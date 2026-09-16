import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import { ValidationError } from '../../lib/validate.js';
import type { ApiResponse, MemberPinDto, UpsertMemberPinBody, GeocodeResult } from '@dem/shared';

export const memberPinsRouter = Router();

// ── GET /api/guilds/:guildId/member-pins ──────────────────────────────────────
// Returns all pins for the guild. userId is never included in the response.

memberPinsRouter.get('/:guildId/member-pins', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  try {
    const guild = await prisma.guild.findUnique({ where: { guildId }, select: { id: true } });
    if (!guild) {
      res.status(404).json({ success: false, error: 'Guild not found' } satisfies ApiResponse);
      return;
    }
    const pins = await prisma.memberPin.findMany({
      where: { guildId: guild.id },
      select: { id: true, lat: true, lng: true, municipality: true, displayName: true },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ success: true, data: pins } satisfies ApiResponse<MemberPinDto[]>);
  } catch (err) {
    console.error('[GET member-pins]', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});

// ── GET /api/guilds/:guildId/member-pins/mine ─────────────────────────────────
// Returns the current user's own pin (for "is my pin set / what are my current settings").

memberPinsRouter.get('/:guildId/member-pins/mine', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  try {
    const guild = await prisma.guild.findUnique({ where: { guildId }, select: { id: true } });
    if (!guild) {
      res.status(404).json({ success: false, error: 'Guild not found' } satisfies ApiResponse);
      return;
    }
    const pin = await prisma.memberPin.findUnique({
      where: { guildId_userId: { guildId: guild.id, userId: req.session.userId! } },
      select: { id: true, lat: true, lng: true, municipality: true, displayName: true },
    });
    res.json({ success: true, data: pin ?? null } satisfies ApiResponse<MemberPinDto | null>);
  } catch (err) {
    console.error('[GET member-pins/mine]', err);
    res.status(500).json({ success: false, error: 'Internal server error' } satisfies ApiResponse);
  }
});

// ── PUT /api/guilds/:guildId/member-pins ──────────────────────────────────────
// Upsert (create or update) the current user's pin.

memberPinsRouter.put('/:guildId/member-pins', requireAuth, async (req, res) => {
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

    const pin = await prisma.memberPin.upsert({
      where: { guildId_userId: { guildId: guild.id, userId: req.session.userId! } },
      create: {
        guildId: guild.id,
        userId: req.session.userId!,
        lat,
        lng,
        municipality: body.municipality.trim().slice(0, 200),
        displayName,
      },
      update: {
        lat,
        lng,
        municipality: body.municipality.trim().slice(0, 200),
        displayName,
        updatedAt: new Date(),
      },
      select: { id: true, lat: true, lng: true, municipality: true, displayName: true },
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

memberPinsRouter.delete('/:guildId/member-pins', requireAuth, async (req, res) => {
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

// ── GET /api/guilds/:guildId/member-pins/geocode?lat=X&lng=Y ─────────────────
// Server-side reverse geocoding via Nominatim (avoids CSP connect-src issues).
// Returns the municipality name and its canonical center coordinates.

memberPinsRouter.get('/:guildId/member-pins/geocode', requireAuth, async (req, res) => {
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
    const reverseRes = await fetch(reverseUrl, {
      headers: {
        'User-Agent': 'ASOP-Terminal/1.0 (member-map)',
        'Accept-Language': 'en',
      },
    });

    if (!reverseRes.ok) {
      throw new Error(`Nominatim reverse geocode failed: ${reverseRes.status}`);
    }

    const reverseData = await reverseRes.json() as {
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

    // Step 2: forward geocode city to get canonical center coordinates
    // This ensures all members in the same city share identical coordinates
    const forwardUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city + ', ' + country)}&format=json&limit=1&addressdetails=0`;
    const forwardRes = await fetch(forwardUrl, {
      headers: {
        'User-Agent': 'ASOP-Terminal/1.0 (member-map)',
        'Accept-Language': 'en',
      },
    });

    if (forwardRes.ok) {
      const forwardData = await forwardRes.json() as Array<{ lat: string; lon: string }>;
      if (forwardData[0]) {
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
