import crypto from 'node:crypto';
import { prisma } from './prisma.js';

const FY_WEB = 'https://fleetyards.net';
const FY_API = 'https://api.fleetyards.net/v1';
const MAX_PAGES = 20;

export interface FYTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

export interface FYUser {
  username: string;
}

export interface FYHangarItem {
  model: {
    slug: string;
    name: string;
    manufacturer: { name: string } | null;
  } | null;
  quantity: number | null;
}

interface FYHangarPage {
  items: FYHangarItem[];
  meta: { pagination: { totalPages: number } };
}

function getRedirectUri(): string {
  return `${process.env['API_URL'] ?? 'http://localhost:3001'}/api/auth/fleetyards/callback`;
}

/** Generates a PKCE code_verifier (43-128 URL-safe chars, per RFC 7636). */
export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** Computes PKCE code_challenge = BASE64URL(SHA256(verifier)). */
export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export function buildFleetyardsOAuthUrl(state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    client_id: process.env['FLEETYARDS_CLIENT_ID']!,
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    scope: 'read',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${FY_WEB}/oauth/authorize?${params}`;
}

export async function exchangeFleetyardsCode(code: string, codeVerifier: string): Promise<FYTokenResponse> {
  const res = await fetch(`${FY_WEB}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env['FLEETYARDS_CLIENT_ID'],
      client_secret: process.env['FLEETYARDS_CLIENT_SECRET'],
      code,
      grant_type: 'authorization_code',
      redirect_uri: getRedirectUri(),
      code_verifier: codeVerifier,
    }),
  });
  if (!res.ok) throw new Error(`FleetYards token exchange failed: ${res.status}`);
  return res.json() as Promise<FYTokenResponse>;
}

export async function fetchFleetyardsUser(accessToken: string): Promise<FYUser> {
  const res = await fetch(`${FY_API}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`FleetYards user fetch failed: ${res.status}`);
  return res.json() as Promise<FYUser>;
}

export async function fetchFleetyardsHangar(accessToken: string): Promise<FYHangarItem[]> {
  const all: FYHangarItem[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= MAX_PAGES) {
    const res = await fetch(`${FY_API}/hangar?perPage=240&page=${page}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`FleetYards hangar fetch failed: ${res.status}`);
    const json = (await res.json()) as FYHangarPage;
    all.push(...json.items);
    totalPages = json.meta.pagination.totalPages;
    page++;
  }

  return all;
}

// ── Hangar import helper ──────────────────────────────────────────────────────
// Syncs the user's FY hangar into all guilds where they are currently active,
// plus any explicitly supplied initiating guild.

export async function importHangar(
  userId: string,
  discordId: string,
  username: string,
  accessToken: string,
  initiatingGuildId?: string,
): Promise<void> {

  const hangar = await fetchFleetyardsHangar(accessToken);

  // Collect guilds: currently-active entries + the initiating guild
  const activeRows = await prisma.fleetEntry.findMany({
    where: { userId: discordId, memberActive: true },
    select: { guildId: true },
    distinct: ['guildId'],
  });
  const guildIds = new Set(activeRows.map((r) => r.guildId));
  if (initiatingGuildId) guildIds.add(initiatingGuildId);

  for (const guildId of guildIds) {
    const settings = await prisma.guildSettings.findUnique({ where: { guildId } });
    if (settings?.fleetEnabled === false) continue;

    for (const item of hangar) {
      if (!item.model?.slug) continue;
      await prisma.fleetEntry.upsert({
        where: { guildId_userId_shipSlug: { guildId, userId: discordId, shipSlug: item.model.slug } },
        update: {
          username,
          shipName: item.model.name,
          manufacturer: item.model.manufacturer?.name ?? '',
          quantity: item.quantity ?? 1,
        },
        create: {
          guildId,
          userId: discordId,
          username,
          shipSlug: item.model.slug,
          shipName: item.model.name,
          manufacturer: item.model.manufacturer?.name ?? '',
          quantity: item.quantity ?? 1,
        },
      });
    }
  }

  await prisma.fleetyardsLink.update({
    where: { userId },
    data: { lastSyncAt: new Date() },
  });
}
