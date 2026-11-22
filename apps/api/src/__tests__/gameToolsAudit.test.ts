// v1.63.0: the ship weapons check. Every game-data build compares our reading
// of each ship's guns with the files' mount list; the admin feed hears about
// it when the problems change, and platform admins see it on Admin → Overview.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import type { AdminWeaponAuditDto } from '@dem/shared';
import { createServer } from '../server/app.js';
import { reportWeaponAudit, weaponAuditSignature } from '../lib/gameToolsAudit.js';
import { createUser } from './factories.js';

const app = createServer();
const prisma = new PrismaClient();
const ADMIN_DISCORD_ID = '1135606224155586571'; // PLATFORM_ADMIN_DISCORD_IDS in vitest.config.ts

const audit = (problems: AdminWeaponAuditDto['problems'], commit = 'abc1234def'): AdminWeaponAuditDto => ({
  build: '4.x-TEST',
  commit,
  checkedAt: new Date().toISOString(),
  ships: 280,
  problems,
});
const nose = {
  className: 'ANVL_Test',
  name: 'Anvil Test',
  issues: [{ kind: 'missing-weapon', where: 'hardpoint_weapon_nose', detail: 'A gun is missing.' }],
};
const logs = () => prisma.adminLog.findMany({ where: { kind: 'gametools.weapons' }, orderBy: { id: 'asc' } });

beforeEach(async () => {
  await prisma.adminLog.deleteMany({ where: { kind: 'gametools.weapons' } });
});

describe('reporting the check to the admin feed', () => {
  it('says nothing when everything agrees and nothing was reported before', async () => {
    await reportWeaponAudit(audit([]));
    expect(await logs()).toHaveLength(0);
  });

  it('reports problems once, however often the data is rebuilt (restarts included)', async () => {
    await reportWeaponAudit(audit([nose]));
    await reportWeaponAudit(audit([nose], 'other-commit'));
    const rows = await logs();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.summary).toMatch(/1 of 280 ships need a look/);
    expect(rows[0]!.summary).toMatch(/Anvil Test \(missing-weapon\)/);
    expect(rows[0]!.posted).toBe(false); // the bot posts it
  });

  it('reports again when the problems change, and once when all agree again', async () => {
    await reportWeaponAudit(audit([nose]));
    await reportWeaponAudit(audit([nose, { ...nose, className: 'ANVL_Other', name: 'Anvil Other' }]));
    await reportWeaponAudit(audit([]));
    await reportWeaponAudit(audit([]));
    const rows = await logs();
    expect(rows.map((r) => r.summary.slice(0, 20))).toEqual([
      '1 of 280 ships need ',
      '2 of 280 ships need ',
      "All 280 ships' weapo",
    ]);
  });

  it('turrets only listed to confirm (severity check) never reach the feed (v1.64.1)', async () => {
    const seatless = {
      className: 'MISC_Reliant',
      name: 'MISC Reliant Kore',
      issues: [
        {
          kind: 'inferred-unsure',
          severity: 'check' as const,
          where: 'Hardpoint_Weapon_Wing_Tip_S3_Left',
          detail: 'x',
        },
      ],
    };
    await reportWeaponAudit(audit([seatless]));
    expect(await logs()).toHaveLength(0);
    // With a real problem alongside, the summary counts only the problem.
    await reportWeaponAudit(audit([seatless, nose]));
    const rows = await logs();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.summary).toMatch(/^1 of 280 ships need a look/);
    expect(rows[0]!.summary).not.toMatch(/Reliant/);
    expect(weaponAuditSignature({ problems: [seatless] })).toBe('clear');
  });

  it('the signature ignores order and wording, not the problems', () => {
    const a = { ...nose, issues: [...nose.issues, { kind: 'role-differs', where: 'x', detail: 'one' }] };
    const b = { ...nose, issues: [{ kind: 'role-differs', where: 'x', detail: 'two' }, ...nose.issues] };
    expect(weaponAuditSignature({ problems: [a] })).toBe(weaponAuditSignature({ problems: [b] }));
    expect(weaponAuditSignature({ problems: [] })).toBe('clear');
    expect(weaponAuditSignature({ problems: [nose] })).not.toBe(weaponAuditSignature({ problems: [a] }));
  });
});

describe('GET /api/admin/weapon-audit', () => {
  it('is for platform admins only', async () => {
    const user = await createUser({ discordId: '610000000000009901' });
    const agent = request.agent(app);
    await agent.post('/test/login').send({ userId: user.id });
    await agent.get('/api/admin/weapon-audit').expect(404);
  });

  it('answers null before the ship data is built', async () => {
    const user = await createUser({ discordId: ADMIN_DISCORD_ID });
    const agent = request.agent(app);
    await agent.post('/test/login').send({ userId: user.id });
    const res = await agent.get('/api/admin/weapon-audit').expect(200);
    expect(res.body).toEqual({ success: true, data: null });
  });
});
