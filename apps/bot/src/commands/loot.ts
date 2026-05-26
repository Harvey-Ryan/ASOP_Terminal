import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { prisma } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('loot')
  .setDescription('Loot distribution')
  .addSubcommand((sub) =>
    sub.setName('open').setDescription('Open the loot dashboard for this server'),
  )
  .addSubcommand((sub) =>
    sub.setName('status').setDescription('Show the current active loot session'),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  switch (interaction.options.getSubcommand()) {
    case 'open':
      return handleOpen(interaction);
    case 'status':
      return handleStatus(interaction);
  }
}

async function handleOpen(interaction: ChatInputCommandInteraction) {
  const webUrl = process.env['WEB_URL'] ?? 'http://localhost:5173';
  const url = `${webUrl}/dashboard/servers/${interaction.guildId}/loot`;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel('Open Loot Dashboard')
      .setStyle(ButtonStyle.Link)
      .setURL(url),
  );

  await interaction.reply({
    content: '🎁 Click below to open the loot dashboard:',
    components: [row],
    ephemeral: true,
  });
}

async function handleStatus(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });

  const guildId = interaction.guildId!;

  // Find the most recently active loot session for this guild
  const session = await prisma.lootSession.findFirst({
    where: { guildId, status: 'OPEN' },
    orderBy: { updatedAt: 'desc' },
    include: {
      items: { include: { assignments: true }, orderBy: { sortOrder: 'asc' } },
    },
  });

  if (!session) {
    await interaction.editReply({ content: 'No active loot session for this server.' });
    return;
  }

  const assignedCount = session.items.filter((i) => i.assignments.length > 0).length;
  const totalCount = session.items.length;

  const method =
    session.method === 'RANDOM_ROLL' ? '🎲 Random Roll' :
    session.method === 'SNAKE_DRAFT' ? '🐍 Snake Draft' : '🪙 DKP';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionName = (session as any).name ?? (session.eventId ? 'Event Loot' : 'Standalone Session');

  let content = `**${sessionName}** — ${method}\n${assignedCount}/${totalCount} items assigned`;

  if (session.method === 'SNAKE_DRAFT' && session.draftStarted) {
    const draftOrder: string[] = JSON.parse(session.draftOrder);
    if (draftOrder.length > 0) {
      const pos = session.items.reduce((n, i) => n + i.assignments.length, 0) + session.skipCount;
      const n = draftOrder.length;
      const round = Math.floor(pos / n);
      const idx = pos % n;
      const nextId = round % 2 === 0 ? draftOrder[idx] : draftOrder[n - 1 - idx];
      if (nextId) content += `\n🎯 Now picking: <@${nextId}>`;
    }
  }

  const webUrl = process.env['WEB_URL'] ?? 'http://localhost:5173';
  const lootPath = session.eventId
    ? `/dashboard/servers/${guildId}/events/${session.eventId}/loot`
    : `/dashboard/servers/${guildId}/loot/sessions/${session.id}`;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel('View Loot Session')
      .setStyle(ButtonStyle.Link)
      .setURL(`${webUrl}${lootPath}`),
  );

  await interaction.editReply({ content, components: [row] });
}
