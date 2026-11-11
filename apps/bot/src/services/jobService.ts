// Job board (v1.21.0), Discord side. A job is posted in its server's jobs
// channel and, when shared with allies or everyone, in its allies' jobs
// channels (only servers that chose a channel). The message updates as people
// take it, and closes when it's done, cancelled or expired. Global jobs reach
// other servers on the website's board, not in their channels.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { JOB_KINDS, JOB_TAKE_MESSAGES, JOB_VISIBILITY, jobTakeProblem, type JobKind, type JobVisibility } from '@dem/shared';
import { prisma } from '../db.js';
import { client } from '../client.js';

interface JobPost { guildId: string; channelId: string; messageId: string }
type JobWithCrew = NonNullable<Awaited<ReturnType<typeof loadJob>>>;

const loadJob = (id: string) => prisma.job.findUnique({ where: { id }, include: { crew: { orderBy: { id: 'asc' } } } });

const webUrl = () => process.env['WEB_URL'] ?? 'http://localhost:5173';

/** Servers allied with this one (Discord ids). */
async function alliesOf(discordGuildId: string): Promise<string[]> {
  const guild = await prisma.guild.findUnique({ where: { guildId: discordGuildId }, select: { id: true } });
  if (!guild) return [];
  const links = await prisma.guildAlly.findMany({ where: { status: 'ACCEPTED', OR: [{ guildAId: guild.id }, { guildBId: guild.id }] }, select: { guildAId: true, guildBId: true } });
  const ids = links.map((l) => (l.guildAId === guild.id ? l.guildBId : l.guildAId));
  return (await prisma.guild.findMany({ where: { id: { in: ids } }, select: { guildId: true } })).map((g) => g.guildId);
}

/** The jobs channels a job goes in: its own server's, plus its allies' when shared. */
async function targetChannels(job: { guildId: string; visibility: string }): Promise<Map<string, string>> {
  const servers = [job.guildId, ...(job.visibility === 'SERVER' ? [] : await alliesOf(job.guildId))];
  const rows = await prisma.guild.findMany({
    where: { guildId: { in: servers } },
    select: { guildId: true, settings: { select: { jobsEnabled: true, jobsChannelId: true } } },
  });
  return new Map(rows.filter((r) => r.settings?.jobsChannelId && r.settings.jobsEnabled !== false).map((r) => [r.guildId, r.settings!.jobsChannelId!]));
}

const CLOSED: Record<string, { label: string; color: number }> = {
  DONE: { label: '✅ Done', color: 0x747f8d },
  CANCELLED: { label: '🚫 Cancelled', color: 0x747f8d },
  EXPIRED: { label: '⌛ Expired', color: 0x747f8d },
};

/** The job as it shows in `inGuildId`'s channel. */
export function jobMessage(job: JobWithCrew, inGuildId: string, homeName: string | null) {
  const kind = JOB_KINDS[job.kind as JobKind] ?? JOB_KINDS.OTHER;
  const closed = CLOSED[job.status];
  const full = job.crew.length >= job.slots;
  const facts = [
    job.reward && `💰 ${job.reward}`,
    job.whenText && `🕐 ${job.whenText}`,
    job.location && `📍 ${job.location}`,
    `👤 Posted by <@${job.posterId}>${job.guildId !== inGuildId && homeName ? ` from ${homeName}` : ''}`,
  ].filter(Boolean).join(' · ');
  const embed = new EmbedBuilder()
    .setColor(closed ? closed.color : full ? 0xfaa61a : 0x57f287)
    .setTitle(`${kind.emoji} ${kind.label} · ${job.title}`.slice(0, 256))
    .setDescription([job.details, facts].filter(Boolean).join('\n\n').slice(0, 4000))
    .addFields({
      name: `Crew (${job.crew.length}/${job.slots})${closed ? ` · ${closed.label}` : full ? ' · Full' : ''}`,
      value: job.crew.length ? job.crew.map((c) => `<@${c.userId}>`).join(', ').slice(0, 1024) : '*Nobody yet*',
    })
    .setFooter({ text: closed ? 'Closed' : `${JOB_VISIBILITY[job.visibility as JobVisibility]?.label ?? 'This server'} · open until ${job.expiresAt.toISOString().slice(0, 10)}` });
  if (closed) return { embeds: [embed], components: [] as ActionRowBuilder<ButtonBuilder>[], allowedMentions: { parse: [] as [] } };
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`job:take:${job.id}`).setLabel(full ? 'Crew full' : 'Take job').setStyle(ButtonStyle.Primary).setDisabled(full),
    new ButtonBuilder().setCustomId(`job:leave:${job.id}`).setLabel('Leave').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Job board').setURL(`${webUrl()}/dashboard/servers/${inGuildId}/jobs`),
  );
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] as [] } };
}

/** Posts or updates a job's messages in every jobs channel it belongs in. */
export async function syncJobMessages(jobId: string): Promise<void> {
  const job = await loadJob(jobId);
  if (!job) return;
  const posts = JSON.parse(job.messages) as JobPost[];
  const home = await prisma.guild.findUnique({ where: { guildId: job.guildId }, select: { name: true } });
  // Closed jobs only update what was posted; open ones also go where they're missing.
  const targets = job.status === 'OPEN' && job.expiresAt > new Date() ? await targetChannels(job) : new Map<string, string>();
  const kept: JobPost[] = [];

  for (const p of posts) {
    try {
      const ch = await client.channels.fetch(p.channelId).catch(() => null);
      const msg = ch?.isTextBased() ? await ch.messages.fetch(p.messageId).catch(() => null) : null;
      if (!msg) continue; // deleted: post again below if it still belongs there
      await msg.edit(jobMessage(job, p.guildId, home?.name ?? null));
      kept.push(p);
    } catch (err) {
      console.warn(`[jobs] Couldn't update job ${job.id} in ${p.channelId}:`, err instanceof Error ? err.message : err);
      kept.push(p);
    }
  }
  for (const [guildId, channelId] of targets) {
    if (kept.some((p) => p.guildId === guildId)) continue;
    try {
      const ch = await client.channels.fetch(channelId).catch(() => null);
      if (!ch?.isTextBased() || !('send' in ch)) continue;
      const msg = await ch.send(jobMessage(job, guildId, home?.name ?? null));
      kept.push({ guildId, channelId, messageId: msg.id });
    } catch (err) {
      console.warn(`[jobs] Couldn't post job ${job.id} in ${channelId}:`, err instanceof Error ? err.message : err);
    }
  }
  if (JSON.stringify(kept) !== job.messages) await prisma.job.update({ where: { id: job.id }, data: { messages: JSON.stringify(kept) } });
}

/** Tells the poster someone took their job. Closed DMs are fine: it's on the board. */
export async function notifyJobTaken(jobId: string, takerId: string): Promise<void> {
  const job = await loadJob(jobId);
  if (!job) return;
  const kind = JOB_KINDS[job.kind as JobKind] ?? JOB_KINDS.OTHER;
  try {
    const poster = await client.users.fetch(job.posterId);
    await poster.send({
      content: `${kind.emoji} <@${takerId}> took your job **${job.title}** (${job.crew.length}/${job.slots}).`,
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Job board').setURL(`${webUrl()}/dashboard/servers/${job.guildId}/jobs?view=mine`),
      )],
    });
  } catch {
    console.warn(`[jobs] Couldn't DM ${job.posterId} about job ${job.id}`);
  }
}

/** Take or Leave from a Discord button. Returns the reply. */
export async function clickJob(action: 'take' | 'leave', jobId: string, userId: string, username: string, guildId: string | null): Promise<string> {
  if (action === 'leave') {
    const gone = await prisma.jobCrew.deleteMany({ where: { jobId, userId } });
    if (gone.count) void syncJobMessages(jobId).catch((err) => console.error(`[jobs] Sync failed for ${jobId}:`, err));
    return gone.count ? 'You\'ve left this job.' : 'You weren\'t on this job.';
  }
  const problem = await prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ status: string; slots: number; posterId: string; expiresAt: Date }[]>`
      SELECT status, slots, "posterId", "expiresAt" FROM "Job" WHERE id = ${jobId} FOR UPDATE`;
    if (!row) return 'closed' as const;
    const crew = await tx.jobCrew.findMany({ where: { jobId }, select: { userId: true } });
    const why = jobTakeProblem({ ...row, status: row.expiresAt < new Date() ? 'EXPIRED' : row.status }, crew, userId);
    if (why) return why;
    await tx.jobCrew.create({ data: { jobId, userId, username, guildId } });
    return null;
  });
  if (problem) return `⚠️ ${JOB_TAKE_MESSAGES[problem]}`;
  void syncJobMessages(jobId).catch((err) => console.error(`[jobs] Sync failed for ${jobId}:`, err));
  void notifyJobTaken(jobId, userId);
  return '✅ You took the job. The poster has been told; sort out the details with them.';
}

/** Open jobs past their date close (scheduler, every minute). */
export async function expireJobs(): Promise<void> {
  const due = await prisma.job.findMany({ where: { status: 'OPEN', expiresAt: { lt: new Date() } }, select: { id: true }, take: 50 });
  for (const { id } of due) {
    await prisma.job.update({ where: { id }, data: { status: 'EXPIRED', closedAt: new Date() } });
    await syncJobMessages(id).catch((err) => console.error(`[jobs] Sync failed for expired ${id}:`, err));
  }
}
