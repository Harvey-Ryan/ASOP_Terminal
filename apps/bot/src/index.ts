import 'dotenv/config';
import { Events, GuildMember, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { ChatInputCommandInteraction, AutocompleteInteraction } from 'discord.js';
import { client } from './client.js';
import { prisma } from './db.js';
import { startScheduler } from './scheduler.js';
import { startInternalServer } from './internal.js';
import * as eventCommand from './commands/event.js';
import * as loginCommand from './commands/login.js';
import * as bidCommand from './commands/bid.js';
import * as walletCommand from './commands/wallet.js';
import * as uexCommand from './commands/uex.js';
import * as whohasCommand from './commands/whohas.js';
import * as blueprintCommand from './commands/blueprint.js';
import * as materialCommand from './commands/material.js';
import { registerCommands } from './services/commandService.js';
import { joinRoster, setRosterRole } from './services/rsvpService.js';
import { endEvent, deleteEventVcs } from './services/eventService.js';

interface Command {
  data: { toJSON(): unknown };
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
}

const commands = new Map<string, Command>([
  ['event', eventCommand],
  ['login', loginCommand],
  ['bid', bidCommand],
  ['wallet', walletCommand],
  ['uex', uexCommand],
  ['whohas', whohasCommand],
  ['blueprint', blueprintCommand],
  ['material', materialCommand],
]);

// Validate API_URL at startup so misconfiguration is caught immediately.
const apiUrl = process.env['API_URL'];
if (!apiUrl) {
  console.warn('[bot] WARNING: API_URL is not set — image fetching will fall back to http://localhost:3001 and will likely fail in production');
} else {
  try {
    new URL(apiUrl);
    console.log(`[bot] API_URL=${apiUrl}`);
  } catch {
    console.error(`[bot] FATAL: API_URL="${apiUrl}" is not a valid URL (missing http:// scheme?). Image fetching will fail.`);
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`[bot] Ready! Logged in as ${c.user.tag}`);
  await registerCommands(c.user.id);
  await syncAllGuilds();
  await startScheduler();
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
  try {
    await upsertGuild(guild.id, guild.name, guild.icon);
    console.log(`[bot] Joined new guild: ${guild.name} (${guild.id}) — DB record created, ready to operate`);
  } catch (err) {
    console.error(`[bot] GuildCreate sync failed for ${guild.name} (${guild.id}):`, err);
  }
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
      const payload = { content: '❌ An error occurred.', ephemeral: true } as const;
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
          await interaction.reply({ content: 'This event has already ended.', ephemeral: true });
          return;
        }
        const displayName = (interaction.member instanceof GuildMember)
          ? interaction.member.displayName
          : interaction.user.username;
        await setRosterRole(entityId, interaction.user.id, displayName, role);
        const label = role ?? 'Unassigned';
        await interaction.reply({
          content: `✅ You are marked as **${label}** for **${event.name}**.`,
          ephemeral: true,
        });
      } catch (err) {
        console.error('[bot] Role button error:', err);
        await interaction.reply({ content: '❌ Failed to update roster.', ephemeral: true });
      }
      return;
    }

  }
});

// ── !asop prefix command ──────────────────────────────────────────────────────

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (message.content.trim().toLowerCase() !== '!asop') return;

  const webUrl = process.env['WEB_URL'] ?? 'http://localhost:5173';
  const loginUrl = `${webUrl}/api/auth/login`;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel('Log in to ASOP')
      .setStyle(ButtonStyle.Link)
      .setURL(loginUrl),
  );

  await message.reply({ content: 'Click below to log in to the event manager:', components: [row] });
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

// ── VC join/leave handling ────────────────────────────────────────────────────

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const leftChannelId = oldState.channelId;
  const joinedChannelId = newState.channelId;

  // ── Cleanup: delete VC when last person leaves an ENDED event ───────────────
  if (leftChannelId && joinedChannelId !== leftChannelId) {
    try {
      const event = await prisma.event.findFirst({
        where: { status: 'ENDED', botCleanedUp: false, vcIds: { contains: leftChannelId } },
      });
      if (event) await deleteEventVcs(event.id);
    } catch (err) {
      console.error('[bot] VoiceStateUpdate cleanup error:', err);
    }
  }

  // ── Auto-assign: RSVP + confirmed attendee when joining an ACTIVE event VC ──
  if (joinedChannelId && joinedChannelId !== leftChannelId) {
    try {
      const event = await prisma.event.findFirst({
        where: { status: 'ACTIVE', vcIds: { contains: joinedChannelId } },
      });
      if (!event) return;

      const userId = newState.member?.id ?? newState.id;
      if (!userId) return;

      const username = newState.member?.displayName ?? newState.member?.user.username ?? userId;

      // Upsert RSVP (add to roster if not already there)
      await prisma.eventRsvp.upsert({
        where: { eventId_userId: { eventId: event.id, userId } },
        create: { eventId: event.id, userId, username },
        update: { username }, // keep username current
      });

      // Add to confirmedAttendees if not already present
      const confirmed: string[] = event.confirmedAttendees ? JSON.parse(event.confirmedAttendees) : [];
      if (!confirmed.includes(userId)) {
        confirmed.push(userId);
        await prisma.event.update({
          where: { id: event.id },
          data: { confirmedAttendees: JSON.stringify(confirmed) },
        });
      }
    } catch (err) {
      console.error('[bot] VoiceStateUpdate auto-assign error:', err);
    }
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

startInternalServer();
client.login(process.env['DISCORD_TOKEN']);
