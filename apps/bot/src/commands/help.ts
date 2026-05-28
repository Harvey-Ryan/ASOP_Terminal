import { SlashCommandBuilder, EmbedBuilder, GuildMember, PermissionFlagsBits } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { prisma } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Show all commands available to you');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }

  const settings = await prisma.guildSettings.findFirst({
    where: { guild: { guildId } },
    select: {
      dkpLabel: true,
      eventBotEnabled: true,
      dkpEnabled: true,
      lootEnabled: true,
      exchangeEnabled: true,
      fleetEnabled: true,
      eventCreatorRoles: true,
      lootDraftCreatorRoles: true,
    },
  });

  const dkpLabel       = settings?.dkpLabel       ?? 'DKP';
  const eventBotEnabled = settings?.eventBotEnabled ?? true;
  const dkpEnabled      = settings?.dkpEnabled      ?? true;
  const lootEnabled     = settings?.lootEnabled     ?? true;
  const exchangeEnabled = settings?.exchangeEnabled  ?? true;
  const fleetEnabled    = settings?.fleetEnabled    ?? true;

  const eventCreatorRoles: string[]    = JSON.parse(settings?.eventCreatorRoles    ?? '[]');
  const lootDraftCreatorRoles: string[] = JSON.parse(settings?.lootDraftCreatorRoles ?? '[]');

  // Determine what the user can do
  const member = interaction.member;
  let isAdmin        = false;
  let memberRoleIds: string[] = [];

  if (member instanceof GuildMember) {
    isAdmin       = member.permissions.has(PermissionFlagsBits.ManageGuild);
    memberRoleIds = member.roles.cache.map((r) => r.id);
  }

  const canManageEvents    = isAdmin || eventCreatorRoles.some((r) => memberRoleIds.includes(r));
  const canCreateLootDraft = isAdmin || lootDraftCreatorRoles.some((r) => memberRoleIds.includes(r));

  const fields: { name: string; value: string }[] = [];

  // ── General ───────────────────────────────────────────────────────────────────
  fields.push({
    name: '🔹 General',
    value: [
      '`/login` — Get a link to log in to the web dashboard',
      '`/help` — Show this message',
    ].join('\n'),
  });

  // ── Events ────────────────────────────────────────────────────────────────────
  if (eventBotEnabled && canManageEvents) {
    fields.push({
      name: '📅 Events',
      value: [
        '`/event list` — List upcoming events in this server',
        '`/event create` — Open the web dashboard to create a new event',
        '`/event end` — End an active event and trigger cleanup',
      ].join('\n'),
    });
  }

  // ── DKP ───────────────────────────────────────────────────────────────────────
  if (dkpEnabled) {
    fields.push({
      name: `🪙 ${dkpLabel}`,
      value: [
        `\`/wallet\` — Check your ${dkpLabel} balance and recent transactions`,
        `\`/wallet [user]\` — Look up another member's balance`,
        `\`/bid <amount>\` — Place or raise your bid in a live ${dkpLabel} loot auction`,
      ].join('\n'),
    });
  }

  // ── Loot ─────────────────────────────────────────────────────────────────────
  if (lootEnabled) {
    const lootLines = [
      '`/loot open` — Open the loot dashboard for this server',
      '`/loot status` — Show the current active loot session',
    ];
    fields.push({ name: '🎁 Loot', value: lootLines.join('\n') });
  }

  // ── Exchange ──────────────────────────────────────────────────────────────────
  if (exchangeEnabled) {
    fields.push({
      name: '🔄 Exchange',
      value: '`/whohas <item>` — Search guild member inventories for an item or commodity',
    });
  }

  // ── Fleet ─────────────────────────────────────────────────────────────────────
  if (fleetEnabled) {
    fields.push({
      name: '🚀 Fleet',
      value: [
        '`/fleet search <ship>` — Search guild fleet registries for a ship',
        '`/fleet link` — Manage your Fleet Registry on the web dashboard',
      ].join('\n'),
    });
  }

  // ── Star Citizen Data (always available) ──────────────────────────────────────
  fields.push({
    name: '🎮 Star Citizen Data',
    value: [
      '`/uex item <name>` — Look up a Star Citizen item by name',
      '`/uex commodity <name>` — Look up a commodity and trade routes',
      '`/blueprint search <name>` — Search crafting blueprints by output item',
      '`/blueprint recipe <name>` — Show the full crafting recipe for a blueprint',
      '`/blueprint dismantle <name>` — Show the dismantle return for a blueprint',
      '`/material usedby <name>` — Find all blueprints that require a given material',
    ].join('\n'),
  });

  const embed = new EmbedBuilder()
    .setTitle('📖 Available Commands')
    .setDescription('Only commands relevant to your role and this server\'s enabled modules are shown.')
    .setColor(0x5865f2)
    .addFields(fields);

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
