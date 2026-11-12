// v1.30.0: live updates. A write through Prisma (the API's or the bot's)
// reaches a browser stream watching its topic, and only that one.
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import type { AddressInfo } from 'node:net';
import { createServer } from '../server/app.js';
import { prisma } from '../lib/prisma.js';
import { createUser, createGuild, createEvent, createLootSession, createLootItem } from './factories.js';

const app = createServer();
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
afterAll(() => { server.closeAllConnections(); server.close(); });

async function cookieFor(managed: string[]) {
  const user = await createUser();
  const res = await request(app).post('/test/login').send({ userId: user.id, managedGuildIds: managed });
  return (res.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
}

/** Opens a stream and collects what it says until closed. */
async function stream(cookie: string, topics: string[]) {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/live?topics=${encodeURIComponent(topics.join(','))}`, { headers: { cookie }, signal: ctrl.signal });
  const events: { event: string; data: { topics: string[] } }[] = [];
  if (res.status === 200) {
    void (async () => {
      const reader = res.body!.getReader();
      let buf = '';
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += new TextDecoder().decode(value);
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const data = /^data: (.*)$/m.exec(block)?.[1];
            if (data) events.push({ event: /^event: (.*)$/m.exec(block)?.[1] ?? 'message', data: JSON.parse(data) });
          }
        }
      } catch { /* aborted */ }
    })();
  }
  return { status: res.status, events, close: () => ctrl.abort() };
}

const until = async (ok: () => boolean, ms = 5_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (ok()) return;
  throw new Error('timed out');
};

describe('live updates', () => {
  it('a loot write reaches the stream watching that session, not another', async () => {
    const guild = await createGuild();
    const event = await createEvent(guild.guildId, 'host');
    const session = await createLootSession(event.id, guild.guildId);
    const other = await createLootSession((await createEvent(guild.guildId, 'host')).id, guild.guildId);
    const cookie = await cookieFor([]);
    const mine = await stream(cookie, [`loot:${session.id}`]);
    const theirs = await stream(cookie, [`loot:${other.id}`]);
    expect(mine.status).toBe(200);
    await until(() => mine.events.some((e) => e.event === 'ready') && theirs.events.some((e) => e.event === 'ready'));

    // A pick: an assignment row only knows its item, so the item's session is looked up.
    const item = await createLootItem(session.id);
    await prisma.lootAssignment.create({ data: { itemId: item.id, userId: 'u1', username: 'Someone' } });
    await until(() => mine.events.some((e) => e.event === 'message'));
    expect(mine.events.filter((e) => e.event === 'message').flatMap((e) => e.data.topics)).toContain(`loot:${session.id}`);
    await new Promise((r) => setTimeout(r, 400));
    expect(theirs.events.filter((e) => e.event === 'message')).toEqual([]);
    mine.close(); theirs.close();
  });

  it('server-wide topics only for servers the person is in; bad requests refused', async () => {
    const guild = await createGuild();
    const elsewhere = await createGuild();
    const cookie = await cookieFor([guild.guildId]);
    const s = await stream(cookie, [`auctions:${guild.guildId}`, `auctions:${elsewhere.guildId}`, 'nonsense:1']);
    await until(() => s.events.some((e) => e.event === 'ready'));
    expect(s.events[0]!.data.topics).toEqual([`auctions:${guild.guildId}`]);

    await prisma.auction.create({ data: { guildId: guild.guildId, title: 'Rare ship', startedById: 'x', closesAt: new Date(Date.now() + 60_000) } });
    await until(() => s.events.some((e) => e.event === 'message'));
    s.close();

    expect((await stream(cookie, ['nonsense:1'])).status).toBe(400);
    expect((await fetch(`${base}/api/live?topics=loot:abc`)).status).toBe(401);
  });
});
