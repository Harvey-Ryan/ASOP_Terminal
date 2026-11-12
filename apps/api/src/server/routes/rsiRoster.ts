// RSI org roster (moved out of the Fleet routes in v1.32.0; the page is its own
// menu item): the org's RSI members matched to this server's Discord members.

import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import { assertGuildManager } from '../../lib/assertGuildManager.js';
import { getMemberNames } from '../../lib/discordRest.js';
import type { ApiResponse, RsiRosterDto } from '@dem/shared';

export const rsiRosterRouter = Router();

// ── GET /api/guilds/:guildId/rsi/roster ───────────────────────────────────────
// Fetches the RSI org roster and cross-references with app members' RSI handles.
// Requires guild manager. Proxies to the RSI org members API to avoid CORS.

rsiRosterRouter.get('/:guildId/rsi/roster', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };

  if (!(await assertGuildManager(req, guildId))) {
    res.status(403).json({ success: false, error: 'Forbidden' } satisfies ApiResponse);
    return;
  }

  const guild = await prisma.guild.findUnique({ where: { guildId }, include: { settings: true } });
  if (!guild) {
    res.status(404).json({ success: false, error: 'Guild not found' } satisfies ApiResponse);
    return;
  }

  const orgTag = guild.settings?.rsiOrgTag ?? null;

  if (!orgTag) {
    res.json({ success: true, data: { orgTag: null, linked: [], orgOnly: [], total: 0 } satisfies RsiRosterDto } satisfies ApiResponse<RsiRosterDto>);
    return;
  }

  // Fetch all app members for this guild — use per-guild rsiHandle (verified flow)
  // falling back to the global User.rsiHandle for members who haven't re-linked
  const members = await prisma.guildMember.findMany({
    where: { guildId: guild.id },
    include: { user: { select: { discordId: true, username: true, globalName: true, rsiHandle: true } } },
  });

  // Fetch RSI org roster (paginated, max 32 per page).
  // The endpoint returns { success:1, data:{ totalrows:N, html:"...rendered li items..." } }
  // — not a members array — so we parse handles and rank stars from the HTML.
  const RSI_PAGE_SIZE = 32;
  let page = 1;
  let totalRows = Infinity;
  const orgMembers: { handle: string; stars: number }[] = [];

  function parseMembersHtml(html: string): { handle: string; stars: number }[] {
    const out: { handle: string; stars: number }[] = [];
    // Split on each member-item block boundary
    const blocks = html.split(/<li[^>]+class="[^"]*member-item[^"]*"/);
    for (const block of blocks.slice(1)) {
      const handleMatch = block.match(/href="\/citizens\/([^"]+)"/);
      if (!handleMatch?.[1]) continue;
      const handle = handleMatch[1].trim();
      // Count active star spans: icon-star followed or preceded by "active" somewhere in its class
      const activeStars = (block.match(/class="[^"]*icon-star[^"]*"\s+style="[^"]*color/g) ?? []).length
        || (block.match(/<span[^>]*class="[^"]*icon-star\s+active[^"]*"/g) ?? []).length
        || (block.match(/active(?:[^"]*)?icon-star|icon-star(?:[^"]*)?active/g) ?? []).length;
      out.push({ handle, stars: activeStars });
    }
    return out;
  }

  try {
    while (orgMembers.length < totalRows) {
      const response = await fetch('https://robertsspaceindustries.com/api/orgs/getOrgMembers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Origin': 'https://robertsspaceindustries.com',
          'Referer': `https://robertsspaceindustries.com/en/orgs/${orgTag}`,
        },
        body: JSON.stringify({ symbol: orgTag, page, pagesize: RSI_PAGE_SIZE }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.error(`[rsi/roster] HTTP ${response.status} from RSI:`, body.slice(0, 300));
        res.status(502).json({ success: false, error: `RSI API returned HTTP ${response.status}` } satisfies ApiResponse);
        return;
      }

      const rawText = await response.text();
      let json: { success: number; data: { totalrows: number; html?: string; members?: unknown[] } };
      try {
        json = JSON.parse(rawText);
      } catch {
        console.error('[rsi/roster] Non-JSON response from RSI:', rawText.slice(0, 300));
        res.status(502).json({ success: false, error: 'RSI returned an unexpected response' } satisfies ApiResponse);
        return;
      }

      if (!json.success) {
        console.error('[rsi/roster] RSI returned success=false:', rawText.slice(0, 300));
        res.status(502).json({ success: false, error: 'RSI org not found or is private' } satisfies ApiResponse);
        return;
      }

      totalRows = json.data?.totalrows ?? 0;
      if (totalRows === 0) break;

      const parsed = json.data?.html
        ? parseMembersHtml(json.data.html)
        : (json.data?.members as { handle: string; stars: number }[] | undefined) ?? [];

      if (parsed.length === 0 && page === 1) {
        console.error('[rsi/roster] Could not parse any members from RSI response. html length:', (json.data?.html ?? '').length);
      }

      for (const m of parsed) {
        orgMembers.push(m);
      }
      if (parsed.length < RSI_PAGE_SIZE) break;
      page++;
    }
  } catch (err) {
    console.error('[rsi/roster] Fetch failed:', err);
    res.status(502).json({ success: false, error: 'Failed to reach RSI' } satisfies ApiResponse);
    return;
  }

  // Fetch affiliates — non-fatal, empty set if the call fails or returns nothing
  const affiliateHandleSet = new Set<string>();
  try {
    let affiliatePage = 1;
    let affiliateTotalRows = Infinity;
    while (affiliateHandleSet.size < affiliateTotalRows) {
      const affResponse = await fetch('https://robertsspaceindustries.com/api/orgs/getOrgMembers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Origin': 'https://robertsspaceindustries.com',
          'Referer': `https://robertsspaceindustries.com/en/orgs/${orgTag}`,
        },
        body: JSON.stringify({ symbol: orgTag, page: affiliatePage, pagesize: RSI_PAGE_SIZE, role: 'affiliate' }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!affResponse.ok) break;
      let affJson: { success: number; data: { totalrows: number; html?: string } };
      try { affJson = JSON.parse(await affResponse.text()); } catch { break; }
      if (!affJson.success) break;
      affiliateTotalRows = affJson.data?.totalrows ?? 0;
      if (affiliateTotalRows === 0) break;
      const parsed = affJson.data?.html ? parseMembersHtml(affJson.data.html) : [];
      for (const m of parsed) affiliateHandleSet.add(m.handle.toLowerCase());
      if (parsed.length < RSI_PAGE_SIZE) break;
      affiliatePage++;
    }
  } catch {
    // Affiliate fetch is non-fatal
  }

  const orgHandleSet = new Set(orgMembers.map((m) => m.handle.toLowerCase()));
  const orgRankMap = new Map(orgMembers.map((m) => [m.handle.toLowerCase(), m.stars]));

  const linked = members
    .filter((m) => m.rsiHandle || m.user.rsiHandle)
    .map((m) => {
      const handle = (m.rsiHandle || m.user.rsiHandle)!;
      const handleLc = handle.toLowerCase();
      return {
        discordId: m.user.discordId,
        discordUsername: m.user.globalName ?? m.user.username,
        rsiHandle: handle,
        verified: m.rsiVerified,
        inOrg: orgHandleSet.has(handleLc) || affiliateHandleSet.has(handleLc),
        isAffiliate: affiliateHandleSet.has(handleLc),
        orgRank: orgRankMap.get(handleLc) ?? null,
      };
    });

  const linkedHandles = new Set(linked.map((l) => l.rsiHandle.toLowerCase()));
  const orgOnly = orgMembers
    .filter((m) => !linkedHandles.has(m.handle.toLowerCase()))
    .map((m) => ({ rsiHandle: m.handle, orgRank: m.stars, isAffiliate: affiliateHandleSet.has(m.handle.toLowerCase()) }));

  res.json({
    success: true,
    data: { orgTag, linked, orgOnly, total: orgMembers.length } satisfies RsiRosterDto,
  } satisfies ApiResponse<RsiRosterDto>);
});
