// Crafting Calculator (v1.26.0: "fabrication bay" look, per-part material
// sliders, a build list with totals and where to mine everything).
import { Fragment, useState, useMemo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Search, X, ChevronLeft, ChevronRight, MapPin, FileText, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  chanceLabel,
  formatMaterialAmount,
  buildListTotals,
  planRoute,
  routeSystems,
  MINING_METHOD_LABELS,
} from '@dem/shared';
import {
  blueprintTypes,
  craftingSource,
  materialSources,
  missionContracts,
  obtainableBlueprints,
  searchBlueprints,
  getBlueprintByUuid,
  getBaseStats,
  interpolateStat,
  combinedMultiplier,
  type LocalBlueprint,
  type MissionContract,
  type ItemBaseStats,
} from '@/lib/gameData';
import { buildList, useBuildList, type BuildListItem } from '@/lib/buildList';
import './crafting/fabrication.css';


// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtSecs(s: number) {
  if (s < 60) return `${s}s`;
  if (s < 3600) return s % 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 60)}m`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function fmtPct(v: number, decimals = 2) {
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(decimals)}%`;
}

function fmtMult(v: number) {
  return `×${v.toFixed(2)}`;
}

function applyStatFormula(statKey: string, baseValue: number, mult: number): number {
  if (statKey === 'armor_damagemitigation') {
    return 1 - (1 - baseValue) * mult;
  }
  return baseValue * mult;
}

function fmtContractTitle(raw: string): string {
  return raw
    .replace(/~mission\([^|)]+\|([^)]+)\)/g, (_, inner: string) =>
      inner.replace(/([A-Z])/g, ' $1').replace(/\bTitle\b/gi, '').trim()
    )
    .replace(/~mission\(([^)]+)\)/g, (_, inner: string) =>
      inner.replace(/([A-Z])/g, ' $1').trim()
    )
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function fmtDescription(raw: string): string {
  return raw
    .replace(/<EM4>(.*?)<\/EM4>/g, '$1')
    .replace(/~mission\([^|)]+\|([^)]+)\)/g, (_, inner: string) =>
      inner.replace(/([A-Z])/g, ' $1').trim()
    )
    .replace(/~mission\(([^)]+)\)/g, '[...]')
    .trim();
}

function fmtDiffLabel(raw: string): string {
  return raw.replace(/_\d+$/, '').replace(/_/g, ' ');
}

function fmtMinutes(m: number): string {
  if (m < 60) return `~${Math.round(m)}m`;
  const h = Math.floor(m / 60);
  const rem = Math.round(m % 60);
  return rem > 0 ? `~${h}h ${rem}m` : `~${h}h`;
}

function diffCls(score: number): string {
  if (score <= 3) return 'text-green-500 border-green-500/30 bg-green-500/10';
  if (score <= 4) return 'text-yellow-500 border-yellow-500/30 bg-yellow-500/10';
  if (score <= 5) return 'text-orange-500 border-orange-500/30 bg-orange-500/10';
  return 'text-red-500 border-red-500/30 bg-red-500/10';
}

import type { MissionDifficulty, MissionStanding } from '@/lib/gameData';

function DifficultyBlock({ diff, time, standing, illegal }: {
  diff: MissionDifficulty | null;
  time: number | null;
  standing: MissionStanding | null;
  illegal: boolean;
}) {
  type DimDef = { label: string; score: number; detail: string };
  const dims: DimDef[] = diff ? [
    { label: 'Risk',       score: diff.riskOfLoss,      detail: diff.riskOfLossLabel },
    { label: 'Mental',     score: diff.mentalLoad,       detail: diff.mentalLoadLabel },
    { label: 'Mechanical', score: diff.mechanicalSkill,  detail: diff.mechanicalSkillLabel },
    { label: 'Knowledge',  score: diff.gameKnowledge,    detail: diff.gameKnowledgeLabel },
  ] : [];

  return (
    <div className="space-y-2">
      {/* Meta row: time + profile + standing + illegal */}
      <div className="flex items-center gap-2 flex-wrap">
        {time != null && (
          <span className="text-[11px] font-mono bg-muted text-muted-foreground rounded px-2 py-0.5">
            ⏱ {fmtMinutes(time)}
          </span>
        )}
        {diff?.profile && (
          <span className="text-[11px] bg-muted text-muted-foreground rounded px-2 py-0.5">{diff.profile}</span>
        )}
        {standing && standing.minReputation > 0 && (
          <span className="text-[11px] bg-primary/10 text-primary rounded px-2 py-0.5 font-medium">
            {standing.name} ({standing.minReputation.toLocaleString()}+ rep)
          </span>
        )}
        {illegal && (
          <span className="text-[11px] bg-red-500/10 text-red-500 border border-red-500/20 rounded px-2 py-0.5 font-semibold">
            Illegal
          </span>
        )}
      </div>

      {/* Difficulty grid */}
      {dims.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5">
          {dims.map(({ label, score, detail }) => score > 0 ? (
            <div key={label} className={cn('rounded border px-2 py-1.5', diffCls(score))}>
              <p className="text-[9px] font-semibold uppercase tracking-wider opacity-70">{label}</p>
              <p className="text-[11px] font-medium leading-tight mt-0.5">{score}/7</p>
              {detail && <p className="text-[10px] opacity-60 leading-tight mt-0.5 capitalize">{detail.toLowerCase()}</p>}
            </div>
          ) : null)}
        </div>
      )}
    </div>
  );
}

// ── Contract modal ────────────────────────────────────────────────────────────

function ContractModal({
  contract,
  onClose,
  onSelectBlueprint,
}: {
  contract: MissionContract;
  onClose: () => void;
  onSelectBlueprint: (uuid: string) => void;
}) {
  const multiPool = contract.pools.length > 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-lg border border-border bg-card shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-bold leading-tight">{fmtContractTitle(contract.title)}</h2>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {contract.missionType && (
                  <span className="text-[11px] bg-muted text-muted-foreground rounded px-2 py-0.5 font-medium">
                    {contract.missionType}
                  </span>
                )}
                {contract.missionGiver && (
                  <span className="text-[11px] bg-muted text-muted-foreground rounded px-2 py-0.5">
                    {contract.missionGiver}
                  </span>
                )}
                {contract.faction && contract.faction !== contract.missionGiver && (
                  <span className="text-[11px] bg-primary/10 text-primary rounded px-2 py-0.5 font-mono">
                    {contract.faction}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Difficulty + meta */}
          <DifficultyBlock
            diff={contract.difficulty}
            time={contract.timeToCompleteMinutes}
            standing={contract.minStanding}
            illegal={contract.illegal}
          />

          {/* Reward row */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded px-3 py-2 flex-wrap">
            <span className="font-semibold text-foreground">aUEC:</span> Calculated (scales with difficulty &amp; distance)
            {contract.reputation.length > 0 && (
              <>
                <span className="mx-1 opacity-30">·</span>
                <span className="font-semibold text-foreground">Rep XP:</span>
                {contract.reputation.map(r => `${r.xp.toLocaleString()} (${r.faction})`).join(' · ')}
              </>
            )}
          </div>

          {/* Locations */}
          {contract.locations.length > 0 && (
            <div className="space-y-1.5">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <MapPin className="h-3 w-3" /> Locations
              </p>
              <div className="flex flex-wrap gap-1">
                {contract.locations.map(loc => (
                  <span key={loc} className="text-[11px] bg-muted text-muted-foreground rounded px-1.5 py-0.5">
                    {loc}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Description */}
          {contract.description && (
            <div className="space-y-1.5">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <FileText className="h-3 w-3" /> Description
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap rounded border border-border/50 bg-muted/20 px-3 py-2.5 max-h-40 overflow-y-auto">
                {fmtDescription(contract.description)}
              </p>
            </div>
          )}

          {/* Blueprint pools */}
          <div className="space-y-3">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Layers className="h-3 w-3" /> Blueprints
            </p>
            {contract.pools.map((pool, pi) => (
              <div key={pi} className="rounded-md border border-border overflow-hidden">
                {multiPool && (
                  <div className="px-3 py-1.5 bg-muted/30 border-b border-border/60 flex items-center gap-2">
                    <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="text-[11px] text-muted-foreground">
                      {pool.locations.length > 0 ? pool.locations.slice(0, 5).join(', ') + (pool.locations.length > 5 ? ` +${pool.locations.length - 5} more` : '') : 'Default (all locations)'}
                    </span>
                  </div>
                )}
                <div className="divide-y divide-border/40">
                  {pool.blueprints.map(bp => {
                    const found = getBlueprintByUuid(bp.blueprintUuid);
                    return (
                      <div key={bp.blueprintUuid} className="flex items-center justify-between px-3 py-2">
                        <span className="text-sm text-foreground">{bp.name}</span>
                        {found ? (
                          <button
                            onClick={() => { onSelectBlueprint(bp.blueprintUuid); onClose(); }}
                            className="text-[11px] text-primary hover:underline shrink-0 ml-3"
                          >
                            View recipe →
                          </button>
                        ) : (
                          <span className="text-[11px] text-muted-foreground/40 shrink-0 ml-3 italic">no recipe</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Product Stats section ─────────────────────────────────────────────────────

function resDisplay(v: number) {
  const pct = (1 - v) * 100;
  return `${fmtMult(v)} (${pct.toFixed(0)}%)`;
}

function ArmorStats({
  base,
  mults,
}: {
  base: Extract<ItemBaseStats, { kind: 'armor' }>;
  mults: Record<string, number>;
}) {
  const [open, setOpen] = useState(true);
  const toggle = useCallback(() => setOpen(o => !o), []);

  const dmg  = mults['armor_damagemitigation']     ?? 1;
  const tMin = mults['armor_temperaturemin']        ?? 1;
  const tMax = mults['armor_temperaturemax']        ?? 1;
  const rad  = mults['armor_radiationdissipation']  ?? 1;

  const resFields: [string, number][] = [
    ['Physical',    base.resistance.physical],
    ['Energy',      base.resistance.energy],
    ['Distortion',  base.resistance.distortion],
    ['Thermal',     base.resistance.thermal],
    ['Biochemical', base.resistance.biochemical],
    ['Stun',        base.resistance.stun],
  ];

  return (
    <div className="space-y-3">
      {/* Collapsible card: Damage Mitigation + Temperature side by side */}
      <div className="rounded border border-border overflow-hidden">
        <button
          onClick={toggle}
          className="w-full flex items-center justify-between px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors"
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Damage Mitigation &amp; Temperature
          </span>
          <ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', open && 'rotate-90')} />
        </button>

        {open && (
          <div className="grid grid-cols-2 gap-px bg-border">
            {/* Left: Damage Resistance */}
            <div className="bg-card p-3 space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Mitigation</p>
              <div className="grid grid-cols-2 gap-1.5">
                {resFields.map(([label, bv]) => {
                  const crafted = applyStatFormula('armor_damagemitigation', bv, dmg);
                  const delta   = crafted - bv;
                  const better  = crafted < bv;
                  return (
                    <div key={label} className="rounded border border-border bg-muted/30 px-2 py-1.5 space-y-0.5">
                      <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
                      <p className="text-[11px] font-mono">{resDisplay(bv)}</p>
                      {dmg !== 1 && (
                        <p className={cn('text-[10px] font-mono font-bold', better ? 'text-green-500' : 'text-red-500')}>
                          → {resDisplay(crafted)}
                          <span className="ml-0.5 text-[9px]">{fmtPct(delta * 100)}</span>
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right: Temperature */}
            <div className="bg-card p-3 space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Temperature</p>
              {base.temperature ? (
                <table className="w-full text-xs">
                  <tbody>
                    <tr className="border-b border-border/40">
                      <td className="py-1.5 text-muted-foreground">Min</td>
                      <td className="py-1.5 text-right font-mono">{base.temperature.min.toFixed(1)}°C</td>
                      {tMin !== 1 && (
                        <td className="py-1.5 text-right font-mono font-bold text-green-500 text-[10px]">
                          → {(base.temperature.min * tMin).toFixed(1)}°C
                        </td>
                      )}
                    </tr>
                    <tr>
                      <td className="py-1.5 text-muted-foreground">Max</td>
                      <td className="py-1.5 text-right font-mono">{base.temperature.max.toFixed(1)}°C</td>
                      {tMax !== 1 && (
                        <td className="py-1.5 text-right font-mono font-bold text-green-500 text-[10px]">
                          → {(base.temperature.max * tMax).toFixed(1)}°C
                        </td>
                      )}
                    </tr>
                  </tbody>
                </table>
              ) : (
                <p className="text-xs text-muted-foreground/50 italic">No data</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Radiation (separate, only when relevant) */}
      {base.radiation && rad !== 1 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Radiation</p>
          <div className="rounded border border-border overflow-hidden">
            <table className="w-full text-xs">
              <tbody>
                <tr>
                  <td className="px-3 py-2 text-muted-foreground">Scrub Rate</td>
                  <td className="px-3 py-2 text-right font-mono">{base.radiation.dissipationRate.toFixed(0)} REM/s</td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-green-500">
                    → {(base.radiation.dissipationRate * rad).toFixed(0)} REM/s
                    <span className="ml-1 text-[10px]">{fmtPct((rad - 1) * 100)}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ShieldStats({
  base,
  mults,
}: {
  base: Extract<ItemBaseStats, { kind: 'shield' }>;
  mults: Record<string, number>;
}) {
  const mult    = mults['shield_maxhealth'] ?? mults['health_maxhealth'] ?? 1;
  const crafted = base.maxHealth * mult;
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Shield</p>
      <div className="rounded border border-border overflow-hidden">
        <table className="w-full text-xs">
          <tbody>
            <tr>
              <td className="px-3 py-2 text-muted-foreground">Max Health</td>
              <td className="px-3 py-2 text-right font-mono">{base.maxHealth.toLocaleString()}</td>
              {mult !== 1 && (
                <td className="px-3 py-2 text-right font-mono font-bold text-green-500">
                  → {crafted.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  <span className="ml-1 text-[10px]">{fmtPct((mult - 1) * 100)}</span>
                </td>
              )}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WeaponStats({
  base,
  mults,
}: {
  base: Extract<ItemBaseStats, { kind: 'weapon' }>;
  mults: Record<string, number>;
}) {
  const dmgM = mults['weapon_damage']   ?? 1;
  const rpmM = mults['weapon_firerate'] ?? 1;
  if (base.modes.length === 0) {
    return <p className="text-xs text-muted-foreground/60 italic">No fire mode data for this weapon in the game data.</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Weapon</p>
      <div className="rounded border border-border overflow-hidden">
        <table className="w-full text-xs">
          <tbody>
            {base.modes.map((mode, i) => (
              <Fragment key={`${mode.name}-${i}`}>
                <tr key={`${mode.name}-alpha`} className="border-b border-border/40">
                  <td className="px-3 py-2 text-muted-foreground">{mode.name} — Damage</td>
                  <td className="px-3 py-2 text-right font-mono">{mode.alpha.toFixed(1)}</td>
                  {dmgM !== 1 && (
                    <td className="px-3 py-2 text-right font-mono font-bold text-green-500">
                      → {(mode.alpha * dmgM).toFixed(1)}
                      <span className="ml-1 text-[10px]">{fmtPct((dmgM - 1) * 100)}</span>
                    </td>
                  )}
                </tr>
                <tr key={`${mode.name}-rpm`} className="border-b border-border/40 last:border-0">
                  <td className="px-3 py-2 text-muted-foreground">{mode.name} — RPM</td>
                  <td className="px-3 py-2 text-right font-mono">{mode.rpm}</td>
                  {rpmM !== 1 && (
                    <td className="px-3 py-2 text-right font-mono font-bold text-green-500">
                      → {(mode.rpm * rpmM).toFixed(0)}
                      <span className="ml-1 text-[10px]">{fmtPct((rpmM - 1) * 100)}</span>
                    </td>
                  )}
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PowerPlantStats({
  base,
  mults,
}: {
  base: Extract<ItemBaseStats, { kind: 'powerplant' }>;
  mults: Record<string, number>;
}) {
  const mult    = mults['itemresource_powergeneration'] ?? 1;
  const crafted = base.powerOutput * mult;
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Power Plant</p>
      <div className="rounded border border-border overflow-hidden">
        <table className="w-full text-xs">
          <tbody>
            <tr>
              <td className="px-3 py-2 text-muted-foreground">Power Output</td>
              <td className="px-3 py-2 text-right font-mono">{base.powerOutput.toFixed(0)}</td>
              {mult !== 1 && (
                <td className="px-3 py-2 text-right font-mono font-bold text-green-500">
                  → {crafted.toFixed(0)}
                  <span className="ml-1 text-[10px]">{fmtPct((mult - 1) * 100)}</span>
                </td>
              )}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function QuantumDriveStats({
  base,
  mults,
}: {
  base: Extract<ItemBaseStats, { kind: 'quantumdrive' }>;
  mults: Record<string, number>;
}) {
  const speedM = mults['quantum_speed']           ?? 1;
  const fuelM  = mults['quantum_fuelrequirement'] ?? 1;
  const speedMm = base.speedMs / 1_000_000;
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Quantum Drive</p>
      <div className="rounded border border-border overflow-hidden">
        <table className="w-full text-xs">
          <tbody>
            <tr className="border-b border-border/40">
              <td className="px-3 py-2 text-muted-foreground">Speed</td>
              <td className="px-3 py-2 text-right font-mono">{speedMm.toFixed(0)} Mm/s</td>
              {speedM !== 1 && (
                <td className="px-3 py-2 text-right font-mono font-bold text-green-500">
                  → {(speedMm * speedM).toFixed(0)} Mm/s
                  <span className="ml-1 text-[10px]">{fmtPct((speedM - 1) * 100)}</span>
                </td>
              )}
            </tr>
            <tr>
              <td className="px-3 py-2 text-muted-foreground">Fuel / 10 Gm</td>
              <td className="px-3 py-2 text-right font-mono">{base.fuelReq10GM.toFixed(3)} SCU</td>
              {fuelM !== 1 && (
                <td className="px-3 py-2 text-right font-mono font-bold text-green-500">
                  → {(base.fuelReq10GM * fuelM).toFixed(3)} SCU
                  <span className="ml-1 text-[10px]">{fmtPct((fuelM - 1) * 100)}</span>
                </td>
              )}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProductStats({ bp, qls }: { bp: LocalBlueprint; qls: number[] }) {
  const baseStats = useMemo(() => getBaseStats(bp.itemUuid, bp.type), [bp.itemUuid, bp.type]);

  const mults = useMemo(() => {
    const allKeys = [...new Set(bp.components.flatMap(c => c.stats.map(s => s.key)))];
    return Object.fromEntries(allKeys.map(key => [key, combinedMultiplier(bp, key, qls)]));
  }, [bp, qls]);

  if (!baseStats) return null;

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="px-3 py-1.5 border-b border-border bg-muted/20 flex items-center justify-between">
        <p className="text-xs font-bold text-foreground">Product Stats</p>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {bp.manufacturer && (
            <span className="text-[11px] font-mono bg-primary/10 text-primary px-2 py-0.5 rounded">
              {bp.manufacturer}
            </span>
          )}
          {bp.mass != null && <span className="text-[11px] text-muted-foreground">{bp.mass} kg</span>}
          {bp.subtype    && <span className="text-[11px] text-muted-foreground capitalize">{bp.subtype}</span>}
        </div>
      </div>
      <div className="px-3 py-2 space-y-3">
        {baseStats.kind === 'armor'        && <ArmorStats        base={baseStats} mults={mults} />}
        {baseStats.kind === 'shield'       && <ShieldStats       base={baseStats} mults={mults} />}
        {baseStats.kind === 'weapon'       && <WeaponStats       base={baseStats} mults={mults} />}
        {baseStats.kind === 'powerplant'   && <PowerPlantStats   base={baseStats} mults={mults} />}
        {baseStats.kind === 'quantumdrive' && <QuantumDriveStats base={baseStats} mults={mults} />}
        {baseStats.kind === 'generic' && baseStats.hp != null && (
          <p className="text-xs text-muted-foreground">
            HP: <span className="text-foreground font-mono">{baseStats.hp.toLocaleString()}</span>
          </p>
        )}
      </div>
    </div>
  );
}

// ═══ The workbench (v1.26.0): blueprints · item · build list ════════════════
//
// One screen, three columns (stacked on phones): find a blueprint, set each
// part's material quality and see the result, and collect what to craft in a
// build list with total time, materials and where to mine them.

/** "Char_Armor_Arms" → "Armor arms", "WeaponPersonal" → "Weapon personal" */
function typeLabel(t: string): string {
  const s = t.replace(/^Char_/, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const amountOf = (m: LocalBlueprint['components'][number]['material']) => formatMaterialAmount(m.quantityScu, m.quantity);
const BROWSE_PAGE = 60;
const PRESETS: [string, number][] = [['Min', 0], ['Base', 500], ['Max', 1000]];

function Rivets() {
  return (
    <>
      <span aria-hidden="true" className="fab-rivet" style={{ top: 10, left: 10 }} />
      <span aria-hidden="true" className="fab-rivet" style={{ top: 10, right: 10 }} />
      <span aria-hidden="true" className="fab-rivet" style={{ bottom: 10, left: 10 }} />
      <span aria-hidden="true" className="fab-rivet" style={{ bottom: 10, right: 10 }} />
    </>
  );
}

// ── Left: find a blueprint ───────────────────────────────────────────────────

function BlueprintBrowser({ selectedUuid, onPick, onCollapse, className }: {
  selectedUuid: string | null;
  onPick: (uuid: string) => void;
  /** Wide screens, with a blueprint open: tuck the list away to give the parts room */
  onCollapse?: () => void;
  className?: string;
}) {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [limit, setLimit] = useState(BROWSE_PAGE);
  const list = useMemo(() => searchBlueprints(q, type || undefined).slice().sort((a, b) => a.name.localeCompare(b.name)), [q, type]);
  const shown = list.slice(0, limit);
  const queue = useBuildList();
  const inList = new Set(queue.map((i) => i.uuid));

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && list[0]) { e.preventDefault(); onPick(list[0].uuid); }
  }

  return (
    <section aria-label="Blueprints" className={cn('flex min-w-0 flex-col gap-3', className)}>
      <div className="flex flex-col gap-1.5">
        <span className="flex items-center justify-between gap-2">
          <label htmlFor="bp-search" className="fab-label">Search</label>
          {onCollapse && (
            <button type="button" onClick={onCollapse} aria-label="Hide the blueprint list" aria-expanded="true" title="Hide the blueprint list"
              className="fab-btn hidden h-8 items-center gap-1 px-2 text-xs lg:flex">
              <ChevronLeft aria-hidden="true" className="h-4 w-4" /> Hide
            </button>
          )}
        </span>
        <span className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7a7a7a]" />
          <input
            id="bp-search"
            type="search"
            value={q}
            onChange={(e) => { setQ(e.target.value); setLimit(BROWSE_PAGE); }}
            onKeyDown={onKeyDown}
            placeholder="Name, type…"
            autoComplete="off"
            className="fab-input h-11 w-full pl-9 pr-3 text-[15px] outline-none"
          />
        </span>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="fab-label">Type</span>
        <select value={type} onChange={(e) => { setType(e.target.value); setLimit(BROWSE_PAGE); }} className="fab-input h-10 w-full px-2 text-sm outline-none">
          <option value="">All types</option>
          {blueprintTypes().map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
        </select>
      </label>

      <p className="fab-mono text-xs text-[var(--fab-faint)]" aria-live="polite">{list.length} blueprint{list.length === 1 ? '' : 's'}</p>

      <div className="fab-plate fab-scroll flex flex-col lg:max-h-[calc(100vh-17rem)] lg:overflow-y-auto xl:max-h-none xl:min-h-0 xl:flex-1">
        {shown.map((bp) => (
          <div key={bp.uuid} className="fab-row flex items-stretch" aria-current={bp.uuid === selectedUuid ? 'true' : undefined}>
            <button type="button" onClick={() => onPick(bp.uuid)} className="flex min-w-0 flex-1 flex-col gap-1 px-3.5 py-2.5 text-left">
              <span className="flex items-baseline justify-between gap-2">
                <span className="line-clamp-2 text-[15px] font-semibold leading-snug text-[var(--fab-bright)]">{bp.name}</span>
                <span className="fab-mono shrink-0 text-xs text-[var(--fab-faint)]">{fmtSecs(bp.craftTimeSecs)}</span>
              </span>
              <span className="fab-mono line-clamp-2 text-[11.5px] leading-snug text-[var(--fab-muted)]">
                {bp.components.map((c) => `${c.material.name} ${amountOf(c.material)}`).join(' · ')}
              </span>
            </button>
            <button
              type="button"
              onClick={() => buildList.add(bp.uuid)}
              aria-label={`Add ${bp.name} to the build list`}
              title="Add to build list"
              className={cn('w-11 shrink-0 border-l border-[#262626] text-lg', inList.has(bp.uuid) ? 'text-[var(--fab-gold-text)]' : 'text-[var(--fab-faint)] hover:text-[var(--fab-bright)]')}
            >
              +
            </button>
          </div>
        ))}
        {list.length === 0 && <p className="px-4 py-6 text-sm text-[var(--fab-muted)]">No blueprint matches.</p>}
        {list.length > shown.length && (
          <button type="button" onClick={() => setLimit((l) => l + BROWSE_PAGE)} className="fab-btn m-3 h-10 text-sm">
            Show {Math.min(BROWSE_PAGE, list.length - shown.length)} more
          </button>
        )}
      </div>
    </section>
  );
}

// ── Centre: one blueprint ────────────────────────────────────────────────────

function PartRow({ comp, index, ql, onChange }: {
  comp: LocalBlueprint['components'][number];
  index: number;
  ql: number;
  onChange: (v: number) => void;
}) {
  const id = `part-${index}`;
  return (
    <li className="fab-part-row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-3.5 py-3 sm:grid-cols-[9.5rem_minmax(0,1fr)_4.25rem] sm:gap-y-1">
      <span className="flex min-w-0 flex-col gap-0.5 sm:row-span-2 sm:self-start">
        <span className="fab-label !text-[11.5px] !tracking-[0.14em]">{comp.slot} · {String(index + 1).padStart(2, '0')}</span>
        <span className="flex items-baseline gap-2">
          <span className="truncate text-[15px] font-semibold text-[var(--fab-bright)]">{comp.material.name}</span>
          <span className="fab-mono shrink-0 text-xs text-[var(--fab-gold-text)]">{amountOf(comp.material)}</span>
        </span>
        {comp.material.minQuality > 1 && <span className="text-xs text-[var(--fab-muted)]">Needs quality {comp.material.minQuality}+</span>}
      </span>

      {comp.stats.length > 0 ? (
        <>
          <input
            id={id}
            type="range"
            min={0}
            max={1000}
            step={5}
            value={ql}
            aria-label={`${comp.material.name} quality`}
            onChange={(e) => onChange(Number(e.target.value))}
            className="col-span-2 row-start-2 w-full sm:col-span-1 sm:col-start-2 sm:row-start-1"
          />
          <input
            type="number"
            min={0}
            max={1000}
            value={ql}
            aria-label={`${comp.material.name} quality, exact`}
            onChange={(e) => onChange(Math.max(0, Math.min(1000, Math.round(Number(e.target.value) || 0))))}
            className="fab-input fab-mono col-start-2 row-start-1 h-8 w-[4.25rem] px-1.5 text-right text-sm outline-none sm:col-start-3"
          />
          <ul className="col-span-2 flex flex-col gap-0.5 sm:col-start-2 sm:row-start-2 sm:flex-row sm:flex-wrap sm:gap-x-5">
            {comp.stats.map((s) => {
              const pct = (interpolateStat(s, ql) - 1) * 100;
              return (
                <li key={s.key} className="flex items-baseline justify-between gap-2 text-[13px] sm:justify-start">
                  <span className="truncate text-[var(--fab-muted)]">{s.label}</span>
                  <span className={cn('fab-mono shrink-0 font-semibold', pct > 0.005 ? 'text-[#7fc97f]' : pct < -0.005 ? 'text-[#e07a6e]' : 'text-[var(--fab-text)]')}>{fmtPct(pct)}</span>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <span className="col-span-2 text-[13px] text-[var(--fab-muted)] sm:col-span-2 sm:col-start-2 sm:row-start-1">Quality doesn't change anything for this part.</span>
      )}
    </li>
  );
}

function Fold({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-[#0d0d0d] shadow-[0_-1px_0_#2c2c2c]">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 py-3 text-left">
        <span className="fab-label text-[var(--fab-text)]">{title}{count != null ? ` (${count})` : ''}</span>
        <ChevronRight aria-hidden="true" className={cn('h-4 w-4 text-[var(--fab-faint)] transition-transform', open && 'rotate-90')} />
      </button>
      {open && <div className="pb-4">{children}</div>}
    </div>
  );
}

const PLACES_SHOWN = 6;

function ContractCard({ contract, onSelectBlueprint, onDetails }: { contract: MissionContract; onSelectBlueprint: (uuid: string) => void; onDetails: () => void }) {
  const others = contract.pools.flatMap((p) => p.blueprints);
  const [allPlaces, setAllPlaces] = useState(false);
  const places = allPlaces ? contract.locations : contract.locations.slice(0, PLACES_SHOWN);
  return (
    <div className="fab-inset flex flex-col gap-2 px-3.5 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[15px] font-semibold text-[var(--fab-bright)]">{fmtContractTitle(contract.title)}</span>
        <button type="button" onClick={onDetails} className="fab-btn h-8 px-2.5 text-xs">Details</button>
      </div>
      <div className="flex flex-wrap gap-1.5 text-xs">
        {contract.missionType && <span className="border border-[#3a3a3a] px-1.5 py-0.5 text-[var(--fab-muted)]">{contract.missionType}</span>}
        {contract.faction && <span className="border border-[#3a3a3a] px-1.5 py-0.5 text-[var(--fab-gold-text)]">{contract.faction}</span>}
        {contract.illegal && <span className="border border-[#7a3a32] px-1.5 py-0.5 text-[#e07a6e]">Illegal</span>}
        {contract.difficulty && <span className={cn('border px-1.5 py-0.5', diffCls(contract.difficulty.riskOfLoss))}>Risk {contract.difficulty.riskOfLoss}/7</span>}
        {contract.timeToCompleteMinutes != null && <span className="fab-mono border border-[#3a3a3a] px-1.5 py-0.5 text-[var(--fab-muted)]">{fmtMinutes(contract.timeToCompleteMinutes)}</span>}
      </div>
      {contract.locations.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-[var(--fab-muted)]">
          <MapPin aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            {places.join(' · ')}
            {contract.locations.length > PLACES_SHOWN && (
              <button type="button" onClick={() => setAllPlaces((v) => !v)} className="ml-1.5 text-[var(--fab-gold-text)] hover:underline">
                {allPlaces ? 'fewer' : `+${contract.locations.length - PLACES_SHOWN} more`}
              </button>
            )}
          </span>
        </p>
      )}
      {others.length > 1 && (
        <p className="text-xs text-[var(--fab-muted)]">
          Also rewards:{' '}
          {others.slice(0, 6).map((e, i) => (
            <span key={e.blueprintUuid}>
              {i > 0 && ', '}
              {getBlueprintByUuid(e.blueprintUuid)
                ? <button type="button" onClick={() => onSelectBlueprint(e.blueprintUuid)} className="text-[var(--fab-gold-text)] underline-offset-2 hover:underline">{e.name}</button>
                : e.name}
            </span>
          ))}
          {others.length > 6 && ` +${others.length - 6}`}
        </p>
      )}
    </div>
  );
}

function Workspace({ bp, onPick, onBack, wide = false }: { bp: LocalBlueprint; onPick: (uuid: string) => void; onBack: () => void; wide?: boolean }) {
  const [qls, setQls] = useState<number[]>(() => bp.components.map(() => 500));
  const [contractModal, setContractModal] = useState<MissionContract | null>(null);
  const queue = useBuildList();
  const queued = queue.find((i) => i.uuid === bp.uuid)?.qty ?? 0;
  const hasQuality = bp.components.some((c) => c.stats.length > 0);
  const allAt = (v: number) => qls.every((q) => q === v);

  const contracts = useMemo(
    () => missionContracts().filter((mc) => mc.pools.some((p) => p.blueprints.some((e) => e.blueprintUuid === bp.uuid))),
    [bp.uuid],
  );
  // Each stat, with every part that affects it at its chosen quality.
  const statRows = useMemo(() => {
    const keys = new Map<string, string>();
    for (const c of bp.components) for (const s of c.stats) if (!keys.has(s.key)) keys.set(s.key, s.label);
    return [...keys].map(([key, label]) => ({ key, label, mult: combinedMultiplier(bp, key, qls) }));
  }, [bp, qls]);

  return (
    <section aria-label={bp.name} className="fab-plate flex min-w-0 flex-col gap-5 px-5 pb-4 pt-6 sm:px-7">
      <Rivets />
      {contractModal && (
        <div className="fab-legacy">
          <ContractModal contract={contractModal} onClose={() => setContractModal(null)} onSelectBlueprint={(uuid) => { setContractModal(null); onPick(uuid); }} />
        </div>
      )}

      <button type="button" onClick={onBack} className="fab-btn -mt-1 flex h-9 w-fit items-center gap-1 px-2.5 text-xs lg:hidden">
        <ChevronLeft aria-hidden="true" className="h-4 w-4" /> All blueprints
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="fab-label">{[typeLabel(bp.type), bp.subtype && !typeLabel(bp.type).toLowerCase().includes(bp.subtype.toLowerCase()) && bp.subtype, bp.grade && `Grade ${bp.grade}`].filter(Boolean).join(' · ')}</span>
          <h2 className="fab-stencil m-0 text-[26px] leading-tight text-[var(--fab-bright)] sm:text-[30px]">{bp.name.toUpperCase()}</h2>
          <span className="fab-mono text-xs text-[var(--fab-muted)]">
            Craft time {fmtSecs(bp.craftTimeSecs)} · {bp.components.length} part{bp.components.length === 1 ? '' : 's'}
            {contracts.length > 0 && ` · ${contracts.length} mission${contracts.length === 1 ? '' : 's'} reward it`}
          </span>
          {(bp.manufacturer || bp.mass != null) && (
            <span className="text-xs text-[var(--fab-muted)]">{[bp.manufacturer, bp.mass != null && `${bp.mass} kg`].filter(Boolean).join(' · ')}</span>
          )}
        </div>
        <button type="button" onClick={() => buildList.add(bp.uuid)} className="fab-btn-primary h-11 shrink-0 px-4 text-[15px]">
          {queued ? `+ Add another (${queued} in list)` : '+ Add to build list'}
        </button>
      </div>

      {hasQuality && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="fab-label mr-1">Set every part to</span>
          {PRESETS.map(([label, v]) => (
            <button key={label} type="button" aria-pressed={allAt(v)} onClick={() => setQls(bp.components.map(() => v))} className="fab-btn fab-mono h-9 min-w-[3.5rem] px-3 text-xs">
              {v === 1000 ? 'MAX' : v}
            </button>
          ))}
        </div>
      )}

      <div>
        <h3 className="fab-stencil m-0 mb-2.5 text-base text-[var(--fab-gold-text)]">PARTS &amp; MATERIALS</h3>
        <ul className="fab-inset m-0 list-none p-0">
          {bp.components.map((comp, i) => (
            <PartRow key={`${comp.slot}-${i}`} comp={comp} index={i} ql={qls[i] ?? 500} onChange={(v) => setQls((prev) => { const n = [...prev]; n[i] = v; return n; })} />
          ))}
        </ul>
      </div>

      {statRows.length > 0 && (
        <div>
          <h3 className="fab-stencil m-0 mb-1.5 text-base text-[var(--fab-gold-text)]">RESULT</h3>
          <table className="w-full border-collapse text-[15px]">
            <thead>
              <tr className="fab-label text-left">
                <th scope="col" className="border-b-2 border-[#0d0d0d] py-2 font-semibold">Stat</th>
                <th scope="col" className="border-b-2 border-[#0d0d0d] py-2 text-right font-semibold">Multiplier</th>
                <th scope="col" className="border-b-2 border-[#0d0d0d] py-2 text-right font-semibold">Change</th>
              </tr>
            </thead>
            <tbody>
              {statRows.map((r) => {
                const pct = (r.mult - 1) * 100;
                return (
                  <tr key={r.key}>
                    <td className="border-b border-[#262626] py-2.5">{r.label}</td>
                    <td className="fab-mono border-b border-[#262626] py-2.5 text-right text-[var(--fab-muted)]">{fmtMult(r.mult)}</td>
                    <td className={cn('fab-mono border-b border-[#262626] py-2.5 text-right', pct > 0.005 ? 'text-[#7fc97f]' : pct < -0.005 ? 'text-[#e07a6e]' : 'text-[var(--fab-gold-text)]')}>{fmtPct(pct)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="fab-legacy">
        <ProductStats bp={bp} qls={qls} />
      </div>

      <div>
        {contracts.length > 0 && (
          <Fold title="Missions that reward it" count={contracts.length}>
            <div className="flex flex-col gap-2">
              {contracts.map((mc) => <ContractCard key={mc.title} contract={mc} onSelectBlueprint={onPick} onDetails={() => setContractModal(mc)} />)}
            </div>
          </Fold>
        )}
        {bp.dismantle && (
          <Fold title="Dismantle returns">
            <p className="fab-mono mb-2 text-xs text-[var(--fab-muted)]">{fmtSecs(bp.dismantle.timeSecs)} · {(bp.dismantle.efficiency * 100).toFixed(0)}% recovered</p>
            <table className="w-full border-collapse text-sm">
              <tbody>
                {bp.dismantle.returns.map((r, i) => (
                  <tr key={i}>
                    <td className="border-b border-[#262626] py-2">{r.name}</td>
                    <td className="fab-mono border-b border-[#262626] py-2 text-right text-[var(--fab-bright)]">{formatMaterialAmount(r.quantityScu, r.quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Fold>
        )}
      </div>
    </section>
  );
}

function EmptyWorkspace() {
  return (
    <section className="fab-plate flex min-h-[18rem] flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <Rivets />
      <span className="fab-stencil text-xl text-[var(--fab-gold-text)]">SELECT A BLUEPRINT</span>
      <p className="max-w-sm text-sm text-[var(--fab-muted)]">Pick one from the list to set each material's quality and see what you'll get. Use + to add it to your build list.</p>
    </section>
  );
}

// ── Right: the build list ────────────────────────────────────────────────────

const SYSTEM_KEY = 'asop-crafting-system';

function BuildListPanel({ onPick }: { onPick: (uuid: string) => void }) {
  const queue = useBuildList();
  const entries = queue.map((i) => ({ item: i, bp: getBlueprintByUuid(i.uuid) })).filter((e): e is { item: BuildListItem; bp: LocalBlueprint } => !!e.bp);
  const totals = useMemo(() => buildListTotals(entries.map((e) => ({ bp: e.bp, qty: e.item.qty }))), [queue]); // eslint-disable-line react-hooks/exhaustive-deps
  const sources = materialSources();
  const names = totals.materials.map((m) => m.name);
  const systems = useMemo(() => routeSystems(names, sources), [names.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const [picked, setPicked] = useState<string>(() => { try { return localStorage.getItem(SYSTEM_KEY) ?? ''; } catch { return ''; } });
  const system = systems.includes(picked) ? picked : systems[0] ?? '';
  const route = useMemo(() => (system ? planRoute(names, sources, system) : null), [system, names.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickSystem = (s: string) => { setPicked(s); try { localStorage.setItem(SYSTEM_KEY, s); } catch { /* this visit only */ } };
  const count = entries.reduce((a, e) => a + e.item.qty, 0);

  return (
    <aside aria-label="Build list" className="fab-plate flex min-w-0 flex-col">
      <div aria-hidden="true" className="fab-hazard-thin h-1.5" />
      <div className="flex flex-col gap-4 px-5 pb-5 pt-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="fab-stencil m-0 text-[22px] text-[var(--fab-gold-text)]">BUILD LIST</h2>
          <span className="fab-mono text-xs text-[var(--fab-faint)]">{count} ITEM{count === 1 ? '' : 'S'}</span>
        </div>

        {entries.length === 0 ? (
          <p className="text-sm text-[var(--fab-muted)]">Nothing yet. Add blueprints with <span className="text-[var(--fab-gold-text)]">+</span> to total up time and materials, and plan where to mine them.</p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {entries.map(({ item, bp }) => (
                <li key={bp.uuid} className="flex items-center gap-2 border-b border-[#262626] pb-2">
                  <button type="button" onClick={() => onPick(bp.uuid)} className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
                    <span className="line-clamp-2 text-[15px] font-medium leading-snug text-[var(--fab-bright)]">{bp.name}</span>
                    <span className="fab-mono text-xs text-[var(--fab-muted)]">{fmtSecs(bp.craftTimeSecs)} each</span>
                  </button>
                  <button type="button" aria-label={`One fewer ${bp.name}`} onClick={() => buildList.setQty(bp.uuid, item.qty - 1)} className="fab-btn h-9 w-9 text-base">−</button>
                  <span className="fab-mono w-7 text-center text-[var(--fab-bright)]" aria-label={`${item.qty} in the list`}>{item.qty}</span>
                  <button type="button" aria-label={`One more ${bp.name}`} onClick={() => buildList.setQty(bp.uuid, item.qty + 1)} className="fab-btn h-9 w-9 text-base">+</button>
                </li>
              ))}
            </ul>

            <div className="fab-inset flex items-baseline justify-between px-3.5 py-3">
              <span className="fab-label">Total craft time</span>
              <span className="fab-mono whitespace-nowrap text-[22px] font-semibold text-[var(--fab-gold-text)]">{fmtSecs(totals.craftTimeSecs)}</span>
            </div>

            <div className="flex flex-col gap-1">
              <h3 className="fab-label m-0 font-bold">Materials</h3>
              {totals.materials.map((m) => (
                <div key={m.name} className="flex justify-between gap-2 py-1 text-[15px]">
                  <span>{m.name}</span>
                  <span className="fab-mono text-[var(--fab-bright)]">{formatMaterialAmount(m.scu, m.units)}</span>
                </div>
              ))}
            </div>

            {systems.length > 0 && route && (
              <div className="flex flex-col gap-2.5">
                <h3 className="fab-label m-0 font-bold">Where to mine them</h3>
                {systems.length > 1 && (
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="System">
                    {systems.map((s) => (
                      <button key={s} type="button" aria-pressed={s === system} onClick={() => pickSystem(s)} className="fab-btn h-8 px-3 text-xs">{s}</button>
                    ))}
                  </div>
                )}
                <ol className="flex flex-col gap-2.5">
                  {route.stops.map((stop, i) => (
                    <li key={stop.place} className="flex items-start gap-2.5">
                      <span className="fab-stop fab-stencil flex h-[22px] min-w-[22px] items-center justify-center text-[13px]">{i + 1}</span>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-[15px] font-medium text-[var(--fab-bright)]">{stop.place} <span className="text-xs font-normal capitalize text-[var(--fab-faint)]">{stop.kind}</span></span>
                        <span className="text-[13px] text-[var(--fab-muted)]">
                          {stop.materials.map((m) => `${m.name} (${MINING_METHOD_LABELS[m.method]}, ${chanceLabel(m.chance).toLowerCase()})`).join(' · ')}
                        </span>
                      </div>
                    </li>
                  ))}
                </ol>
                {route.missing.length > 0 && (
                  <p className="text-[13px] text-[var(--fab-muted)]">Not mined in {route.system}: {route.missing.join(', ')}. Buy {route.missing.length === 1 ? 'it' : 'them'} or check another system.</p>
                )}
              </div>
            )}

            <button type="button" onClick={() => buildList.clear()} className="fab-btn h-9 self-start px-3 text-xs">Clear list</button>
          </>
        )}
      </div>
    </aside>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────

const LIST_HIDDEN_KEY = 'asop-crafting-list-hidden';

function CraftingWorkbench({ selectedUuid }: { selectedUuid: string | null }) {
  const { guildId } = useParams<{ guildId: string }>();
  const navigate = useNavigate();
  const bp = selectedUuid ? getBlueprintByUuid(selectedUuid) ?? null : null;
  const pick = (uuid: string) => navigate(`/dashboard/servers/${guildId}/crafting-calculator/${uuid}`);
  const back = () => navigate(`/dashboard/servers/${guildId}/crafting-calculator`);
  const src = craftingSource();
  const [listHidden, setListHidden] = useState(() => { try { return localStorage.getItem(LIST_HIDDEN_KEY) === '1'; } catch { return false; } });
  const hideList = (v: boolean) => { setListHidden(v); try { localStorage.setItem(LIST_HIDDEN_KEY, v ? '1' : '0'); } catch { /* this visit only */ } };
  // Only with a blueprint open: with none, the list is all there is to use.
  const collapsed = !!bp && listHidden;

  return (
    <div className="fab -m-6 min-h-[calc(100%+3rem)] pb-10 xl:flex xl:h-[calc(100%+3rem)] xl:flex-col xl:overflow-hidden xl:pb-0">
      <div aria-hidden="true" className="fab-hazard h-2 shrink-0 opacity-85" />
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b-2 border-[#0d0d0d] px-5 pb-4 pt-5 shadow-[0_1px_0_#2c2c2c] sm:px-8">
        <div className="flex items-center gap-4">
          <span aria-hidden="true" className="fab-stencil flex h-11 w-11 items-center justify-center border-2 border-[var(--fab-gold)] text-xl text-[var(--fab-gold-text)]">F</span>
          <div className="flex flex-col gap-0.5">
            <span className="fab-label">Fabrication bay{src.build ? ` · ${src.build}` : ''}</span>
            <h1 className="fab-stencil m-0 text-[26px] text-[var(--fab-gold-text)] sm:text-[32px]">CRAFTING CALCULATOR</h1>
          </div>
        </div>
        <span className="fab-mono border border-[#333] bg-[#121212] px-2.5 py-1.5 text-xs text-[var(--fab-muted)]">
          <span className="font-semibold text-[var(--fab-gold-text)]">{obtainableBlueprints().length}</span> BLUEPRINTS
        </span>
      </header>

      <div className="flex flex-wrap items-start gap-5 px-5 pt-6 sm:px-8 xl:min-h-0 xl:flex-1 xl:flex-nowrap xl:items-stretch xl:pb-6">
        {collapsed ? (
          <button type="button" onClick={() => hideList(false)} aria-label="Show the blueprint list" aria-expanded="false" title="Show the blueprint list"
            className="fab-plate hidden w-11 shrink-0 flex-col items-center gap-3 self-stretch py-4 text-[var(--fab-gold-text)] hover:text-[#f0c35a] lg:flex">
            <ChevronRight aria-hidden="true" className="h-4 w-4" />
            <span className="fab-label text-[var(--fab-gold-text)] [writing-mode:vertical-rl]">Blueprints</span>
          </button>
        ) : (
          <BlueprintBrowser
            selectedUuid={bp?.uuid ?? null}
            onPick={pick}
            onCollapse={bp ? () => hideList(true) : undefined}
            className={cn('flex-[1_1_260px] lg:max-w-[340px] xl:min-h-0', bp && 'hidden lg:flex')}
          />
        )}
        <div className="fab-scroll min-w-0 flex-[999_1_480px] xl:min-h-0 xl:overflow-y-auto xl:pb-1">
          {bp ? <Workspace key={bp.uuid} bp={bp} onPick={pick} onBack={back} wide={collapsed} /> : selectedUuid ? (
            <section className="fab-plate px-6 py-10 text-center text-sm text-[var(--fab-muted)]">
              That blueprint isn't in the current game data. <button type="button" onClick={back} className="text-[var(--fab-gold-text)] underline">Back to all blueprints</button>
            </section>
          ) : <EmptyWorkspace />}
        </div>
        <div className={cn('fab-scroll min-w-0 flex-[1_1_300px] xl:min-h-0 xl:overflow-y-auto xl:pb-1', collapsed ? 'lg:max-w-[340px]' : 'lg:max-w-[380px]')}>
          <BuildListPanel onPick={pick} />
        </div>
      </div>
    </div>
  );
}

export function CraftingCalculatorPage() {
  return <CraftingWorkbench selectedUuid={null} />;
}

export function CraftingCalculatorDetailPage() {
  const { blueprintUuid } = useParams<{ blueprintUuid: string }>();
  return <CraftingWorkbench selectedUuid={blueprintUuid ?? null} />;
}
