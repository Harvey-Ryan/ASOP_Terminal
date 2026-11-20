// Release notes from commit messages (CLAUDE.md, "Patch notes in every commit"
// and "Batching patch notes"). Pure functions, so they can be tested without git.
//
// Every commit carries a `Patch notes:` block after its body and before its
// trailers: `[Section]` lines, each followed by `* ` bullets (sub-points
// indented with three spaces). `Patch notes: none` marks an internal change.

const TRAILER = /^[A-Za-z][A-Za-z-]*: \S/; // Co-Authored-By: …, Claude-Session: …

/**
 * One commit message → its patch notes.
 * @returns {{ kind: 'none' } | { kind: 'missing' } | { kind: 'notes', sections: { title: string, bullets: { text: string, subs: string[] }[] }[] }}
 */
export function parsePatchNotes(message) {
  const lines = String(message).replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((l) => /^Patch notes:/i.test(l.trim()));
  if (start < 0) return { kind: 'missing' };
  if (/^Patch notes:\s*none\.?\s*$/i.test(lines[start].trim())) return { kind: 'none' };
  const sections = [];
  let section = null;
  let bullet = null;
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trimEnd();
    if (TRAILER.test(line) && !line.startsWith('*')) break;
    const title = /^\s*\[(.+)\]\s*$/.exec(line);
    if (title) {
      section = sections.find((s) => s.title === title[1].trim());
      if (!section) {
        section = { title: title[1].trim(), bullets: [] };
        sections.push(section);
      }
      bullet = null;
      continue;
    }
    if (!line.trim()) continue;
    const sub = /^\s{2,}[*-]\s+(.*)$/.exec(line);
    const top = /^[*-]\s+(.*)$/.exec(line);
    if (!section) {
      section = { title: 'Other', bullets: [] };
      sections.push(section);
    }
    if (top) {
      bullet = { text: top[1].trim(), subs: [] };
      section.bullets.push(bullet);
    } else if (sub && bullet) bullet.subs.push(sub[1].trim());
    else if (bullet) {
      // A wrapped line belongs to the last bullet (or its last sub-point).
      if (bullet.subs.length) bullet.subs[bullet.subs.length - 1] += ` ${line.trim()}`;
      else bullet.text += ` ${line.trim()}`;
    }
  }
  return sections.length ? { kind: 'notes', sections } : { kind: 'none' };
}

/** `git log --format='%H%n%B%n==END=='` output → commits. */
export function splitLog(log) {
  return String(log)
    .split(/^==END==$/m)
    .map((chunk) => chunk.replace(/^\n+/, ''))
    .filter((c) => c.trim())
    .map((chunk) => {
      const [sha, ...rest] = chunk.split('\n');
      const message = rest.join('\n').trim();
      return { sha: sha.trim(), subject: message.split('\n')[0] ?? '', message };
    });
}

const isMerge = (c) => /^Merge (pull request|branch|remote-tracking branch)\b/.test(c.subject);

/**
 * A release's commits → merged sections (same title merged, duplicate bullets
 * dropped, Bug Fixes last) plus the commits that carried no block at all.
 */
export function collectNotes(commits) {
  const sections = [];
  const missing = [];
  for (const c of commits) {
    if (isMerge(c)) continue;
    const notes = parsePatchNotes(c.message);
    if (notes.kind === 'missing') {
      missing.push(c);
      continue;
    }
    if (notes.kind !== 'notes') continue;
    for (const s of notes.sections) {
      let into = sections.find((x) => x.title.toLowerCase() === s.title.toLowerCase());
      if (!into) {
        into = { title: s.title, bullets: [] };
        sections.push(into);
      }
      for (const b of s.bullets) if (!into.bullets.some((x) => x.text === b.text)) into.bullets.push(b);
    }
  }
  const fixes = sections.filter((s) => /^bug fixes$/i.test(s.title));
  return { sections: [...sections.filter((s) => !/^bug fixes$/i.test(s.title)), ...fixes], missing };
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "Patch Notes — v1.55.0 — November 19", as CLAUDE.md asks; the date is the release commit's (Central time, the team's). */
export function releaseTitle(version, isoDate) {
  const day = new Date(new Date(isoDate).toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  return `Patch Notes — v${version} — ${MONTHS[day.getMonth()]} ${day.getDate()}`;
}

/** Markdown for the GitHub Release. */
export function renderNotes({ sections, missing }) {
  const out = [];
  for (const s of sections) {
    out.push(`### ${s.title}`, '');
    for (const b of s.bullets) {
      out.push(`- ${b.text}`);
      for (const sub of b.subs) out.push(`  - ${sub}`);
    }
    out.push('');
  }
  if (!sections.length) out.push('No player-facing changes in this release.', '');
  if (missing.length) {
    out.push('<details><summary>Commits without patch notes (check these)</summary>', '');
    for (const c of missing) out.push(`- ${c.sha.slice(0, 7)} ${c.subject}`);
    out.push('', '</details>', '');
  }
  return out.join('\n').trimEnd() + '\n';
}

/** "1.10.2" > "1.9.9" */
export function compareVersions(a, b) {
  const pa = a.split('.').map(Number),
    pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/**
 * Where each version first appeared on master (oldest first), from the
 * versions read at each first-parent commit that touched package.json.
 * @param {{ sha: string, version: string | null, date: string }[]} changes oldest first
 */
export function versionStarts(changes) {
  const out = [];
  let prev = null;
  for (const c of changes) {
    if (c.version && c.version !== prev && !out.some((o) => o.version === c.version)) out.push(c);
    prev = c.version ?? prev;
  }
  return out;
}
