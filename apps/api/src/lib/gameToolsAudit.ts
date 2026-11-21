// Ship weapons check (v1.63.0): every game-data build, our reading of each
// ship's guns (who fires them, that none are missing) is compared with the
// files' own mount list (`auditShipWeapons` in packages/shared/src/combat.ts).
// The admin feed hears about it when the list of problems changes, and once
// when everything agrees again; Admin → Overview shows the current list.
// Issues of severity 'check' (v1.64.1: turrets with no seat recorded) are
// shown on the admin page only: they agree with the files and don't change
// from build to build, so they'd only repeat in the feed.

import { createHash } from 'node:crypto';
import type { AdminWeaponAuditDto } from '@dem/shared';
import { prisma } from './prisma.js';
import { adminLog } from './adminLog.js';

const KIND = 'gametools.weapons';
const CLEAR = 'clear';

type Problems = AdminWeaponAuditDto['problems'];

/** Ships with issues the feed should hear about (severity 'problem'; older issues without one count). */
export function feedProblems(problems: Problems): Problems {
  return problems
    .map((p) => ({ ...p, issues: p.issues.filter((i) => (i.severity ?? 'problem') === 'problem') }))
    .filter((p) => p.issues.length);
}

/** A fingerprint of the problems, so the same list isn't reported twice (restarts included). */
export function weaponAuditSignature(a: Pick<AdminWeaponAuditDto, 'problems'>): string {
  const problems = feedProblems(a.problems);
  if (!problems.length) return CLEAR;
  const lines = problems
    .flatMap((p) => p.issues.map((i) => `${p.className}|${i.kind}|${i.where}`))
    .sort()
    .join('\n');
  return createHash('sha1').update(lines).digest('hex').slice(0, 16);
}

export async function reportWeaponAudit(a: AdminWeaponAuditDto): Promise<void> {
  const signature = weaponAuditSignature(a);
  const last = await prisma.adminLog.findFirst({ where: { kind: KIND }, orderBy: { id: 'desc' } });
  let lastSignature: string | null = null;
  try {
    lastSignature = last ? ((JSON.parse(last.details ?? '{}') as { signature?: string }).signature ?? null) : null;
  } catch {
    lastSignature = null;
  }
  if (signature === lastSignature) return;
  // Nothing wrong and nothing reported before: stay quiet.
  if (signature === CLEAR && !last) return;
  const build = a.build ?? a.commit.slice(0, 7);
  const problems = feedProblems(a.problems);
  const issues = problems.reduce((t, p) => t + p.issues.length, 0);
  const summary =
    signature === CLEAR
      ? `All ${a.ships} ships' weapons agree with the game files again (${build}).`
      : `${problems.length} of ${a.ships} ships need a look (${issues} issue${issues === 1 ? '' : 's'}, ${build}): ` +
        problems
          .slice(0, 6)
          .map((p) => `${p.name} (${[...new Set(p.issues.map((i) => i.kind))].join(', ')})`)
          .join('; ') +
        (problems.length > 6 ? `; and ${problems.length - 6} more` : '') +
        '. Details: Admin → Overview → Ship weapons check.';
  await adminLog({
    kind: KIND,
    summary,
    details: { signature, commit: a.commit, build: a.build, ships: a.ships, problems: problems.length },
  });
}
