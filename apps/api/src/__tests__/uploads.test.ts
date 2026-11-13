// v1.40.0: uploaded images are shrunk to WebP, each server has a cap, and the
// admin panel reports what's on disk.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';
import type { Express } from 'express';
import { createUser, createGuild } from './factories.js';

const prisma = new PrismaClient();
const ADMIN = '1135606224155586571'; // PLATFORM_ADMIN_DISCORD_IDS default
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asop-uploads-'));
let app: Express;

beforeAll(async () => {
  process.env['UPLOADS_DIR'] = dir; // read when the modules load
  app = (await import('../server/app.js')).createServer();
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
afterEach(() => { delete process.env['UPLOADS_SERVER_CAP_MB']; });

async function officer() {
  const g = await createGuild();
  const user = await createUser();
  const agent = request.agent(app);
  await agent.post('/test/login').send({ userId: user.id, managedGuildIds: [g.guildId] });
  return { g, agent };
}

const bigPng = () => sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#335577' } })
  .composite([{ input: Buffer.from('<svg width="4000" height="3000"><circle cx="2000" cy="1500" r="1200" fill="#e2bd5b"/></svg>') }])
  .png().toBuffer();

describe('image uploads', () => {
  it('are shrunk to fit 2560 px and saved as WebP', async () => {
    const { g, agent } = await officer();
    const input = await bigPng();
    const res = await agent.post(`/api/guilds/${g.guildId}/images`).attach('image', input, { filename: 'Big Map.PNG', contentType: 'image/png' }).expect(201);
    expect(res.body.data.filename).toMatch(/\.webp$/);
    expect(res.body.data.url).toBe(`/uploads/${g.guildId}/${res.body.data.filename}`);
    const files = fs.readdirSync(path.join(dir, g.guildId));
    expect(files).toEqual([res.body.data.filename]); // the original is gone
    const meta = await sharp(path.join(dir, g.guildId, files[0]!)).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 2560, height: 1920 });
    expect(fs.statSync(path.join(dir, g.guildId, files[0]!)).size).toBeLessThan(input.length);
    await request(app).get(res.body.data.url).expect(200).expect('Content-Type', /webp/);
  });

  it('turns SVGs into pictures, so nothing served can run script', async () => {
    const { g, agent } = await officer();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><script>alert(1)</script><rect width="200" height="100" fill="red"/></svg>');
    const res = await agent.post(`/api/guilds/${g.guildId}/images`).attach('image', svg, { filename: 'x.svg', contentType: 'image/svg+xml' }).expect(201);
    expect(res.body.data.filename).toMatch(/\.webp$/);
    expect(fs.readdirSync(path.join(dir, g.guildId)).some((f) => f.endsWith('.svg'))).toBe(false);
  });

  it('turns away files that aren\'t really images, keeping nothing', async () => {
    const { g, agent } = await officer();
    const res = await agent.post(`/api/guilds/${g.guildId}/images`).attach('image', Buffer.from('not an image'), { filename: 'x.png', contentType: 'image/png' }).expect(400);
    expect(res.body.error).toMatch(/Could not read that image/);
    expect(fs.readdirSync(path.join(dir, g.guildId))).toEqual([]);
    expect(await prisma.serverImage.count({ where: { guildId: g.guildId } })).toBe(0);
  });

  it('stops at the server\'s limit, with a clear message, and says how much is used', async () => {
    const { g, agent } = await officer();
    const first = await agent.post(`/api/guilds/${g.guildId}/images`).attach('image', await bigPng(), { filename: 'a.png', contentType: 'image/png' }).expect(201);
    const used = (await agent.get(`/api/guilds/${g.guildId}/images/usage`).expect(200)).body.data;
    expect(used.files).toBe(1);
    expect(used.bytes).toBeGreaterThan(0);
    expect(used.capBytes).toBe(200 * 1024 * 1024);

    process.env['UPLOADS_SERVER_CAP_MB'] = String(used.bytes / 1024 / 1024 + 0.0001); // room for barely anything
    const res = await agent.post(`/api/guilds/${g.guildId}/images`).attach('image', await bigPng(), { filename: 'b.png', contentType: 'image/png' }).expect(413);
    expect(res.body.error).toMatch(/image library is full/);
    expect(fs.readdirSync(path.join(dir, g.guildId))).toEqual([first.body.data.filename]);
    expect(await prisma.serverImage.count({ where: { guildId: g.guildId } })).toBe(1);

    // deleting frees the space
    await agent.delete(`/api/guilds/${g.guildId}/images/${first.body.data.id}`).expect(200);
    expect((await agent.get(`/api/guilds/${g.guildId}/images/usage`).expect(200)).body.data.bytes).toBe(0);
  });

  it('usage is for the server\'s event creators only', async () => {
    const { g } = await officer();
    const stranger = request.agent(app);
    await stranger.post('/test/login').send({ userId: (await createUser()).id, managedGuildIds: [] });
    await stranger.get(`/api/guilds/${g.guildId}/images/usage`).expect(403);
  });

  it('the admin panel lists each server\'s storage, biggest first', async () => {
    const small = await officer();
    const big = await officer();
    await small.agent.post(`/api/guilds/${small.g.guildId}/images`).attach('image', await sharp({ create: { width: 50, height: 50, channels: 3, background: '#fff' } }).png().toBuffer(), { filename: 's.png', contentType: 'image/png' }).expect(201);
    await big.agent.post(`/api/guilds/${big.g.guildId}/images`).attach('image', await bigPng(), { filename: 'b.png', contentType: 'image/png' }).expect(201);

    const user = (await prisma.user.findUnique({ where: { discordId: ADMIN } })) ?? (await createUser({ discordId: ADMIN }));
    const admin = request.agent(app);
    await admin.post('/test/login').send({ userId: user.id, managedGuildIds: [] });
    const st = (await admin.get('/api/admin/storage').expect(200)).body.data;
    const ids = st.servers.map((s: { guildId: string }) => s.guildId);
    expect(ids.indexOf(big.g.guildId)).toBeLessThan(ids.indexOf(small.g.guildId));
    expect(st.servers.find((s: { guildId: string }) => s.guildId === big.g.guildId)).toMatchObject({ name: big.g.name, files: 1 });
    expect(st.totalBytes).toBeGreaterThan(0);
    expect(st.capBytes).toBe(200 * 1024 * 1024);
    await small.agent.get('/api/admin/storage').expect(404);
  });
});
