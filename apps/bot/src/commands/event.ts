import {
  SlashCommandBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  ComponentType,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';
import { prisma } from '../db.js';
import { endEvent } from '../services/eventService.js';
import type { EventRole } from '@dem/shared';

// ── Command definition ────────────────────────────────────────────────────────

export const data = new SlashCommandBuilder()
  .setName('event')
  .setDescription('Manage events')
  .addSubcommand((sub) =>
    sub.setName('create').setDescription('Open the web dashboard to create a new event'),
  )
  .addSubcommand((sub) =>
    sub.setName('end').setDescription('End an active event in this server'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('list')
      .setDescription('List upcoming events'),
  );

// ── Autocomplete ──────────────────────────────────────────────────────────────

export async function autocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused();
  const events = await prisma.event.findMany({
    where: {
      guildId: interaction.guildId!,
      name: { contains: focused },
      status: { not: 'COMPLETED' },
    },
    orderBy: { startTime: 'asc' },
    take: 25,
  });
  await interaction.respond(events.map((e) => ({ name: e.name, value: e.id })));
}

// ── Slash command dispatch ────────────────────────────────────────────────────

export async function execute(interaction: ChatInputCommandInteraction) {
  switch (interaction.options.getSubcommand()) {
    case 'create':
      return handleCreate(interaction);
    case 'end':
      return handleEnd(interaction);
    case 'list':
      return handleList(interaction);
  }
}

// ── Subcommand handlers ───────────────────────────────────────────────────────

async function handleCreate(interaction: ChatInputCommandInteraction) {
  const webUrl = process.env['WEB_URL'] ?? 'http://localhost:5173';
  const url = `${webUrl}/dashboard/servers/${interaction.guildId}/events/new`;
  await interaction.reply({
    content: `📋 [Click Here To Login](${url})`,
    ephemeral: true,
  });
}

async function handleEnd(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });

  const active = await prisma.event.findMany({
    where: {
      guildId: interaction.guildId!,
      status: { in: ['PENDING', 'ACTIVE'] },
    },
    orderBy: { startTime: 'asc' },
    take: 25,
  });

  if (active.length === 0) {
    await interaction.editReply({ content: 'No active events to end.' });
    return;
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId('end_event_select')
    .setPlaceholder('Select an event to end')
    .addOptions(
      active.map((e) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(e.name)
          .setValue(e.id)
          .setDescription(new Date(e.startTime).toUTCString()),
      ),
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  const reply = await interaction.editReply({ content: 'Which event would you like to end?', components: [row] });

  try {
    const selection = await reply.awaitMessageComponent({
      componentType: ComponentType.StringSelect,
      time: 30_000,
    });

    const eventId = selection.values[0]!;
    const event = active.find((e) => e.id === eventId);

    await selection.update({ content: `⏳ Ending **${event?.name ?? eventId}**…`, components: [] });

    await endEvent(eventId);
    await interaction.editReply({ content: `✅ **${event?.name ?? eventId}** ended. VCs deleted, loot prompt posted.`, components: [] });
  } catch {
    await interaction.editReply({ content: 'Timed out — no event selected.', components: [] });
  }
}

async function handleList(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const events = await prisma.event.findMany({
    where: {
      guildId: interaction.guildId!,
      status: { not: 'COMPLETED' },
      startTime: { gte: new Date() },
    },
    orderBy: { startTime: 'asc' },
    take: 15,
    include: { rsvps: true },
  });

  if (events.length === 0) {
    await interaction.editReply({ content: 'No upcoming events.' });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('📅 Upcoming Events')
    .setColor(0x5865f2)
    .addFields(
      events.map((e) => {
        const roles = JSON.parse(e.roles) as EventRole[];
        const ts = Math.floor(e.startTime.getTime() / 1000);
        const thread = e.threadId ? ` • <#${e.threadId}>` : '';
        const roleList = roles.length > 0 ? ` • ${roles.map((r) => `${r.name}×${r.count}`).join(', ')}` : '';
        return {
          name: e.name,
          value: `<t:${ts}:F> • 👥 ${e.rsvps.length}${roleList}${thread}`,
          inline: false,
        };
      }),
    );

  await interaction.editReply({ embeds: [embed] });
}
