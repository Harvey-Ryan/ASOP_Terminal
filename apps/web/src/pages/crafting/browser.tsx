// The blueprint list shared by the Crafting Calculator and the Blueprints page
// (v1.27.0), in the "fabrication bay" look (.fab scope).
import { useMemo, useState } from 'react';
import { Search, ChevronLeft } from 'lucide-react';
import { formatMaterialAmount } from '@dem/shared';
import { cn } from '@/lib/utils';
import { blueprintTypes, searchBlueprints, type LocalBlueprint } from '@/lib/gameData';
import { buildList, useBuildList } from '@/lib/buildList';

export const amountOf = (m: LocalBlueprint['components'][number]['material']) => formatMaterialAmount(m.quantityScu, m.quantity);
const BROWSE_PAGE = 60;

export function fmtSecs(s: number) {
  if (s < 60) return `${s}s`;
  if (s < 3600) return s % 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 60)}m`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}


/** "Char_Armor_Arms" → "Armor arms", "WeaponPersonal" → "Weapon personal" */
export function typeLabel(t: string): string {
  const s = t.replace(/^Char_/, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}


export function Rivets() {
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

export function BlueprintBrowser({ selectedUuid, onPick, onCollapse, className }: {
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
