import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shipComponentFromItem, shipComponentSlots, componentFitsSlot, componentTotals, dedupeComponents,
} from '../dist/index.js';

// Numbers from scunpacked 4.10.3-LIVE (base stats = quality 500).
const item = (uuid, name, type, size, extra, dd = { Class: 'Civilian', Grade: 'C' }) => shipComponentFromItem({
  uuid, class_name: name, name, manufacturer_name: 'Maker', size,
  data: { stdItem: { Type: type, Size: size, DescriptionData: dd, ResourceNetwork: { Usage: { Power: { Maximum: 3 } } }, Emission: { Em: { Maximum: 1240 }, Ir: 0 }, ...extra } },
});
const chimalli = item('chimalli', "5MA 'Chimalli'", 'Shield.UNDEFINED', 2, { Shield: { MaxShieldHealth: 10000, MaxShieldRegen: 1900, DamagedDelay: 5.5, DownedDelay: 11 } });
const fr76 = item('fr76', 'FR-76', 'Shield.UNDEFINED', 2, { Shield: { MaxShieldHealth: 9000, MaxShieldRegen: 2000 } }, { Class: 'Military', Grade: 'A' });
const daybreak = item('daybreak', 'DayBreak', 'PowerPlant.Power', 2, { ResourceNetwork: { Generation: { Power: 18 } } });
const torrent = item('torrent', 'Torrent', 'QuantumDrive.UNDEFINED', 2, { QuantumDrive: { FuelRequirement10GM: 0.22, StandardJump: { DriveSpeed: 263400000, SpoolUpTime: 7.3, CooldownTime: 14.3 } } });
const bespoke = item('stellate', 'Stellate', 'PowerPlant.Power', 4, { ResourceNetwork: { Generation: { Power: 60 } } }, { Class: 'Civilian', Grade: 'Bespoke' });

test('reads each kind of component', () => {
  assert.equal(chimalli.kind, 'shield');
  assert.equal(chimalli.shieldHp, 10000);
  assert.equal(chimalli.downedDelay, 11);
  assert.equal(chimalli.ir, null);
  assert.equal(daybreak.powerOut, 18);
  assert.equal(torrent.qtSpool, 7.3);
  assert.equal(torrent.available, true);
  assert.equal(bespoke.available, false);
  assert.equal(item('x', 'Radar', 'Radar.MidRangeRadar', 1, {}, {}).available, false);
  assert.equal(item('x', 'Gun', 'WeaponGun.Gun', 1, {}), null);
});

const m80 = {
  PortTags: '',
  Loadout: [
    { HardpointName: 'hardpoint_quantum_drive', Type: 'QuantumDrive.UNDEFINED', UUID: 'torrent', MinSize: 2, MaxSize: 2, Editable: true, CompatibleTypes: [{ Type: 'QuantumDrive', SubTypes: ['QDrive'] }] },
    { HardpointName: 'hardpoint_shield_left', Type: 'Shield.UNDEFINED', UUID: 'chimalli', MinSize: 2, MaxSize: 2, Editable: true, CompatibleTypes: [{ Type: 'Shield' }] },
    { HardpointName: 'hardpoint_shield_right', Type: 'Shield.UNDEFINED', UUID: 'chimalli', MinSize: 2, MaxSize: 2, Editable: true, CompatibleTypes: [{ Type: 'Shield' }] },
    { HardpointName: 'hardpoint_controller_shield', Type: 'ShieldController.UNDEFINED', UUID: 'ctrl', Editable: false, CompatibleTypes: [{ Type: 'ShieldController' }] },
    { HardpointName: 'module', Type: 'Module', Loadout: [
      { HardpointName: 'hardpoint_power_plant', Type: 'PowerPlant.Power', UUID: 'daybreak', MinSize: 2, MaxSize: 2, Editable: false, CompatibleTypes: [{ Type: 'PowerPlant' }] },
    ] },
  ],
};

test('slots: shields first, nested ones found, controllers skipped, fixed ones locked', () => {
  const slots = shipComponentSlots(m80);
  assert.deepEqual(slots.map((s) => s.kind), ['shield', 'shield', 'power', 'quantum']);
  assert.equal(slots[2].locked, true);
  assert.equal(slots[2].id, 'module/hardpoint_power_plant');
  assert.equal(componentFitsSlot(fr76, slots[0]), true);
  assert.equal(componentFitsSlot(daybreak, slots[0]), false, 'wrong kind');
  assert.equal(componentFitsSlot(item('s1', 'Small', 'Shield.UNDEFINED', 1, {}), slots[0]), false, 'wrong size');
  assert.equal(componentFitsSlot(daybreak, slots[2]), true, 'stock always fits');
  assert.equal(componentFitsSlot(item('p2', 'Other', 'PowerPlant.Power', 2, {}), slots[2]), false, 'locked');
  assert.equal(componentFitsSlot(bespoke, { ...slots[2], locked: false, minSize: 4, maxSize: 4, stockUuid: null }), false, 'bespoke parts only where stock');
});

test('totals: only the two strongest shields are up; range from the tank', () => {
  // Erkul's M80: 20,000 shield HP, 3,800 regen; 4.6 SCU tank / 22 mSCU per Gm = 209.1 Gm.
  const t = componentTotals([chimalli, chimalli, daybreak, torrent], 4600);
  assert.equal(t.shieldHp, 20000);
  assert.equal(t.shieldRegen, 3800);
  assert.equal(t.spareShields, 0);
  assert.equal(t.quantum.name, 'Torrent');
  assert.equal(torrent.qtFuelPerGm, 22);
  assert.equal(t.qtRangeGm.toFixed(1), '209.1');
  // Zeus CL style: three shields, two up.
  const z = componentTotals([fr76, chimalli, chimalli], null);
  assert.equal(z.shieldHp, 20000);
  assert.equal(z.activeShields, 2);
  assert.equal(z.spareShields, 1);
  assert.equal(z.qtRangeGm, null);
});

test('identical copies are one choice', () => {
  const list = dedupeComponents([chimalli, { ...chimalli, uuid: 'copy' }, fr76]);
  assert.equal(list.length, 2);
  assert.equal(list[0].variants, 1);
});
