import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { checkScope, classify, globToRegExp, parseNumstat, renderCodeowners, renderSummary } from '../sections.mjs';

const where = (path) => {
  const r = classify(path);
  return r.kind === 'section' ? r.section : r.kind;
};

test('globs: * stays in one folder, ** crosses folders', () => {
  assert.ok(globToRegExp('*').test('package.json'));
  assert.ok(!globToRegExp('*').test('apps/web/package.json'));
  assert.ok(globToRegExp('**/package.json').test('package.json'));
  assert.ok(globToRegExp('**/package.json').test('apps/web/package.json'));
  assert.ok(globToRegExp('apps/sc-data/**').test('apps/sc-data/src/index.ts'));
  assert.ok(globToRegExp('apps/api/src/lib/assert*.ts').test('apps/api/src/lib/assertEventCreator.ts'));
  assert.ok(!globToRegExp('apps/api/src/lib/assert*.ts').test('apps/api/src/lib/x/assertEventCreator.ts'));
});

test('features land in their section across every app', () => {
  for (const f of [
    'apps/api/src/server/routes/loot.ts',
    'apps/web/src/pages/events/LootPage.tsx', // keyword beats the events folder
    'apps/bot/src/services/lootService.ts',
    'apps/bot/src/commands/bid.ts',
    'apps/web/src/hooks/useDkpLabel.ts',
  ])
    assert.equal(where(f), 'loot', f);
  for (const f of [
    'apps/web/src/pages/tools/ShipLoadout.tsx',
    'apps/sc-data/src/index.ts',
    'packages/shared/src/mining.ts',
    'packages/shared/test/combat.test.mjs',
    'apps/bot/src/commands/blueprint.ts',
  ])
    assert.equal(where(f), 'game-tools', f);
  assert.equal(where('packages/shared/src/ships.ts'), 'fleet');
  assert.equal(where('apps/api/src/server/routes/rsiRoster.ts'), 'members');
  assert.equal(where('apps/web/src/pages/settings/TournamentSettingsPage.tsx'), 'tournaments');
  assert.equal(where('apps/web/src/pages/settings/BotSettingsPage.tsx'), 'admin');
  assert.equal(where('docs/features/loot/draft-queue.md'), 'loot');
});

test('core and wiring', () => {
  for (const f of [
    'package.json',
    'package-lock.json',
    'CLAUDE.md',
    'apps/api/prisma/schema.prisma',
    'apps/api/package.json',
    '.github/workflows/ci.yml',
    'scripts/sections.config.mjs',
    'apps/api/src/lib/assertModuleEnabled.ts',
    'apps/web/src/components/ProtectedRoute.tsx',
  ])
    assert.equal(where(f), 'core', f);
  assert.deepEqual(classify('apps/web/src/App.tsx'), { kind: 'wiring', limit: 40 });
  assert.deepEqual(classify('apps/api/src/server/app.ts'), { kind: 'wiring', limit: 25 });
  assert.deepEqual(classify('apps/web/src/lib/somethingNew.ts'), { kind: 'core', unmapped: true });
});

test('numstat: lines added + removed; binary files are unlimited', () => {
  assert.deepEqual(parseNumstat('3\t1\tapps/web/src/App.tsx\n-\t-\tapps/web/public/logo.png\n'), [
    { path: 'apps/web/src/App.tsx', lines: 4 },
    { path: 'apps/web/public/logo.png', lines: Infinity },
  ]);
});

test('one section with a little wiring passes', () => {
  const r = checkScope([
    { path: 'apps/api/src/server/routes/loot.ts', lines: 120 },
    { path: 'apps/web/src/pages/LootModulePage.tsx', lines: 80 },
    { path: 'apps/web/src/App.tsx', lines: 6 },
    { path: 'apps/api/src/server/app.ts', lines: 2 },
  ]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.sections, ['loot']);
  assert.deepEqual(r.problems, []);
});

test('two sections, core files, big wiring and too many files each fail', () => {
  assert.equal(
    checkScope([
      { path: 'apps/api/src/server/routes/loot.ts', lines: 1 },
      { path: 'apps/api/src/server/routes/events.ts', lines: 1 },
    ]).ok,
    false,
  );
  const core = checkScope([{ path: 'package.json', lines: 2 }]);
  assert.equal(core.ok, false);
  assert.match(core.problems[0], /core file/);
  const wiring = checkScope([{ path: 'apps/api/src/server/app.ts', lines: 26 }]);
  assert.equal(wiring.ok, false);
  assert.match(wiring.problems[0], /up to 25 lines/);
  const many = Array.from({ length: 31 }, (_, i) => ({ path: `packages/shared/test/mining${i}.test.mjs`, lines: 1 }));
  assert.equal(checkScope(many).ok, false);
});

test('the override label lets a maintainer accept it, and says so', () => {
  const r = checkScope([{ path: 'package.json', lines: 2 }], ['scope-override']);
  assert.equal(r.ok, true);
  assert.equal(r.overridden, true);
  assert.match(renderSummary(r), /overridden/);
});

test('CODEOWNERS is generated, maintainers own core last, and the committed file is current', () => {
  const text = renderCodeowners();
  const lines = text.split('\n');
  assert.equal(
    lines.find((l) => l.startsWith('* ')),
    '* @Harvey-Ryan',
  );
  assert.ok(lines.includes('*loot* @Harvey-Ryan') && lines.includes('*Loot* @Harvey-Ryan'));
  assert.ok(lines.indexOf('/apps/api/prisma/** @Harvey-Ryan') > lines.indexOf('*loot* @Harvey-Ryan'));
  assert.equal(readFileSync(new URL('../../.github/CODEOWNERS', import.meta.url), 'utf8'), text);
});
