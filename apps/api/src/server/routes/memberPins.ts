import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { assertEventViewer } from '../../lib/assertEventViewer.js';
import { prisma } from '../../lib/prisma.js';
import { ValidationError } from '../../lib/validate.js';
import type { ApiResponse, MemberPinDto, UpsertMemberPinBody, GeocodeResult, MunicipalitySearchResult } from '@dem/shared';

export const memberPinsRouter = Router();

// v1.21.1: the map is for people who can see the server's events (same rule as
// the rest of the server page). Previously any signed-in user could read any
// server's pins, or put a pin on its map.
async function canViewServer(req: Request, res: Response, next: NextFunction) {
  try {
    if (await assertEventViewer(req, (req.params as { guildId: string }).guildId)) return next();
    res.status(403).json({ success: false, error: 'You don\'t have access to this server\'s map.' } satisfies ApiResponse);
  } catch (err) { next(err); }
}

// ── Nominatim (OpenStreetMap geocoding) ───────────────────────────────────────
// Their usage policy allows at most one request a second from the whole app, so
// requests are spaced out and answers are cached for a day.

const NOMINATIM_GAP_MS = 1100;
const NOMINATIM_CACHE_MS = 24 * 60 * 60 * 1000;
const nominatimCache = new Map<string, { at: number; body: unknown }>();
let nominatimQueue: Promise<unknown> = Promise.resolve();

export async function nominatim(url: string): Promise<unknown> {
  const hit = nominatimCache.get(url);
  if (hit && Date.now() - hit.at < NOMINATIM_CACHE_MS) return hit.body;
  const run = nominatimQueue.then(async () => {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'ASOP-Terminal/1.0 (member-map)', 'Accept-Language': 'en' },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error(`Nominatim ${r.status}`);
      const body = await r.json() as unknown;
      if (nominatimCache.size >= 500) nominatimCache.delete(nominatimCache.keys().next().value!);
      nominatimCache.set(url, { at: Date.now(), body });
      return body;
    } finally {
      await new Promise((ok) => setTimeout(ok, NOMINATIM_GAP_MS));
    }
  });
  nominatimQueue = run.catch(() => undefined);
  return run;
}

// ── Timezone backfill helper ──────────────────────────────────────────────────
// Pins placed before the timezone column was added have timezone = null.
// This helper looks up the IANA timezone for each such pin from timeapi.io,
// writes it to the DB, and mutates the in-memory object so the caller's response
// already contains the correct value without a second round-trip.

type PinWithTimezone = { id: string; lat: number; lng: number; timezone: string | null };

// Pins whose lookup failed aren't retried for a while, so a slow or down
// timeapi.io doesn't slow every map load.
const tzTried = new Map<string, number>();
const TZ_RETRY_MS = 6 * 60 * 60 * 1000;

async function backfillTimezones(pins: PinWithTimezone[]): Promise<void> {
  const now = Date.now();
  const missing = pins.filter((p) => !p.timezone && now - (tzTried.get(p.id) ?? 0) > TZ_RETRY_MS).slice(0, 10);
  if (missing.length === 0) return;
  for (const p of missing) tzTried.set(p.id, now);
  await Promise.allSettled(
    missing.map(async (pin) => {
      try {
        const tzRes = await fetch(
          `https://timeapi.io/api/TimeZone/coordinate?latitude=${pin.lat}&longitude=${pin.lng}`,
          {
            headers: { Accept: 'application/json', 'User-Agent': 'ASOP-Terminal/1.0' },
            signal: AbortSignal.timeout(4000),
          },
        );
        if (!tzRes.ok) return;
        const tzJson = await tzRes.json() as { timeZone?: string };
        if (typeof tzJson.timeZone === 'string' && tzJson.timeZone) {
          await prisma.memberPin.update({ where: { id: pin.id }, data: { timezone: tzJson.timeZone } });
          pin.timezone = tzJson.timeZone; // mutate so the current response carries the real timezone
        }
      } catch { /* ignore — pin.timezone stays null; client falls back to longitude estimate */ }
    }),
  );
}

// ── GET /api/guilds/:guildId/member-pins ──────────────────────────────────────
// Returns all pins for the guild. userId is never included in the response.

memberPinsRouter.get('/:guildId/member-pins', requireAuth, canViewServer, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  try {
    const guild = await prisma.guild.findUnique({ where: { guildId }, select: { id: true } });
    if (!guild) {
      res.status(404).json({ success: false, error: 'Guild not found' } satisfies ApiResponse);
      return;
    }
    const pins = await prisma.memberPin.findMany({
      where: { guildId: guild.id },
      select: { id: true, lat: true, lng: true, municipality: true, displayName: true, timezone: true },
      orderBy: { createdAt: 'asc' },
    });
    // Lazily fill in any timezones missing from pins placed before the column existed.
    // Awaited so this response already returns accurate timezone data.
    await backfillTimezones(pins);
    res.json({ success: true, data: pins } satisfies ApiResponse<MemberPinDto[]>);
  } catch (err) {
    console.error('[GET member-pins]', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});

// ── GET /api/guilds/:guildId/member-pins/mine ─────────────────────────────────
// Returns the current user's own pin (for "is my pin set / what are my current settings").

memberPinsRouter.get('/:guildId/member-pins/mine', requireAuth, canViewServer, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  try {
    const guild = await prisma.guild.findUnique({ where: { guildId }, select: { id: true } });
    if (!guild) {
      res.status(404).json({ success: false, error: 'Guild not found' } satisfies ApiResponse);
      return;
    }
    const pin = await prisma.memberPin.findUnique({
      where: { guildId_userId: { guildId: guild.id, userId: req.session.userId! } },
      select: { id: true, lat: true, lng: true, municipality: true, displayName: true, timezone: true },
    });
    if (pin) await backfillTimezones([pin]);
    res.json({ success: true, data: pin ?? null } satisfies ApiResponse<MemberPinDto | null>);
  } catch (err) {
    console.error('[GET member-pins/mine]', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});

// ── PUT /api/guilds/:guildId/member-pins ──────────────────────────────────────
// Upsert (create or update) the current user's pin.

memberPinsRouter.put('/:guildId/member-pins', requireAuth, canViewServer, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  try {
    const guild = await prisma.guild.findUnique({ where: { guildId }, select: { id: true } });
    if (!guild) {
      res.status(404).json({ success: false, error: 'Guild not found' } satisfies ApiResponse);
      return;
    }

    const body = req.body as UpsertMemberPinBody;
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (isNaN(lat) || lat < -90 || lat > 90) throw new ValidationError('lat must be between -90 and 90');
    if (isNaN(lng) || lng < -180 || lng > 180) throw new ValidationError('lng must be between -180 and 180');
    if (typeof body.municipality !== 'string' || !body.municipality.trim()) {
      throw new ValidationError('municipality is required');
    }

    // Resolve display name server-side to avoid spoofing
    let displayName: string | null = null;
    if (body.showName === true) {
      const user = await prisma.user.findUnique({
        where: { id: req.session.userId! },
        select: { globalName: true, username: true },
      });
      displayName = user?.globalName ?? user?.username ?? null;
    }

    // Look up the IANA timezone for these coordinates so the client can show
    // accurate DST-aware local time. Best-effort: if the external API is
    // unavailable we save null and the client falls back to a longitude estimate.
    let timezone: string | null = null;
    try {
      const tzRes = await fetch(
        `https://timeapi.io/api/TimeZone/coordinate?latitude=${lat}&longitude=${lng}`,
        {
          headers: { Accept: 'application/json', 'User-Agent': 'ASOP-Terminal/1.0' },
          signal: AbortSignal.timeout(4000),
        },
      );
      if (tzRes.ok) {
        const tzJson = await tzRes.json() as { timeZone?: string };
        if (typeof tzJson.timeZone === 'string' && tzJson.timeZone) {
          timezone = tzJson.timeZone; // e.g. "America/Chicago"
        }
      }
    } catch {
      // ignore — timezone stays null, client will use longitude estimate
    }

    const pin = await prisma.memberPin.upsert({
      where: { guildId_userId: { guildId: guild.id, userId: req.session.userId! } },
      create: {
        guildId: guild.id,
        userId: req.session.userId!,
        lat,
        lng,
        municipality: body.municipality.trim().slice(0, 200),
        displayName,
        timezone,
      },
      update: {
        lat,
        lng,
        municipality: body.municipality.trim().slice(0, 200),
        displayName,
        timezone,
        updatedAt: new Date(),
      },
      select: { id: true, lat: true, lng: true, municipality: true, displayName: true, timezone: true },
    });

    res.json({ success: true, data: pin } satisfies ApiResponse<MemberPinDto>);
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ success: false, error: err.message } satisfies ApiResponse);
      return;
    }
    console.error('[PUT member-pins]', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});

// ── DELETE /api/guilds/:guildId/member-pins ───────────────────────────────────
// Remove the current user's pin.

memberPinsRouter.delete('/:guildId/member-pins', requireAuth, canViewServer, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  try {
    const guild = await prisma.guild.findUnique({ where: { guildId }, select: { id: true } });
    if (!guild) {
      res.status(404).json({ success: false, error: 'Guild not found' } satisfies ApiResponse);
      return;
    }
    await prisma.memberPin.deleteMany({
      where: { guildId: guild.id, userId: req.session.userId! },
    });
    res.json({ success: true } satisfies ApiResponse);
  } catch (err) {
    console.error('[DELETE member-pins]', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});

// ── GET /api/guilds/:guildId/member-pins/search?q=NAME ───────────────────────
// Forward geocoding by place name — proxied through the API to avoid CSP issues.

memberPinsRouter.get('/:guildId/member-pins/search', requireAuth, canViewServer, async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q) {
    res.json({ success: true, data: [] } satisfies ApiResponse<MunicipalitySearchResult[]>);
    return;
  }

  try {
    const url =
      `https://nominatim.openstreetmap.org/search` +
      `?q=${encodeURIComponent(q)}&format=json&limit=6&addressdetails=1`;

    let found: unknown;
    try { found = await nominatim(url); } catch (err) {
      console.warn('[GET member-pins/search] Nominatim unavailable', err);
      res.status(502).json({ success: false, error: 'Geocoding service unavailable' } satisfies ApiResponse);
      return;
    }

    const raw = (Array.isArray(found) ? found : []) as Array<{
      display_name: string;
      lat: string;
      lon: string;
      name: string;
      address?: Record<string, string>;
    }>;

    const seen = new Set<string>();
    const data: MunicipalitySearchResult[] = [];

    for (const r of raw) {
      const addr  = r.address ?? {};
      const city  = addr['city'] ?? addr['town'] ?? addr['village'] ?? addr['county'] ?? r.name;
      if (!city) continue;
      // Include state + country so results are unambiguous ("Joplin, Missouri, United States"
      // rather than just "Joplin") and match the format the geocode endpoint returns.
      const state   = addr['state']   ?? '';
      const country = addr['country'] ?? '';
      const municipality = [city, state, country].filter(Boolean).join(', ');
      const key = municipality.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      data.push({
        displayName: r.display_name,
        municipality,
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lon),
      });
    }

    res.json({ success: true, data } satisfies ApiResponse<MunicipalitySearchResult[]>);
  } catch (err) {
    console.error('[GET member-pins/search]', err);
    res.status(500).json({ success: false, error: 'Search failed' } satisfies ApiResponse);
  }
});

// ── GET /api/guilds/:guildId/member-pins/geocode?lat=X&lng=Y ─────────────────
// Server-side reverse geocoding via Nominatim (avoids CSP connect-src issues).
// Returns the municipality name and its canonical center coordinates.

memberPinsRouter.get('/:guildId/member-pins/geocode', requireAuth, canViewServer, async (req, res) => {
  const rawLat = req.query['lat'];
  const rawLng = req.query['lng'];
  const lat = parseFloat(typeof rawLat === 'string' ? rawLat : '');
  const lng = parseFloat(typeof rawLng === 'string' ? rawLng : '');

  if (isNaN(lat) || lat < -90 || lat > 90 || isNaN(lng) || lng < -180 || lng > 180) {
    res.status(400).json({ success: false, error: 'Invalid lat/lng' } satisfies ApiResponse);
    return;
  }

  try {
    // Step 1: reverse geocode to get city/town name
    const reverseUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10`;
    const reverseData = await nominatim(reverseUrl) as {
      address?: {
        city?: string; town?: string; village?: string; county?: string;
        state?: string; country?: string;
      };
    };

    const addr = reverseData.address ?? {};
    const city = addr.city ?? addr.town ?? addr.village ?? addr.county ?? '';
    const state = addr.state ?? '';
    const country = addr.country ?? '';

    if (!city && !country) {
      // Likely clicked on ocean or remote area — round coordinates as fallback
      res.json({
        success: true,
        data: { lat: Math.round(lat * 10) / 10, lng: Math.round(lng * 10) / 10, municipality: 'Remote Location' },
      } satisfies ApiResponse<GeocodeResult>);
      return;
    }

    const municipalityName = [city, state, country].filter(Boolean).join(', ');

    // Step 2: forward geocode to get canonical center coordinates.
    // Include state so "Jasper County, Missouri, United States" doesn't
    // resolve to the first matching county in any other state.
    const forwardQuery = [city, state, country].filter(Boolean).join(', ');
    const forwardUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(forwardQuery)}&format=json&limit=1&addressdetails=0`;
    const forwardData = await nominatim(forwardUrl).catch(() => null) as Array<{ lat: string; lon: string }> | null;
    {
      if (Array.isArray(forwardData) && forwardData[0]) {
        res.json({
          success: true,
          data: {
            lat: parseFloat(forwardData[0].lat),
            lng: parseFloat(forwardData[0].lon),
            municipality: municipalityName,
          },
        } satisfies ApiResponse<GeocodeResult>);
        return;
      }
    }

    // Fallback: use original coordinates if forward geocode fails
    res.json({
      success: true,
      data: { lat, lng, municipality: municipalityName },
    } satisfies ApiResponse<GeocodeResult>);
  } catch (err) {
    console.error('[GET member-pins/geocode]', err);
    res.status(500).json({ success: false, error: 'Geocoding failed' } satisfies ApiResponse);
  }
});
