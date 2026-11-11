// SC Database search (Org Settings → SC Database).
//
// v1.11.1: reads our sc-data copy (Postgres schema `scdata`, kept up to date by
// the sc-data worker; see apps/sc-data/README.md) instead of the old Sc* Prisma
// tables, which were filled by a separate weekly download in the API. That
// download is retired. The scdata schema isn't managed by Prisma, so it's read
// with $queryRaw. Sync status and "Sync now" live at /api/game-data/*.
//
// Each list answers up to 50 rows, closest name matches first, with the
// fields the page shows (title from name / outputName / displayName / value,
// subtitle from type / outputType / kind / tier).

import { Router, type Request, type Response } from 'express';
import { Prisma } from '@prisma/client';
import { isGameDataMissingError, type ApiResponse } from '@dem/shared';
import { prisma } from '../../lib/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';

export const scRouter = Router();

export const SC_SEARCH_LIMIT = 50;

/** Escapes LIKE wildcards so a search for "50%" means the text "50%". */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** The `q` parameter, trimmed; at least 2 characters (shorter answers nothing). */
function searchTerm(req: Request): string | null {
  const q = typeof req.query['q'] === 'string' ? req.query['q'].trim().slice(0, 100) : '';
  return q.length >= 2 ? q : null;
}

/** Runs one search: `contains` and `prefix` are ILIKE patterns for the term. */
function searchRoute(path: string, query: (contains: string, prefix: string) => Prisma.Sql) {
  scRouter.get(path, requireAuth, async (req: Request, res: Response) => {
    const q = searchTerm(req);
    if (!q) { res.json({ success: true, data: [] } satisfies ApiResponse<unknown[]>); return; }
    const esc = likeEscape(q);
    try {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>(query(`%${esc}%`, `${esc}%`));
      res.json({ success: true, data: rows } satisfies ApiResponse<unknown[]>);
    } catch (err) {
      if (isGameDataMissingError(err)) { res.json({ success: true, data: [] } satisfies ApiResponse<unknown[]>); return; }
      console.error(`[sc] ${path}:`, err);
      res.status(500).json({ success: false, error: 'Could not search the game data' } satisfies ApiResponse);
    }
  });
}

const limit = Prisma.raw(String(SC_SEARCH_LIMIT));

// ── Blueprints: by the crafted item's name ───────────────────────────────────
searchRoute('/sc/blueprints', (c, p) => Prisma.sql`
  SELECT b.uuid, b.key,
         coalesce(b.data->'Output'->>'Name', b.output_class) AS "outputName",
         b.output_type AS "outputType",
         b.data->'Output'->>'Subtype' AS "outputSubtype",
         b.data->'Output'->>'Grade' AS "outputGrade",
         b.kind,
         jsonb_array_length(coalesce(b.data->'Tiers', '[]'::jsonb)) AS "tierCount",
         (b.data->'Dismantle'->>'TimeSeconds')::double precision AS "dismantleTimeSecs",
         (b.data->'Dismantle'->>'Efficiency')::double precision AS "dismantleEfficiency"
  FROM scdata.blueprints b
  WHERE coalesce(b.data->'Output'->>'Name', b.output_class) ILIKE ${c}
  ORDER BY coalesce(b.data->'Output'->>'Name', b.output_class) ILIKE ${p} DESC, 3
  LIMIT ${limit}`);

// ── Ship items (components, weapons…): by name, class or type ───────────────
// Type matters: shield generators are named "5CA 'Akura'", so "shield" finds them by type.
searchRoute('/sc/ship-items', (c, p) => Prisma.sql`
  SELECT uuid, name, class_name AS "className", type, sub_type AS "subType", size, grade,
         classification, manufacturer_name AS manufacturer, mass
  FROM scdata.items
  WHERE is_ship_item AND NOT is_placeholder
    AND (name ILIKE ${c} OR class_name ILIKE ${c} OR type ILIKE ${c} OR sub_type ILIKE ${c})
  ORDER BY name ILIKE ${p} DESC, name ILIKE ${c} DESC, type, size, name NULLS LAST
  LIMIT ${limit}`);

// ── Commodities ──────────────────────────────────────────────────────────────
searchRoute('/sc/commodities', (c, p) => Prisma.sql`
  SELECT uuid, name, key, tier
  FROM scdata.commodities
  WHERE name ILIKE ${c} OR key ILIKE ${c}
  ORDER BY name ILIKE ${p} DESC, name NULLS LAST
  LIMIT ${limit}`);

// ── Resources (mineables and other raw materials) ───────────────────────────
searchRoute('/sc/resources', (c, p) => Prisma.sql`
  SELECT uuid, name, kind, key
  FROM scdata.resources
  WHERE name ILIKE ${c} OR key ILIKE ${c}
  ORDER BY name ILIKE ${p} DESC, name NULLS LAST
  LIMIT ${limit}`);

// ── Starmap (systems, planets, moons, stations…) ────────────────────────────
searchRoute('/sc/starmap', (c, p) => Prisma.sql`
  SELECT s.uuid, s.name, s.type_name AS type, parent.name AS parent
  FROM scdata.starmap s
  LEFT JOIN scdata.starmap parent ON parent.uuid = s.parent_uuid
  WHERE NOT s.is_placeholder AND s.name ILIKE ${c}
  ORDER BY s.name ILIKE ${p} DESC, s.name
  LIMIT ${limit}`);

// ── Trade locations ──────────────────────────────────────────────────────────
searchRoute('/sc/trade-locations', (c, p) => Prisma.sql`
  SELECT uuid, display_name AS "displayName", class_name AS "className", disabled
  FROM scdata.trade_locations
  WHERE display_name ILIKE ${c} OR class_name ILIKE ${c}
  ORDER BY display_name ILIKE ${p} DESC, display_name NULLS LAST
  LIMIT ${limit}`);

// ── Manufacturers ────────────────────────────────────────────────────────────
searchRoute('/sc/manufacturers', (c, p) => Prisma.sql`
  SELECT uuid, name, code, description
  FROM scdata.manufacturers
  WHERE name ILIKE ${c} OR code ILIKE ${c}
  ORDER BY name ILIKE ${p} DESC, name NULLS LAST
  LIMIT ${limit}`);

// ── Labels (the game's localisation strings) ────────────────────────────────
searchRoute('/sc/labels', (c, p) => Prisma.sql`
  SELECT key, value
  FROM scdata.labels
  WHERE value ILIKE ${c} OR key ILIKE ${c}
  ORDER BY value ILIKE ${p} DESC, value
  LIMIT ${limit}`);
