import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import type { CatalogDetail } from '@dem/shared';
import { catalogApi } from '@/api/catalog';
import { HoverPopover } from '@/components/HoverPopover';

// The "i" card on loot items: what the game files say about an item, looked
// up by its name. Commodities also show UEX's average prices.

async function lookUp(name: string): Promise<CatalogDetail | null> {
  const hits = await catalogApi.search(name, { limit: 5 });
  const lc = name.trim().toLowerCase();
  const hit = hits.find((h) => h.name.toLowerCase() === lc) ?? hits[0];
  return hit ? catalogApi.item(hit.ref) : null;
}

const aUEC = (n: number) => `${Math.round(n).toLocaleString()} aUEC`;

function Badge({ children, tone }: { children: React.ReactNode; tone: 'item' | 'commodity' | 'muted' | 'danger' }) {
  const cls = {
    item: 'bg-primary/10 border border-primary/20 text-primary',
    commodity: 'bg-amber-500/10 border border-amber-500/20 text-amber-500',
    muted: 'bg-muted text-muted-foreground',
    danger: 'bg-destructive/10 text-destructive',
  }[tone];
  return <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{children}</span>;
}

export function CatalogInfoCard({ data }: { data: CatalogDetail }) {
  const c = data.commodity;
  const facts: [string, string][] = [];
  if (data.kind === 'ITEM') {
    facts.push(['Type', data.detail]);
    if (data.category && data.category !== data.detail) facts.push(['Category', data.category]);
    if (data.manufacturer) facts.push(['Maker', data.manufacturer]);
  }
  if (c?.avgBuy != null) facts.push(['Buy avg', aUEC(c.avgBuy)]);
  if (c?.avgSell != null) facts.push(['Sell avg', aUEC(c.avgSell)]);
  if (c?.refinedName) facts.push(['Refines into', c.refinedName]);

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-foreground leading-tight">{data.name}</p>
        <Badge tone={data.kind === 'COMMODITY' ? 'commodity' : 'item'}>{data.kind === 'COMMODITY' ? 'Commodity' : 'Item'}</Badge>
      </div>

      {facts.length > 0 && (
        <div className="space-y-0.5 text-muted-foreground">
          {facts.map(([k, v]) => (
            <div key={k} className="flex gap-1.5"><span className="text-foreground/60 shrink-0">{k}:</span><span className="text-foreground">{v}</span></div>
          ))}
        </div>
      )}

      {data.stats.length > 0 && (
        <div className="border-t border-border pt-1.5 space-y-0.5">
          {data.stats.map((s) => (
            <div key={s.name} className="flex gap-1.5">
              <span className="text-foreground/60 shrink-0">{s.name}:</span>
              <span className="text-foreground">{s.value}</span>
            </div>
          ))}
        </div>
      )}

      {c && (c.raw || c.illegal || c.code) && (
        <div className="flex flex-wrap gap-1">
          {c.raw && <Badge tone="muted">raw</Badge>}
          {c.illegal && <Badge tone="danger">illegal</Badge>}
          {c.code && <Badge tone="muted">{c.code}</Badge>}
        </div>
      )}

      {data.description && (
        <p className="border-t border-border pt-1.5 text-muted-foreground line-clamp-4 whitespace-pre-line">{data.description}</p>
      )}

      {c && (c.avgBuy != null || c.avgSell != null) && (
        <p className="text-[10px] text-muted-foreground/70">Prices reported by players to UEX Corp.</p>
      )}
    </div>
  );
}

export function ItemInfoPopover({ name }: { name: string }) {
  const [show, setShow] = useState(false);
  const info = useQuery({
    queryKey: ['catalog-item-info', name],
    queryFn: () => lookUp(name),
    enabled: show,
    staleTime: 10 * 60 * 1000,
  });

  return (
    <HoverPopover
      className="w-72"
      onOpenChange={setShow}
      trigger={
        <button type="button" tabIndex={-1} aria-label={`About ${name}`} className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/50 hover:text-muted-foreground transition-colors">
          <Info className="h-3.5 w-3.5" />
        </button>
      }
    >
      {info.isLoading && <p className="text-muted-foreground">Looking up "{name}"…</p>}
      {info.isError && <p className="text-muted-foreground">Couldn't load item details right now.</p>}
      {!info.isLoading && !info.isError && info.data === null && (
        <p className="text-muted-foreground">"{name}" isn't in the game data.</p>
      )}
      {info.data && <CatalogInfoCard data={info.data} />}
    </HoverPopover>
  );
}
