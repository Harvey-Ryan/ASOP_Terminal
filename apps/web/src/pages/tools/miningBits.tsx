// Mining modifiers as the Mining page and the ship page show them (v1.50.0):
// which way is good for the miner, and how a percent change reads.

import { fmt } from '../../lib/gameTools';

export const MOD_COLUMNS: { key: string; label: string; lowerIsBetter: boolean }[] = [
  { key: 'Resistance', label: 'Resistance', lowerIsBetter: true },
  { key: 'Instability', label: 'Instability', lowerIsBetter: true },
  { key: 'OptimalChargeWindow', label: 'Opt. window', lowerIsBetter: false },
  { key: 'OptimalChargeRate', label: 'Opt. rate', lowerIsBetter: false },
  { key: 'InertMaterials', label: 'Inert', lowerIsBetter: true },
  { key: 'OverchargeRate', label: 'Overcharge', lowerIsBetter: true },
  { key: 'ShatterDamage', label: 'Shatter', lowerIsBetter: true },
];

/** The changes a laser can carry (v1.52.0: "All rates" was the inert filter counted twice, see filterFix). */
export const LASER_MOD_COLUMNS = MOD_COLUMNS.filter((m) => ['Resistance', 'Instability', 'OptimalChargeWindow', 'OptimalChargeRate', 'InertMaterials'].includes(m.key));

/** Gadgets also change how the rock breaks apart: a higher cluster factor keeps more of it together. */
export const GADGET_MOD_COLUMNS: typeof MOD_COLUMNS = [
  ...MOD_COLUMNS.filter((m) => ['Resistance', 'Instability', 'OptimalChargeWindow', 'OptimalChargeRate'].includes(m.key)),
  { key: 'ClusterFactor', label: 'Cluster', lowerIsBetter: false },
];

const ALL_MODS = [...MOD_COLUMNS, ...GADGET_MOD_COLUMNS];
export const modLabel = (key: string) => ALL_MODS.find((m) => m.key === key)?.label ?? key.replace(/([a-z])([A-Z])/g, '$1 $2');
export const modIsGood = (key: string, v: number) => (ALL_MODS.find((m) => m.key === key)?.lowerIsBetter ?? false ? v < 0 : v > 0);

export const pctText = (v: number) => `${v > 0 ? '+' : '−'}${fmt(Math.abs(v), Math.abs(v) % 1 ? 1 : 0)}%`;

export const ModCell = ({ v, lowerIsBetter }: { v: number | undefined; lowerIsBetter: boolean }) =>
  v == null ? <span className="gt-dim">–</span> : <span className={(lowerIsBetter ? v < 0 : v > 0) ? 'gt-good' : 'gt-bad'}>{pctText(v)}</span>;
