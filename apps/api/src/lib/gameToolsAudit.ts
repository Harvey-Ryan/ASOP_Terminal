// Ship weapons check (v1.63.0): every game-data build, our reading of each
// ship's guns (who fires them, that none are missing) is compared with the
// files' own mount list (`auditShipWeapons` in packages/shared/src/combat.ts).
// The admin feed hears about it when the list of problems changes, and once
// when everything agrees again; Admin → Overview shows the current list.

import { createHash } from 'node:crypto';
import type { AdminWeaponAuditDto } from '@dem/shared';
import { prisma } from './prisma.js';
import { adminLog } from './adminLog.js';

const KIND = 'gametools.weapons';
const CLEAR = 'clear';

/** A fingerprint of the problems, so the same list isn't reported twice (restarts included). */
export function weaponAuditSignature(a: Pick<AdminWeaponAuditDto, 'problems'>): string {
  if (!a.problems.length) return CLEAR;
  const lines = a.problems
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
  const issues = a.problems.reduce((t, p) => t + p.issues.length, 0);
  const summary =
    signature === CLEAR
      ? `All ${a.ships} ships' weapons agree with the game files again (${build}).`
      : `${a.problems.length} of ${a.ships} ships need a look (${issues} issue${issues === 1 ? '' : 's'}, ${build}): ` +
        a.problems
          .slice(0, 6)
          .map((p) => `${p.name} (${[...new Set(p.issues.map((i) => i.kind))].join(', ')})`)
          .join('; ') +
        (a.problems.length > 6 ? `; and ${a.problems.length - 6} more` : '') +
        '. Details: Admin → Overview → Ship weapons check.';
  await adminLog({
    kind: KIND,
    summary,
    details: { signature, commit: a.commit, build: a.build, ships: a.ships, problems: a.problems.length },
  });
}
