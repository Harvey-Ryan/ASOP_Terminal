// Fleets in Discord (v1.32.0): the ship list for autocomplete, the quarterly
// "Still flying these?" DM, and its buttons. The API has the same rules
// (apps/api/src/server/routes/fleet.ts); see packages/shared/src/ships.ts.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type ButtonInteraction } from 'discord.js';
import { fleetCheckDue, FLEET_CHECK_DAYS, type ShipCatalogEntry } from '@dem/shared';
import { prisma } from '../db.js';
import { client } from '../client.js';

export const FLEET_COLOR = 0x5865f2;
export const webUrl = () => process.env['WEB_URL'] ?? 'http://localhost:5173';
export const myFleetUrl = () => `${webUrl()}/dashboard/fleet`;

let cache: { at: number; ships: ShipCatalogEntry[] } | null = null;

/** Current ships (not retired), A–Z, cached ten minutes. */
export async function shipList(): Promise<ShipCatalogEntry[]> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.ships;
  const rows = await prisma.ship.findMany({ where: { retired: false }, orderBy: { name: 'asc' } });
  cache = {
    at: Date.now(),
    ships: rows.map((r) => ({
      id: r.id, name: r.name, manufacturer: r.manufacturer, manufacturerCode: r.manufacturerCode, type: r.type, focus: r.focus, size: r.size,
      minCrew: r.minCrew, maxCrew: r.maxCrew, cargo: r.cargo, status: r.status, imageUrl: r.imageUrl, thumbUrl: r.thumbUrl, storeUrl: r.storeUrl,
    })),
  };
  return cache.ships;
}

/** Their fleet row, made on first use; `touch` marks the fleet as just checked. */
export async function fleetOwner(discordId: string, name: string, touch: boolean) {
  return prisma.fleetOwner.upsert({
    where: { discordId },
    create: { discordId, username: name, checkedAt: touch ? new Date() : null },
    update: { username: name, ...(touch ? { checkedAt: new Date() } : {}) },
  });
}

/** "Carrack ×2 · Cutlass Black ("Rust Bucket")": one line per ship, for embeds. */
export async function fleetLines(discordId: string): Promise<string[]> {
  const rows = await prisma.fleetShip.findMany({ where: { discordId }, include: { ship: true }, orderBy: { id: 'asc' } });
  return rows
    .map((r) => {
      const name = r.ship ? `**${r.ship.name}**` : `**${r.customName ?? 'Unknown ship'}** ⚠️ not matched`;
      const qty = r.quantity > 1 ? ` ×${r.quantity}` : '';
      const nick = r.nickname ? ` "${r.nickname}"` : '';
      const off = r.available ? '' : ' · *not for org ops*';
      return { sort: r.ship?.name ?? r.customName ?? '', line: `${name}${qty}${nick}${off}` };
    })
    .sort((a, b) => a.sort.localeCompare(b.sort))
    .map((x) => x.line);
}

export const confirmButton = () => new ButtonBuilder().setCustomId('fleet:confirm').setLabel('Still correct').setStyle(ButtonStyle.Success);
export const editButton = () => new ButtonBuilder().setLabel('Update on the website').setStyle(ButtonStyle.Link).setURL(myFleetUrl());

// ── The quarterly check-in ───────────────────────────────────────────────────

let lastRun = 0;

/**
 * DMs people whose fleet hasn't been checked for FLEET_CHECK_DAYS: "Still
 * flying these?" with Still correct / Update / Stop asking. Runs at most
 * hourly, 25 people at a time; a DM that can't be delivered still counts as
 * asked, so closed DMs aren't retried every hour.
 */
export async function checkFleetNudges(now = new Date()): Promise<void> {
  if (now.getTime() - lastRun < 60 * 60_000) return;
  lastRun = now.getTime();
  const cutoff = new Date(now.getTime() - FLEET_CHECK_DAYS * 86_400_000);
  const owners = await prisma.fleetOwner.findMany({
    where: {
      nudges: true,
      OR: [{ checkedAt: { lt: cutoff } }, { checkedAt: null, createdAt: { lt: cutoff } }],
      AND: [{ OR: [{ lastNudgeAt: null }, { lastNudgeAt: { lt: cutoff } }] }],
      ships: { some: {} },
    },
    include: { _count: { select: { ships: true } } },
    take: 25,
  });
  for (const o of owners) {
    if (!fleetCheckDue(o, o._count.ships, now)) continue;
    await prisma.fleetOwner.update({ where: { discordId: o.discordId }, data: { lastNudgeAt: now } });
    try {
      const user = await client.users.fetch(o.discordId);
      const lines = await fleetLines(o.discordId);
      const shown = lines.slice(0, 20);
      await user.send({
        embeds: [new EmbedBuilder()
          .setColor(FLEET_COLOR)
          .setTitle('🚀 Still flying these?')
          .setDescription([
            'Your org officers plan ops around the ships members have. A quick check keeps your fleet up to date:',
            '',
            ...shown,
            ...(lines.length > shown.length ? [`…and ${lines.length - shown.length} more`] : []),
          ].join('\n'))
          .setFooter({ text: `Asked about once every ${Math.round(FLEET_CHECK_DAYS / 30)} months. "Stop asking" turns this off.` })],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
          confirmButton(),
          editButton(),
          new ButtonBuilder().setCustomId('fleet:stop').setLabel('Stop asking').setStyle(ButtonStyle.Secondary),
        )],
      });
    } catch (err) {
      console.warn(`[fleet] Couldn't DM a fleet check-in (${o.discordId}):`, err instanceof Error ? err.message : err);
    }
  }
}

/** fleet:confirm / fleet:stop, from /fleet mine or the check-in DM. */
export async function handleFleetButton(interaction: ButtonInteraction): Promise<void> {
  const name = interaction.user.globalName ?? interaction.user.username;
  if (interaction.customId === 'fleet:confirm') {
    await fleetOwner(interaction.user.id, name, true);
    await interaction.update({ components: [new ActionRowBuilder<ButtonBuilder>().addComponents(editButton())], content: '✅ Thanks, your fleet is marked as checked.' });
    return;
  }
  if (interaction.customId === 'fleet:stop') {
    await fleetOwner(interaction.user.id, name, false);
    await prisma.fleetOwner.update({ where: { discordId: interaction.user.id }, data: { nudges: false } });
    await interaction.update({ components: [new ActionRowBuilder<ButtonBuilder>().addComponents(editButton())], content: 'Okay, no more check-ins. You can turn them back on in Notification Settings on the website.' });
  }
}
