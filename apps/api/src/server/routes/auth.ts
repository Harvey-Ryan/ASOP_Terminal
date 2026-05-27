import { Router } from 'express';
import crypto from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { buildOAuthUrl, exchangeCode, fetchDiscordUser, fetchDiscordGuilds } from '../../lib/discord-oauth.js';
import { getValidAccessToken } from '../../lib/token-helpers.js';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  buildFleetyardsOAuthUrl,
  exchangeFleetyardsCode,
  fetchFleetyardsUser,
  importHangar,
  generateCodeVerifier,
  generateCodeChallenge,
} from '../../lib/fleetyardsOAuth.js';
import {
  getGuildIconUrl,
  resolveAvatarUrl,
} from '@dem/shared';
import type { ApiResponse, DiscordUser, ManagedGuild, MeResponse } from '@dem/shared';

export const authRouter = Router();

const WEB_URL = () => process.env.WEB_URL ?? 'http://localhost:5173';

// ── GET /api/auth/login ───────────────────────────────────────────────────────

authRouter.get('/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;

  req.session.save((err) => {
    if (err) {
      res.status(500).json({ success: false, error: 'Session save failed' } satisfies ApiResponse);
      return;
    }
    const oauthUrl = buildOAuthUrl(state);
    console.log('[auth/login] redirecting to:', oauthUrl);
    res.redirect(oauthUrl);
  });
});

// ── GET /api/auth/callback ────────────────────────────────────────────────────

authRouter.get('/callback', async (req, res) => {
  const { code, state, error } = req.query as Record<string, string | undefined>;

  if (error) {
    res.redirect(`${WEB_URL()}/login?error=access_denied`);
    return;
  }

  // Validate CSRF state to prevent open-redirect attacks
  if (!state || state !== req.session.oauthState) {
    res.redirect(`${WEB_URL()}/login?error=invalid_state`);
    return;
  }

  if (!code) {
    res.redirect(`${WEB_URL()}/login?error=no_code`);
    return;
  }

  try {
    const tokens = await exchangeCode(code);
    const expiresAt = Math.floor(Date.now() / 1000) + tokens.expires_in;
    const discordUser = await fetchDiscordUser(tokens.access_token);

    // Upsert the User record (profile fields may change between logins)
    const user = await prisma.user.upsert({
      where: { discordId: discordUser.id },
      update: {
        username: discordUser.username,
        discriminator: discordUser.discriminator,
        globalName: discordUser.global_name,
        avatar: discordUser.avatar,
        email: discordUser.email ?? null,
      },
      create: {
        discordId: discordUser.id,
        username: discordUser.username,
        discriminator: discordUser.discriminator,
        globalName: discordUser.global_name,
        avatar: discordUser.avatar,
        email: discordUser.email ?? null,
      },
    });

    // Upsert the Account record (always store freshest tokens)
    await prisma.account.upsert({
      where: { provider_providerAccountId: { provider: 'discord', providerAccountId: discordUser.id } },
      update: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt,
        tokenType: tokens.token_type,
        scope: tokens.scope,
      },
      create: {
        userId: user.id,
        provider: 'discord',
        providerAccountId: discordUser.id,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt,
        tokenType: tokens.token_type,
        scope: tokens.scope,
      },
    });

    // Regenerate session ID to prevent session fixation
    req.session.regenerate((regenErr) => {
      if (regenErr) {
        res.redirect(`${WEB_URL()}/login?error=session_error`);
        return;
      }
      req.session.userId = user.id;
      req.session.save((saveErr) => {
        if (saveErr) {
          res.redirect(`${WEB_URL()}/login?error=session_error`);
          return;
        }
        res.redirect(`${WEB_URL()}/dashboard`);
      });
    });
  } catch (err) {
    console.error('[auth/callback]', err);
    res.redirect(`${WEB_URL()}/login?error=auth_failed`);
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────

authRouter.get('/me', requireAuth, async (req, res) => {
  try {
    const dbUser = await prisma.user.findUniqueOrThrow({
      where: { id: req.session.userId },
    });

    const account = await prisma.account.findFirst({
      where: { userId: dbUser.id, provider: 'discord' },
    });

    let guilds: ManagedGuild[] = [];

    if (account) {
      try {
        const accessToken = await getValidAccessToken(account);
        const [raw, botGuildRows] = await Promise.all([
          fetchDiscordGuilds(accessToken),
          prisma.guild.findMany({ select: { guildId: true } }),
        ]);
        const botGuildIds = new Set(botGuildRows.map((g) => g.guildId));
        guilds = raw
          .filter((g) => botGuildIds.has(g.id))
          .map((g) => ({
            id: g.id,
            name: g.name,
            icon: g.icon,
            iconUrl: getGuildIconUrl(g.id, g.icon),
            owner: g.owner,
            permissions: g.permissions,
            hasBotInstalled: true,
          }))
          .sort((a, b) => {
            if (a.owner !== b.owner) return a.owner ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
      } catch {
        // Non-fatal: return empty guild list rather than failing /me entirely
      }
    }

    const user: DiscordUser = {
      id: dbUser.discordId,
      username: dbUser.username,
      discriminator: dbUser.discriminator,
      globalName: dbUser.globalName,
      avatar: dbUser.avatar,
      avatarUrl: resolveAvatarUrl(dbUser.discordId, dbUser.discriminator, dbUser.avatar),
      email: dbUser.email ?? undefined,
    };

    res.json({
      success: true,
      data: { user, guilds } satisfies MeResponse,
    } satisfies ApiResponse<MeResponse>);
  } catch (err) {
    console.error('[auth/me]', err);
    res.status(500).json({ success: false, error: 'Failed to load user' } satisfies ApiResponse);
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────

authRouter.post('/logout', requireAuth, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      res.status(500).json({ success: false, error: 'Logout failed' } satisfies ApiResponse);
      return;
    }
    res.clearCookie('dem.sid');
    res.json({ success: true, message: 'Logged out successfully' } satisfies ApiResponse);
  });
});

// ── GET /api/auth/fleetyards ──────────────────────────────────────────────────
// Starts the FleetYards OAuth flow. Gated on FLEETYARDS_CLIENT_ID being set.
// Optional ?guildId= query param tells the callback where to redirect afterwards.

authRouter.get('/fleetyards', requireAuth, (req, res) => {
  if (!process.env['FLEETYARDS_CLIENT_ID']) {
    res.status(503).json({ success: false, error: 'FleetYards integration is not configured' } satisfies ApiResponse);
    return;
  }

  const state = crypto.randomBytes(16).toString('hex');
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  req.session.fyOAuthState = state;
  req.session.fyCodeVerifier = codeVerifier;
  const guildId = req.query['guildId'] as string | undefined;
  if (guildId) req.session.fyReturnGuildId = guildId;

  req.session.save((err) => {
    if (err) {
      res.status(500).json({ success: false, error: 'Session save failed' } satisfies ApiResponse);
      return;
    }
    res.redirect(buildFleetyardsOAuthUrl(state, codeChallenge));
  });
});

// ── GET /api/auth/fleetyards/callback ─────────────────────────────────────────
// Exchanges the code, imports the user's hangar, then redirects back to the
// fleet page. All FY OAuth errors redirect back with a ?fy= query param.

authRouter.get('/fleetyards/callback', requireAuth, async (req, res) => {
  const { code, state, error } = req.query as Record<string, string | undefined>;
  const returnGuildId = req.session.fyReturnGuildId;
  const returnPath = returnGuildId ? `/servers/${returnGuildId}/fleet` : '/dashboard';

  if (error) {
    res.redirect(`${WEB_URL()}${returnPath}?fy=access_denied`);
    return;
  }
  if (!state || state !== req.session.fyOAuthState) {
    res.redirect(`${WEB_URL()}${returnPath}?fy=invalid_state`);
    return;
  }
  if (!code) {
    res.redirect(`${WEB_URL()}${returnPath}?fy=no_code`);
    return;
  }

  const codeVerifier = req.session.fyCodeVerifier;
  if (!codeVerifier) {
    res.redirect(`${WEB_URL()}${returnPath}?fy=invalid_state`);
    return;
  }

  try {
    const tokens = await exchangeFleetyardsCode(code, codeVerifier);
    const expiresAt = Math.floor(Date.now() / 1000) + tokens.expires_in;
    const fyUser = await fetchFleetyardsUser(tokens.access_token);

    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: req.session.userId } });

    await prisma.fleetyardsLink.upsert({
      where: { userId: dbUser.id },
      update: {
        fyUserId: fyUser.username,
        fyUsername: fyUser.username,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        expiresAt,
      },
      create: {
        userId: dbUser.id,
        fyUserId: fyUser.username,
        fyUsername: fyUser.username,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        expiresAt,
      },
    });

    await importHangar(dbUser.id, dbUser.discordId, dbUser.globalName ?? dbUser.username, tokens.access_token, returnGuildId);

    req.session.fyOAuthState = undefined;
    req.session.fyCodeVerifier = undefined;
    req.session.fyReturnGuildId = undefined;
    req.session.save(() => {
      res.redirect(`${WEB_URL()}${returnPath}?fy=linked`);
    });
  } catch (err) {
    console.error('[auth/fleetyards/callback]', err);
    res.redirect(`${WEB_URL()}${returnPath}?fy=error`);
  }
});

