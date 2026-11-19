// v1.56.0: the AI assistant's settings. Admins only, the key is checked before
// it's stored, stored encrypted, and never sent back.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

process.env['AI_KEY_SECRET'] = 'test-secret-that-is-at-least-32-characters-long';
process.env['AI_SERVER_IDS'] = '*';

const { createServer } = await import('../server/app.js');
const { PrismaClient } = await import('@prisma/client');
const { createUser, createGuild } = await import('./factories.js');
const { decryptAiKey, encryptAiKey } = await import('../lib/aiKeys.js');

const app = createServer();
const prisma = new PrismaClient();
const KEY = 'sk-test-THIS-IS-THE-SECRET-1234';
const ADMIN_DISCORD_ID = '1135606224155586571';

let n = 0;
async function signedIn(managedGuildIds: string[], discordId?: string) {
  const user = await createUser({ discordId: discordId ?? `7000000000000000${String(++n).padStart(2, '0')}` });
  const agent = request.agent(app);
  await agent.post('/test/login').send({ userId: user.id, managedGuildIds });
  return agent;
}

/** The provider, faked: answers OK unless told otherwise; records what it was sent. */
let providerStatus = 200;
const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
beforeEach(() => {
  providerStatus = 200;
  calls.length = 0;
  vi.stubGlobal('fetch', async (url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push({ url, headers: init.headers, body: init.body });
    const body = providerStatus === 200
      ? JSON.stringify({ choices: [{ message: { content: 'OK' } }], usage: { prompt_tokens: 5, completion_tokens: 1 } })
      : JSON.stringify({ error: { message: 'Incorrect API key provided' } });
    return { ok: providerStatus === 200, status: providerStatus, text: async () => body };
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('assistant settings', () => {
  it('only the server\'s admins, and only servers in the rollout', async () => {
    const guild = await createGuild();
    await request(app).get(`/api/guilds/${guild.guildId}/assistant`).expect(401);
    const member = await signedIn([]);
    await member.get(`/api/guilds/${guild.guildId}/assistant`).expect(403);
    await member.put(`/api/guilds/${guild.guildId}/assistant/key`).send({ key: KEY }).expect(403);
    process.env['AI_SERVER_IDS'] = 'someone-else';
    const admin = await signedIn([guild.guildId]);
    await admin.get(`/api/guilds/${guild.guildId}/assistant`).expect(404);
    process.env['AI_SERVER_IDS'] = '*';
  });

  it('a key is checked, stored encrypted, and never sent back', async () => {
    const guild = await createGuild();
    const admin = await signedIn([guild.guildId]);
    const base = `/api/guilds/${guild.guildId}/assistant`;
    // Model first, and it can't be switched on without a key.
    await admin.put(`${base}/key`).send({ key: KEY }).expect(400);
    await admin.put(base).send({ provider: 'openai', model: 'small-model' }).expect(200);
    await admin.put(base).send({ enabled: true }).expect(400);

    const saved = await admin.put(`${base}/key`).send({ key: KEY }).expect(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(calls[0]!.headers['authorization']).toBe(`Bearer ${KEY}`);
    expect(saved.body.data.key).toMatchObject({ saved: true, last4: '1234', status: 'ok' });

    const row = await prisma.aiAssistant.findUniqueOrThrow({ where: { guildId: guild.guildId } });
    expect(row.keyCipher).not.toContain(KEY);
    expect(decryptAiKey(row.keyCipher!, guild.guildId)).toBe(KEY);
    expect(decryptAiKey(row.keyCipher!, 'another-server')).toBeNull(); // bound to its server

    // Nothing the website can fetch holds the key.
    for (const res of [saved, await admin.get(base).expect(200), await admin.put(base).send({ enabled: true, answerChars: 900 }).expect(200)]) {
      expect(JSON.stringify(res.body)).not.toContain(KEY);
      expect(JSON.stringify(res.body)).not.toContain(row.keyCipher!);
    }
    const log = await prisma.adminLog.findMany();
    expect(JSON.stringify(log)).not.toContain(KEY);
    expect(log.map((l) => l.kind).sort()).toEqual(['ai.key', 'ai.settings']);
  });

  it('a refused key is not stored', async () => {
    const guild = await createGuild();
    const admin = await signedIn([guild.guildId]);
    const base = `/api/guilds/${guild.guildId}/assistant`;
    await admin.put(base).send({ provider: 'openai', model: 'small-model' }).expect(200);
    providerStatus = 401;
    const res = await admin.put(`${base}/key`).send({ key: KEY }).expect(400);
    expect(res.body.error).toMatch(/refused this key/);
    expect(JSON.stringify(res.body)).not.toContain(KEY);
    expect((await prisma.aiAssistant.findUniqueOrThrow({ where: { guildId: guild.guildId } })).keyCipher).toBeNull();
  });

  it('changing provider drops the key and switches it off; removing the key does too', async () => {
    const guild = await createGuild();
    const admin = await signedIn([guild.guildId]);
    const base = `/api/guilds/${guild.guildId}/assistant`;
    await admin.put(base).send({ provider: 'openai', model: 'small-model' }).expect(200);
    await admin.put(`${base}/key`).send({ key: KEY }).expect(200);
    await admin.put(base).send({ enabled: true }).expect(200);
    const moved = await admin.put(base).send({ provider: 'anthropic', model: 'claude-small' }).expect(200);
    expect(moved.body.data).toMatchObject({ enabled: false, provider: 'anthropic', key: { saved: false } });

    await admin.put(`${base}/key`).send({ key: KEY }).expect(200);
    expect(calls.at(-1)!.headers['x-api-key']).toBe(KEY);
    const gone = await admin.delete(`${base}/key`).expect(200);
    expect(gone.body.data).toMatchObject({ enabled: false, key: { saved: false, last4: null } });
  });

  it('settings are checked: no local addresses, limits clamped', async () => {
    const guild = await createGuild();
    const admin = await signedIn([guild.guildId]);
    const base = `/api/guilds/${guild.guildId}/assistant`;
    await admin.put(base).send({ baseUrl: 'https://localhost:8080/v1' }).expect(400);
    await admin.put(base).send({ baseUrl: 'https://10.0.0.1/v1' }).expect(400);
    const res = await admin.put(base).send({ baseUrl: 'https://openrouter.ai/api/v1', dailyQuestionLimit: 0, answerChars: 5000 }).expect(200);
    expect(res.body.data).toMatchObject({ baseUrl: 'https://openrouter.ai/api/v1', dailyQuestionLimit: 1, answerChars: 2000 });
  });

  it('usage is counts per server; flags are that server\'s admins\' only', async () => {
    const guild = await createGuild();
    const other = await createGuild();
    const admin = await signedIn([guild.guildId]);
    const today = new Date().toISOString().slice(0, 10);
    await prisma.aiUsage.createMany({ data: [
      { guildId: guild.guildId, discordId: 'a', day: today, questions: 2, inputTokens: 1000, outputTokens: 200 },
      { guildId: guild.guildId, discordId: 'b', day: today, questions: 1, inputTokens: 500, outputTokens: 100 },
      { guildId: other.guildId, discordId: 'a', day: today, questions: 9, inputTokens: 9000, outputTokens: 900 },
    ] });
    await admin.put(`/api/guilds/${guild.guildId}/assistant`).send({ priceInPerM: 1, priceOutPerM: 4 }).expect(200);
    const res = await admin.get(`/api/guilds/${guild.guildId}/assistant`).expect(200);
    expect(res.body.data.usage).toMatchObject({ monthQuestions: 3, monthTokensIn: 1500, monthTokensOut: 300 });
    expect(res.body.data.usage.monthCostEstimate).toBeCloseTo(0.0027);
    expect(res.body.data.usage.days.at(-1)).toEqual({ day: today, questions: 3, tokens: 1800 });

    const flag = await prisma.aiFlag.create({ data: { guildId: guild.guildId, discordId: 'a', username: 'A', question: 'rude', reason: 'abusive' } });
    await prisma.aiFlag.create({ data: { guildId: other.guildId, discordId: 'a', username: 'A', question: 'elsewhere', reason: 'x' } });
    const flags = await admin.get(`/api/guilds/${guild.guildId}/assistant/flags`).expect(200);
    expect(flags.body.data.map((f: { question: string }) => f.question)).toEqual(['rude']);
    await admin.delete(`/api/guilds/${guild.guildId}/assistant/flags/${flag.id}`).expect(200);
    expect(await prisma.aiFlag.count({ where: { guildId: guild.guildId } })).toBe(0);
    // Platform admins don't see flags (not their server's admin).
    const platform = await signedIn([], ADMIN_DISCORD_ID);
    await platform.get(`/api/guilds/${other.guildId}/assistant/flags`).expect(403);
  });
});

describe('off for every server', () => {
  it('needs TURN OFF AI typed, keeps each server\'s setting', async () => {
    const guild = await createGuild();
    await prisma.aiAssistant.create({ data: { guildId: guild.guildId, enabled: true, model: 'm', keyCipher: encryptAiKey(KEY, guild.guildId), keyLast4: '1234' } });
    const platform = await signedIn([], ADMIN_DISCORD_ID);
    await platform.put('/api/admin/ai').send({ disabled: true }).expect(400);
    await platform.put('/api/admin/ai').send({ disabled: true, confirm: 'turn off ai' }).expect(400);
    const off = await platform.put('/api/admin/ai').send({ disabled: true, confirm: 'TURN OFF AI' }).expect(200);
    expect(off.body.data).toMatchObject({ disabled: true, serversOn: 1, keysSaved: 1 });
    expect(JSON.stringify(off.body)).not.toContain(KEY);
    expect((await prisma.aiAssistant.findUniqueOrThrow({ where: { guildId: guild.guildId } })).enabled).toBe(true);
    const admin = await signedIn([guild.guildId]);
    expect((await admin.get(`/api/guilds/${guild.guildId}/assistant`).expect(200)).body.data.globallyOff).toBe(true);
    await platform.put('/api/admin/ai').send({ disabled: false }).expect(200);
    const member = await signedIn([]);
    await member.put('/api/admin/ai').send({ disabled: false }).expect(404);
  });
});
