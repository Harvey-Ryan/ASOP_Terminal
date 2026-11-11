// Job board (v1.21.0): members post small jobs ("Need a hauler, 60k aUEC"),
// others take them, the poster marks them done. A job is seen by its own
// server, or also by that server's allies, or by everyone on ASOP.

export const JOB_KINDS = {
  HAULING: { label: 'Hauling', emoji: '🚚' },
  ESCORT: { label: 'Escort', emoji: '🛡️' },
  MINING: { label: 'Mining', emoji: '⛏️' },
  SALVAGE: { label: 'Salvage', emoji: '♻️' },
  CRAFTING: { label: 'Crafting', emoji: '🔨' },
  BOUNTY: { label: 'Bounty', emoji: '🎯' },
  MEDICAL: { label: 'Medical', emoji: '🩺' },
  OTHER: { label: 'Other', emoji: '📌' },
} as const;
export type JobKind = keyof typeof JOB_KINDS;

export const JOB_VISIBILITY = {
  SERVER: { label: 'This server', help: 'Members of this server' },
  ALLIES: { label: 'Allies too', help: 'This server and its allies' },
  GLOBAL: { label: 'Everyone on ASOP', help: 'Every server that uses ASOP' },
} as const;
export type JobVisibility = keyof typeof JOB_VISIBILITY;

export type JobStatus = 'OPEN' | 'DONE' | 'CANCELLED' | 'EXPIRED';

/** Open jobs close by themselves after this long. */
export const JOB_EXPIRY_DAYS = 7;
export const JOB_LIMITS = { title: 100, details: 1000, reward: 60, location: 80, whenText: 60, maxSlots: 20, openPerPerson: 10 } as const;

export interface JobCrewDto { userId: string; username: string }

export interface JobDto {
  id: string;
  /** The server it was posted from, and its name */
  guildId: string;
  guildName: string;
  posterId: string;
  posterName: string;
  kind: JobKind;
  title: string;
  details: string | null;
  reward: string | null;
  location: string | null;
  whenText: string | null;
  slots: number;
  visibility: JobVisibility;
  status: JobStatus;
  expiresAt: string;
  createdAt: string;
  crew: JobCrewDto[];
}

/** Body for posting or editing a job. */
export interface JobInput {
  kind: JobKind;
  title: string;
  details?: string | null;
  reward?: string | null;
  location?: string | null;
  whenText?: string | null;
  slots?: number;
  visibility?: JobVisibility;
}

/**
 * Whether people in `viewerGuildId` can see (and take) a job. `alliesOfJobServer`
 * is the set of servers allied with the server the job was posted from.
 */
export function jobVisibleTo(job: { guildId: string; visibility: string }, viewerGuildId: string, alliesOfJobServer: ReadonlySet<string>): boolean {
  if (job.guildId === viewerGuildId || job.visibility === 'GLOBAL') return true;
  return job.visibility === 'ALLIES' && alliesOfJobServer.has(viewerGuildId);
}

/** Why someone can't take a job, or null if they can. */
export function jobTakeProblem(
  job: { status: string; slots: number; posterId: string },
  crew: readonly { userId: string }[],
  userId: string,
): 'closed' | 'own' | 'taken' | 'full' | null {
  if (job.status !== 'OPEN') return 'closed';
  if (job.posterId === userId) return 'own';
  if (crew.some((c) => c.userId === userId)) return 'taken';
  return crew.length >= job.slots ? 'full' : null;
}

export const JOB_TAKE_MESSAGES = {
  closed: 'This job is closed.',
  own: 'That\'s your own job.',
  taken: 'You\'re already on this job.',
  full: 'This job already has its crew.',
} as const;

/** Checks and tidies a job from a form. Returns the problem in words, or the clean job. */
export function parseJobInput(raw: unknown): { error: string } | { job: Required<JobInput> } {
  const b = (raw ?? {}) as Record<string, unknown>;
  const text = (k: keyof typeof JOB_LIMITS, required = false): string | null | { error: string } => {
    const v = b[k];
    if (v == null || v === '') return required ? { error: `Give the job a ${k}.` } : null;
    if (typeof v !== 'string') return { error: `${k} must be text.` };
    const t = v.trim();
    if (!t) return required ? { error: `Give the job a ${k}.` } : null;
    if (t.length > (JOB_LIMITS[k] as number)) return { error: `${k} can be at most ${JOB_LIMITS[k]} characters.` };
    return t;
  };
  if (typeof b['kind'] !== 'string' || !(b['kind'] in JOB_KINDS)) return { error: 'Pick a kind of job.' };
  const slots = b['slots'] == null ? 1 : Number(b['slots']);
  if (!Number.isInteger(slots) || slots < 1 || slots > JOB_LIMITS.maxSlots) return { error: `Crew must be between 1 and ${JOB_LIMITS.maxSlots}.` };
  const visibility = b['visibility'] == null ? 'SERVER' : String(b['visibility']);
  if (!(visibility in JOB_VISIBILITY)) return { error: 'Pick who can see the job.' };
  const fields = { title: text('title', true), details: text('details'), reward: text('reward'), location: text('location'), whenText: text('whenText') };
  for (const v of Object.values(fields)) if (v && typeof v === 'object') return v;
  return {
    job: {
      kind: b['kind'] as JobKind, slots, visibility: visibility as JobVisibility,
      title: fields.title as string, details: fields.details as string | null, reward: fields.reward as string | null,
      location: fields.location as string | null, whenText: fields.whenText as string | null,
    },
  };
}
