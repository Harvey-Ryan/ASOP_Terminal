// The AI assistant's server side (v1.56.0): who has it, whether it's off for
// everyone, a server's settings as the page sees them, and checking a key.
// Rules: packages/shared/src/assistant.ts. The bot answers the questions.

import type { AiAssistant } from '@prisma/client';
import {
  callModel,
  DEFAULT_ASSISTANT_SETTINGS,
  estimateCost,
  isAssistantProvider,
  KEY_TEST_REQUEST,
  ModelCallError,
  usageDay,
  usageMonthStart,
  type AssistantKeyStatus,
  type AssistantSettings,
  type AssistantSettingsDto,
  type AssistantUsageDto,
  type FetchLike,
} from '@dem/shared';
import { prisma } from './prisma.js';

// Rollout (v1.56.0): Fleet 919 first. AI_SERVER_IDS: comma-separated Discord
// server ids, or "*" for every server.
const DEFAULT_IDS = '1497395378495160493';

export function assistantAvailable(guildId: string): boolean {
  const raw = (process.env['AI_SERVER_IDS'] ?? DEFAULT_IDS).trim();
  if (raw === '*') return true;
  return raw
    .split(',')
    .map((s) => s.trim())
    .includes(guildId);
}

/** The platform admins' "off for every server" switch (AdminConfig.aiDisabled). */
export async function assistantGloballyOff(): Promise<boolean> {
  const row = await prisma.adminConfig.findUnique({ where: { id: 1 }, select: { aiDisabled: true } });
  return row?.aiDisabled ?? false;
}

const list = (json: string): string[] => {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

/** The channels the assistant answers in (empty = every channel). */
export const assistantChannels = (json: string): string[] => list(json);

export function settingsOf(row: AiAssistant | null): AssistantSettings {
  if (!row) return { ...DEFAULT_ASSISTANT_SETTINGS };
  return {
    enabled: row.enabled,
    provider: isAssistantProvider(row.provider) ? row.provider : 'openai',
    baseUrl: row.baseUrl,
    model: row.model,
    channelIds: list(row.channelIds),
    roleIds: list(row.roleIds),
    dailyQuestionLimit: row.dailyQuestionLimit,
    monthlyTokenLimit: row.monthlyTokenLimit,
    answerChars: row.answerChars,
    priceInPerM: row.priceInPerM,
    priceOutPerM: row.priceOutPerM,
  };
}

/** Settings → the columns that hold them. */
export function columnsOf(s: AssistantSettings) {
  return {
    enabled: s.enabled,
    provider: s.provider,
    baseUrl: s.baseUrl,
    model: s.model,
    channelIds: JSON.stringify(s.channelIds),
    roleIds: JSON.stringify(s.roleIds),
    dailyQuestionLimit: s.dailyQuestionLimit,
    monthlyTokenLimit: s.monthlyTokenLimit,
    answerChars: s.answerChars,
    priceInPerM: s.priceInPerM,
    priceOutPerM: s.priceOutPerM,
  };
}

export async function usageOf(
  guildId: string,
  settings: AssistantSettings,
  now = new Date(),
): Promise<AssistantUsageDto> {
  const from = usageDay(new Date(now.getTime() - 29 * 86_400_000));
  const rows = await prisma.aiUsage.groupBy({
    by: ['day'],
    where: { guildId, day: { gte: from < usageMonthStart(now) ? from : usageMonthStart(now) } },
    _sum: { questions: true, inputTokens: true, outputTokens: true },
  });
  const month = rows.filter((r) => r.day >= usageMonthStart(now));
  const sum = (k: 'questions' | 'inputTokens' | 'outputTokens') => month.reduce((n, r) => n + (r._sum[k] ?? 0), 0);
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const days: AssistantUsageDto['days'] = [];
  for (let i = 29; i >= 0; i--) {
    const day = usageDay(new Date(now.getTime() - i * 86_400_000));
    const r = byDay.get(day);
    days.push({
      day,
      questions: r?._sum.questions ?? 0,
      tokens: (r?._sum.inputTokens ?? 0) + (r?._sum.outputTokens ?? 0),
    });
  }
  return {
    monthQuestions: sum('questions'),
    monthTokensIn: sum('inputTokens'),
    monthTokensOut: sum('outputTokens'),
    monthCostEstimate: estimateCost(
      sum('inputTokens'),
      sum('outputTokens'),
      settings.priceInPerM,
      settings.priceOutPerM,
    ),
    days,
  };
}

/** The page's view of a server's assistant: settings, what can be said about the key, usage. Never the key. */
export async function assistantDto(guildId: string): Promise<AssistantSettingsDto> {
  const row = await prisma.aiAssistant.findUnique({ where: { guildId } });
  const settings = settingsOf(row);
  return {
    ...settings,
    available: assistantAvailable(guildId),
    globallyOff: await assistantGloballyOff(),
    key: {
      saved: !!row?.keyCipher,
      last4: row?.keyCipher ? row.keyLast4 : null,
      savedAt: row?.keyCipher && row.keySavedAt ? row.keySavedAt.toISOString() : null,
      status: (row?.keyCipher ? row.keyStatus : null) as AssistantKeyStatus | null,
      checkedAt: row?.keyCipher && row.keyCheckedAt ? row.keyCheckedAt.toISOString() : null,
    },
    usage: await usageOf(guildId, settings),
  };
}

/**
 * One tiny call with the key and model: 'ok', or what's wrong ('busy' and
 * 'other' are reported as they are; the caller decides). The provider's reply
 * never includes the key (callModel masks it).
 */
export async function testAssistantKey(
  settings: AssistantSettings,
  apiKey: string,
  fetchFn: FetchLike = fetch as unknown as FetchLike,
): Promise<{ status: AssistantKeyStatus | 'busy' | 'other'; detail?: string }> {
  try {
    const signal = AbortSignal.timeout(20_000);
    await callModel(
      { provider: settings.provider, baseUrl: settings.baseUrl, model: settings.model, apiKey },
      KEY_TEST_REQUEST,
      fetchFn,
      signal,
    );
    return { status: 'ok' };
  } catch (err) {
    if (err instanceof ModelCallError) return { status: err.kind, detail: err.message };
    return { status: 'other', detail: err instanceof Error ? err.message : String(err) };
  }
}
