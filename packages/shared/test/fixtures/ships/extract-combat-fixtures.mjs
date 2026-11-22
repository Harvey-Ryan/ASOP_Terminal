// Cuts control ships (combat-<class>.json) out of scunpacked's ships.json for the weapon-role tests
// (v1.63.0). Keeps only what shipGunSlots / auditShipWeapons read: every
// loadout port keeps its place (port ids are indices), but ports with no gun
// or turret below them are cut down to their hardpoint name.
//
//   node packages/shared/test/fixtures/ships/extract-combat-fixtures.mjs <ships.json> [ClassName…]
//
// With no class names it refreshes the ships already in this folder.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [source, ...wanted] = process.argv.slice(2);
if (!source) {
  console.error('Usage: extract-combat-fixtures.mjs <ships.json> [ClassName…]');
  process.exit(1);
}
const names = wanted.length
  ? wanted
  : readdirSync(here)
      .filter((f) => f.startsWith('combat-') && f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(here, f), 'utf8')).ClassName);

const weaponish = (p) => {
  const type = String(p.Type ?? '');
  const types = (p.CompatibleTypes ?? []).map((t) => String(t.Type ?? ''));
  return (
    type.startsWith('WeaponGun') ||
    type.startsWith('Turret') ||
    types.includes('WeaponGun') ||
    types.includes('Turret') ||
    (p.Loadout ?? []).some(weaponish)
  );
};
const trimPort = (p) => {
  if (!weaponish(p)) return { HardpointName: p.HardpointName };
  const out = {};
  for (const k of ['HardpointName', 'Name', 'Type', 'MinSize', 'MaxSize', 'UUID', 'RequiredTags', 'PortTags'])
    if (p[k] !== undefined) out[k] = p[k];
  if (p.CompatibleTypes) out.CompatibleTypes = p.CompatibleTypes.map((t) => ({ Type: t.Type }));
  if (p.Loadout && !String(p.Type ?? '').startsWith('WeaponGun')) out.Loadout = p.Loadout.map(trimPort);
  return out;
};
const trimMount = (m) => ({
  PortId: m.PortId,
  HardpointName: m.HardpointName,
  ...(m.MountType !== undefined ? { MountType: m.MountType } : {}),
  ...(m.TurretRole !== undefined ? { TurretRole: m.TurretRole } : {}),
  ...(m.IsPilotSlaveable !== undefined ? { IsPilotSlaveable: m.IsPilotSlaveable } : {}),
  ...(m.OperatingStations ? { OperatingStations: m.OperatingStations.map((o) => ({ Kind: o.Kind })) } : {}),
  Payload: (m.Payload ?? [])
    .filter((p) => String(p.Type ?? '').startsWith('WeaponGun'))
    .map((p) => ({ PortId: p.PortId, Type: p.Type, Size: p.Size, Name: p.Name, Dps: p.CombatStats?.Dps })),
});

const all = JSON.parse(readFileSync(source, 'utf8'));
for (const name of names) {
  const s = all.find((x) => String(x.ClassName).toLowerCase() === String(name).toLowerCase());
  if (!s) {
    console.error(`Not found: ${name}`);
    process.exitCode = 1;
    continue;
  }
  const out = {
    ClassName: s.ClassName,
    Name: s.Name,
    Crew: s.Crew,
    PortTags: s.PortTags,
    // Turret seats decide seatless remote turrets (v1.65.1, turretSeats).
    Seating: { Seats: (s.Seating?.Seats ?? []).map((x) => ({ HardpointName: x.HardpointName, Role: x.Role })) },
    Weaponry: { PilotDps: s.Weaponry?.PilotDps ?? null },
    Loadout: (s.Loadout ?? []).map(trimPort),
    MountingPositions: (s.MountingPositions ?? [])
      .filter(
        (m) => (m.Payload ?? []).some((p) => String(p.Type ?? '').startsWith('WeaponGun')) || m.MountType === 'Turret',
      )
      .map(trimMount),
  };
  writeFileSync(join(here, `combat-${s.ClassName.toLowerCase()}.json`), JSON.stringify(out) + '\n');
  console.log(`${s.ClassName}: ${s.Name}`);
}
