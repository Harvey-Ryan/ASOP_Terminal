import 'dotenv/config';
import { Events, EmbedBuilder, GuildMember, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import type { EventRole } from '@dem/shared';
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
import * as recipeCommand from './commands/recipe.js';
import * as lootCommand from './commands/loot.js';
import * as fleetCommand from './commands/fleet.js';
import * as helpCommand from './commands/help.js';
import * as marketplaceCommand from './commands/marketplace.js';
import { registerCommands } from './services/commandService.js';
import { joinRoster, setRosterRole, leaveRoster } from './services/rsvpService.js';
import { endEvent } from './services/eventService.js';
import { postMatchAnnouncement } from './services/tournamentService.js';

interface Command {
  data: { toJSON(): unknown };
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
}

const commands = new Map<string, Command>([
  ['event', eventCommand],
  ['login', loginCommand],
  ['loot', lootCommand],
  ['bid', bidCommand],
  ['wallet', walletCommand],
  ['uex', uexCommand],
  ['whohas', whohasCommand],
  ['blueprint', blueprintCommand],
  ['material', materialCommand],
  ['recipe', recipeCommand],
  ['fleet', fleetCommand],
  ['help', helpCommand],
  ['marketplace', marketplaceCommand],
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

// ── Exchange member-active lifecycle ──────────────────────────────────────────
// When a member leaves, their inventory entries are preserved but hidden from
// search results. When they rejoin, their entries become visible again.

client.on(Events.GuildMemberRemove, async (member) => {
  try {
    await Promise.all([
      prisma.inventoryEntry.updateMany({
        where: { guildId: member.guild.id, userId: member.user.id },
        data: { memberActive: false },
      }),
      prisma.fleetEntry.updateMany({
        where: { guildId: member.guild.id, userId: member.user.id },
        data: { memberActive: false },
      }),
    ]);
  } catch (err) {
    console.error('[bot] GuildMemberRemove update error:', err);
  }
});

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    await Promise.all([
      prisma.inventoryEntry.updateMany({
        where: { guildId: member.guild.id, userId: member.user.id },
        data: { memberActive: true },
      }),
      prisma.fleetEntry.updateMany({
        where: { guildId: member.guild.id, userId: member.user.id },
        data: { memberActive: true },
      }),
    ]);
  } catch (err) {
    console.error('[bot] GuildMemberAdd update error:', err);
  }
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
      const payload = { content: '❌ An error occurred.', flags: MessageFlags.Ephemeral } as const;
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
      const roleKey = value === '__unassigned__' ? null : value;
      await interaction.deferReply({ ephemeral: true });
      try {
        const event = await prisma.event.findFirst({
          where: { id: entityId, status: { not: 'COMPLETED' } },
        });
        if (!event) {
          await interaction.editReply({ content: 'This event has already ended.' });
          return;
        }
        let label = 'Unassigned';
        if (roleKey) {
          const roles = JSON.parse(event.roles) as EventRole[];
          const found = roles.find((r) => (r.id ?? r.name) === roleKey);
          label = found?.name ?? roleKey;
        }
        const displayName = (interaction.member instanceof GuildMember)
          ? interaction.member.displayName
          : interaction.user.username;
        await setRosterRole(entityId, interaction.user.id, displayName, roleKey);
        await interaction.editReply({
          content: `✅ You are marked as **${label}** for **${event.name}**.`,
        });
      } catch (err) {
        console.error('[bot] Role button error:', err);
        await interaction.editReply({ content: '❌ Failed to update roster.' });
      }
      return;
    }

    // ── Leave Roster button ───────────────────────────────────────────────────
    if (prefix === 'leave') {
      await interaction.deferReply({ ephemeral: true });
      try {
        const event = await prisma.event.findFirst({
          where: { id: entityId, status: { not: 'COMPLETED' } },
        });
        if (!event) {
          await interaction.editReply({ content: 'This event has already ended.' });
          return;
        }
        await leaveRoster(entityId, interaction.user.id);
        await interaction.editReply({
          content: `✅ You have been removed from the roster for **${event.name}**.`,
        });
      } catch (err) {
        console.error('[bot] Leave roster button error:', err);
        await interaction.editReply({ content: '❌ Failed to leave roster.' });
      }
      return;
    }

    // ── Loot / No-Loot decision prompt ────────────────────────────────────────
    if (prefix === 'event_loot_start' || prefix === 'event_loot_none') {
      await interaction.deferReply({ ephemeral: true });
      try {
        const event = await prisma.event.findUnique({ where: { id: entityId } });
        if (!event) {
          await interaction.editReply({ content: '❌ Event not found.' });
          return;
        }
        if (event.hadLoot !== null) {
          await interaction.editReply({ content: 'ℹ️ The loot decision has already been made.' });
          return;
        }

        // Permission: event creator OR OWNER / ADMIN / ORGANIZER in the host guild
        const dbUser = await prisma.user.findUnique({ where: { discordId: interaction.user.id } });
        const guild  = await prisma.guild.findUnique({ where: { guildId: event.guildId } });
        const member = dbUser && guild
          ? await prisma.guildMember.findUnique({
              where: { userId_guildId: { userId: dbUser.id, guildId: guild.id } },
            })
          : null;

        const isCreator = dbUser?.id === event.createdById;
        const isManager = ['OWNER', 'ADMIN', 'ORGANIZER'].includes(member?.role ?? '');

        if (!isCreator && !isManager) {
          await interaction.editReply({
            content: '❌ Only the event creator or guild managers can make the loot decision.',
          });
          return;
        }

        if (prefix === 'event_loot_start') {
          await prisma.event.update({ where: { id: entityId }, data: { hadLoot: true } });

          // Update the prompt embed to show who made the call
          const confirmedEmbed = new EmbedBuilder()
            .setTitle(`🏁 ${event.name} has ended`)
            .setDescription(`✅ **Loot session** — decision by <@${interaction.user.id}>.\nOpen the dashboard to create and manage the loot session.`)
            .setColor(0x57f287);
          await interaction.message.edit({ embeds: [confirmedEmbed], components: [] }).catch(() => null);

          const webUrl = process.env['WEB_URL'] ?? 'http://localhost:5173';
          const lootUrl = `${webUrl}/dashboard/servers/${event.guildId}/events/${entityId}/loot`;
          const dashRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setLabel('Open Loot Dashboard')
              .setStyle(ButtonStyle.Link)
              .setURL(lootUrl),
          );
          await interaction.editReply({
            content: '✅ Loot flagged. Create and manage the session from the dashboard.',
            components: [dashRow],
          });
        } else {
          // event_loot_none
          await prisma.event.update({ where: { id: entityId }, data: { hadLoot: false } });

          // Update the prompt embed to show who made the call
          const confirmedEmbed = new EmbedBuilder()
            .setTitle(`🏁 ${event.name} has ended`)
            .setDescription(`⛔ **No loot** — closed by <@${interaction.user.id}>.`)
            .setColor(0x747f8d);
          await interaction.message.edit({ embeds: [confirmedEmbed], components: [] }).catch(() => null);

          // Archive host thread
          if (event.threadId) {
            try {
              const hostThread = await client.channels.fetch(event.threadId);
              if (hostThread?.isThread()) {
                await hostThread.setArchived(true).catch(() => null);
              }
            } catch (err) {
              console.error('[bot] event_loot_none: failed to archive host thread:', err);
            }
          }

          // Archive alliance guild threads
          const allianceGuilds = await prisma.eventAllianceGuild.findMany({
            where: { eventId: entityId, threadId: { not: null } },
          });
          await Promise.allSettled(
            allianceGuilds.map(async (ag) => {
              const agThread = await client.channels.fetch(ag.threadId!).catch(() => null);
              if (!agThread?.isThread()) return;
              await agThread.setArchived(true).catch(() => null);
            }),
          );

          await interaction.editReply({ content: '✅ Event closed — no loot.' });
        }
      } catch (err) {
        console.error('[bot] Loot prompt button error:', err);
        await interaction.editReply({ content: '❌ Something went wrong.' }).catch(() => null);
      }
      return;
    }

    // ── Tournament: Ready check ───────────────────────────────────────────────
    if (prefix === 'bracket_ready') {
      const matchId = entityId;
      const side = value as 'A' | 'B';
      await interaction.deferReply({ ephemeral: true });
      try {
        const match = await prisma.tournamentMatch.findUnique({
          where: { id: matchId },
          include: { participantA: true, participantB: true },
        });
        if (!match) {
          await interaction.editReply({ content: '❌ Match not found.' });
          return;
        }
        if (match.status === 'COMPLETED') {
          await interaction.editReply({ content: 'ℹ️ This match is already complete.' });
          return;
        }

        const participant = side === 'A' ? match.participantA : match.participantB;
        if (!participant?.discordId || participant.discordId !== interaction.user.id) {
          await interaction.editReply({ content: '❌ You are not a participant in this match.' });
          return;
        }

        const update: Record<string, boolean> = side === 'A' ? { readyA: true } : { readyB: true };
        const updated = await prisma.tournamentMatch.update({ where: { id: matchId }, data: update });

        if (updated.readyA && updated.readyB) {
          await prisma.tournamentMatch.update({ where: { id: matchId }, data: { status: 'IN_PROGRESS' } });
          await interaction.message.edit({ components: [] }).catch(() => null);
          await interaction.editReply({ content: '✅ Both players ready — match is live!' });
        } else {
          await interaction.editReply({ content: '✅ You are marked as ready. Waiting for your opponent.' });
        }
      } catch (err) {
        console.error('[bot] bracket_ready error:', err);
        await interaction.editReply({ content: '❌ Something went wrong.' }).catch(() => null);
      }
      return;
    }

    // ── Tournament: Check-in ──────────────────────────────────────────────────
    if (prefix === 'bracket_checkin') {
      const matchId = entityId;
      const side = value as 'A' | 'B';
      await interaction.deferReply({ ephemeral: true });
      try {
        const match = await prisma.tournamentMatch.findUnique({
          where: { id: matchId },
          include: { participantA: true, participantB: true },
        });
        if (!match) {
          await interaction.editReply({ content: '❌ Match not found.' });
          return;
        }

        const participant = side === 'A' ? match.participantA : match.participantB;
        if (!participant?.discordId || participant.discordId !== interaction.user.id) {
          await interaction.editReply({ content: '❌ You are not a participant in this match.' });
          return;
        }

        const update: Record<string, boolean> = side === 'A' ? { checkedInA: true } : { checkedInB: true };
        const updated = await prisma.tournamentMatch.update({ where: { id: matchId }, data: update });

        if (updated.checkedInA && updated.checkedInB) {
          await prisma.tournamentMatch.update({ where: { id: matchId }, data: { status: 'IN_PROGRESS' } });
          await interaction.editReply({ content: '✅ Both players checked in — match is live!' });
        } else {
          await interaction.editReply({ content: '✅ You are checked in. Waiting for your opponent.' });
        }
      } catch (err) {
        console.error('[bot] bracket_checkin error:', err);
        await interaction.editReply({ content: '❌ Something went wrong.' }).catch(() => null);
      }
      return;
    }

    // ── Tournament: Self-register ─────────────────────────────────────────────
    if (prefix === 'bracket_register') {
      const tournamentId = entityId;
      await interaction.deferReply({ ephemeral: true });
      try {
        const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } });
        if (!tournament) {
          await interaction.editReply({ content: '❌ Tournament not found.' });
          return;
        }
        if (tournament.status !== 'REGISTRATION') {
          await interaction.editReply({ content: 'ℹ️ Registration is no longer open.' });
          return;
        }

        const existing = await prisma.tournamentParticipant.findFirst({
          where: { tournamentId, discordId: interaction.user.id },
        });
        if (existing) {
          await interaction.editReply({ content: 'ℹ️ You are already registered.' });
          return;
        }

        const count = await prisma.tournamentParticipant.count({ where: { tournamentId } });
        if (count >= tournament.size) {
          await interaction.editReply({ content: '❌ Tournament is full.' });
          return;
        }

        const displayName = (interaction.member instanceof GuildMember)
          ? interaction.member.displayName
          : interaction.user.username;

        await prisma.tournamentParticipant.create({
          data: { tournamentId, discordId: interaction.user.id, displayName },
        });

        // Add user to the registration/tournament thread
        if (tournament.threadId) {
          const thread = await client.channels.fetch(tournament.threadId).catch(() => null);
          if (thread?.isThread()) {
            await thread.members.add(interaction.user.id).catch(() => null);
          }
        }

        await interaction.editReply({ content: `✅ You are registered for **${tournament.name}**!` });
      } catch (err) {
        console.error('[bot] bracket_register error:', err);
        await interaction.editReply({ content: '❌ Something went wrong.' }).catch(() => null);
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

  // VC deletion is handled by the scheduler (checkEndedEvents) with a 5-minute
  // empty-VC timer so members have time to wind down after the event ends.

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

      // Add to roster (if not already there) and notify the event thread.
      // joinRoster is idempotent — it no-ops when the user is already on the roster.
      // Isolated try/catch: a unique-constraint race (two simultaneous VC joins for the
      // same user) should not prevent the confirmedAttendees append below from running.
      await joinRoster(event.id, userId, username).catch((err) =>
        console.error('[bot] VoiceStateUpdate joinRoster error:', err),
      );

      // Atomically append userId to confirmedAttendees if not already present.
      // A single SQL statement avoids the read-modify-write race when two members
      // join the same VC simultaneously.
      const userIdJson = JSON.stringify([userId]);
      await prisma.$executeRaw`
        UPDATE "Event"
        SET "confirmedAttendees" = (
          COALESCE("confirmedAttendees", '[]')::jsonb || ${userIdJson}::jsonb
        )::text
        WHERE id = ${event.id}
          AND NOT (COALESCE("confirmedAttendees", '[]')::jsonb @> ${userIdJson}::jsonb)
      `;
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
