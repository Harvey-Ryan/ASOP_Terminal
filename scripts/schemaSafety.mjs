#!/usr/bin/env node
// Schema safety check for pull requests (CONTRIBUTING.md, "Database changes").
//
// Production starts with `prisma db push --accept-data-loss` (CLAUDE.md,
// "Railway"), so whatever schema.prisma says on master is applied as soon as
// it deploys, including dropping tables and columns. This check diffs the PR's
// schema against its base with `prisma migrate diff` (no database needed) and
// fails when the change can lose data or fail on a table that has rows, until
// a maintainer adds the `schema-reviewed` label.
//
//   node scripts/schemaSafety.mjs check <base> <head>   # labels from PR_LABELS (JSON list)
//
// `findings` is exported for scripts/test/schemaSafety.test.mjs.

import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LABELS } from './sections.config.mjs';

export const SCHEMA_PATH = 'apps/api/prisma/schema.prisma';

/**
 * What in a `prisma migrate diff --script` result can lose data or fail on a
 * non-empty table: Prisma's own "Warnings" block, plus the statements that
 * drop or retype things (in case a warning is ever missing).
 * @returns {string[]} one line per finding, empty when the change is additive
 */
export function findings(sql) {
  const out = [];
  const text = String(sql).replace(/\r\n/g, '\n');
  for (const block of text.matchAll(/\/\*([\s\S]*?)\*\//g)) {
    if (!/Warnings:/.test(block[1])) continue;
    // Bullets may wrap onto the next line; join them back up.
    const bullets = block[1].split(/\n\s*-\s+/).slice(1);
    for (const b of bullets) out.push(b.replace(/\s+/g, ' ').trim());
  }
  const statements = [
    [/DROP TABLE\s+("?[\w.]+"?)/gi, (m) => `Drops table ${m[1]}.`],
    [/ALTER TABLE\s+("?[\w.]+"?)[^;]*?DROP COLUMN\s+("?\w+"?)/gi, (m) => `Drops column ${m[2]} from ${m[1]}.`],
    [/ALTER TABLE\s+("?[\w.]+"?)[^;]*?ALTER COLUMN\s+("?\w+"?)\s+SET DATA TYPE/gi, (m) => `Changes the type of ${m[1]}.${m[2]}.`],
    [/DROP TYPE\s+("?\w+"?)/gi, (m) => (/_old"?$/.test(m[1]) ? null : `Drops type ${m[1]}.`)],
  ];
  for (const [re, say] of statements) {
    for (const m of text.matchAll(re)) {
      const line = say(m);
      if (line && !out.includes(line)) out.push(line);
    }
  }
  return out;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const [cmd, base, head] = process.argv.slice(2);
  if (cmd !== 'check' || !base || !head) {
    console.error('usage: schemaSafety.mjs check <base> <head>');
    process.exit(2);
  }
  const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const summary = (md) => {
    console.log(md);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
  };

  const mergeBase = git('merge-base', base, head).trim();
  const changed = git('diff', '--name-only', `${mergeBase}..${head}`, '--', SCHEMA_PATH).trim();
  if (!changed) {
    summary('### ✅ Schema safety: `schema.prisma` is unchanged');
    process.exit(0);
  }

  const dir = mkdtempSync(join(tmpdir(), 'schema-safety-'));
  const before = join(dir, 'base.prisma');
  const after = join(dir, 'head.prisma');
  writeFileSync(before, git('show', `${mergeBase}:${SCHEMA_PATH}`));
  writeFileSync(after, git('show', `${head}:${SCHEMA_PATH}`));
  // The Prisma CLI version the base branch uses (the PR can't pick its own).
  const apiPkg = JSON.parse(readFileSync(new URL('../apps/api/package.json', import.meta.url), 'utf8'));
  const prismaVersion = apiPkg.devDependencies?.prisma ?? apiPkg.dependencies?.prisma ?? '5';

  let sql;
  try {
    sql = execFileSync(
      'npx',
      ['--yes', `prisma@${prismaVersion}`, 'migrate', 'diff', '--from-schema-datamodel', before, '--to-schema-datamodel', after, '--script'],
      // Run outside the checkout, with a placeholder URL: nothing connects to a database.
      { cwd: dir, encoding: 'utf8', env: { ...process.env, DATABASE_URL: 'postgresql://check:check@localhost:5432/check' }, maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (err) {
    summary(`### ❌ Schema safety: \`prisma migrate diff\` failed\n\n\`\`\`\n${err.stderr || err.message}\n\`\`\``);
    process.exit(1);
  }

  let labels = [];
  try { labels = JSON.parse(process.env.PR_LABELS || '[]'); } catch { /* none */ }
  const found = findings(sql);
  const reviewed = labels.includes(LABELS.schemaReviewed);
  const sqlBlock = `<details><summary>SQL this change would run</summary>\n\n\`\`\`sql\n${sql.trim()}\n\`\`\`\n</details>`;

  if (!found.length) {
    summary(`### ✅ Schema safety: additive change only\n\n${sqlBlock}`);
    process.exit(0);
  }
  const list = found.map((f) => `- ${f}`).join('\n');
  if (reviewed) {
    summary(`### ⚠️ Schema safety: risky change accepted with the \`${LABELS.schemaReviewed}\` label\n\n${list}\n\n${sqlBlock}`);
    process.exit(0);
  }
  summary(
    `### ❌ Schema safety: this change can lose data or fail the deploy\n\n${list}\n\n` +
      'Production applies `schema.prisma` with `prisma db push --accept-data-loss` when this merges, so ' +
      'these happen to live data straight away. See CONTRIBUTING.md, "Database changes". A maintainer ' +
      `adds the \`${LABELS.schemaReviewed}\` label once the change is planned (data moved first, defaults set).\n\n${sqlBlock}`,
  );
  for (const f of found) console.log(`::error::${f.replace(/`/g, '')}`);
  process.exit(1);
}
