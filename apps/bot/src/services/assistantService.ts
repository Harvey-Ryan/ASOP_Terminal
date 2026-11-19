// The AI assistant in Discord (v1.56.0). A member tags the bot with a plain
// question; the server's own model (their key, their provider) answers it with
// ASOP's lookups (assistantTools.ts). Rules and provider formats are in
// packages/shared/src/assistant.ts; settings are on the website (API
// routes/assistant.ts).
//
// Checks, in order: the server is in the rollout (AI_SERVER_IDS), not switched
// off for every server, switched on here with a key, in an allowed channel, by
// an allowed role, within the member's daily and the server's monthly limits.
// Only counts are stored (AiUsage); a question the model flags is kept for
// that server's admins (AiFlag, 90 days).

import { PermissionFlagsBits, type Message } from 'discord.js';
import {
  ASSISTANT_PROVIDERS, CONTEXT_EXCHANGES, MAX_MODEL_ROUNDS, MAX_TOOL_CALLS,
  answerTokenCap, assistantLimitHit, assistantSystemPrompt, callModel, defuseMentions, isAssistantProvider,
  limitMessage, ModelCallError, pickTools, privacyNotice, questionText, trimAnswer, usageDay, usageMonthStart,
  type AssistantMessage, type AssistantProvider, type FetchLike,
} from '@dem/shared';
import type { AiAssistant } from '@prisma/client';
import { client } from '../client.js';
import { prisma } from '../db.js';
import { decryptAiKey } from '../utils/aiKeys.js';
import { getGuildDkpLabel } from '../utils/dkpLabel.js';
import { withMessage, withRef } from '../utils/errorLog.js';
import { runTool } from './assistantTools.js';

const web = () => process.env['WEB_URL'] ?? 'http://localhost:5173';
const settingsUrl = (guildId: string) => `${web()}/dashboard/servers/${guildId}/settings/assistant`;

// ── Who has it ───────────────────────────────────────────────────────────────

/** Rollout (same rule as the API's lib/assistant.ts): AI_SERVER_IDS, default Fleet 919, "*" = all. */
export function assistantAvailable(guildId: string): boolean {
  const raw = (process.env['AI_SERVER_IDS'] ?? '1497395378495160493').trim();
  return raw === '*' || raw.split(',').map((s) => s.trim()).includes(guildId);
}

let offCache: { at: number; off: boolean } | null = null;
async function globallyOff(): Promise<boolean> {
  if (offCache && Date.now() - offCache.at < 30_000) return offCache.off;
  const row = await prisma.adminConfig.findUnique({ where: { id: 1 }, select: { aiDisabled: true } }).catch(() => null);
  offCache = { at: Date.now(), off: row?.aiDisabled ?? false };
  return offCache.off;
}

const list = (json: string): string[] => { try { const v = JSON.parse(json); return Array.isArray(v) ? v : []; } catch { return []; } };

// ── Short answers to repeat questions ────────────────────────────────────────
// Same question in the same server within 10 minutes, when nothing personal
// was looked up: answered again without asking the model.

const answerCache = new Map<string, { at: number; text: string }>();
const cacheKey = (guildId: string, q: string) => `${guildId}|${q.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim()}`;
function cached(key: string): string | null {
  const hit = answerCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > 10 * 60_000) { answerCache.delete(key); return null; }
  return hit.text;
}
function remember(key: string, text: string) {
  if (answerCache.size > 500) answerCache.delete(answerCache.keys().next().value!);
  answerCache.set(key, { at: Date.now(), text });
}

// ── Context: earlier exchanges when someone replies to the assistant ──────────

async function earlierExchanges(message: Message): Promise<AssistantMessage[]> {
  const out: AssistantMessage[] = [];
  let ref = message.reference?.messageId ? await message.fetchReference().catch(() => null) : null;
  for (let i = 0; ref && i < CONTEXT_EXCHANGES; i++) {
    if (ref.author.id !== client.user?.id) break; // only a thread of questions to us
    const answer = ref.content.split('\n').filter((l) => !l.startsWith('-# ℹ️')).join('\n').trim();
    const question = ref.reference?.messageId ? await ref.fetchReference().catch(() => null) : null;
    if (!question) break;
    out.unshift({ role: 'assistant', text: answer, toolCalls: [] });
    out.unshift({ role: 'user', text: questionText(question.content, client.user!.id).slice(0, 500) });
    ref = question.reference?.messageId ? await question.fetchReference().catch(() => null) : null;
  }
  return out;
}

// ── Broken keys ──────────────────────────────────────────────────────────────

const KEY_WORDS: Record<string, string> = {
  invalid: 'the provider refused the key',
  no_credit: 'the provider says the account is out of credit or over its spending limit',
  model: "the provider doesn't recognise the model, or it can't use tools",
};

/** Tells the server's owner once a day that the key stopped working (the settings page shows it too). */
async function keyBroken(row: AiAssistant, kind: string, message: Message) {
  await prisma.aiAssistant.update({ where: { guildId: row.guildId }, data: { keyStatus: kind, keyCheckedAt: new Date() } }).catch(() => null);
  if (row.keyAlertAt && Date.now() - row.keyAlertAt.getTime() < 86_400_000) return;
  await prisma.aiAssistant.update({ where: { guildId: row.guildId }, data: { keyAlertAt: new Date() } }).catch(() => null);
  const owner = await message.guild?.fetchOwner().catch(() => null);
  await owner?.send(
    `⚠️ The ASOP assistant in **${message.guild?.name}** stopped working: ${KEY_WORDS[kind] ?? 'the provider refused the request'}. ` +
    `Members are told it's unavailable until it's fixed. Check the key and model here: ${settingsUrl(row.guildId)}`,
  ).catch(() => null);
}

// ── Counting ─────────────────────────────────────────────────────────────────

async function count(guildId: string, discordId: string, tokensIn: number, tokensOut: number) {
  const day = usageDay(new Date());
  await prisma.aiUsage.upsert({
    where: { guildId_discordId_day: { guildId, discordId, day } },
    create: { guildId, discordId, day, questions: 1, inputTokens: tokensIn, outputTokens: tokensOut },
    update: { questions: { increment: 1 }, inputTokens: { increment: tokensIn }, outputTokens: { increment: tokensOut } },
  }).catch((err) => console.error('[assistant] usage not counted:', err));
}

// ── The handler ──────────────────────────────────────────────────────────────

const replyTo = (message: Message, content: string) =>
  message.reply({ content: defuseMentions(content).slice(0, 2000), allowedMentions: { parse: [], repliedUser: true } }).catch((err) => {
    console.warn('[assistant] reply failed:', err instanceof Error ? err.message : err);
    return null;
  });

/** True when the message is a question for the assistant (it tags the bot itself). */
export function isForAssistant(message: Message): boolean {
  const me = client.user?.id;
  // Typed into the message: a reply to one of the bot's posts (a roster, say) pings it without asking anything.
  return !!me && !message.author.bot && !!message.guildId && new RegExp(`<@!?${me}>`).test(message.content);
}

export function handleAssistantMessage(message: Message): Promise<void> {
  return withMessage(message, 'assistant question', () => answer(message).catch((err) => {
    console.error('[assistant] question failed:', err);
    void replyTo(message, withRef('Sorry, something went wrong answering that.'));
  }));
}

async function answer(message: Message): Promise<void> {
  const guild = message.guild!;
  const member = message.member ?? await guild.members.fetch(message.author.id).catch(() => null);
  if (!member || !assistantAvailable(guild.id)) return;
  const isAdmin = member.permissions.has(PermissionFlagsBits.ManageGuild);

  const row = await prisma.aiAssistant.findUnique({ where: { guildId: guild.id } });
  if (!row?.enabled || !row.keyCipher || !row.model) {
    // Quiet for members; admins get pointed at the setting.
    if (isAdmin) await replyTo(message, `The assistant isn't switched on in this server yet. Set it up here: ${settingsUrl(guild.id)}`);
    return;
  }
  if (await globallyOff()) { await replyTo(message, 'The assistant is switched off for now.'); return; }

  const channels = list(row.channelIds);
  const channel = message.channel;
  const channelId = channel.isThread() ? channel.parentId ?? channel.id : channel.id;
  if (channels.length && !channels.includes(channelId) && !channels.includes(channel.id)) {
    await replyTo(message, `I answer questions in ${channels.slice(0, 5).map((c) => `<#${c}>`).join(', ')}.`);
    return;
  }
  const roles = list(row.roleIds);
  if (roles.length && !isAdmin && !roles.some((r) => member.roles.cache.has(r))) {
    await replyTo(message, "The assistant isn't enabled for you in this server.");
    return;
  }

  const question = questionText(message.content, client.user!.id).slice(0, 1000);
  if (!question) {
    await replyTo(message, 'Ask me something after the mention, like "when is the next op?" or "where can I mine Quantanium?"');
    return;
  }

  const now = new Date();
  const [today, month] = await Promise.all([
    prisma.aiUsage.findUnique({ where: { guildId_discordId_day: { guildId: guild.id, discordId: message.author.id, day: usageDay(now) } } }),
    prisma.aiUsage.aggregate({ where: { guildId: guild.id, day: { gte: usageMonthStart(now) } }, _sum: { inputTokens: true, outputTokens: true } }),
  ]);
  const hit = assistantLimitHit({
    questionsToday: today?.questions ?? 0,
    tokensThisMonth: (month._sum.inputTokens ?? 0) + (month._sum.outputTokens ?? 0),
    dailyQuestionLimit: row.dailyQuestionLimit, monthlyTokenLimit: row.monthlyTokenLimit, now,
  });
  if (hit) { await replyTo(message, limitMessage(hit)); return; }

  const apiKey = decryptAiKey(row.keyCipher, guild.id);
  if (!apiKey) {
    console.error(`[assistant] key for ${guild.id} can't be decrypted (AI_KEY_SECRET changed or missing?)`);
    await keyBroken(row, 'invalid', message);
    await replyTo(message, "The assistant isn't working right now: its key needs to be added again. The server's admins have been told.");
    return;
  }

  // First time for this person: the privacy notice above the answer.
  const firstTime = !(await prisma.aiNoticeSeen.findUnique({ where: { discordId: message.author.id } }));
  const provider: AssistantProvider = isAssistantProvider(row.provider) ? row.provider : 'openai';
  const notice = firstTime ? `${privacyNotice(ASSISTANT_PROVIDERS.find((p) => p.id === provider)!.label, `${web()}/dashboard/settings/notifications`)}\n` : '';
  const markSeen = () => firstTime && prisma.aiNoticeSeen.upsert({ where: { discordId: message.author.id }, create: { discordId: message.author.id }, update: {} }).catch(() => null);

  const context = await earlierExchanges(message);
  const key = cacheKey(guild.id, question);
  const again = context.length ? null : cached(key);
  if (again) {
    await count(guild.id, message.author.id, 0, 0);
    await markSeen();
    await replyTo(message, notice + again);
    return;
  }

  const type = () => { if ('sendTyping' in channel) void channel.sendTyping().catch(() => null); };
  type();
  const typing = setInterval(type, 8_000);
  let tokensIn = 0, tokensOut = 0;
  try {
    const dkpLabel = await getGuildDkpLabel(guild.id);
    const tools = pickTools(question, dkpLabel);
    const system = assistantSystemPrompt({ serverName: guild.name, answerChars: row.answerChars, today: usageDay(now), dkpLabel });
    const messages: AssistantMessage[] = [...context, { role: 'user', text: question }];
    const cfg = { provider, baseUrl: row.baseUrl, model: row.model, apiKey };
    const ctx = { guild, userId: message.author.id };
    let personal = false;
    let toolCalls = 0;
    let text = '';
    for (let round = 0; round < MAX_MODEL_ROUNDS; round++) {
      const reply = await callModel(cfg, { system, messages, tools, maxTokens: answerTokenCap(row.answerChars) }, fetch as unknown as FetchLike, AbortSignal.timeout(45_000));
      tokensIn += reply.usage.input;
      tokensOut += reply.usage.output;
      const flag = reply.toolCalls.find((c) => c.name === 'flag_question');
      if (flag) {
        await prisma.aiFlag.create({ data: {
          guildId: guild.id, discordId: message.author.id, username: member.displayName.slice(0, 100), channelId: message.channelId,
          question: question.slice(0, 1000), reason: String(flag.args['reason'] ?? 'flagged').slice(0, 200),
        } });
        text = "I can't help with that one.";
        break;
      }
      if (!reply.toolCalls.length) { text = reply.text; break; }
      messages.push({ role: 'assistant', text: reply.text, toolCalls: reply.toolCalls, raw: reply.raw });
      const results = [];
      for (const call of reply.toolCalls) {
        const spec = tools.find((t) => t.name === call.name);
        if (spec?.personal) personal = true;
        results.push({ id: call.id, name: call.name, content: ++toolCalls > MAX_TOOL_CALLS || !spec ? 'Not available.' : await runTool(ctx, call.name, call.args) });
      }
      messages.push({ role: 'tool', results });
    }
    if (!text) text = "I couldn't put an answer together for that. Try asking it more simply.";
    const answerText = trimAnswer(text, row.answerChars);
    await replyTo(message, notice + answerText);
    await markSeen();
    if (!personal && !context.length && toolCalls > 0) remember(key, answerText);
  } catch (err) {
    if (err instanceof ModelCallError) {
      if (err.kind === 'invalid' || err.kind === 'no_credit' || err.kind === 'model') {
        console.warn(`[assistant] ${guild.id}: key problem (${err.kind})`);
        await keyBroken(row, err.kind, message);
        await replyTo(message, "The assistant isn't working right now (its AI key or model needs attention). The server's admins have been told.");
      } else if (err.kind === 'busy') {
        await replyTo(message, 'The AI provider is busy right now. Try again in a minute.');
      } else {
        console.error(`[assistant] ${guild.id}: model call failed (${err.kind}):`, err.message);
        await replyTo(message, withRef("Sorry, I couldn't get an answer from the AI provider."));
      }
    } else throw err;
  } finally {
    clearInterval(typing);
    await count(guild.id, message.author.id, tokensIn, tokensOut);
  }
}

// ── Housekeeping ─────────────────────────────────────────────────────────────

let lastPrune = 0;

/** Flagged questions are kept 90 days; old usage counts 400 days. From the scheduler, at most hourly. */
export async function pruneAssistantData(now = new Date()): Promise<void> {
  if (now.getTime() - lastPrune < 3_600_000) return;
  lastPrune = now.getTime();
  await prisma.aiFlag.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 90 * 86_400_000) } } });
  await prisma.aiUsage.deleteMany({ where: { day: { lt: usageDay(new Date(now.getTime() - 400 * 86_400_000)) } } });
}

/** The bot left a server: its key goes (settings stay, switched off). */
export async function forgetAssistantKey(guildId: string): Promise<void> {
  await prisma.aiAssistant.updateMany({ where: { guildId }, data: { enabled: false, keyCipher: null, keyLast4: null, keySavedAt: null, keyStatus: null, keyCheckedAt: null } });
}
