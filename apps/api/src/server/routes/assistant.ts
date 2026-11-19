// AI assistant settings (v1.56.0), for a server's admins only (Manage Server):
//
//   GET    /api/guilds/:guildId/assistant              settings, key status (never the key), usage
//   PUT    /api/guilds/:guildId/assistant              change settings
//   PUT    /api/guilds/:guildId/assistant/key { key }  check the key with one tiny call, then store it encrypted
//   POST   /api/guilds/:guildId/assistant/key/test     check the stored key again
//   DELETE /api/guilds/:guildId/assistant/key          remove the key (the assistant stops)
//   GET    /api/guilds/:guildId/assistant/flags        questions the model flagged (90 days)
//   DELETE /api/guilds/:guildId/assistant/flags/:id    dismiss one
//
// The key is write-only: it goes in once and nothing ever sends it back.
// Servers outside the rollout (AI_SERVER_IDS) get 404 everywhere.

import { Router, type Request, type Response } from 'express';
import { cleanApiKey, keyLast4, mergeAssistantSettings, type ApiResponse, type AssistantFlagDto, type AssistantSettingsDto } from '@dem/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import { assertGuildManager } from '../../lib/assertGuildManager.js';
import { aiKeysConfigured, decryptAiKey, encryptAiKey } from '../../lib/aiKeys.js';
import { assistantAvailable, assistantDto, columnsOf, settingsOf, testAssistantKey } from '../../lib/assistant.js';
import { adminLog } from '../../lib/adminLog.js';

export const assistantRouter = Router();
assistantRouter.use('/:guildId/assistant', requireAuth);

const fail = (res: Response, status: number, error: string) => res.status(status).json({ success: false, error } satisfies ApiResponse);

/** Allowed (an admin of this server, server in the rollout), else answers and returns false. */
async function admin(req: Request, res: Response): Promise<boolean> {
  const { guildId } = req.params as { guildId: string };
  if (!assistantAvailable(guildId)) { fail(res, 404, "The assistant isn't available for this server yet."); return false; }
  if (!(await assertGuildManager(req, guildId))) { fail(res, 403, 'Only server admins (Manage Server) can change the assistant.'); return false; }
  return true;
}

// Key checks call the provider: a few per server per ten minutes is plenty.
const checks = new Map<string, number[]>();
function tooManyChecks(guildId: string): boolean {
  const now = Date.now();
  const recent = (checks.get(guildId) ?? []).filter((t) => now - t < 10 * 60_000);
  if (recent.length >= 10) return true;
  recent.push(now);
  checks.set(guildId, recent);
  return false;
}

const KEY_PROBLEM: Record<string, string> = {
  invalid: 'The provider refused this key. Check you copied all of it, and that it belongs to the provider you picked.',
  no_credit: 'The provider accepted the key but says the account is out of credit or over its spending limit.',
  model: "The provider doesn't know that model, or it can't use tools. Check the model id on the provider's model list.",
  unreachable: "Couldn't reach the provider. Check the address, then try again.",
  busy: 'The provider is busy right now. Try again in a minute.',
  other: 'The provider gave an unexpected answer.',
};

async function who(req: Request) {
  const u = req.session.userId ? await prisma.user.findUnique({ where: { id: req.session.userId }, select: { discordId: true, username: true } }) : null;
  return u ? { discordId: u.discordId, username: u.username } : null;
}

assistantRouter.get('/:guildId/assistant', async (req, res) => {
  if (!(await admin(req, res))) return;
  res.json({ success: true, data: await assistantDto(req.params['guildId']!) } satisfies ApiResponse<AssistantSettingsDto>);
});

assistantRouter.put('/:guildId/assistant', async (req, res) => {
  if (!(await admin(req, res))) return;
  const guildId = req.params['guildId']!;
  const row = await prisma.aiAssistant.findUnique({ where: { guildId } });
  const prev = settingsOf(row);
  const merged = mergeAssistantSettings(prev, req.body);
  if (!merged.ok) { fail(res, 400, merged.error); return; }
  const next = merged.value;
  if (next.enabled && !row?.keyCipher) { fail(res, 400, 'Save a key before switching the assistant on.'); return; }
  // A key belongs to one provider: changing provider or address drops it.
  const dropKey = !!row?.keyCipher && (next.provider !== prev.provider || next.baseUrl !== prev.baseUrl);
  if (dropKey) next.enabled = false;
  await prisma.aiAssistant.upsert({
    where: { guildId },
    create: { guildId, ...columnsOf(next) },
    update: { ...columnsOf(next), ...(dropKey ? { keyCipher: null, keyLast4: null, keySavedAt: null, keyStatus: null, keyCheckedAt: null } : {}) },
  });
  // A new model is checked with the saved key, so the page shows whether it works.
  if (!dropKey && row?.keyCipher && next.model !== prev.model && next.model) {
    const key = decryptAiKey(row.keyCipher, guildId);
    if (key) {
      const r = await testAssistantKey(next, key);
      if (r.status !== 'busy' && r.status !== 'other') {
        await prisma.aiAssistant.update({ where: { guildId }, data: { keyStatus: r.status, keyCheckedAt: new Date() } });
      }
    }
  }
  if (next.enabled !== prev.enabled) {
    const guild = await prisma.guild.findUnique({ where: { guildId }, select: { name: true } });
    await adminLog({ kind: 'ai.settings', guildId, guildName: guild?.name ?? null, actor: await who(req), summary: `Assistant switched ${next.enabled ? 'on' : 'off'} (${next.provider}, ${next.model || 'no model'})` });
  }
  res.json({ success: true, data: await assistantDto(guildId) } satisfies ApiResponse<AssistantSettingsDto>);
});

assistantRouter.put('/:guildId/assistant/key', async (req, res) => {
  if (!(await admin(req, res))) return;
  const guildId = req.params['guildId']!;
  if (!aiKeysConfigured()) { fail(res, 503, "Keys can't be stored yet: ASOP's key encryption isn't set up. The ASOP team has been told."); console.error('[assistant] AI_KEY_SECRET is missing or shorter than 32 characters'); return; }
  const key = cleanApiKey((req.body as { key?: unknown } | undefined)?.key);
  if (!key) { fail(res, 400, "That doesn't look like an API key."); return; }
  const settings = settingsOf(await prisma.aiAssistant.findUnique({ where: { guildId } }));
  if (!settings.model) { fail(res, 400, 'Choose the provider and model first, then add the key (it is checked with them).'); return; }
  if (tooManyChecks(guildId)) { fail(res, 429, 'Too many key checks. Try again in a few minutes.'); return; }
  const r = await testAssistantKey(settings, key);
  if (r.status !== 'ok') {
    fail(res, 400, `Key not saved. ${KEY_PROBLEM[r.status] ?? KEY_PROBLEM['other']}`);
    return;
  }
  const now = new Date();
  const data = { keyCipher: encryptAiKey(key, guildId), keyLast4: keyLast4(key), keySavedAt: now, keyStatus: 'ok', keyCheckedAt: now, keyAlertAt: null };
  await prisma.aiAssistant.upsert({ where: { guildId }, create: { guildId, ...columnsOf(settings), ...data }, update: data });
  const guild = await prisma.guild.findUnique({ where: { guildId }, select: { name: true } });
  await adminLog({ kind: 'ai.key', guildId, guildName: guild?.name ?? null, actor: await who(req), summary: `Assistant key saved (${settings.provider})` });
  res.json({ success: true, data: await assistantDto(guildId) } satisfies ApiResponse<AssistantSettingsDto>);
});

assistantRouter.post('/:guildId/assistant/key/test', async (req, res) => {
  if (!(await admin(req, res))) return;
  const guildId = req.params['guildId']!;
  const row = await prisma.aiAssistant.findUnique({ where: { guildId } });
  const key = row?.keyCipher ? decryptAiKey(row.keyCipher, guildId) : null;
  if (!row || !key) { fail(res, 400, row?.keyCipher ? "The saved key can't be read any more. Please add it again." : 'No key saved.'); return; }
  if (tooManyChecks(guildId)) { fail(res, 429, 'Too many key checks. Try again in a few minutes.'); return; }
  const r = await testAssistantKey(settingsOf(row), key);
  if (r.status === 'busy' || r.status === 'other') { fail(res, 502, KEY_PROBLEM[r.status]!); return; }
  await prisma.aiAssistant.update({ where: { guildId }, data: { keyStatus: r.status, keyCheckedAt: new Date(), ...(r.status === 'ok' ? { keyAlertAt: null } : {}) } });
  res.json({ success: true, data: await assistantDto(guildId) } satisfies ApiResponse<AssistantSettingsDto>);
});

assistantRouter.delete('/:guildId/assistant/key', async (req, res) => {
  if (!(await admin(req, res))) return;
  const guildId = req.params['guildId']!;
  await prisma.aiAssistant.updateMany({ where: { guildId }, data: { enabled: false, keyCipher: null, keyLast4: null, keySavedAt: null, keyStatus: null, keyCheckedAt: null } });
  const guild = await prisma.guild.findUnique({ where: { guildId }, select: { name: true } });
  await adminLog({ kind: 'ai.key', guildId, guildName: guild?.name ?? null, actor: await who(req), summary: 'Assistant key removed' });
  res.json({ success: true, data: await assistantDto(guildId) } satisfies ApiResponse<AssistantSettingsDto>);
});

assistantRouter.get('/:guildId/assistant/flags', async (req, res) => {
  if (!(await admin(req, res))) return;
  const rows = await prisma.aiFlag.findMany({
    where: { guildId: req.params['guildId']!, createdAt: { gte: new Date(Date.now() - 90 * 86_400_000) } },
    orderBy: { createdAt: 'desc' }, take: 200,
  });
  res.json({ success: true, data: rows.map((r) => ({
    id: r.id, discordId: r.discordId, username: r.username, question: r.question, reason: r.reason, channelId: r.channelId, createdAt: r.createdAt.toISOString(),
  })) } satisfies ApiResponse<AssistantFlagDto[]>);
});

assistantRouter.delete('/:guildId/assistant/flags/:id', async (req, res) => {
  if (!(await admin(req, res))) return;
  await prisma.aiFlag.deleteMany({ where: { id: req.params['id']!, guildId: req.params['guildId']! } });
  res.json({ success: true } satisfies ApiResponse);
});
