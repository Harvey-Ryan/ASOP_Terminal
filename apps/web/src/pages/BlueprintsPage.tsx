import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Search, X, MapPin, Layers, FileText, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  MISSION_CONTRACTS,
  searchBlueprints,
  type LocalBlueprint,
  type MissionContract,
  type MissionDifficulty,
  type MissionStanding,
} from '@/lib/gameData';

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function fmtMinutes(m: number): string {
  if (m < 60) return `~${Math.round(m)}m`;
  const h = Math.floor(m / 60);
  const rem = Math.round(m % 60);
  return rem > 0 ? `~${h}h ${rem}m` : `~${h}h`;
}

function fmtAuec(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1000)}k`;
}

// Community-benchmarked estimate: ~2,500 aUEC/min at risk-3 baseline, ×1.5 per tier.
// Distance to objective is not in our data and will cause variance.
function estimateAuec(time: number | null, riskScore: number): { low: number; high: number } | null {
  if (!time || !riskScore) return null;
  const mid = time * 2500 * Math.pow(1.5, riskScore - 3);
  return { low: mid * 0.8, high: mid * 1.2 };
}

function scopeLabel(scope: string): string {
  switch (scope) {
    case 'FactionReputation':               return 'XP';
    case 'Affinity':                        return 'Affinity';
    case 'BountyHunter_BountyHuntersGuild': return 'BHG';
    case 'ShipCombat_HeadHunters':          return 'Headhunters';
    default: return scope.replace(/_/g, ' ');
  }
}

function diffCls(score: number): string {
  if (score <= 3) return 'text-green-500 border-green-500/30 bg-green-500/10';
  if (score <= 4) return 'text-yellow-500 border-yellow-500/30 bg-yellow-500/10';
  if (score <= 5) return 'text-orange-500 border-orange-500/30 bg-orange-500/10';
  return 'text-red-500 border-red-500/30 bg-red-500/10';
}

function diffTextCls(score: number): string {
  if (score <= 3) return 'text-green-500';
  if (score <= 4) return 'text-yellow-500';
  if (score <= 5) return 'text-orange-500';
  return 'text-red-500';
}

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

// ── Contract card ─────────────────────────────────────────────────────────────

function ContractCard({
  contract,
  onViewRecipe,
}: {
  contract: MissionContract;
  onViewRecipe: (uuid: string) => void;
}) {
  const [expanded,     setExpanded]     = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);

  const multiPool   = contract.pools.length > 1;
  const desc        = contract.description ? fmtDescription(contract.description) : '';
  const totalBps    = contract.pools.flatMap(p => p.blueprints).length;
  const riskScore   = contract.difficulty?.riskOfLoss ?? 0;
  const auecEst     = estimateAuec(contract.timeToCompleteMinutes, riskScore);

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden flex flex-col">

      {/* ── Overview (always visible, click to expand) ── */}
      <button
        onClick={() => setExpanded(o => !o)}
        className="w-full text-left px-4 pt-3 pb-3 hover:bg-accent/30 transition-colors"
      >
        {/* Title row */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-bold leading-snug">{fmtContractTitle(contract.title)}</h3>
          <ChevronDown className={cn(
            'h-4 w-4 shrink-0 text-muted-foreground mt-0.5 transition-transform duration-200',
            expanded && 'rotate-180',
          )} />
        </div>

        {/* Chips */}
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          {contract.missionType && (
            <span className="text-[10px] bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-medium">
              {contract.missionType}
            </span>
          )}
          {contract.missionGiver && (
            <span className="text-[10px] bg-muted text-muted-foreground rounded px-1.5 py-0.5">
              {contract.missionGiver}
            </span>
          )}
          {contract.faction && contract.faction !== contract.missionGiver && (
            <span className="text-[10px] bg-primary/10 text-primary rounded px-1.5 py-0.5 font-mono">
              {contract.faction}
            </span>
          )}
          {contract.illegal && (
            <span className="text-[10px] bg-red-500/10 text-red-500 border border-red-500/20 rounded px-1.5 py-0.5 font-semibold">
              Illegal
            </span>
          )}
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-2 mt-2.5 flex-wrap">
          {contract.timeToCompleteMinutes != null && (
            <span className="text-[11px] font-mono text-muted-foreground">
              ⏱ {fmtMinutes(contract.timeToCompleteMinutes)}
            </span>
          )}
          {riskScore > 0 && (
            <span className={cn('text-[11px] font-semibold border rounded px-1.5 py-0.5', diffCls(riskScore))}>
              Risk {riskScore}/7
            </span>
          )}
          {contract.locations.length > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <MapPin className="h-3 w-3" />
              {contract.locations.length} location{contract.locations.length !== 1 ? 's' : ''}
            </span>
          )}
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Layers className="h-3 w-3" />
            {totalBps} blueprint{totalBps !== 1 ? 's' : ''}
          </span>
          {auecEst && (
            <span className="text-[11px] font-semibold ml-auto text-blue-400">
              ~{fmtAuec(auecEst.low)}–{fmtAuec(auecEst.high)} aUEC
              <span className="text-[9px] text-muted-foreground font-normal ml-0.5">est.</span>
            </span>
          )}
        </div>
      </button>

      {/* ── Expanded detail ── */}
      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-3">

          {/* Difficulty grid */}
          <DifficultyBlock
            diff={contract.difficulty}
            time={contract.timeToCompleteMinutes}
            standing={contract.minStanding}
            illegal={contract.illegal}
          />

          {/* aUEC + Rep */}
          <div className="text-xs text-muted-foreground bg-muted/30 rounded px-3 py-1.5 space-y-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-foreground">aUEC:</span>
              {auecEst
                ? <><span className="font-semibold text-blue-400">~{fmtAuec(auecEst.low)}–{fmtAuec(auecEst.high)}</span> <span className="opacity-60">(est. · varies with distance)</span></>
                : 'Calculated (scales with difficulty & distance)'
              }
            </div>
            {contract.reputation.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-semibold text-foreground">Rep XP:</span>
                {contract.reputation.map((r, i) => (
                  <span key={i}>
                    <span className="font-semibold text-blue-400">+{r.xp.toLocaleString()} {scopeLabel(r.scope)}</span>
                    <span className="opacity-60 ml-0.5">({r.faction})</span>
                    {i < contract.reputation.length - 1 && <span className="opacity-40 mx-1">·</span>}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Locations */}
          {contract.locations.length > 0 && (
            <div className="flex items-start gap-2">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
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
          {desc && (
            <div className="space-y-1">
              <button
                onClick={e => { e.stopPropagation(); setDescExpanded(o => !o); }}
                className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
              >
                <FileText className="h-3.5 w-3.5" />
                Description
                <span className="text-[9px]">{descExpanded ? '▲' : '▼'}</span>
              </button>
              {descExpanded && (
                <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap rounded border border-border/50 bg-muted/20 px-3 py-2 max-h-36 overflow-y-auto">
                  {desc}
                </p>
              )}
            </div>
          )}

          {/* Blueprint pools */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Blueprints</span>
            </div>
            {contract.pools.map((pool, pi) => (
              <div key={pi} className="rounded border border-border overflow-hidden">
                {multiPool && (
                  <div className="px-3 py-1.5 bg-muted/30 border-b border-border/60 flex items-center gap-2">
                    <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="text-[11px] text-muted-foreground">
                      {pool.locations.length > 0
                        ? pool.locations.slice(0, 5).join(', ') +
                          (pool.locations.length > 5 ? ` +${pool.locations.length - 5} more` : '')
                        : 'Default (all locations)'}
                    </span>
                  </div>
                )}
                <div className="divide-y divide-border/40">
                  {pool.blueprints.map(bp => (
                    <div key={bp.blueprintUuid} className="flex items-center justify-between px-3 py-2">
                      <span className="text-xs text-foreground">{bp.name}</span>
                      <button
                        onClick={() => onViewRecipe(bp.blueprintUuid)}
                        className="text-[11px] text-primary hover:underline shrink-0 ml-3"
                      >
                        View recipe →
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function BlueprintsPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const navigate    = useNavigate();

  const [inputValue,   setInputValue]   = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [submittedBp,  setSubmittedBp]  = useState<LocalBlueprint | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(
    () => (inputValue.length > 1 ? searchBlueprints(inputValue).slice(0, 10) : []),
    [inputValue],
  );

  const contracts = useMemo(
    () =>
      submittedBp
        ? MISSION_CONTRACTS.filter(mc =>
            mc.pools.some(pool =>
              pool.blueprints.some(e => e.blueprintUuid === submittedBp.uuid),
            ),
          )
        : [],
    [submittedBp],
  );

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  function selectBlueprint(bp: LocalBlueprint) {
    setInputValue(bp.name);
    setSubmittedBp(bp);
    setDropdownOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && suggestions.length > 0) {
      e.preventDefault();
      selectBlueprint(suggestions[0]);
    }
    if (e.key === 'Escape') setDropdownOpen(false);
  }

  function handleClear() {
    setInputValue('');
    setSubmittedBp(null);
    setDropdownOpen(false);
  }

  return (
    <div className="flex flex-col h-full -m-6 overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="px-6 pt-6 pb-4 border-b border-border shrink-0 bg-background space-y-4">
        <h3 className="text-lg font-bold tracking-tight">Blueprint Search</h3>

        <div ref={wrapperRef} className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none z-10" />
          <input
            value={inputValue}
            onChange={e => {
              setInputValue(e.target.value);
              setDropdownOpen(true);
              if (submittedBp && e.target.value !== submittedBp.name) setSubmittedBp(null);
            }}
            onFocus={() => { if (inputValue.length > 1) setDropdownOpen(true); }}
            onKeyDown={handleKeyDown}
            placeholder="Search blueprints…"
            autoComplete="off"
            className="w-full pl-9 pr-4 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {inputValue && (
            <button
              onClick={handleClear}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground z-10"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}

          {dropdownOpen && suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-md border border-border bg-popover shadow-lg overflow-hidden">
              {suggestions.map(bp => (
                <button
                  key={bp.uuid}
                  onMouseDown={e => { e.preventDefault(); selectBlueprint(bp); }}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 text-left bg-background hover:bg-accent transition-colors',
                    'border-b border-border/40 last:border-0',
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{bp.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-muted-foreground font-mono">{bp.type}</span>
                      {bp.subtype && (
                        <span className="text-xs text-muted-foreground capitalize">{bp.subtype}</span>
                      )}
                    </div>
                  </div>
                  {bp.grade && (
                    <span className="text-xs text-muted-foreground shrink-0">G{bp.grade}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Results ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {!submittedBp ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 gap-3">
            <Search className="h-8 w-8 text-muted-foreground/25" />
            <p className="text-sm text-muted-foreground">
              Search for a blueprint above to see its contracts.
            </p>
          </div>
        ) : contracts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 gap-2">
            <p className="text-sm text-muted-foreground">
              No contracts found for{' '}
              <strong className="text-foreground">{submittedBp.name}</strong>.
            </p>
          </div>
        ) : (
          <div className="p-6 space-y-4">
            <p className="text-xs text-muted-foreground">
              {contracts.length} contract{contracts.length !== 1 ? 's' : ''} for{' '}
              <strong className="text-foreground">{submittedBp.name}</strong>
              <span className="ml-2 opacity-50">· aUEC estimates based on community-measured rates; vary with distance</span>
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {contracts.map(mc => (
                <ContractCard
                  key={mc.title}
                  contract={mc}
                  onViewRecipe={uuid =>
                    navigate(`/dashboard/servers/${guildId}/crafting-calculator/${uuid}`)
                  }
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
