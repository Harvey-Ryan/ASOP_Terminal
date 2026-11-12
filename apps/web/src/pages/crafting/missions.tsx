// Missions that reward blueprints (v1.27.0), shared by the Blueprints page and
// the Crafting Calculator, in the "fabrication bay" look (.fab scope).
// Rewards are what the game files say: items and reputation. aUEC payouts
// aren't in the files (the game works them out when you accept a contract),
// so none are shown or estimated.
import { useEffect, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getBlueprintByUuid, type MissionContract } from '@/lib/gameData';

/** Placeholders the game fills in when it offers the mission, as words. */
const PLACEHOLDER_WORDS: Record<string, string> = {
  Location: 'location', Address: 'location', NearbyLocation: 'nearby location',
  TargetName: 'target', Ship: 'ship', RecoverItemTitle: 'Recover an item',
};
function placeholder(inner: string): string {
  const parts = inner.split('|');
  for (const p of [...parts].reverse()) if (PLACEHOLDER_WORDS[p]) return PLACEHOLDER_WORDS[p]!;
  return parts[0]!.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

/** "[Location|Address] needs help" → "‹location› needs help"; a title that is only a placeholder becomes its words. */
export function fmtContractTitle(raw: string): string {
  const t = raw.replace(/~mission\(([^)]+)\)/g, '[$1]').trim();
  const whole = /^\[([^\]]+)\]$/.exec(t);
  if (whole) { const w = placeholder(whole[1]!); return w.charAt(0).toUpperCase() + w.slice(1); }
  return t.replace(/\[([^\]]+)\]/g, (_, inner: string) => `‹${placeholder(inner)}›`).replace(/\s{2,}/g, ' ');
}

export function fmtDescription(raw: string): string {
  return raw
    .replace(/<EM4>(.*?)<\/EM4>/g, '$1')
    .replace(/~mission\([^|)]+\|([^)]+)\)/g, (_, inner: string) => inner.replace(/([A-Z])/g, ' $1').trim())
    .replace(/~mission\(([^)]+)\)/g, '[…]')
    .trim();
}

export function fmtMinutes(m: number): string {
  if (m < 60) return `~${Math.round(m)} min`;
  const h = Math.floor(m / 60);
  const rem = Math.round(m % 60);
  return rem > 0 ? `~${h} h ${rem} min` : `~${h} h`;
}

/** Text colour for a 1–7 difficulty score. */
export function diffText(score: number): string {
  if (score <= 3) return 'text-[#7fc97f]';
  if (score <= 4) return 'text-[#e0b54a]';
  if (score <= 5) return 'text-[#e0924a]';
  return 'text-[#e07a6e]';
}
export function diffCls(score: number): string {
  if (score <= 3) return 'border-[#3f6b3f] text-[#7fc97f]';
  if (score <= 4) return 'border-[#6e520a] text-[#e0b54a]';
  if (score <= 5) return 'border-[#7a4f22] text-[#e0924a]';
  return 'border-[#7a3a32] text-[#e07a6e]';
}

const sameName = (a: string | null, b: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

function reputationWord(scope: string): string {
  switch (scope) {
    case 'FactionReputation': return 'reputation';
    case 'Affinity': return 'affinity';
    case 'BountyHunter_BountyHuntersGuild': return 'Bounty Hunters Guild rep';
    case 'ShipCombat_HeadHunters': return 'Headhunters rep';
    default: return scope.replace(/_/g, ' ').toLowerCase();
  }
}

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('border border-[#3a3a3a] px-1.5 py-0.5 text-xs text-[var(--fab-muted)]', className)}>{children}</span>;
}

/** Type, who gives it, and what kind of contract it is. */
export function MissionChips({ contract }: { contract: MissionContract }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {contract.missionType && <Chip>{contract.missionType}</Chip>}
      {contract.missionGiver && <Chip className="text-[var(--fab-gold-text)]">{contract.missionGiver}</Chip>}
      {contract.faction && !sameName(contract.faction, contract.missionGiver) && <Chip className="text-[var(--fab-gold-text)]">{contract.faction}</Chip>}
      {contract.illegal && <Chip className="border-[#7a3a32] text-[#e07a6e]">Illegal</Chip>}
      {contract.shareable && <Chip>Shareable</Chip>}
      {contract.onceOnly && <Chip>Once only</Chip>}
    </div>
  );
}

/** One line: time, risk, enemies. */
export function MissionStats({ contract }: { contract: MissionContract }) {
  const risk = contract.difficulty?.riskOfLoss ?? 0;
  const e = contract.enemies;
  return (
    <p className="fab-mono flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--fab-muted)]">
      {contract.timeToCompleteMinutes != null && <span>{fmtMinutes(contract.timeToCompleteMinutes)}</span>}
      {risk > 0 && <span className={diffText(risk)}>Risk {risk}/7</span>}
      {e && <span>{e.min === e.max ? e.max : `${e.min}–${e.max}`} {e.max === 1 ? 'enemy' : 'enemies'}</span>}
    </p>
  );
}

const PLACES_SHOWN = 6;

function Places({ places }: { places: string[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? places : places.slice(0, PLACES_SHOWN);
  return (
    <p className="text-sm leading-relaxed text-[var(--fab-text)]">
      {shown.join(' · ')}
      {places.length > PLACES_SHOWN && (
        <button type="button" onClick={() => setAll((v) => !v)} className="ml-2 text-[var(--fab-gold-text)] hover:underline">
          {all ? 'fewer' : `+${places.length - PLACES_SHOWN} more`}
        </button>
      )}
    </p>
  );
}

function SubHead({ children }: { children: React.ReactNode }) {
  return <h4 className="fab-label m-0 mb-1.5 !text-[12px]">{children}</h4>;
}

/** Everything about one mission: rewards, difficulty, places, its blueprints. */
export function MissionDetails({ contract, currentUuid, onSelectBlueprint, onOpenCalculator }: {
  contract: MissionContract;
  /** The blueprint being looked at, marked in the list */
  currentUuid?: string | null;
  onSelectBlueprint: (uuid: string) => void;
  /** When given, each blueprint also links to the calculator */
  onOpenCalculator?: (uuid: string) => void;
}) {
  const [descOpen, setDescOpen] = useState(false);
  const d = contract.difficulty;
  const dims = d ? [
    { label: 'Risk', score: d.riskOfLoss, words: d.riskOfLossLabel },
    { label: 'Focus', score: d.mentalLoad, words: d.mentalLoadLabel },
    { label: 'Combat', score: d.mechanicalSkill, words: d.mechanicalSkillLabel },
    { label: 'Know-how', score: d.gameKnowledge, words: d.gameKnowledgeLabel },
  ].filter((x) => x.score > 0) : [];
  const desc = contract.description ? fmtDescription(contract.description) : '';
  const multiPool = contract.pools.length > 1;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <SubHead>Rewards</SubHead>
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
          {contract.rewardItems.map((r) => (
            <li key={r.name}><span className="fab-mono text-[var(--fab-gold-text)]">{r.amount.toLocaleString()} ×</span> {r.name}</li>
          ))}
          {contract.reputation.map((r, i) => (
            <li key={`rep-${i}`}><span className="fab-mono text-[var(--fab-gold-text)]">+{r.xp.toLocaleString()}</span> {reputationWord(r.scope)} with {r.faction}</li>
          ))}
          <li className="text-xs text-[var(--fab-faint)]">Plus aUEC, which the game sets when you accept the contract.</li>
        </ul>
        {contract.minStanding && contract.minStanding.minReputation > 0 && (
          <p className="mt-2 text-xs text-[var(--fab-muted)]">Needs the rank <span className="text-[var(--fab-bright)]">{contract.minStanding.name}</span> ({contract.minStanding.minReputation.toLocaleString()}+ reputation).</p>
        )}
      </div>

      {dims.length > 0 && (
        <div>
          <SubHead>Difficulty{d?.profile ? ` · ${d.profile}` : ''}</SubHead>
          <ul className="m-0 grid list-none grid-cols-1 gap-x-5 gap-y-2 p-0 sm:grid-cols-2">
            {dims.map((x) => (
              <li key={x.label} className="flex flex-col gap-1">
                <span className="flex items-baseline justify-between gap-2 text-[13px]">
                  <span className="text-[var(--fab-muted)]">{x.label}</span>
                  <span className={cn('fab-mono font-semibold', diffText(x.score))}>{x.score}/7</span>
                </span>
                <span aria-hidden="true" className="flex gap-0.5">
                  {Array.from({ length: 7 }, (_, i) => (
                    <span key={i} className={cn('h-1.5 flex-1', i < x.score ? 'bg-current' : 'bg-[#2a2a2a]', diffText(x.score))} />
                  ))}
                </span>
                {x.words && <span className="text-xs text-[var(--fab-text)]">{x.words}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {contract.locations.length > 0 && (
        <div>
          <SubHead>Where</SubHead>
          <Places places={contract.locations} />
        </div>
      )}

      <div>
        <SubHead>Blueprints it can give</SubHead>
        <div className="flex flex-col gap-2">
          {contract.pools.map((pool, pi) => (
            <div key={pi} className="fab-inset">
              {multiPool && (
                <p className="m-0 border-b border-[#262626] px-3 py-1.5 text-xs text-[var(--fab-muted)]">
                  {pool.locations.length ? `At ${pool.locations.slice(0, 4).join(', ')}${pool.locations.length > 4 ? ` +${pool.locations.length - 4} more` : ''}` : 'Anywhere'}
                </p>
              )}
              <ul className="m-0 list-none p-0">
                {pool.blueprints.map((e) => {
                  const known = !!getBlueprintByUuid(e.blueprintUuid);
                  const here = e.blueprintUuid === currentUuid;
                  return (
                    <li key={e.blueprintUuid} className={cn('flex items-center justify-between gap-3 border-b border-[#1f1f1f] px-3 py-2 last:border-0 text-sm', here && 'bg-[rgba(185,138,19,0.12)]')}>
                      {known && !here
                        ? <button type="button" onClick={() => onSelectBlueprint(e.blueprintUuid)} className="text-left text-[var(--fab-bright)] hover:text-[var(--fab-gold-text)] hover:underline">{e.name}</button>
                        : <span className={here ? 'font-semibold text-[var(--fab-gold-text)]' : 'text-[var(--fab-muted)]'}>{e.name}</span>}
                      {known && onOpenCalculator && (
                        <button type="button" onClick={() => onOpenCalculator(e.blueprintUuid)} className="shrink-0 text-xs text-[var(--fab-gold-text)] hover:underline">Calculator →</button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {desc && (
        <div>
          <button type="button" aria-expanded={descOpen} onClick={() => setDescOpen((v) => !v)} className="fab-label flex items-center gap-1 !text-[12px] hover:text-[var(--fab-bright)]">
            Briefing <ChevronDown aria-hidden="true" className={cn('h-3.5 w-3.5 transition-transform', descOpen && 'rotate-180')} />
          </button>
          {descOpen && <p className="fab-inset mt-1.5 whitespace-pre-wrap px-3 py-2.5 text-sm leading-relaxed text-[var(--fab-text)]">{desc}</p>}
        </div>
      )}
    </div>
  );
}

/** A mission in a list: the summary, opening to the details. */
export function MissionCard({ contract, defaultOpen = false, ...rest }: React.ComponentProps<typeof MissionDetails> & { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <article className="fab-plate flex flex-col">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex flex-col gap-2 px-4 py-3.5 text-left hover:bg-[rgba(255,255,255,0.02)]">
        <span className="flex items-start justify-between gap-3">
          <span className="text-base font-semibold leading-snug text-[var(--fab-bright)]">{fmtContractTitle(contract.title)}</span>
          <ChevronDown aria-hidden="true" className={cn('mt-0.5 h-4 w-4 shrink-0 text-[var(--fab-faint)] transition-transform', open && 'rotate-180')} />
        </span>
        <MissionChips contract={contract} />
        <MissionStats contract={contract} />
      </button>
      {open && (
        <div className="border-t border-[#0d0d0d] px-4 pb-4 pt-3.5 shadow-[inset_0_1px_0_#2c2c2c]">
          <MissionDetails contract={contract} {...rest} />
        </div>
      )}
    </article>
  );
}

/** A mission's details over the page (the calculator's "Details"). */
export function MissionModal({ contract, onClose, ...rest }: Omit<React.ComponentProps<typeof MissionDetails>, 'contract'> & { contract: MissionContract; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={fmtContractTitle(contract.title)} onClick={(e) => e.stopPropagation()}
        className="fab-plate fab-scroll flex max-h-[85vh] w-full max-w-2xl flex-col overflow-y-auto">
        <div className="flex items-start justify-between gap-3 border-b border-[#0d0d0d] px-5 py-4 shadow-[0_1px_0_#2c2c2c]">
          <div className="flex min-w-0 flex-col gap-2">
            <h2 className="m-0 text-lg font-semibold leading-snug text-[var(--fab-bright)]">{fmtContractTitle(contract.title)}</h2>
            <MissionChips contract={contract} />
            <MissionStats contract={contract} />
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="fab-btn flex h-9 w-9 shrink-0 items-center justify-center"><X aria-hidden="true" className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-4"><MissionDetails contract={contract} {...rest} /></div>
      </div>
    </div>
  );
}
