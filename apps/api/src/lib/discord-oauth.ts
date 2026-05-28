// All Discord API v10 interactions needed for the OAuth2 flow.
// Uses native fetch (Node.js 20+) – no extra HTTP library required.

const DISCORD_API = 'https://discord.com/api/v10';

// ── Response shapes from Discord API ─────────────────────────────────────────

export interface DiscordTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export interface DiscordApiUser {
  id: string;
  username: string;
  discriminator: string;
  global_name: string | null;
  avatar: string | null;
  email?: string;
}

export interface DiscordApiGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Builds the Discord consent-screen URL with a CSRF state token. */
export function buildOAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID ?? '',
    redirect_uri: process.env.DISCORD_REDIRECT_URI ?? '',
    response_type: 'code',
    scope: 'identify guilds email',
    prompt: 'none',
    state,
  });
  return `${DISCORD_API}/oauth2/authorize?${params.toString()}`;
}

/** Exchanges an authorization code for an access + refresh token pair. */
export async function exchangeCode(code: string): Promise<DiscordTokenResponse> {
  const body = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID ?? '',
    client_secret: process.env.DISCORD_CLIENT_SECRET ?? '',
    grant_type: 'authorization_code',
    code,
    redirect_uri: process.env.DISCORD_REDIRECT_URI ?? '',
  });

  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<DiscordTokenResponse>;
}

/** Trades an expired access token for a fresh one using the refresh token. */
export async function refreshAccessToken(refreshToken: string): Promise<DiscordTokenResponse> {
  const body = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID ?? '',
    client_secret: process.env.DISCORD_CLIENT_SECRET ?? '',
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`Token refresh failed (${res.status})`);
  }

  return res.json() as Promise<DiscordTokenResponse>;
}

/** Fetches the Discord user object for the given access token. */
export async function fetchDiscordUser(accessToken: string): Promise<DiscordApiUser> {
  const res = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`User fetch failed (${res.status})`);
  }

  return res.json() as Promise<DiscordApiUser>;
}

export class GuildsFetchError extends Error {
  constructor(
    public readonly status: number,
    public readonly retryAfterMs: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'GuildsFetchError';
  }
}

/** Fetches all guilds the authed user is a member of. */
export async function fetchDiscordGuilds(accessToken: string): Promise<DiscordApiGuild[]> {
  const res = await fetch(`${DISCORD_API}/users/@me/guilds`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const retryAfterMs = res.status === 429
      ? Math.ceil(parseFloat(res.headers.get('Retry-After') ?? '5') * 1000)
      : null;
    throw new GuildsFetchError(res.status, retryAfterMs, `Guilds fetch failed (${res.status})`);
  }

  return res.json() as Promise<DiscordApiGuild[]>;
}
