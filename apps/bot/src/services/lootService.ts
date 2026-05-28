import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { prisma } from '../db.js';
import { client } from '../client.js';
import { getGuildDkpLabel } from '../utils/dkpLabel.js';

const LOOT_PICKER_ROLE = 'Loot Picker';

function getNextPicker(position: number, draftOrder: string[]): string | null {
  if (draftOrder.length === 0) return null;
  const n = draftOrder.length;
  const round = Math.floor(position / n);
  const pos = position % n;
  return round % 2 === 0 ? draftOrder[pos]! : draftOrder[n - 1 - pos]!;
}

export async function announceDraftOrder(eventId: string) {
  const session = await prisma.lootSession.findUnique({ where: { eventId } });
  if (!session || session.method !== 'SNAKE_DRAFT') return;

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event?.threadId) return;

  const draftOrder: string[] = JSON.parse(session.draftOrder);
  if (draftOrder.length === 0) return;

  const lines = draftOrder.map((userId, i) => `${i + 1}. <@${userId}>`).join('\n');

  const embed = new EmbedBuilder()
    .setTitle('🐍 Snake Draft Order Updated')
    .setDescription(lines)
    .setColor(0xf59e0b)
    .setTimestamp();

  try {
    const thread = await client.channels.fetch(event.threadId);
    if (thread?.isThread()) {
      const wasArchived = thread.archived ?? false;
      if (wasArchived) await thread.setArchived(false).catch(() => null);
      await thread.send({ embeds: [embed] });
      if (wasArchived) await thread.setArchived(true).catch(() => null);
    }
  } catch (err) {
    console.error('[bot] Failed to announce draft order:', err);
  }
}

export async function notifySnakeTurn(eventId: string) {
  const session = await prisma.lootSession.findUnique({
    where: { eventId },
    include: { items: { include: { assignments: true } } },
  });
  if (!session || session.method !== 'SNAKE_DRAFT' || session.status === 'COMPLETED') return;

  const draftOrder: string[] = JSON.parse(session.draftOrder);
  if (draftOrder.length === 0) return;

  const allAssignmentCount = session.items.reduce((n, item) => n + item.assignments.length, 0);
  const totalUnassigned = session.items.filter((i) => i.assignments.length === 0).length;

  const guild = await client.guilds.fetch(session.guildId).catch(() => null);
  if (!guild) return;

  // Find or create the "Loot Picker" role
  let pickerRole = guild.roles.cache.find((r) => r.name === LOOT_PICKER_ROLE);
  if (!pickerRole) {
    pickerRole = await guild.roles.create({
      name: LOOT_PICKER_ROLE,
      color: 0xf59e0b,
      reason: 'Snake draft loot picker indicator',
    }).catch(() => null) ?? undefined;
  }

  // Remove role from any current holders — fetch only the role's members, not the whole guild
  if (pickerRole) {
    const freshRole = await guild.roles.fetch(pickerRole.id).catch(() => null);
    if (freshRole) {
      for (const [, member] of freshRole.members) {
        await member.roles.remove(freshRole).catch(() => null);
      }
    }
  }

  // If all items assigned, we're done — no DM needed (only exit when items actually exist)
  if (session.items.length > 0 && totalUnassigned === 0) return;

  const effectivePosition = allAssignmentCount + session.skipCount;
  const nextPickerId = getNextPicker(effectivePosition, draftOrder);
  if (!nextPickerId) return;

  // Assign the picker role to the new picker
  if (pickerRole) {
    const nextMember = await guild.members.fetch(nextPickerId).catch(() => null);
    if (nextMember) await nextMember.roles.add(pickerRole).catch(() => null);
  }

  const webUrl = process.env['WEB_URL'] ?? 'http://localhost:5173';
  const lootUrl = `${webUrl}/dashboard/servers/${session.guildId}/events/${eventId}/loot`;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel('View Loot Pool')
      .setStyle(ButtonStyle.Link)
      .setURL(lootUrl),
  );

  try {
    const discordUser = await client.users.fetch(nextPickerId);
    await discordUser.send({
      content: `🐍 It's your turn to pick in the snake draft!\n\nClick below to view the remaining loot and select your reward.`,
      components: [row],
    });
  } catch (err) {
    console.error(`[bot] Failed to DM snake draft picker ${nextPickerId}:`, err);
  }
}

export async function notifyStandaloneSnakeTurn(sessionId: string) {
  const session = await prisma.lootSession.findUnique({
    where: { id: sessionId },
    include: { items: { include: { assignments: true } } },
  });
  if (!session || session.method !== 'SNAKE_DRAFT' || session.status === 'COMPLETED') return;

  const draftOrder: string[] = JSON.parse(session.draftOrder);
  if (draftOrder.length === 0) return;

  const allAssignmentCount = session.items.reduce((n, item) => n + item.assignments.length, 0);
  const totalUnassigned = session.items.filter((i) => i.assignments.length === 0).length;

  const guild = await client.guilds.fetch(session.guildId).catch(() => null);
  if (!guild) return;

  // Find or create the "Loot Picker" role
  let pickerRole = guild.roles.cache.find((r) => r.name === LOOT_PICKER_ROLE);
  if (!pickerRole) {
    pickerRole = await guild.roles.create({
      name: LOOT_PICKER_ROLE,
      color: 0xf59e0b,
      reason: 'Snake draft loot picker indicator',
    }).catch(() => null) ?? undefined;
  }

  // Remove role from all current holders
  if (pickerRole) {
    const freshRole = await guild.roles.fetch(pickerRole.id).catch(() => null);
    if (freshRole) {
      for (const [, member] of freshRole.members) {
        await member.roles.remove(freshRole).catch(() => null);
      }
    }
  }

  if (session.items.length > 0 && totalUnassigned === 0) return;

  const effectivePosition = allAssignmentCount + session.skipCount;
  const nextPickerId = getNextPicker(effectivePosition, draftOrder);
  if (!nextPickerId) return;

  if (pickerRole) {
    const nextMember = await guild.members.fetch(nextPickerId).catch(() => null);
    if (nextMember) await nextMember.roles.add(pickerRole).catch(() => null);
  }

  const webUrl = process.env['WEB_URL'] ?? 'http://localhost:5173';
  const lootUrl = `${webUrl}/dashboard/servers/${session.guildId}/loot/sessions/${sessionId}`;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel('View Loot Pool')
      .setStyle(ButtonStyle.Link)
      .setURL(lootUrl),
  );

  try {
    const discordUser = await client.users.fetch(nextPickerId);
    await discordUser.send({
      content: `🐍 It's your turn to pick in the snake draft!\n\nClick below to view the remaining loot and select your reward.`,
      components: [row],
    });
  } catch (err) {
    console.error(`[bot] Failed to DM standalone snake draft picker ${nextPickerId}:`, err);
  }
}

export async function notifyLootComplete(sessionId: string) {
  const session = await prisma.lootSession.findUnique({
    where: { id: sessionId },
    include: { items: { include: { assignments: true }, orderBy: { sortOrder: 'asc' } } },
  });
  if (!session) return;

  // Build a map of userId → { username, items[] }
  type WinnerEntry = { username: string; lines: string[] };
  const winners = new Map<string, WinnerEntry>();

  for (const item of session.items) {
    for (const a of item.assignments) {
      if (!winners.has(a.userId)) winners.set(a.userId, { username: a.username, lines: [] });
      const qty = item.quantity > 1 ? ` ×${item.quantity}` : '';
      const ql = item.qualityLevel != null ? ` QL ${item.qualityLevel}` : '';
      let suffix = '';
      if (a.rollValue != null) suffix = ` (rolled ${a.rollValue})`;
      else if (a.dkpSpent != null && a.dkpSpent > 0) suffix = ` (${a.dkpSpent} DKP)`;
      else if (a.pickNumber != null) suffix = ` (pick #${a.pickNumber + 1})`;
      winners.get(a.userId)!.lines.push(`• ${item.name}${qty}${ql}${suffix}`);
    }
  }

  if (winners.size === 0) return;

  // Resolve session label — prefer event name, fall back to session name or generic
  let sessionLabel = session.name ?? 'Loot Session';
  if (session.eventId) {
    const event = await prisma.event.findUnique({ where: { id: session.eventId }, select: { name: true } });
    if (event) sessionLabel = event.name;
  }

  for (const [userId, { lines }] of winners) {
    const content = [
      `🎁 **Loot Session Complete — ${sessionLabel}**`,
      '',
      'Your items:',
      ...lines,
    ].join('\n');

    try {
      const discordUser = await client.users.fetch(userId);
      await discordUser.send({ content });
    } catch {
      // User may have DMs disabled — skip silently
    }
  }
}

const METHOD_LABELS: Record<string, string> = {
  RANDOM_ROLL: '🎲 Random Roll',
  SNAKE_DRAFT: '🐍 Snake Draft',
};

export async function announceLootSessionStart(sessionId: string) {
  const session = await prisma.lootSession.findUnique({ where: { id: sessionId } });
  if (!session || !session.eventId) return;

  const event = await prisma.event.findUnique({ where: { id: session.eventId } });
  if (!event?.threadId) return;

  const dkpLabel = await getGuildDkpLabel(session.guildId);

  const methodLabel = session.method === 'DKP'
    ? `🪙 ${dkpLabel} Bid`
    : METHOD_LABELS[session.method] ?? session.method;

  const attendeeCount = event.confirmedAttendees
    ? (JSON.parse(event.confirmedAttendees) as string[]).length
    : 0;

  const webUrl = process.env['WEB_URL'] ?? 'http://localhost:5173';
  const lootUrl = `${webUrl}/dashboard/servers/${session.guildId}/events/${event.id}/loot`;

  const fields: { name: string; value: string; inline: boolean }[] = [
    { name: 'Method', value: methodLabel, inline: true },
    { name: 'Eligible Attendees', value: String(attendeeCount), inline: true },
  ];

  if (session.dkpAward > 0) {
    fields.push({
      name: `${dkpLabel} Award`,
      value: `+${session.dkpAward} ${dkpLabel} per attendee on completion`,
      inline: false,
    });
  }

  const embed = new EmbedBuilder()
    .setTitle(`🎁 Loot Session Open — ${event.name}`)
    .setColor(0xf59e0b)
    .addFields(fields)
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel('Open Loot Session')
      .setStyle(ButtonStyle.Link)
      .setURL(lootUrl),
  );

  try {
    const thread = await client.channels.fetch(event.threadId);
    if (thread?.isThread()) {
      const wasArchived = thread.archived ?? false;
      if (wasArchived) await thread.setArchived(false).catch(() => null);
      await thread.send({ embeds: [embed], components: [row] });
      if (wasArchived) await thread.setArchived(true).catch(() => null);
    }
  } catch (err) {
    console.error('[bot] Failed to announce loot session start:', err);
  }
}

export async function announceLootResults(sessionId: string) {
  const session = await prisma.lootSession.findUnique({
    where: { id: sessionId },
    include: { items: { include: { assignments: true }, orderBy: { sortOrder: 'asc' } } },
  });
  if (!session || !session.eventId) return;

  const event = await prisma.event.findUnique({ where: { id: session.eventId } });
  if (!event?.threadId) return;

  const dkpLabel = await getGuildDkpLabel(session.guildId);

  const assignedItems = session.items.filter((i) => i.assignments.length > 0);
  if (assignedItems.length === 0) return;

  const lines = assignedItems.map((item) => {
    const a = item.assignments[0]!;
    const qty = item.quantity > 1 ? ` ×${item.quantity}` : '';
    let suffix = '';
    if (a.rollValue != null) suffix = ` *(rolled ${a.rollValue})*`;
    else if (a.dkpSpent != null) suffix = ` *(${a.dkpSpent} ${dkpLabel})*`;
    else if (a.pickNumber != null) suffix = ` *(pick #${a.pickNumber + 1})*`;
    return `**${item.name}${qty}** → <@${a.userId}>${suffix}`;
  });

  const methodLabel = session.method === 'DKP'
    ? `🪙 ${dkpLabel}`
    : METHOD_LABELS[session.method] ?? session.method;

  const embed = new EmbedBuilder()
    .setTitle(`🎁 Loot — ${event.name}`)
    .setColor(0xf59e0b)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `Method: ${methodLabel}` })
    .setTimestamp();

  if (session.dkpAward > 0) {
    const confirmedIds: string[] = event.confirmedAttendees
      ? JSON.parse(event.confirmedAttendees)
      : [];
    embed.addFields({
      name: `🪙 ${dkpLabel} Awarded`,
      value: `+${session.dkpAward} ${dkpLabel} to ${confirmedIds.length} attendee${confirmedIds.length !== 1 ? 's' : ''}`,
      inline: false,
    });
  }

  try {
    const thread = await client.channels.fetch(event.threadId);
    if (thread?.isThread()) {
      const wasArchived = thread.archived ?? false;
      if (wasArchived) await thread.setArchived(false).catch(() => null);
      await thread.send({ embeds: [embed] });
      if (wasArchived) await thread.setArchived(true).catch(() => null);
    }
  } catch (err) {
    console.error('[bot] Failed to post loot results:', err);
  }
}
