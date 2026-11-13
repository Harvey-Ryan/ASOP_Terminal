import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import type { EventRole } from '@dem/shared';
import { describeRecurrence, serverHeadcount, serverTagOf, AFTER_ACTION_OUTCOMES, type AfterActionOutcome } from '@dem/shared';

interface RsvpEntry {
  userId: string;
  role: string | null;
  /** "Maybe" (v1.17.0) */
  tentative?: boolean;
  /** Server they signed up from (v1.20.0) */
  guildId?: string | null;
}

interface EventForRoster {
  id: string;
  name: string;
  description: string | null;
  musterPoint: string | null;
  startTime: Date;
  endTime: Date | null;
  recurType: string | null;
  recurAnchor?: Date | null;
  recurTimezone?: string | null;
  imageUrl: string | null;
  roles: string; // JSON
  /** The host server (for server tags on shared events) */
  guildId?: string;
  rsvps: RsvpEntry[];
  /** In line order (v1.14.0) */
  waitlist?: { userId: string; role: string }[];
  /** Mission briefing (v1.36.0) */
  briefingPublishedAt?: Date | null;
  briefingSummary?: string | null;
}

/** Discord's limit for an embed field's text. */
const FIELD_MAX = 1024;

/** Joins mentions, ending with "+N more" rather than going over Discord's field limit. */
function mentionList(items: string[], prefix = ''): string {
  let out = prefix;
  for (let i = 0; i < items.length; i++) {
    const next = `${i ? ', ' : ''}${items[i]}`;
    const more = ` +${items.length - i} more`;
    if (out.length + next.length + (i < items.length - 1 ? more.length : 0) > FIELD_MAX - 20) return `${out}${more}`;
    out += next;
  }
  return out;
}


function formatMember(userId: string, activeUserIds?: Set<string>): string {
  if (!activeUserIds) return `<@${userId}>`;
  return activeUserIds.has(userId) ? `✅ <@${userId}>` : `<@${userId}>`;
}

/**
 * The roster message. On a shared event (joint op, v1.20.0) `serverTags` holds
 * each taking-part server's tag: everyone gets theirs, with a headcount per server.
 */
export function buildRosterEmbed(event: EventForRoster, activeUserIds?: Set<string>, imageFileName?: string, guildTagMap?: Record<string, string>, serverTags?: Record<string, string>): EmbedBuilder {
  const joint = serverTags && event.guildId && Object.keys(serverTags).length > 1 ? { tags: serverTags, host: event.guildId } : null;
  const member = (r: RsvpEntry) => {
    const tag = joint ? serverTagOf({ guildId: r.guildId ?? null }, joint.host, joint.tags) : undefined;
    return tag ? `${formatMember(r.userId, activeUserIds)} \`${tag}\`` : formatMember(r.userId, activeUserIds);
  };
  const roles = JSON.parse(event.roles) as EventRole[];
  const startTs = Math.floor(event.startTime.getTime() / 1000);
  const endTs = event.endTime ? Math.floor(event.endTime.getTime() / 1000) : null;

  const whenParts = [`<t:${startTs}:F>`];
  if (endTs) whenParts.push(`→ <t:${endTs}:t>`);
  if (event.recurType) whenParts.push(`· ${describeRecurrence(event.recurType, event.recurAnchor ?? event.startTime, event.recurTimezone)}`);

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

  if (event.briefingPublishedAt && !ended) {
    embed.addFields({ name: '📋 Briefing ready', value: `${event.briefingSummary ? `${event.briefingSummary}\n` : ''}Open it with the **Briefing** button.`.slice(0, FIELD_MAX), inline: false });
  }

  if (joint) {
    const counts = serverHeadcount(event.rsvps.map((r) => ({ guildId: r.guildId ?? null, tentative: r.tentative })), joint.host, joint.tags);
    embed.addFields({ name: '👥 By server', value: counts.map((c) => `${c.tag} ${c.count}`).join(' · '), inline: false });
  }

  const unassigned = event.rsvps.filter((r) => !r.role && !r.tentative);
  const maybes = event.rsvps.filter((r) => r.tentative);

  if (roles.length > 0) {
    for (const role of roles) {
      const roleKey = role.id ?? role.name;
      const members = event.rsvps.filter((r) => r.role === roleKey);
      const filled = `${members.length}/${role.count}`;
      let value = members.length > 0 ? mentionList(members.map(member)) : '*None*';
      const waiting = ended ? [] : (event.waitlist ?? []).filter((w) => w.role === roleKey);
      if (waiting.length) value = mentionList(waiting.map((w) => `<@${w.userId}>`), `${value}\n⏳ Waiting: `);
      const tag = role.guildId && guildTagMap ? guildTagMap[role.guildId] : undefined;
      const fieldName = tag ? `${role.name} [${tag}] (${filled})` : `${role.name} (${filled})`;
      embed.addFields({ name: fieldName, value, inline: true });
    }
  }

  const unassignedValue = unassigned.length > 0
    ? mentionList(unassigned.map(member))
    : '*None*';
  embed.addFields({
    name: `📋 Unassigned (${unassigned.length})`,
    value: unassignedValue,
    inline: true,
  });

  // Only when someone said maybe, to keep the roster short (v1.17.0).
  if (maybes.length > 0) {
    embed.addFields({ name: `❔ Maybe (${maybes.length})`, value: mentionList(maybes.map(member)), inline: true });
  }

  if (ended && activeUserIds.size > 0) {
    embed.addFields({
      name: `🎙️ Active in VC (${activeUserIds.size})`,
      value: mentionList([...activeUserIds].map((id) => `<@${id}>`)),
      inline: false,
    });
  }

  return embed;
}

export function buildPostEventEmbed(
  event: EventForRoster,
  attendees: { userId: string; items: { name: string; quantity: number }[] }[],
  imageFileName?: string,
  dkpAward?: number,
  dkpLabel?: string,
  /** The officers' after-action notes (v1.19.0) */
  afterAction?: { outcome: string | null; notes: string | null } | null,
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

  if (afterAction && (afterAction.outcome || afterAction.notes)) {
    const o = afterAction.outcome ? AFTER_ACTION_OUTCOMES[afterAction.outcome as AfterActionOutcome] : null;
    const notes = afterAction.notes ?? '';
    embed.addFields({
      name: `📝 After action${o ? ` · ${o.emoji} ${o.label}` : ''}`,
      value: notes ? (notes.length > 1024 ? `${notes.slice(0, 1020)}…` : notes) : '​',
      inline: false,
    });
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

  if (dkpAward && dkpAward > 0) {
    const label = dkpLabel ?? 'DKP';
    embed.addFields({
      name: `🪙 ${label} Awarded`,
      value: `+${dkpAward} ${label} to ${attendees.length} attendee${attendees.length !== 1 ? 's' : ''}`,
      inline: false,
    });
  }

  return embed;
}

/**
 * The buttons under a roster: one per role this server can take (a full role
 * becomes a grey "· waitlist" button, v1.14.0), then Unassigned, Maybe
 * (v1.17.0) and Leave Roster, which always fit in Discord's 25.
 */
export function buildRoleButtons(
  eventId: string,
  roles: EventRole[],
  rsvps: { role: string | null }[],
  viewingGuildId?: string,
  /** A published briefing (v1.36.0): adds a Briefing link to it, opened as the server viewing the roster */
  briefing = false,
): ActionRowBuilder<ButtonBuilder>[] {
  const visibleRoles = viewingGuildId
    ? roles.filter((r) => !r.guildId || r.guildId === viewingGuildId)
    : roles;

  const allButtons: ButtonBuilder[] = [
    ...visibleRoles.slice(0, briefing && viewingGuildId ? 21 : 22).map((role) => {
      const key = role.id ?? role.name;
      const full = rsvps.filter((r) => r.role === key).length >= role.count;
      return full
        ? new ButtonBuilder().setCustomId(`wait:${eventId}:${key}`).setLabel(`${role.name} · waitlist`.slice(0, 80)).setStyle(ButtonStyle.Secondary)
        : new ButtonBuilder().setCustomId(`role:${eventId}:${key}`).setLabel(role.name.slice(0, 80)).setStyle(ButtonStyle.Primary);
    }),
    new ButtonBuilder()
      .setCustomId(`role:${eventId}:__unassigned__`)
      .setLabel('Unassigned')
      .setEmoji('📋')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`maybe:${eventId}`)
      .setLabel('Maybe')
      .setEmoji('❔')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`leave:${eventId}`)
      .setLabel('Leave Roster')
      .setEmoji('🚪')
      .setStyle(ButtonStyle.Danger),
  ];
  if (briefing && viewingGuildId) {
    const web = (process.env['WEB_URL'] ?? 'http://localhost:5173').replace(/\/$/, '');
    allButtons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Briefing').setEmoji('📋')
      .setURL(`${web}/dashboard/servers/${viewingGuildId}/events/${eventId}/briefing`));
  }

  // Split into rows of 5
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < allButtons.length && i < 25; i += 5) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(allButtons.slice(i, i + 5)),
    );
  }
  return rows;
}
