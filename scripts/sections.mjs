#!/usr/bin/env node
// Sections: which part of ASOP each file belongs to (scripts/sections.config.mjs),
// the pull-request scope check built on it, and the CODEOWNERS file made from it.
// CONTRIBUTING.md explains the rules to contributors.
//
//   node scripts/sections.mjs report                 # every tracked file → its section
//   node scripts/sections.mjs which <file>…           # where the given files go
//   node scripts/sections.mjs check <base> <head>     # scope check for the diff base...head
//                                                     #   (labels from PR_LABELS, a JSON list)
//   node scripts/sections.mjs codeowners [--check]    # write (or verify) .github/CODEOWNERS
//
// The pure functions are exported for scripts/test/sections.test.mjs.

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as defaultConfig from './sections.config.mjs';

// ── Globs ─────────────────────────────────────────────────────────────────────

const globCache = new Map();
/** `*` = anything but `/`, `**` = any number of folders (also none). */
export function globToRegExp(glob) {
  if (globCache.has(glob)) return globCache.get(glob);
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; }
      else { re += '.*'; i += 1; }
    } else if (c === '*') re += '[^/]*';
    else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  const out = new RegExp(`^${re}$`);
  globCache.set(glob, out);
  return out;
}
export const matchGlob = (glob, path) => globToRegExp(glob).test(path);

// ── Where a file goes ─────────────────────────────────────────────────────────

const baseName = (path) => path.slice(path.lastIndexOf('/') + 1);

/**
 * @returns {{ kind: 'wiring', limit: number } | { kind: 'core' } | { kind: 'section', section: string }}
 *   `unmapped: true` on a core result means no rule claimed the file.
 */
export function classify(path, config = defaultConfig) {
  const wiring = config.WIRING.find((w) => w.path === path);
  if (wiring) return { kind: 'wiring', limit: wiring.lines ?? config.LIMITS.wiringLines };
  if (config.CORE.some((g) => matchGlob(g, path))) return { kind: 'core' };
  for (const s of config.SECTIONS) {
    if ((s.files ?? []).includes(path) || matchGlob(`docs/features/${s.id}/**`, path)) {
      return { kind: 'section', section: s.id };
    }
  }
  const name = baseName(path).toLowerCase();
  for (const s of config.SECTIONS) {
    if ((s.keywords ?? []).some((k) => name.includes(k))) return { kind: 'section', section: s.id };
  }
  for (const s of config.SECTIONS) {
    if ((s.dirs ?? []).some((g) => matchGlob(g, path))) return { kind: 'section', section: s.id };
  }
  return { kind: 'core', unmapped: true };
}

// ── The scope check ───────────────────────────────────────────────────────────

/** `git diff --numstat` output → [{ path, lines }] (binary files count as Infinity lines). */
export function parseNumstat(text) {
  return String(text).split('\n').filter((l) => l.trim()).map((line) => {
    const [added, removed, ...rest] = line.split('\t');
    const path = rest.join('\t');
    const lines = added === '-' || removed === '-' ? Infinity : Number(added) + Number(removed);
    return { path, lines };
  });
}

/**
 * Checks one pull request's changes.
 * @param {{ path: string, lines: number }[]} changes
 * @param {string[]} labels
 * @returns {{ ok: boolean, overridden: boolean, problems: string[], sections: string[], rows: object[] }}
 */
export function checkScope(changes, labels = [], config = defaultConfig) {
  const overridden = labels.includes(config.LABELS.override);
  const rows = changes.map((c) => ({ ...c, ...classify(c.path, config) }));
  const sections = [...new Set(rows.filter((r) => r.kind === 'section').map((r) => r.section))];
  const core = rows.filter((r) => r.kind === 'core');
  const bigWiring = rows.filter((r) => r.kind === 'wiring' && r.lines > r.limit);
  const name = (id) => config.SECTIONS.find((s) => s.id === id)?.name ?? id;

  const problems = [];
  if (sections.length > 1) {
    problems.push(
      `This pull request changes ${sections.length} sections (${sections.map(name).join('; ')}). ` +
        'Please split it into one pull request per section.',
    );
  }
  if (core.length) {
    problems.push(
      `It changes ${core.length} core file${core.length === 1 ? '' : 's'} that only the maintainer changes: ` +
        core.map((r) => `\`${r.path}\`${r.unmapped ? ' (not in any section yet)' : ''}`).join(', ') + '.',
    );
  }
  for (const r of bigWiring) {
    problems.push(
      `\`${r.path}\` is a shared wiring file: a feature may change up to ${r.limit} lines in it, ` +
        `this changes ${r.lines === Infinity ? 'a binary file' : r.lines}.`,
    );
  }
  if (changes.length > config.LIMITS.maxFiles) {
    problems.push(`It changes ${changes.length} files (the limit is ${config.LIMITS.maxFiles}). Please break it up.`);
  }
  return { ok: problems.length === 0 || overridden, overridden, problems, sections, rows };
}

/** Markdown for the check's summary page. */
export function renderSummary(result, config = defaultConfig) {
  const name = (id) => config.SECTIONS.find((s) => s.id === id)?.name ?? id;
  const where = (r) =>
    r.kind === 'section' ? name(r.section)
      : r.kind === 'wiring' ? `wiring (≤ ${r.limit} lines)`
        : r.unmapped ? 'core (unmapped)' : 'core';
  const lines = [];
  if (result.problems.length === 0) lines.push('### ✅ Scope check passed');
  else if (result.overridden) lines.push(`### ⚠️ Scope check overridden by the \`${config.LABELS.override}\` label`);
  else lines.push('### ❌ Scope check failed');
  if (result.problems.length) lines.push('', ...result.problems.map((p) => `- ${p}`));
  if (!result.ok) {
    lines.push(
      '',
      'See CONTRIBUTING.md, "One section per pull request". If the change really has to span ' +
        `more, a maintainer can add the \`${config.LABELS.override}\` label.`,
    );
  }
  lines.push('', '| File | Lines | Section |', '| --- | ---: | --- |');
  for (const r of result.rows) lines.push(`| \`${r.path}\` | ${r.lines === Infinity ? 'binary' : r.lines} | ${where(r)} |`);
  return lines.join('\n');
}

// ── CODEOWNERS ────────────────────────────────────────────────────────────────

/** A keyword as CODEOWNERS patterns: CODEOWNERS is case-sensitive and has no [Aa], so lower + Capitalised. */
const keywordPatterns = (k) => [...new Set([`*${k}*`, `*${k[0].toUpperCase()}${k.slice(1)}*`])];
const anchored = (glob) => `/${glob}`;

/**
 * CODEOWNERS uses the LAST matching line, so rules are written lowest priority
 * first: folders, keywords, exact files (each in reverse section order), then
 * core and wiring. Mixed-case file names (e.g. HeatMap) can fall back to an
 * earlier line; the scope check (classify) is the authority on sections.
 */
export function renderCodeowners(config = defaultConfig) {
  const maint = config.MAINTAINERS.join(' ');
  const ownersOf = (s) => [...new Set([...config.MAINTAINERS, ...(s.owners ?? [])])].join(' ');
  const rev = [...config.SECTIONS].reverse();
  const out = [
    '# GENERATED by `node scripts/sections.mjs codeowners` from scripts/sections.config.mjs.',
    '# Do not edit by hand: change the config and regenerate (CI checks they match).',
    '# Later lines win. Every file needs a review from one of its owners.',
    '',
    `* ${maint}`,
  ];
  const block = (title, lines) => { if (lines.length) out.push('', `# ${title}`, ...lines); };
  for (const s of rev) block(`${s.id}: folders`, (s.dirs ?? []).map((g) => `${anchored(g)} ${ownersOf(s)}`));
  for (const s of rev) {
    block(`${s.id}: file names`, (s.keywords ?? []).flatMap((k) => keywordPatterns(k).map((p) => `${p} ${ownersOf(s)}`)));
  }
  for (const s of rev) {
    block(`${s.id}: files and docs`, [...(s.files ?? []), `docs/features/${s.id}/**`].map((f) => `${anchored(f)} ${ownersOf(s)}`));
  }
  // In CODEOWNERS a trailing `*` also matches folders (and so everything in
  // them); `*.*` keeps "files in this folder" to files.
  const coreLine = (g) => anchored(g === '*' || g.endsWith('/*') ? `${g}.*` : g);
  block('core (maintainers only)', config.CORE.map((g) => `${coreLine(g)} ${maint}`));
  block('shared wiring (maintainers review)', config.WIRING.map((w) => `${anchored(w.path)} ${maint}`));
  return `${out.join('\n')}\n`;
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const [cmd, ...args] = process.argv.slice(2);
  const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const label = (path) => {
    const r = classify(path);
    return r.kind === 'section' ? r.section : r.kind === 'wiring' ? `wiring(${r.limit})` : r.unmapped ? 'core (unmapped)' : 'core';
  };

  if (cmd === 'report') {
    const files = git('ls-files').split('\n').filter(Boolean);
    const counts = {};
    for (const f of files) {
      const l = label(f);
      counts[l] = (counts[l] ?? 0) + 1;
      if (!args.includes('--summary')) console.log(`${l.padEnd(18)} ${f}`);
    }
    console.log('\n' + Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${String(v).padStart(4)}  ${k}`).join('\n'));
  } else if (cmd === 'which') {
    for (const f of args) console.log(`${label(f).padEnd(18)} ${f}`);
  } else if (cmd === 'check') {
    const [base, head] = args;
    if (!base || !head) { console.error('usage: sections.mjs check <base> <head>'); process.exit(2); }
    const changes = parseNumstat(git('diff', '--numstat', '--no-renames', `${base}...${head}`));
    let labels = [];
    try { labels = JSON.parse(process.env.PR_LABELS || '[]'); } catch { /* none */ }
    const result = checkScope(changes, labels);
    const summary = renderSummary(result);
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
    if (!result.ok) {
      for (const p of result.problems) console.log(`::error::${p.replace(/`/g, '')}`);
      process.exit(1);
    }
  } else if (cmd === 'codeowners') {
    const file = new URL('../.github/CODEOWNERS', import.meta.url);
    const want = renderCodeowners();
    if (args.includes('--check')) {
      let have = '';
      try { have = readFileSync(file, 'utf8'); } catch { /* missing */ }
      if (have !== want) {
        console.error('::error::.github/CODEOWNERS is out of date: run `node scripts/sections.mjs codeowners` and commit it.');
        process.exit(1);
      }
      console.log('.github/CODEOWNERS matches scripts/sections.config.mjs.');
    } else {
      writeFileSync(file, want);
      console.log('Wrote .github/CODEOWNERS.');
    }
  } else {
    console.error('usage: sections.mjs report [--summary] | which <file>… | check <base> <head> | codeowners [--check]');
    process.exit(2);
  }
}
