import { EmbedBuilder } from 'discord.js';
import { prisma } from '../db.js';
import { client } from '../client.js';

const METHOD_LABELS: Record<string, string> = {
  RANDOM_ROLL: '🎲 Random Roll',
  DKP: '🪙 DKP',
  SNAKE_DRAFT: '🐍 Snake Draft',
};

export async function announceLootResults(sessionId: string) {
  const session = await prisma.lootSession.findUnique({
    where: { id: sessionId },
    include: { items: { include: { assignments: true }, orderBy: { sortOrder: 'asc' } } },
  });
  if (!session) return;

  const event = await prisma.event.findUnique({ where: { id: session.eventId } });
  if (!event?.threadId) return;

  const assignedItems = session.items.filter((i) => i.assignments.length > 0);
  if (assignedItems.length === 0) return;

  const lines = assignedItems.map((item) => {
    const a = item.assignments[0]!;
    const qty = item.quantity > 1 ? ` ×${item.quantity}` : '';
    let suffix = '';
    if (a.rollValue != null) suffix = ` *(rolled ${a.rollValue})*`;
    else if (a.dkpSpent != null) suffix = ` *(${a.dkpSpent} DKP)*`;
    else if (a.pickNumber != null) suffix = ` *(pick #${a.pickNumber + 1})*`;
    return `**${item.name}${qty}** → <@${a.userId}>${suffix}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`🎁 Loot — ${event.name}`)
    .setColor(0xf59e0b)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `Method: ${METHOD_LABELS[session.method] ?? session.method}` })
    .setTimestamp();

  if (session.dkpAward > 0) {
    const confirmedIds: string[] = event.confirmedAttendees
      ? JSON.parse(event.confirmedAttendees)
      : [];
    embed.addFields({
      name: '🪙 DKP Awarded',
      value: `+${session.dkpAward} DKP to ${confirmedIds.length} attendee${confirmedIds.length !== 1 ? 's' : ''}`,
      inline: false,
    });
  }

  try {
    const thread = await client.channels.fetch(event.threadId);
    if (thread?.isThread()) {
      await thread.send({ embeds: [embed] });
    }
  } catch (err) {
    console.error('[bot] Failed to post loot results:', err);
  }
}
