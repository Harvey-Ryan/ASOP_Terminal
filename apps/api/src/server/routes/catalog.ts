import { Router, type RequestHandler } from 'express';
import type { ApiResponse, CatalogEntry, CatalogDetail, CatalogKind, InventoryLinkStatus } from '@dem/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { getCatalog, getCatalogDetail, inventoryLinkStatus } from '../../lib/catalog.js';
import { getPlatformAdmin } from '../../lib/platformAdmin.js';

// Game item catalog (sc-data): the item and commodity search behind every
// item picker, and item details. Public like the UEX lookups it replaces.

export const catalogRouter = Router();

/** Express 4 doesn't catch async errors; answer 503 instead of hanging. */
const safe = (fn: RequestHandler): RequestHandler => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch((err) => {
    console.error(`[catalog] ${req.path}:`, err instanceof Error ? err.message : err);
    if (!res.headersSent) res.status(503).json({ success: false, error: 'Game data is unavailable right now' } satisfies ApiResponse);
  });
};

// GET /api/catalog/search?q=…&kind=ITEM|COMMODITY&limit=…
catalogRouter.get('/catalog/search', safe(async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : '';
  const kindParam = typeof req.query.kind === 'string' ? req.query.kind.toUpperCase() : '';
  const kinds: CatalogKind[] | undefined = kindParam === 'ITEM' || kindParam === 'COMMODITY' ? [kindParam] : undefined;
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '25'), 10) || 25, 1), 100);

  const catalog = await getCatalog();
  const data = catalog.search(q, { kinds, limit }).map(({ minor: _minor, ...e }) => e);
  res.json({ success: true, data } satisfies ApiResponse<CatalogEntry[]>);
}));

// GET /api/catalog/item/:ref (ref = "ITEM:<uuid>" or "COMMODITY:<uuid>")
catalogRouter.get('/catalog/item/:ref', safe(async (req, res) => {
  const detail = await getCatalogDetail(String(req.params['ref'] ?? ''));
  if (!detail) {
    res.status(404).json({ success: false, error: 'Not in the game data' } satisfies ApiResponse);
    return;
  }
  res.json({ success: true, data: detail } satisfies ApiResponse<CatalogDetail>);
}));

// GET /api/catalog/inventory-links: how many saved inventory entries (all servers)
// are linked to game items. Platform admins only.
catalogRouter.get('/catalog/inventory-links', requireAuth, safe(async (req, res) => {
  if (!(await getPlatformAdmin(req.session.userId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }
  res.json({ success: true, data: await inventoryLinkStatus() } satisfies ApiResponse<InventoryLinkStatus>);
}));
