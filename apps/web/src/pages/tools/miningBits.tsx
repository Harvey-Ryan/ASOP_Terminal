// Mining modifiers as the Mining page and the ship page show them (v1.50.0):
// which way is good for the miner, and how a percent change reads.

import { fmt } from '../../lib/gameTools';

export const MOD_COLUMNS: { key: string; label: string; lowerIsBetter: boolean }[] = [
  { key: 'Resistance', label: 'Resistance', lowerIsBetter: true },
  { key: 'Instability', label: 'Instability', lowerIsBetter: true },
  { key: 'OptimalChargeWindow', label: 'Opt. window', lowerIsBetter: false },
  { key: 'OptimalChargeRate', label: 'Opt. rate', lowerIsBetter: false },
  { key: 'AllChargeRates', label: 'All rates', lowerIsBetter: false },
  { key: 'InertMaterials', label: 'Inert', lowerIsBetter: true },
  { key: 'OverchargeRate', label: 'Overcharge', lowerIsBetter: true },
  { key: 'ShatterDamage', label: 'Shatter', lowerIsBetter: true },
];

export const modLabel = (key: string) => MOD_COLUMNS.find((m) => m.key === key)?.label ?? key.replace(/([a-z])([A-Z])/g, '$1 $2');
export const modIsGood = (key: string, v: number) => (MOD_COLUMNS.find((m) => m.key === key)?.lowerIsBetter ?? false ? v < 0 : v > 0);

export const pctText = (v: number) => `${v > 0 ? '+' : '−'}${fmt(Math.abs(v), Math.abs(v) % 1 ? 1 : 0)}%`;

export const ModCell = ({ v, lowerIsBetter }: { v: number | undefined; lowerIsBetter: boolean }) =>
  v == null ? <span className="gt-dim">–</span> : <span className={(lowerIsBetter ? v < 0 : v > 0) ? 'gt-good' : 'gt-bad'}>{pctText(v)}</span>;
