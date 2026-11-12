// v1.28.0: platform admins hide modules for every server.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

const { createServer } = await import('../server/app.js');
const { forgetHiddenModules } = await import('../lib/hiddenModules.js');
const { PrismaClient } = await import('@prisma/client');
const { createUser, createGuild, createGuildSettings } = await import('./factories.js');

const app = createServer();
const prisma = new PrismaClient();
const ADMIN_DISCORD_ID = '1135606224155586571'; // PLATFORM_ADMIN_DISCORD_IDS default

let n = 0;
async function signedIn(discordId?: string, managedGuildIds: string[] = []) {
  const user = await createUser({ discordId: discordId ?? `7000000000000000${String(++n).padStart(2, '0')}` });
  const agent = request.agent(app);
  await agent.post('/test/login').send({ userId: user.id, managedGuildIds });
  return { user, agent };
}
// The table is wiped between tests; so is the cached list.
beforeEach(() => forgetHiddenModules());

describe('hiding modules for every server', () => {
  it('only platform admins can see or change the list', async () => {
    const { agent } = await signedIn();
    await agent.get('/api/admin/modules').expect(404);
    await agent.put('/api/admin/modules').send({ hidden: ['fleetEnabled'] }).expect(404);
  });

  it('lists every module, shown, with how many servers have it on', async () => {
    const a = await createGuild();
    await createGuild();
    await createGuildSettings(a.id, { fleetEnabled: false });
    const { agent } = await signedIn(ADMIN_DISCORD_ID);
    const list = (await agent.get('/api/admin/modules').expect(200)).body.data as { setting: string; hidden: boolean; serversOn: number }[];
    expect(list.map((m) => m.setting)).toContain('tournamentsEnabled');
    expect(list.every((m) => !m.hidden)).toBe(true);
    expect(list.find((m) => m.setting === 'fleetEnabled')!.serversOn).toBe(1);
    expect(list.find((m) => m.setting === 'lootEnabled')!.serversOn).toBe(2);
  });

  it('a hidden module is off on every server, whatever the server chose, and comes back when shown', async () => {
    const guild = await createGuild();
    await createGuildSettings(guild.id, { fleetEnabled: true, jobsEnabled: true });
    const admin = await signedIn(ADMIN_DISCORD_ID);
    const officer = await signedIn(undefined, [guild.guildId]);

    const res = await admin.agent.put('/api/admin/modules').send({ hidden: ['jobsEnabled', 'fleetEnabled'] }).expect(200);
    expect(res.body.data.filter((m: { hidden: boolean }) => m.hidden).map((m: { setting: string }) => m.setting)).toEqual(['fleetEnabled', 'jobsEnabled']);

    const perms = (await officer.agent.get(`/api/guilds/${guild.guildId}/my-permissions`).expect(200)).body.data;
    expect(perms.fleetEnabled).toBe(false);
    expect(perms.jobsEnabled).toBe(false);
    expect(perms.lootEnabled).toBe(true);
    expect(perms.hiddenModules).toEqual(['fleetEnabled', 'jobsEnabled']);
    await officer.agent.get(`/api/guilds/${guild.guildId}/fleet`).expect(403);

    // The server's own choice is untouched, so showing it again brings it back.
    expect((await prisma.guildSettings.findUnique({ where: { guildId: guild.id } }))!.fleetEnabled).toBe(true);
    await admin.agent.put('/api/admin/modules').send({ hidden: ['jobsEnabled'] }).expect(200);
    const after = (await officer.agent.get(`/api/guilds/${guild.guildId}/my-permissions`).expect(200)).body.data;
    expect(after.fleetEnabled).toBe(true);
    expect(after.hiddenModules).toEqual(['jobsEnabled']);
    await officer.agent.get(`/api/guilds/${guild.guildId}/fleet`).expect(200);

    const log = await prisma.adminLog.findMany({ where: { kind: 'admin.modules' }, orderBy: { id: 'asc' } });
    expect(log.map((l) => l.summary)).toEqual(['Hid Fleet, Job Board for every server', 'Showed Fleet for every server']);
  });

  it('a hidden module drops out of the setup checklist', async () => {
    const guild = await createGuild();
    await createGuildSettings(guild.id, { tournamentsEnabled: true, tournamentChannelId: null });
    const admin = await signedIn(ADMIN_DISCORD_ID);
    const officer = await signedIn(undefined, [guild.guildId]);
    const keys = async () => ((await officer.agent.get(`/api/guilds/${guild.guildId}/setup`).expect(200)).body.data.steps as { key: string }[]).map((s) => s.key);
    expect(await keys()).toContain('tournaments');
    await admin.agent.put('/api/admin/modules').send({ hidden: ['tournamentsEnabled'] }).expect(200);
    expect(await keys()).not.toContain('tournaments');
  });

  it('turns away anything that isn\'t a module', async () => {
    const { agent } = await signedIn(ADMIN_DISCORD_ID);
    await agent.put('/api/admin/modules').send({ hidden: ['nope'] }).expect(400);
    await agent.put('/api/admin/modules').send({}).expect(400);
  });
});
