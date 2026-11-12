// /fleet (v1.32.0): your fleet from Discord, and who in the server has a ship.
// Fleets are per person (FleetOwner / FleetShip), the same rows the website's
// Fleet page edits; ships come from the ship list (Ship, refreshed by the API).

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';
import { searchShips } from '@dem/shared';
import { prisma } from '../db.js';
import { hiddenModules } from '../utils/hiddenModules.js';
import { shipList, fleetOwner, fleetLines, confirmButton, editButton, FLEET_COLOR } from '../services/fleetService.js';

const MAX_SHIPS = 500;

export const data = new SlashCommandBuilder()
  .setName('fleet')
  .setDescription('Your ships, and who in the server has a ship')
  .addSubcommand((sub) => sub
    .setName('add')
    .setDescription('Add a ship to your fleet')
    .addStringOption((o) => o.setName('ship').setDescription('Start typing a ship name').setRequired(true).setAutocomplete(true))
    .addIntegerOption((o) => o.setName('quantity').setDescription('How many (default 1)').setMinValue(1).setMaxValue(99))
    .addStringOption((o) => o.setName('nickname').setDescription('Its name, if you gave it one').setMaxLength(60)))
  .addSubcommand((sub) => sub
    .setName('remove')
    .setDescription('Remove a ship from your fleet')
    .addStringOption((o) => o.setName('ship').setDescription('One of your ships').setRequired(true).setAutocomplete(true)))
  .addSubcommand((sub) => sub
    .setName('mine')
    .setDescription('Show your fleet'))
  .addSubcommand((sub) => sub
    .setName('search')
    .setDescription('Who in this server has a ship')
    .addStringOption((o) => o.setName('ship').setDescription('Start typing a ship name').setRequired(true).setAutocomplete(true)));

const displayName = (i: ChatInputCommandInteraction) =>
  (i.member && 'displayName' in i.member ? i.member.displayName : null) ?? i.user.globalName ?? i.user.username;

// ── Autocomplete ──────────────────────────────────────────────────────────────

export async function autocomplete(interaction: AutocompleteInteraction) {
  const sub = interaction.options.getSubcommand(false);
  const typed = interaction.options.getFocused();
  try {
    if (sub === 'remove') {
      const mine = await prisma.fleetShip.findMany({ where: { discordId: interaction.user.id }, include: { ship: true } });
      const q = typed.toLowerCase();
      await interaction.respond(mine
        .map((r) => ({ name: `${r.ship?.name ?? r.customName ?? 'Unknown'}${r.quantity > 1 ? ` ×${r.quantity}` : ''}${r.nickname ? ` "${r.nickname}"` : ''}`.slice(0, 100), value: String(r.id) }))
        .filter((c) => c.name.toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 25));
      return;
    }
    const ships = searchShips(typed, await shipList(), 25);
    await interaction.respond(ships.map((s) => ({ name: `${s.name} — ${s.manufacturer}`.slice(0, 100), value: s.id })));
  } catch {
    await interaction.respond([]).catch(() => null);
  }
}

// ── Execute ───────────────────────────────────────────────────────────────────

export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  if (interaction.guildId && sub === 'search') {
    const hidden = await hiddenModules();
    const settings = await prisma.guildSettings.findFirst({ where: { guild: { guildId: interaction.guildId } }, select: { fleetEnabled: true } });
    if (hidden.has('fleetEnabled') || settings?.fleetEnabled === false) {
      await interaction.reply({ content: 'The Fleet module is switched off in this server.', flags: MessageFlags.Ephemeral });
      return;
    }
  }
  if (sub === 'add') return add(interaction);
  if (sub === 'remove') return remove(interaction);
  if (sub === 'mine') return mine(interaction);
  return search(interaction);
}

/** Resolves what was picked or typed: an autocomplete id, else the best name match. */
async function pickShip(value: string) {
  const ships = await shipList();
  return ships.find((s) => s.id === value) ?? searchShips(value, ships, 1)[0] ?? null;
}

async function add(interaction: ChatInputCommandInteraction) {
  const ship = await pickShip(interaction.options.getString('ship', true));
  if (!ship) {
    await interaction.reply({ content: 'I couldn\'t find that ship. Start typing its name and pick it from the list.', flags: MessageFlags.Ephemeral });
    return;
  }
  const quantity = interaction.options.getInteger('quantity') ?? 1;
  const nickname = interaction.options.getString('nickname')?.trim() || null;
  const me = interaction.user.id;
  await fleetOwner(me, displayName(interaction), true);
  const same = await prisma.fleetShip.findFirst({ where: { discordId: me, shipId: ship.id, nickname } });
  let total = quantity;
  if (same) {
    total = Math.min(99, same.quantity + quantity);
    await prisma.fleetShip.update({ where: { id: same.id }, data: { quantity: total } });
  } else {
    if ((await prisma.fleetShip.count({ where: { discordId: me } })) >= MAX_SHIPS) {
      await interaction.reply({ content: `A fleet can list up to ${MAX_SHIPS} ships.`, flags: MessageFlags.Ephemeral });
      return;
    }
    await prisma.fleetShip.create({ data: { discordId: me, shipId: ship.id, quantity, nickname } });
  }
  const embed = new EmbedBuilder()
    .setColor(FLEET_COLOR)
    .setTitle(`Added ${ship.name}${quantity > 1 ? ` ×${quantity}` : ''}`)
    .setDescription(`${ship.manufacturer}${ship.focus ? ` · ${ship.focus}` : ''}${same ? `\nYou now have ${total}.` : ''}${nickname ? `\nNamed "${nickname}".` : ''}`);
  if (ship.thumbUrl ?? ship.imageUrl) embed.setThumbnail((ship.thumbUrl ?? ship.imageUrl)!);
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function remove(interaction: ChatInputCommandInteraction) {
  const value = interaction.options.getString('ship', true);
  const me = interaction.user.id;
  const id = Number(value);
  let row = Number.isInteger(id) ? await prisma.fleetShip.findFirst({ where: { id, discordId: me }, include: { ship: true } }) : null;
  if (!row) {
    // Typed instead of picked: the first of their ships with that name.
    const q = value.toLowerCase();
    const mine = await prisma.fleetShip.findMany({ where: { discordId: me }, include: { ship: true } });
    row = mine.find((r) => (r.ship?.name ?? r.customName ?? '').toLowerCase() === q) ?? null;
  }
  if (!row) {
    await interaction.reply({ content: 'That ship isn\'t in your fleet. Pick one from the list.', flags: MessageFlags.Ephemeral });
    return;
  }
  await prisma.fleetShip.delete({ where: { id: row.id } });
  await fleetOwner(me, displayName(interaction), true);
  await interaction.reply({ content: `Removed **${row.ship?.name ?? row.customName}**${row.quantity > 1 ? ` (all ${row.quantity})` : ''} from your fleet.`, flags: MessageFlags.Ephemeral });
}

async function mine(interaction: ChatInputCommandInteraction) {
  const owner = await prisma.fleetOwner.findUnique({ where: { discordId: interaction.user.id } });
  const lines = await fleetLines(interaction.user.id);
  if (!lines.length) {
    await interaction.reply({
      content: 'Your fleet is empty. Add ships with `/fleet add`, or paste or import a whole list on the website.',
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(editButton())],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const shown = lines.slice(0, 40);
  const embed = new EmbedBuilder()
    .setColor(FLEET_COLOR)
    .setTitle('🚀 Your fleet')
    .setDescription([...shown, ...(lines.length > shown.length ? [`…and ${lines.length - shown.length} more on the website`] : [])].join('\n'))
    .setFooter({ text: 'Shown in every ASOP server you\'re in. Hide it from a server on the website.' });
  const checked = owner?.checkedAt ? `Last checked <t:${Math.floor(owner.checkedAt.getTime() / 1000)}:R>.` : '';
  await interaction.reply({
    content: checked || undefined,
    embeds: [embed],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton(), editButton())],
    flags: MessageFlags.Ephemeral,
  });
}

async function search(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) {
    await interaction.reply({ content: 'Use this in a server to see who there has the ship. For your own fleet, use `/fleet mine`.', flags: MessageFlags.Ephemeral });
    return;
  }
  const ship = await pickShip(interaction.options.getString('ship', true));
  if (!ship) {
    await interaction.reply({ content: 'I couldn\'t find that ship. Start typing its name and pick it from the list.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply();
  const guildId = interaction.guild.id;
  const rows = await prisma.fleetShip.findMany({ where: { shipId: ship.id, available: true }, include: { owner: true } });
  const visible = rows.filter((r) => !(JSON.parse(r.owner.hiddenGuildIds) as string[]).includes(guildId));
  // Only people in this server.
  const members = visible.length ? await interaction.guild.members.fetch({ user: [...new Set(visible.map((r) => r.discordId))] }).catch(() => null) : null;
  const here = visible.filter((r) => members?.has(r.discordId));
  const embed = new EmbedBuilder().setColor(here.length ? FLEET_COLOR : 0x747f8d).setTitle(`🚀 Who has a ${ship.name}?`);
  if (ship.imageUrl) embed.setThumbnail(ship.thumbUrl ?? ship.imageUrl);
  if (!here.length) {
    embed.setDescription('Nobody in this server has one in their fleet yet.\nAdd yours with `/fleet add`.');
  } else {
    const byPerson = new Map<string, { name: string; quantity: number; nicknames: string[]; checkedAt: Date | null }>();
    for (const r of here) {
      const p = byPerson.get(r.discordId) ?? { name: members!.get(r.discordId)!.displayName, quantity: 0, nicknames: [], checkedAt: r.owner.checkedAt };
      p.quantity += r.quantity;
      if (r.nickname) p.nicknames.push(`"${r.nickname}"`);
      byPerson.set(r.discordId, p);
    }
    const lines = [...byPerson.values()]
      .sort((a, b) => (b.checkedAt?.getTime() ?? 0) - (a.checkedAt?.getTime() ?? 0))
      .map((p) => `**${p.name}**${p.quantity > 1 ? ` ×${p.quantity}` : ''}${p.nicknames.length ? ` — ${p.nicknames.join(', ')}` : ''}${p.checkedAt ? ` · checked <t:${Math.floor(p.checkedAt.getTime() / 1000)}:R>` : ''}`);
    embed.setDescription(lines.slice(0, 30).join('\n') + (lines.length > 30 ? `\n…and ${lines.length - 30} more` : ''));
  }
  const crew = ship.maxCrew ? ` · crew ${ship.minCrew && ship.minCrew !== ship.maxCrew ? `${ship.minCrew}–` : ''}${ship.maxCrew}` : '';
  embed.setFooter({ text: `${ship.manufacturer}${ship.focus ? ` · ${ship.focus}` : ''}${crew} · ${here.length} member${here.length === 1 ? '' : 's'}` });
  await interaction.editReply({ embeds: [embed] });
}

