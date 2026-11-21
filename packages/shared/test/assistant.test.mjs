import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ASSISTANT_SETTINGS,
  mergeAssistantSettings,
  safeBaseUrl,
  cleanApiKey,
  keyLast4,
  assistantLimitHit,
  limitMessage,
  estimateCost,
  trimAnswer,
  defuseMentions,
  questionText,
  pickTools,
  rankGameKinds,
  ASSISTANT_TOOLS,
  parseLocalDateTime,
  localNowText,
  assistantSystemPrompt,
  buildModelRequest,
  parseModelResponse,
  modelErrorKind,
  callModel,
  ModelCallError,
  answerTokenCap,
} from '../dist/index.js';

test('provider addresses: https on the open internet only', () => {
  assert.equal(safeBaseUrl('https://openrouter.ai/api/v1/'), 'https://openrouter.ai/api/v1');
  assert.equal(safeBaseUrl('https://api.groq.com/openai/v1'), 'https://api.groq.com/openai/v1');
  for (const bad of [
    'http://openrouter.ai/api/v1',
    'https://localhost:3000',
    'https://127.0.0.1/v1',
    'https://[::1]/v1',
    'https://api.railway.internal/v1',
    'https://user:pw@example.com/v1',
    'https://example.com/v1?x=1',
    'ftp://example.com',
    'nonsense',
    42,
  ]) {
    assert.equal(safeBaseUrl(bad), null, String(bad));
  }
});

test('settings: checked, clamped, and a model is needed to switch on', () => {
  const r = mergeAssistantSettings(DEFAULT_ASSISTANT_SETTINGS, {
    provider: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'some/model',
    dailyQuestionLimit: 9999,
    answerChars: 50,
    channelIds: ['123456789012345678', '123456789012345678'],
    priceInPerM: 0.15,
  });
  assert.equal(r.ok, true);
  assert.equal(r.value.dailyQuestionLimit, 500);
  assert.equal(r.value.answerChars, 200);
  assert.deepEqual(r.value.channelIds, ['123456789012345678']);
  assert.equal(r.value.priceInPerM, 0.15);
  assert.equal(mergeAssistantSettings(DEFAULT_ASSISTANT_SETTINGS, { enabled: true }).ok, false);
  assert.equal(
    mergeAssistantSettings(DEFAULT_ASSISTANT_SETTINGS, { provider: 'anthropic', baseUrl: 'https://x.example.com' }).ok,
    false,
  );
  assert.equal(mergeAssistantSettings(DEFAULT_ASSISTANT_SETTINGS, { model: 'has space' }).ok, false);
  assert.equal(mergeAssistantSettings(DEFAULT_ASSISTANT_SETTINGS, { roleIds: ['not-a-role'] }).ok, false);
  // Changing provider clears an OpenAI-style address.
  const switched = mergeAssistantSettings(r.value, { provider: 'google' });
  assert.equal(switched.value.baseUrl, null);
});

test('keys: cleaned, and only the last four are ever shown', () => {
  assert.equal(cleanApiKey('  sk-abc123456789  '), 'sk-abc123456789');
  assert.equal(cleanApiKey('short'), null);
  assert.equal(cleanApiKey('sk-abc 123456789'), null);
  assert.equal(keyLast4('sk-abc123456789'), '6789');
});

test('limits: monthly first, then daily, with UTC resets', () => {
  const now = new Date('2026-11-19T22:00:00Z');
  assert.equal(
    assistantLimitHit({ questionsToday: 3, tokensThisMonth: 10, dailyQuestionLimit: 20, monthlyTokenLimit: 1000, now }),
    null,
  );
  const daily = assistantLimitHit({
    questionsToday: 20,
    tokensThisMonth: 10,
    dailyQuestionLimit: 20,
    monthlyTokenLimit: 1000,
    now,
  });
  assert.equal(daily.limit, 'daily');
  assert.equal(daily.resetsAt.toISOString(), '2026-11-20T00:00:00.000Z');
  const monthly = assistantLimitHit({
    questionsToday: 20,
    tokensThisMonth: 1000,
    dailyQuestionLimit: 20,
    monthlyTokenLimit: 1000,
    now,
  });
  assert.equal(monthly.limit, 'monthly');
  assert.equal(monthly.resetsAt.toISOString(), '2026-12-01T00:00:00.000Z');
  assert.match(limitMessage(daily), /<t:\d+:R>/);
  assert.equal(estimateCost(1_000_000, 500_000, 0.2, 0.8), 0.6);
  assert.equal(estimateCost(10, 10, null, null), null);
});

test('answers: trimmed at a sentence, no pings, mention removed', () => {
  const long = 'First sentence here. Second one is longer and goes on for a while. Third.';
  assert.equal(trimAnswer(long, 70), 'First sentence here. Second one is longer and goes on for a while.…');
  assert.equal(trimAnswer(long, 40), 'First sentence here. Second one is…');
  assert.equal(trimAnswer('short', 500), 'short');
  assert.ok(trimAnswer('x'.repeat(600), 500).length <= 500);
  assert.equal(defuseMentions('hi @everyone and @here'), 'hi @\u200beveryone and @\u200bhere');
  assert.equal(questionText('<@123> where is the  briefing?', '123'), 'where is the briefing?');
  assert.ok(answerTokenCap(500) > 140 && answerTokenCap(2000) < 700);
});

test('tools: by topic, lookups and own changes when unsure, flag always offered', () => {
  const names = (q, l, o) => pickTools(q, l, o).map((t) => t.name);
  assert.deepEqual(names('where can I mine quantanium?'), ['game', 'flag_question']);
  assert.ok(names('what is my dkp?').includes('my_dkp'));
  assert.ok(names('how many Credits do I have', 'Credits').includes('my_dkp'));
  assert.ok(names('who has a Carrack for the Hathor op?').includes('who_has_ship'));
  assert.ok(names('who has a Carrack for the Hathor op?').includes('events'));
  // Unsure: every lookup and the asker's own sign-ups, but no officer changes (they need an event word).
  assert.deepEqual(names('hello there'), [
    'events',
    'my_dkp',
    'who_has_ship',
    'game',
    'sign_up',
    'leave_event',
    'flag_question',
  ]);
  assert.ok(!names('hello there', 'DKP', { officer: true }).includes('create_event'));
  assert.ok(names('push hathor back an hour', 'DKP', { officer: true }).includes('edit_event'));
  assert.ok(names('sign me up for the hathor op as pilot').includes('sign_up'));
  assert.ok(names('count me in for hathor').includes('sign_up'));
  assert.ok(pickTools('cancel the mining op', 'DKP', { officer: true }).some((t) => t.name === 'cancel_event'));
  // In an event's thread the event tools always come, officer ones too for officers.
  assert.ok(names('who is coming?', 'DKP', { inEventThread: true }).includes('events'));
  assert.ok(names('hello', 'DKP', { officer: true, inEventThread: true }).includes('cancel_event'));
  assert.ok(names('where can I mine gold?', 'DKP', { inEventThread: true }).includes('game'));
  // The changes' event can be left out (the thread's event); share still needs the ally.
  for (const n of ['sign_up', 'leave_event', 'edit_event', 'cancel_event'])
    assert.ok(!ASSISTANT_TOOLS.find((t) => t.name === n).parameters.required?.includes('event'), n);
  assert.deepEqual(ASSISTANT_TOOLS.find((t) => t.name === 'share_event').parameters.required, ['ally']);
  // Every change is marked as one, so the bot never runs it without Confirm.
  for (const n of ['sign_up', 'leave_event', 'create_event', 'edit_event', 'cancel_event', 'share_event']) {
    const t = pickTools('event', 'DKP', { officer: true }).find((x) => x.name === n);
    assert.ok(t?.action && t.personal, n);
  }
  // The events lookup is personal only for "mine" (so other answers can be cached).
  const ev = ASSISTANT_TOOLS.find((t) => t.name === 'events');
  assert.equal(ev.personal, undefined);
  assert.equal(ev.personalArg, 'mine');
});

test('game lookup: exact names first, then ore, ship, blueprint; a kind asked for goes first', () => {
  assert.deepEqual(rankGameKinds({ ship: null, ore: 'exact', blueprint: 'partial' }), ['ore', 'blueprint']);
  assert.deepEqual(rankGameKinds({ ship: 'exact', ore: 'partial', blueprint: null }), ['ship', 'ore']);
  assert.deepEqual(rankGameKinds({ ship: 'partial', ore: 'partial', blueprint: 'partial' }), [
    'ore',
    'ship',
    'blueprint',
  ]);
  assert.deepEqual(rankGameKinds({ ship: 'partial', ore: 'exact', blueprint: null }, 'ship'), ['ship', 'ore']);
  // A kind that doesn't match is skipped, so the lookup widens instead of failing.
  assert.deepEqual(rankGameKinds({ ship: null, ore: 'exact', blueprint: null }, 'blueprint'), ['ore']);
  assert.deepEqual(rankGameKinds({ ship: null, ore: null, blueprint: null }), []);
});

test("prompt: an event's thread means that event", () => {
  const base = { serverName: 'S', answerChars: 500, today: '2026-11-21', dkpLabel: 'DKP' };
  assert.match(assistantSystemPrompt({ ...base, inEventThread: true }), /event's Discord thread/);
  const plain = assistantSystemPrompt(base);
  assert.doesNotMatch(plain, /thread/);
  assert.ok(!plain.includes('\n\n'));
});

const tools = [
  {
    name: 'events',
    description: 'd',
    parameters: { type: 'object', properties: { name: { type: 'string', description: 'n' } }, required: ['name'] },
  },
];
const conversation = [
  { role: 'user', text: 'briefing for hathor?' },
  { role: 'assistant', text: '', toolCalls: [{ id: 'c1', name: 'events', args: { name: 'hathor' } }] },
  { role: 'tool', results: [{ id: 'c1', name: 'events', content: 'Hathor op: briefing https://x' }] },
];

test('requests: each provider gets its own shape, key only in a header', () => {
  const o = buildModelRequest(
    { provider: 'openai', baseUrl: null, model: 'm', apiKey: 'sk-secret' },
    { system: 's', messages: conversation, tools, maxTokens: 100 },
  );
  assert.equal(o.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(o.headers.authorization, 'Bearer sk-secret');
  assert.equal(o.body.max_completion_tokens, 100);
  assert.equal(o.body.messages[0].role, 'system');
  assert.equal(o.body.messages[2].tool_calls[0].function.arguments, '{"name":"hathor"}');
  assert.equal(o.body.messages[3].tool_call_id, 'c1');
  const r = buildModelRequest(
    { provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'm', apiKey: 'k' },
    { system: 's', messages: conversation, tools, maxTokens: 100 },
  );
  assert.equal(r.body.max_tokens, 100);

  const a = buildModelRequest(
    { provider: 'anthropic', baseUrl: null, model: 'm', apiKey: 'k' },
    { system: 's', messages: conversation, tools, maxTokens: 100 },
  );
  assert.equal(a.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(a.headers['x-api-key'], 'k');
  assert.equal(a.body.tools[0].input_schema.type, 'object');
  assert.equal(a.body.messages[1].content[0].type, 'tool_use');
  assert.equal(a.body.messages[2].content[0].tool_use_id, 'c1');

  const g = buildModelRequest(
    { provider: 'google', baseUrl: null, model: 'gemini-x', apiKey: 'k' },
    { system: 's', messages: conversation, tools, maxTokens: 100 },
  );
  assert.equal(g.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent');
  assert.ok(!g.url.includes('k='));
  assert.equal(g.body.contents[1].role, 'model');
  assert.equal(g.body.contents[2].parts[0].functionResponse.name, 'events');
  for (const req of [o, a, g]) assert.ok(!JSON.stringify(req.body).includes('sk-secret'));
});

test('replies: text, tool calls and tokens from each provider', () => {
  const o = parseModelResponse('openai', {
    choices: [{ message: { content: null, tool_calls: [{ id: 'x', function: { name: 'my_dkp', arguments: '{}' } }] } }],
    usage: { prompt_tokens: 50, completion_tokens: 7 },
  });
  assert.deepEqual(o.toolCalls, [{ id: 'x', name: 'my_dkp', args: {} }]);
  assert.deepEqual(o.usage, { input: 50, output: 7 });
  const a = parseModelResponse('anthropic', {
    content: [
      { type: 'text', text: 'Hi' },
      { type: 'tool_use', id: 't', name: 'my_dkp', input: {} },
    ],
    usage: { input_tokens: 9, output_tokens: 3 },
  });
  assert.equal(a.text, 'Hi');
  assert.equal(a.toolCalls[0].id, 't');
  const g = parseModelResponse('google', {
    candidates: [{ content: { parts: [{ text: 'thinking', thought: true }, { text: 'Answer' }] } }],
    usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2, thoughtsTokenCount: 5 },
  });
  assert.equal(g.text, 'Answer');
  assert.deepEqual(g.usage, { input: 4, output: 7 });
  assert.throws(() => parseModelResponse('openai', {}));
});

test('errors: what a failure means for the key, and the key never in the message', async () => {
  assert.equal(modelErrorKind(401, ''), 'invalid');
  assert.equal(modelErrorKind(400, '{"error":{"message":"API key not valid"}}'), 'invalid');
  assert.equal(modelErrorKind(429, 'You exceeded your current quota'), 'no_credit');
  assert.equal(modelErrorKind(429, 'rate limit'), 'busy');
  assert.equal(modelErrorKind(404, ''), 'model');
  assert.equal(modelErrorKind(500, ''), 'other');
  const fetchFn = async () => ({ ok: false, status: 401, text: async () => 'bad key sk-secret-123' });
  await assert.rejects(
    callModel(
      { provider: 'openai', baseUrl: null, model: 'm', apiKey: 'sk-secret-123' },
      { system: 's', messages: [], tools: [], maxTokens: 5 },
      fetchFn,
    ),
    (err) => err instanceof ModelCallError && err.kind === 'invalid' && !err.message.includes('sk-secret-123'),
  );
  const down = async () => {
    throw new Error('ECONNREFUSED');
  };
  await assert.rejects(
    callModel(
      { provider: 'anthropic', baseUrl: null, model: 'm', apiKey: 'k' },
      { system: 's', messages: [], tools: [], maxTokens: 5 },
      down,
    ),
    (err) => err.kind === 'unreachable',
  );
});

test("local times for changes: read in the asker's zone, impossible dates refused", () => {
  assert.equal(parseLocalDateTime('2026-11-21T20:00', 'America/Chicago').toISOString(), '2026-11-22T02:00:00.000Z');
  assert.equal(parseLocalDateTime('2026-07-04 9:30', 'America/Chicago').toISOString(), '2026-07-04T14:30:00.000Z');
  assert.equal(parseLocalDateTime('2026-11-21T20:00', 'UTC').toISOString(), '2026-11-21T20:00:00.000Z');
  for (const bad of ['2026-02-30T20:00', '2026-13-01T10:00', 'next saturday', '2026-11-21', 42])
    assert.equal(parseLocalDateTime(bad, 'UTC'), null, String(bad));
  assert.equal(localNowText(new Date('2026-11-19T22:45:00Z'), 'America/Chicago'), '2026-11-19 16:45 (Thursday)');
  const p = assistantSystemPrompt({
    serverName: 'S',
    answerChars: 500,
    today: '2026-11-19',
    dkpLabel: 'DKP',
    timeZone: 'America/Chicago',
    localNow: '2026-11-19 16:45 (Thursday)',
  });
  assert.match(p, /America\/Chicago; it is now 2026-11-19 16:45/);
  assert.match(p, /Never say a change is done/);
});
