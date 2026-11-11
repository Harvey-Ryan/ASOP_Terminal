// Error monitoring for the bot (v1.13.0). See packages/shared/src/errorLog.ts.
//
// - console.error / console.warn are recorded (installed in index.ts).
// - Each interaction (slash command, button, menu) runs with a short ref and
//   its command, server and user, so errors logged while handling it carry
//   them; the "Something went wrong" replies show the ref.
// - Discord client errors and unhandled rejections are recorded as well.

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Interaction } from 'discord.js';
import { ErrorRecorder, captureConsole, newRef } from '@dem/shared';
import { prisma } from '../db.js';
import { APP_COMMIT, APP_VERSION } from '../appVersion.js';

export const RELEASE = `${APP_VERSION}${APP_COMMIT ? `+${APP_COMMIT}` : ''}`;

interface InteractionContext { ref: string; guildId: string | null; userId: string; what: string }

const als = new AsyncLocalStorage<InteractionContext>();
const original = { error: console.error.bind(console) };

export const botErrors = new ErrorRecorder({
  source: 'bot',
  release: RELEASE,
  write: async (rows) => { await prisma.errorEvent.createMany({ data: rows }); },
  fallbackLog: (...args) => original.error(...args),
  currentContext: () => {
    const ctx = als.getStore();
    return ctx ? { ref: ctx.ref, guildId: ctx.guildId, userId: ctx.userId, context: { interaction: ctx.what } } : undefined;
  },
});

export function captureBotConsole(): void {
  captureConsole(botErrors);
}

/** "/loot roll", "button event:role", "select …": what the person was doing. */
function describeInteraction(i: Interaction): string {
  if (i.isChatInputCommand()) {
    const group = i.options.getSubcommandGroup(false);
    const sub = i.options.getSubcommand(false);
    return `/${[i.commandName, group, sub].filter(Boolean).join(' ')}`;
  }
  if (i.isAutocomplete()) return `autocomplete /${i.commandName}`;
  if (i.isButton()) return `button ${i.customId.split(':').slice(0, 2).join(':')}`;
  if (i.isAnySelectMenu()) return `select ${i.customId.split(':').slice(0, 2).join(':')}`;
  if (i.isModalSubmit()) return `modal ${i.customId.split(':').slice(0, 2).join(':')}`;
  return `interaction type ${i.type}`;
}

/** Runs an interaction handler with its ref and context. */
export function withInteraction<T>(interaction: Interaction, fn: () => Promise<T>): Promise<T> {
  return als.run({ ref: newRef(), guildId: interaction.guildId, userId: interaction.user.id, what: describeInteraction(interaction) }, fn);
}

/** "Something went wrong." plus the ref to quote, inside an interaction. */
export function withRef(message: string): string {
  const ref = als.getStore()?.ref;
  return ref ? `${message} (Ref ${ref})` : message;
}

/** Every minute from index.ts: the bot is alive, with its gateway numbers (admin Overview). */
export async function botHeartbeat(startedAt: Date, details: Record<string, unknown>): Promise<void> {
  const d = JSON.stringify({ ...details, memoryMb: Math.round(process.memoryUsage().rss / 1_048_576), uptimeMin: Math.round(process.uptime() / 60) });
  await prisma.serviceHeartbeat.upsert({
    where: { service: 'bot' },
    create: { service: 'bot', startedAt, beatAt: new Date(), release: RELEASE, details: d },
    update: { startedAt, beatAt: new Date(), release: RELEASE, details: d },
  });
}
