import { useState, useMemo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Search, X, ChevronLeft, ChevronRight, Clock, Wrench, Info, Layers, MapPin, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  OBTAINABLE_BLUEPRINTS,
  BLUEPRINT_TYPES,
  MISSION_CONTRACTS,
  searchBlueprints,
  getBlueprintByUuid,
  getBaseStats,
  interpolateStat,
  combinedMultiplier,
  type LocalBlueprint,
  type MissionContract,
  type ItemBaseStats,
} from '@/lib/gameData';


// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtSecs(s: number) {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
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

function fmtMission(raw: string): string {
  const inner = raw.replace(/^~mission\([^|]*\|/, '').replace(/\)$/, '');
  return inner
    .replace(/([A-Z])/g, ' $1')
    .replace(/^\s/, '')
    .replace(/Title/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
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

          {/* Reward note */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded px-3 py-2">
            <span className="font-semibold text-foreground">aUEC:</span> Calculated (scales with difficulty &amp; distance)
            <span className="mx-1 opacity-30">·</span>
            <span className="font-semibold text-foreground">Rep:</span> No data available
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
    return <p className="text-xs text-muted-foreground/60 italic">No fire mode data available in local dataset.</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Weapon</p>
      <div className="rounded border border-border overflow-hidden">
        <table className="w-full text-xs">
          <tbody>
            {base.modes.map(mode => (
              <>
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
              </>
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
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Product Stats</p>
      <div className="rounded-md border border-border bg-muted/20 px-4 py-3 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          {bp.manufacturer && (
            <span className="text-xs font-mono bg-primary/10 text-primary px-2 py-0.5 rounded">
              {bp.manufacturer}
            </span>
          )}
          {bp.mass != null && <span className="text-xs text-muted-foreground">{bp.mass} kg</span>}
          {bp.subtype    && <span className="text-xs text-muted-foreground capitalize">{bp.subtype}</span>}
        </div>

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

// ── Per-slot component card ───────────────────────────────────────────────────

function ComponentCard({
  comp,
  ql,
  onChange,
}: {
  comp: LocalBlueprint['components'][number];
  ql: number;
  onChange: (v: number) => void;
}) {
  const activeStats = comp.stats;

  return (
    <div className="rounded-md border border-border bg-card p-3 space-y-3">
      <p className="text-sm font-semibold text-primary">{comp.slot}</p>

      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5">
          <span>⛏</span>
          <span className="font-medium text-foreground">{comp.material.name}</span>
        </div>
        <span className="text-muted-foreground tabular-nums">
          {comp.material.quantityScu != null
            ? `${comp.material.quantityScu} SCU`
            : comp.material.quantity != null
              ? `×${comp.material.quantity}`
              : '—'}
          {comp.material.minQuality > 0 && (
            <span className="ml-1 opacity-60">(min {comp.material.minQuality})</span>
          )}
        </span>
      </div>

      {activeStats.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Quality</span>
            <input
              type="number"
              min={0}
              max={1000}
              value={ql}
              onChange={e => onChange(Math.max(0, Math.min(1000, Number(e.target.value) || 0)))}
              className={cn(
                'w-14 text-right font-mono text-xs font-bold bg-transparent focus:outline-none',
                ql > 500 ? 'text-green-500 border-b border-green-500/40 focus:border-green-500'
                : ql < 500 ? 'text-red-500 border-b border-red-500/40 focus:border-red-500'
                : 'text-foreground border-b border-border focus:border-foreground',
              )}
            />
          </div>
          <input
            type="range"
            min={0}
            max={1000}
            step={5}
            value={ql}
            onChange={e => onChange(Number(e.target.value))}
            className={cn(
              'w-full h-1.5',
              ql > 500 ? 'accent-green-500' : ql < 500 ? 'accent-red-500' : 'accent-foreground',
            )}
          />
        </div>
      )}

      {activeStats.map(s => {
        const mult   = interpolateStat(s, ql);
        const pctChg = (mult - 1) * 100;
        return (
          <div key={s.key} className="space-y-0.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{s.label}</span>
              <span className={cn(
                'font-mono font-semibold',
                ql > 500 ? 'text-green-500' : ql < 500 ? 'text-red-500' : 'text-foreground',
              )}>
                {fmtMult(mult)} {fmtPct(pctChg)}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground/50">
              Q: {s.qualityMin}–{s.qualityMax} · ×{s.multiplierAtMin.toFixed(2)}–{s.multiplierAtMax.toFixed(2)} · Base 500
            </p>
          </div>
        );
      })}

      {comp.material.kind === 'item' && (
        <div className="flex items-center gap-1.5 text-[10px] text-amber-500/80 border border-amber-500/20 rounded px-2 py-1">
          <Info className="h-3 w-3 shrink-0" />
          Crafted component — sub-recipe pending
        </div>
      )}
    </div>
  );
}

// ── Disassemble view ──────────────────────────────────────────────────────────

function DisassembleView({ bp }: { bp: LocalBlueprint }) {
  if (!bp.dismantle) {
    return <p className="text-sm text-muted-foreground italic">No disassemble data available.</p>;
  }
  const d = bp.dismantle;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 text-sm rounded-md border border-border px-4 py-2.5 bg-muted/20">
        <Wrench className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-muted-foreground">Time</span>
        <span className="font-semibold">{fmtSecs(d.timeSecs)}</span>
        <span className="text-green-500 font-semibold ml-auto">{(d.efficiency * 100).toFixed(0)}% recovery</span>
      </div>

      {d.returns.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Returns</p>
          <div className="rounded-md border border-border overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {d.returns.map((r, i) => (
                  <tr key={i} className="border-b border-border/40 last:border-0">
                    <td className="px-3 py-2 font-medium">{r.name}</td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                      {r.quantityScu != null ? `${r.quantityScu} SCU` : r.quantity != null ? `×${r.quantity}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Blueprint detail panel ────────────────────────────────────────────────────

const PRESET_FREE = -1;
const PRESETS: [string, number][] = [['Min', 0], ['Base', 500], ['Max', 1000]];

function BlueprintDetail({ bp, onClose }: { bp: LocalBlueprint; onClose: () => void }) {
  const { guildId } = useParams<{ guildId: string }>();
  const navigate    = useNavigate();
  const [tab,    setTab]    = useState<'craft' | 'disassemble'>('craft');
  const [qls,    setQls]    = useState<number[]>(() => bp.components.map(() => 500));
  const [preset, setPreset] = useState<number>(500);
  const [contractModal, setContractModal] = useState<MissionContract | null>(null);

  function applyPreset(v: number) {
    setPreset(v);
    setQls(bp.components.map(() => v));
  }

  function setSlot(i: number, v: number) {
    setQls(prev => { const n = [...prev]; n[i] = v; return n; });
    setPreset(PRESET_FREE);
  }

  const relevantContracts = useMemo(
    () => MISSION_CONTRACTS.filter(mc =>
      mc.pools.some(pool => pool.blueprints.some(entry => entry.blueprintUuid === bp.uuid))
    ),
    [bp.uuid],
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-card">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="shrink-0 flex items-center gap-1 px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors rounded-md"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold leading-tight">{bp.name}</h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {bp.manufacturer && (
                <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded font-mono">
                  {bp.manufacturer}
                </span>
              )}
              {bp.subtype && <span className="text-xs text-muted-foreground capitalize">{bp.subtype}</span>}
              {bp.grade   && <span className="text-xs text-muted-foreground">Grade {bp.grade}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Contracts */}
      {relevantContracts.length > 0 && (
        <div className="px-5 py-2.5 border-b border-border shrink-0 bg-muted/10 flex items-start gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground shrink-0 pt-0.5">
            Contracts
          </span>
          <div className="flex flex-wrap gap-1.5">
            {relevantContracts.map(mc => (
              <button
                key={mc.title}
                onClick={() => setContractModal(mc)}
                className="shrink-0 px-2 py-0.5 text-[11px] rounded border border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground hover:border-primary/40 transition-colors whitespace-nowrap"
              >
                {fmtContractTitle(mc.title)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Contract modal */}
      {contractModal && (
        <ContractModal
          contract={contractModal}
          onClose={() => setContractModal(null)}
          onSelectBlueprint={uuid => {
            setContractModal(null);
            navigate(`/dashboard/servers/${guildId}/crafting-calculator/${uuid}`);
          }}
        />
      )}

      {/* Tabs */}
      <div className="px-5 py-3 border-b border-border shrink-0 flex items-center gap-2">
        <button
          onClick={() => setTab('craft')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors',
            tab === 'craft'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent',
          )}
        >
          <Layers className="h-3.5 w-3.5" /> Craft
        </button>
        {bp.dismantle && (
          <button
            onClick={() => setTab('disassemble')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors',
              tab === 'disassemble'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent',
            )}
          >
            <Wrench className="h-3.5 w-3.5" /> Disassemble
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {tab === 'disassemble' ? (
          <DisassembleView bp={bp} />
        ) : (
          <>
            <ProductStats bp={bp} qls={qls} />

            {/* Quality presets */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground shrink-0">
                Presets
              </span>
              {PRESETS.map(([label, v]) => (
                <button
                  key={label}
                  onClick={() => applyPreset(v)}
                  className={cn(
                    'px-2.5 py-1 text-xs rounded font-medium transition-colors',
                    preset === v
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Component cards */}
            <div className="grid grid-cols-2 gap-3">
              {bp.components.map((comp, i) => (
                <ComponentCard
                  key={`${comp.slot}-${i}`}
                  comp={comp}
                  ql={qls[i] ?? 500}
                  onChange={v => setSlot(i, v)}
                />
              ))}
            </div>

            {/* Craft time */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground border-t border-border pt-3">
              <Clock className="h-4 w-4 shrink-0" />
              Craft time: <strong className="text-foreground">{fmtSecs(bp.craftTimeSecs)}</strong>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Blueprint list row ────────────────────────────────────────────────────────

function BlueprintRow({
  bp,
  selected,
  onClick,
}: {
  bp: LocalBlueprint;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-3 text-left border-b border-border/50 last:border-0 transition-colors',
        selected
          ? 'bg-primary/10 border-l-2 border-l-primary'
          : 'hover:bg-accent/40 border-l-2 border-l-transparent',
      )}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{bp.name}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-xs font-mono text-muted-foreground">{bp.type}</span>
          {bp.subtype && <span className="text-xs text-muted-foreground capitalize">{bp.subtype}</span>}
          {bp.grade   && <span className="text-xs text-muted-foreground">G{bp.grade}</span>}
        </div>
      </div>
      <div className="shrink-0 flex items-center gap-2 text-xs text-muted-foreground">
        <Clock className="h-3 w-3" />
        <span className="tabular-nums">{fmtSecs(bp.craftTimeSecs)}</span>
        <ChevronRight className={cn('h-4 w-4', selected && 'text-primary')} />
      </div>
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function CraftingCalculatorPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const navigate = useNavigate();
  const [search,     setSearch]     = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const results = useMemo(
    () => searchBlueprints(search, typeFilter || undefined).slice(0, 100),
    [search, typeFilter],
  );

  return (
    <div className="flex flex-col h-full -m-6 overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="px-6 pt-6 pb-4 border-b border-border shrink-0 bg-background space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Crafting Calculator</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Browse blueprints, inspect recipes, and calculate quality-scaled stat outputs.
          </p>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search blueprints…"
              className="w-full pl-9 pr-4 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="w-44 px-3 py-2 text-sm rounded-md border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All types</option>
            {BLUEPRINT_TYPES.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <p className="text-xs text-muted-foreground">
          {results.length} blueprint{results.length !== 1 ? 's' : ''}
          {results.length === 100 ? ' (showing first 100)' : ''}{' '}
          of {OBTAINABLE_BLUEPRINTS.length} total
        </p>
      </div>

      {/* ── List ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {results.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center px-6">
            <p className="text-muted-foreground text-sm">No blueprints found.</p>
            {(search || typeFilter) && (
              <Button variant="link" size="sm" className="mt-2"
                onClick={() => { setSearch(''); setTypeFilter(''); }}>
                Clear filters
              </Button>
            )}
          </div>
        ) : (
          results.map(bp => (
            <BlueprintRow
              key={bp.uuid}
              bp={bp}
              selected={false}
              onClick={() => navigate(`/dashboard/servers/${guildId}/crafting-calculator/${bp.uuid}`)}
            />
          ))
        )}
      </div>

    </div>
  );
}

// ── Blueprint detail page ─────────────────────────────────────────────────────

export function CraftingCalculatorDetailPage() {
  const { blueprintUuid, guildId } = useParams<{ blueprintUuid: string; guildId: string }>();
  const navigate = useNavigate();

  const bp = blueprintUuid ? getBlueprintByUuid(blueprintUuid) : undefined;
  const handleBack = () => navigate(`/dashboard/servers/${guildId}/crafting-calculator`);

  if (!bp) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center gap-4">
        <p className="text-muted-foreground text-sm">Blueprint not found.</p>
        <Button variant="outline" size="sm" onClick={handleBack}>
          <ChevronLeft className="h-4 w-4 mr-1" />
          Back to Blueprints
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full -m-6 overflow-hidden">
      <BlueprintDetail bp={bp} onClose={handleBack} />
    </div>
  );
}
