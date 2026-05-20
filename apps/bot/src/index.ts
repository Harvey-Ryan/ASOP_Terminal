import 'dotenv/config';
import { Events, MessageFlags, GuildMember } from 'discord.js';
import { client } from './client.js';
import { prisma } from './db.js';
import { startScheduler } from './scheduler.js';
import { startInternalServer } from './internal.js';
import * as eventCommand from './commands/event.js';
import { joinRoster, setRosterRole } from './services/rsvpService.js';

const commands = new Map([['event', eventCommand]]);

client.once(Events.ClientReady, async (c) => {
  console.log(`[bot] Ready! Logged in as ${c.user.tag}`);
  await syncAllGuilds();
  startScheduler();
  startInternalServer();
});

// ── Guild presence sync ───────────────────────────────────────────────────────

async function syncAllGuilds() {
  const guilds = client.guilds.cache;
  for (const [, guild] of guilds) {
    await upsertGuild(guild.id, guild.name, guild.icon);
  }
  console.log(`[bot] Synced ${guilds.size} guild(s) to DB`);
}

async function upsertGuild(guildId: string, name: string, icon: string | null) {
  await prisma.guild.upsert({
    where: { guildId },
    create: { guildId, name, icon },
    update: { name, icon },
  });
}

client.on(Events.GuildCreate, async (guild) => {
  await upsertGuild(guild.id, guild.name, guild.icon).catch((err) =>
    console.error('[bot] GuildCreate sync failed:', err),
  );
  console.log(`[bot] Joined guild: ${guild.name} (${guild.id})`);
});

client.on(Events.GuildDelete, async (guild) => {
  await prisma.guild.deleteMany({ where: { guildId: guild.id } }).catch(() => null);
  console.log(`[bot] Left guild: ${guild.name} (${guild.id})`);
});

// ── Slash commands & autocomplete ─────────────────────────────────────────────

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const cmd = commands.get(interaction.commandName);
    if (!cmd) return;
    try {
      await cmd.execute(interaction);
    } catch (err) {
      console.error('[bot] Command error:', err);
      const payload = { content: '❌ An error occurred.', flags: MessageFlags.Ephemeral };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload).catch(() => null);
      } else {
        await interaction.reply(payload).catch(() => null);
      }
    }
    return;
  }

  if (interaction.isAutocomplete()) {
    const cmd = commands.get(interaction.commandName);
    if (!cmd?.autocomplete) return;
    await cmd.autocomplete(interaction).catch((err) => console.error('[bot] Autocomplete error:', err));
    return;
  }

  if (interaction.isButton()) {
    const parts = interaction.customId.split(':');
    const [prefix, entityId, value] = parts as [string, string, string];

    // ── Role roster buttons ───────────────────────────────────────────────────
    if (prefix === 'role') {
      const role = value === '__unassigned__' ? null : value;
      try {
        const event = await prisma.event.findFirst({
          where: { id: entityId, status: { not: 'COMPLETED' } },
        });
        if (!event) {
          await interaction.reply({ content: 'This event has already ended.', flags: MessageFlags.Ephemeral });
          return;
        }
        const displayName = (interaction.member instanceof GuildMember)
          ? interaction.member.displayName
          : interaction.user.username;
        await setRosterRole(entityId, interaction.user.id, displayName, role);
        const label = role ?? 'Unassigned';
        await interaction.reply({
          content: `✅ You are marked as **${label}** for **${event.name}**.`,
          flags: MessageFlags.Ephemeral,
        });
      } catch (err) {
        console.error('[bot] Role button error:', err);
        await interaction.reply({ content: '❌ Failed to update roster.', flags: MessageFlags.Ephemeral });
      }
      return;
    }

  }
});

// ── Discord Scheduled Event — Interested ─────────────────────────────────────

client.on(Events.GuildScheduledEventUserAdd, async (scheduledEvent, user) => {
  console.log(`[bot] Interested: user=${user.id} scheduledEventId=${scheduledEvent.id}`);
  try {
    const event = await prisma.event.findFirst({
      where: { discordEventId: scheduledEvent.id },
    });
    if (!event) {
      console.warn(`[bot] No event found for discordEventId=${scheduledEvent.id}`);
      return;
    }

    const member = await scheduledEvent.guild?.members.fetch(user.id).catch(() => null);
    const username = member?.displayName ?? user.username;
    await joinRoster(event.id, user.id, username);
  } catch (err) {
    console.error('[bot] GuildScheduledEventUserAdd error:', err);
  }
});

// ── Process cleanup ───────────────────────────────────────────────────────────

process.on('unhandledRejection', (err) => console.error('[bot] Unhandled rejection:', err));

process.on('SIGINT', async () => {
  console.log('[bot] Shutting down…');
  await prisma.$disconnect();
  client.destroy();
  process.exit(0);
});

client.login(process.env['DISCORD_TOKEN']);
