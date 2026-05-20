import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import type { EventRole } from '@dem/shared';

interface RsvpEntry {
  userId: string;
  role: string | null;
}

interface EventForRoster {
  id: string;
  name: string;
  description: string | null;
  musterPoint: string | null;
  startTime: Date;
  endTime: Date | null;
  recurType: string | null;
  imageUrl: string | null;
  roles: string; // JSON
  rsvps: RsvpEntry[];
}

const RECUR_LABELS: Record<string, string> = {
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  BIWEEKLY: 'Every 2 weeks',
  MONTHLY: 'Monthly',
};

function formatMember(userId: string, activeUserIds?: Set<string>): string {
  if (!activeUserIds) return `<@${userId}>`;
  return activeUserIds.has(userId) ? `✅ <@${userId}>` : `<@${userId}>`;
}

export function buildRosterEmbed(event: EventForRoster, activeUserIds?: Set<string>, imageFileName?: string): EmbedBuilder {
  const roles = JSON.parse(event.roles) as EventRole[];
  const startTs = Math.floor(event.startTime.getTime() / 1000);
  const endTs = event.endTime ? Math.floor(event.endTime.getTime() / 1000) : null;

  const whenParts = [`<t:${startTs}:F>`];
  if (endTs) whenParts.push(`→ <t:${endTs}:t>`);
  if (event.recurType) whenParts.push(`· ${RECUR_LABELS[event.recurType] ?? event.recurType}`);

  const ended = activeUserIds !== undefined;

  const embed = new EmbedBuilder()
    .setTitle(`${ended ? '🏁' : '📅'} ${event.name}`)
    .setColor(ended ? 0x747f8d : 0x5865f2)
    .setFooter({ text: `Event ID: ${event.id}` })
    .setTimestamp();

  if (event.description) embed.setDescription(event.description);
  if (imageFileName) embed.setImage(`attachment://${imageFileName}`);

  embed.addFields({ name: '🕐 When', value: whenParts.join(' '), inline: false });

  if (event.musterPoint) {
    embed.addFields({ name: '📍 Muster Point', value: event.musterPoint, inline: false });
  }

  const unassigned = event.rsvps.filter((r) => !r.role);

  if (roles.length > 0) {
    for (const role of roles) {
      const members = event.rsvps.filter((r) => r.role === role.name);
      const filled = `${members.length}/${role.count}`;
      const value = members.length > 0
        ? members.map((r) => formatMember(r.userId, activeUserIds)).join(', ')
        : '*None*';
      embed.addFields({ name: `${role.name} (${filled})`, value, inline: true });
    }
  }

  const unassignedValue = unassigned.length > 0
    ? unassigned.map((r) => formatMember(r.userId, activeUserIds)).join(', ')
    : '*None*';
  embed.addFields({
    name: `📋 Unassigned (${unassigned.length})`,
    value: unassignedValue,
    inline: true,
  });

  if (ended && activeUserIds.size > 0) {
    embed.addFields({
      name: `🎙️ Active in VC (${activeUserIds.size})`,
      value: [...activeUserIds].map((id) => `<@${id}>`).join(', '),
      inline: false,
    });
  }

  return embed;
}

export function buildPostEventEmbed(
  event: EventForRoster,
  attendees: { userId: string; items: { name: string; quantity: number }[] }[],
  imageFileName?: string,
): EmbedBuilder {
  const startTs = Math.floor(event.startTime.getTime() / 1000);
  const endTs = event.endTime ? Math.floor(event.endTime.getTime() / 1000) : null;

  const whenParts = [`<t:${startTs}:F>`];
  if (endTs) whenParts.push(`→ <t:${endTs}:t>`);

  const embed = new EmbedBuilder()
    .setTitle(`🏁 ${event.name}`)
    .setColor(0x747f8d)
    .setFooter({ text: `Event ID: ${event.id}` })
    .setTimestamp();

  if (event.description) embed.setDescription(event.description);
  if (imageFileName) embed.setImage(`attachment://${imageFileName}`);

  embed.addFields({ name: '🕐 When', value: whenParts.join(' '), inline: false });
  if (event.musterPoint) {
    embed.addFields({ name: '📍 Muster Point', value: event.musterPoint, inline: false });
  }

  const lines = attendees.map(({ userId, items }) => {
    const base = `✅ <@${userId}>`;
    if (items.length === 0) return base;
    const lootStr = items
      .map((i) => `**${i.name}**${i.quantity > 1 ? ` ×${i.quantity}` : ''}`)
      .join(', ');
    return `${base} — ${lootStr}`;
  });

  const fieldTitle = `✅ Confirmed Attendees (${attendees.length})`;
  if (lines.length === 0) {
    embed.addFields({ name: fieldTitle, value: '*No confirmed attendees*', inline: false });
  } else {
    const LIMIT = 1024;
    let chunk = '';
    let isFirst = true;
    for (const line of lines) {
      const next = chunk ? `${chunk}\n${line}` : line;
      if (next.length > LIMIT) {
        embed.addFields({ name: isFirst ? fieldTitle : '​', value: chunk, inline: false });
        chunk = line;
        isFirst = false;
      } else {
        chunk = next;
      }
    }
    if (chunk) {
      embed.addFields({ name: isFirst ? fieldTitle : '​', value: chunk, inline: false });
    }
  }

  return embed;
}

export function buildRoleButtons(eventId: string, roles: EventRole[]): ActionRowBuilder<ButtonBuilder>[] {
  // Unassigned is always the first button so it's always accessible
  const allButtons: ButtonBuilder[] = [
    new ButtonBuilder()
      .setCustomId(`role:${eventId}:__unassigned__`)
      .setLabel('Unassigned')
      .setEmoji('📋')
      .setStyle(ButtonStyle.Secondary),
    ...roles.map((role) =>
      new ButtonBuilder()
        .setCustomId(`role:${eventId}:${role.name}`)
        .setLabel(role.name)
        .setStyle(ButtonStyle.Primary),
    ),
  ];

  // Split into rows of 5
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < allButtons.length && i < 25; i += 5) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(allButtons.slice(i, i + 5)),
    );
  }
  return rows;
}
