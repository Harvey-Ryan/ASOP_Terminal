import React, { useState, useRef, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search, Package, Plus, Trash2, Pencil, X, Check,
  Tag, Store, ArrowLeftRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { inventoryApi, marketplaceApi } from '@/api/marketplace';
import { uexApi } from '@/api/uex';
import { useAuth } from '@/hooks/useAuth';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/lib/utils';
import type {
  InventoryEntryDto,
  UexItemDto,
  UexCommodityDto,
  InventoryItemType,
  MarketplaceListingDto,
  TradeDto,
} from '@dem/shared';

// ── Types ─────────────────────────────────────────────────────────────────────

type UexResult =
  | { type: 'ITEM'; item: UexItemDto }
  | { type: 'COMMODITY'; item: UexCommodityDto };

// ── Shared helpers ────────────────────────────────────────────────────────────

function fmtQty(qty: number, type: InventoryItemType) {
  const n = qty % 1 === 0 ? qty.toFixed(0) : qty.toFixed(type === 'COMMODITY' ? 3 : 2);
  return type === 'COMMODITY' ? `${n} cSCU` : `×${n}`;
}

function PriceBadge({ listing }: { listing: Pick<MarketplaceListingDto, 'askingPrice' | 'priceNote'> }) {
  if (listing.askingPrice != null) {
    return (
      <span className="text-xs font-semibold text-green-400 tabular-nums">
        {listing.askingPrice.toLocaleString()} aUEC
      </span>
    );
  }
  if (listing.priceNote) {
    return <span className="text-xs text-muted-foreground italic">{listing.priceNote}</span>;
  }
  return <span className="text-xs text-muted-foreground italic">Price not set</span>;
}

// ── UEX autocomplete ──────────────────────────────────────────────────────────

function UexCombobox({
  placeholder,
  onSelect,
  value,
  onClear,
}: {
  placeholder: string;
  onSelect: (result: UexResult) => void;
  value: string;
  onClear: () => void;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const debouncedQuery = useDebounce(query, 250);

  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const { data: items = [] } = useQuery({
    queryKey: ['uex-items', debouncedQuery],
    queryFn: () => uexApi.getItems({ q: debouncedQuery, limit: 50 }),
    enabled: debouncedQuery.length >= 2 && open,
    staleTime: 60_000,
  });

  const { data: commodities = [] } = useQuery({
    queryKey: ['uex-commodities', debouncedQuery],
    queryFn: () => uexApi.getCommodities({ q: debouncedQuery, limit: 50 }),
    enabled: debouncedQuery.length >= 2 && open,
    staleTime: 60_000,
  });

  const needle = debouncedQuery.toLowerCase();
  const rank = (name: string) => (name.toLowerCase().startsWith(needle) ? 0 : 1);
  const results: UexResult[] = [
    ...items.map((i): UexResult => ({ type: 'ITEM', item: i })),
    ...commodities.map((c): UexResult => ({ type: 'COMMODITY', item: c })),
  ].sort((a, b) => rank(a.item.name) - rank(b.item.name) || a.item.name.localeCompare(b.item.name)).slice(0, 25);

  function select(r: UexResult) {
    setQuery(r.item.name);
    setOpen(false);
    onSelect(r);
  }

  return (
    <div className="relative" ref={ref}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { if (query.length >= 2) setOpen(true); }}
          placeholder={placeholder}
          className="w-full rounded-md border border-input bg-background pl-9 pr-9 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
        {query && (
          <button onClick={() => { setQuery(''); onClear(); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-card shadow-lg max-h-64 overflow-y-auto">
          {results.map((r) => (
            <button
              key={`${r.type}-${r.item.id}`}
              onMouseDown={(e) => { e.preventDefault(); select(r); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left"
            >
              <span className="text-xs rounded px-1.5 py-0.5 font-mono bg-muted text-muted-foreground shrink-0">
                {r.type === 'COMMODITY' ? 'COM' : 'ITEM'}
              </span>
              <span className="truncate">{r.item.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tab 1 — Browse (cross-guild marketplace) ──────────────────────────────────

function BrowseTab({ guildId }: { guildId: string }) {
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const debouncedQ = useDebounce(q, 300);
  const [requesting, setRequesting] = useState<MarketplaceListingDto | null>(null);
  const [reqQty, setReqQty] = useState('');
  const [reqNote, setReqNote] = useState('');
  const [reqError, setReqError] = useState('');

  const { data: listings = [], isLoading } = useQuery({
    queryKey: ['marketplace-browse', debouncedQ],
    queryFn: () => marketplaceApi.browse(debouncedQ ? { q: debouncedQ } : undefined),
    staleTime: 30_000,
  });

  const qc = useQueryClient();
  const requestMut = useMutation({
    mutationFn: () => {
      if (!requesting) throw new Error('No listing selected');
      const qty = parseFloat(reqQty);
      const available = requesting.quantityListed ?? requesting.quantity;
      if (isNaN(qty) || qty <= 0) throw new Error('Enter a valid quantity');
      if (qty > available) throw new Error(`Only ${fmtQty(available, requesting.itemType)} available`);
      return marketplaceApi.requestTrade(guildId, {
        inventoryEntryId: requesting.id,
        quantityRequested: qty,
        note: reqNote.trim() || undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['marketplace-trades', guildId] });
      setRequesting(null);
      setReqQty('');
      setReqNote('');
      setReqError('');
    },
    onError: (e: Error) => setReqError(e.message),
  });

  const myId = user?.id;

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search listings across all guilds…"
          className="w-full rounded-md border border-input bg-background pl-9 pr-4 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
        </div>
      )}

      {!isLoading && listings.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-12">
          {q ? `No listings match "${q}".` : 'No items listed for sale yet.'}
        </p>
      )}

      {listings.length > 0 && (
        <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
          {listings.map((listing) => {
            const available = listing.quantityListed ?? listing.quantity;
            const isOwn = listing.userId === myId;
            const isOpen = requesting?.id === listing.id;

            return (
              <div key={listing.id} className="bg-card">
                <div className="flex items-center gap-3 px-4 py-3 text-sm">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{listing.itemName}</span>
                      <span className="text-xs rounded px-1.5 py-0.5 font-mono bg-muted text-muted-foreground shrink-0">
                        {listing.itemType === 'COMMODITY' ? 'COM' : 'ITEM'}
                      </span>
                      {listing.qualityLevel !== null && (
                        <span className="text-xs text-muted-foreground">QL {listing.qualityLevel}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      <span className="text-xs text-muted-foreground">
                        {listing.username} · {listing.guildName}
                      </span>
                      {listing.location && (
                        <span className="text-xs text-muted-foreground">📍 {listing.location}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground tabular-nums">{fmtQty(available, listing.itemType)}</p>
                      <PriceBadge listing={listing} />
                    </div>
                    {!isOwn && (
                      <Button
                        size="sm"
                        variant={isOpen ? 'outline' : 'default'}
                        onClick={() => {
                          if (isOpen) { setRequesting(null); setReqQty(''); setReqNote(''); setReqError(''); }
                          else { setRequesting(listing); setReqQty(''); setReqNote(''); setReqError(''); }
                        }}
                      >
                        {isOpen ? 'Cancel' : 'Request'}
                      </Button>
                    )}
                    {isOwn && (
                      <span className="text-xs text-muted-foreground italic">Your listing</span>
                    )}
                  </div>
                </div>

                {/* Inline request form */}
                {isOpen && (
                  <div className="px-4 pb-4 pt-1 border-t border-border bg-background/50 space-y-3">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Trade Request</p>
                    <div className="flex flex-wrap gap-2">
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1">
                          Quantity (max {fmtQty(available, listing.itemType)})
                        </label>
                        <input
                          autoFocus
                          type="number"
                          min={0.001}
                          max={available}
                          step={listing.itemType === 'COMMODITY' ? 0.001 : 1}
                          value={reqQty}
                          onChange={(e) => setReqQty(e.target.value)}
                          className="w-28 rounded border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                          placeholder="Qty"
                        />
                      </div>
                      <div className="flex-1 min-w-[160px]">
                        <label className="text-xs text-muted-foreground block mb-1">Message to seller (optional)</label>
                        <input
                          value={reqNote}
                          onChange={(e) => setReqNote(e.target.value)}
                          placeholder="e.g. Available evenings, ping me on Discord"
                          className="w-full rounded border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                        />
                      </div>
                    </div>
                    {reqError && <p className="text-xs text-destructive">{reqError}</p>}
                    <Button size="sm" onClick={() => requestMut.mutate()} disabled={!reqQty || requestMut.isPending}>
                      {requestMut.isPending ? 'Sending…' : 'Send Request'}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Listing editor (inline, inside inventory row) ─────────────────────────────

function ListingEditor({
  entry,
  guildId,
  onClose,
}: {
  entry: InventoryEntryDto;
  guildId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [qtyListed, setQtyListed] = useState(entry.quantityListed !== null ? String(entry.quantityListed) : '');
  const [price, setPrice] = useState(entry.askingPrice !== null ? String(entry.askingPrice) : '');
  const [note, setNote] = useState(entry.priceNote ?? '');
  const [err, setErr] = useState('');

  const saveMut = useMutation({
    mutationFn: (forSale: boolean) => {
      const parsedQty = qtyListed !== '' ? parseFloat(qtyListed) : null;
      if (forSale && parsedQty !== null && (isNaN(parsedQty) || parsedQty <= 0 || parsedQty > entry.quantity)) {
        throw new Error(`Quantity to list must be between 0 and ${entry.quantity}`);
      }
      const parsedPrice = price !== '' ? parseInt(price, 10) : null;
      if (parsedPrice !== null && (isNaN(parsedPrice) || parsedPrice < 0)) {
        throw new Error('Price must be a non-negative number');
      }
      return inventoryApi.upsertEntry(guildId, {
        id: entry.id,
        itemType: entry.itemType,
        externalItemId: entry.externalItemId,
        itemName: entry.itemName,
        quantity: entry.quantity,
        qualityLevel: entry.qualityLevel,
        location: entry.location,
        forSale,
        quantityListed: forSale ? parsedQty : null,
        askingPrice: forSale ? parsedPrice : null,
        priceNote: forSale ? (note.trim() || null) : null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exchange-inventory', guildId] });
      qc.invalidateQueries({ queryKey: ['marketplace-browse'] });
      onClose();
    },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <div className="mt-2 rounded-md border border-border bg-card p-3 space-y-3 text-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {entry.forSale ? 'Update Listing' : 'List for Sale'}
      </p>

      <div className="flex flex-wrap gap-2">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            Quantity to list (max {entry.quantity}; blank = all)
          </label>
          <input
            autoFocus
            type="number"
            min={0}
            max={entry.quantity}
            step={entry.itemType === 'COMMODITY' ? 0.001 : 1}
            value={qtyListed}
            onChange={(e) => setQtyListed(e.target.value)}
            placeholder={String(entry.quantity)}
            className="w-28 rounded border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground block mb-1">Asking price (aUEC)</label>
          <input
            type="number"
            min={0}
            step={1}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Leave blank if using note"
            className="w-40 rounded border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div className="flex-1 min-w-[160px]">
          <label className="text-xs text-muted-foreground block mb-1">Price note (if no fixed price)</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Negotiable, Trade for Agricium"
            className="w-full rounded border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      {err && <p className="text-xs text-destructive">{err}</p>}

      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" onClick={() => saveMut.mutate(true)} disabled={saveMut.isPending}>
          {saveMut.isPending ? 'Saving…' : entry.forSale ? 'Update Listing' : 'Publish Listing'}
        </Button>
        {entry.forSale && (
          <Button size="sm" variant="ghost" onClick={() => saveMut.mutate(false)} disabled={saveMut.isPending}
            className="text-destructive hover:text-destructive/80">
            Unlist
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

// ── Inventory row ─────────────────────────────────────────────────────────────

function InventoryRow({
  entry,
  guildId,
}: {
  entry: InventoryEntryDto;
  guildId: string;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [listing, setListing] = useState(false);
  const [qty, setQty] = useState(String(entry.quantity));
  const [ql, setQl] = useState(entry.qualityLevel !== null ? String(entry.qualityLevel) : '');
  const [loc, setLoc] = useState(entry.location ?? '');
  const [saveError, setSaveError] = useState('');

  const saveMut = useMutation({
    mutationFn: () => {
      if (entry.itemType === 'COMMODITY' && ql === '') throw new Error('Quality Level is required for commodities');
      return inventoryApi.upsertEntry(guildId, {
        id: entry.id,
        itemType: entry.itemType,
        externalItemId: entry.externalItemId,
        itemName: entry.itemName,
        quantity: parseFloat(qty) || 0,
        qualityLevel: ql !== '' ? parseInt(ql, 10) : null,
        location: loc.trim() || null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exchange-inventory', guildId] });
      setSaveError('');
      setEditing(false);
    },
    onError: (err: Error) => setSaveError(err.message),
  });

  const deleteMut = useMutation({
    mutationFn: () => inventoryApi.deleteEntry(guildId, entry.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['exchange-inventory', guildId] }),
  });

  if (editing) {
    return (
      <div className="py-2 space-y-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium min-w-0 flex-1">{entry.itemName}</span>
          <input type="number" min={0} step={entry.itemType === 'COMMODITY' ? 0.001 : 1}
            value={qty} onChange={(e) => setQty(e.target.value)}
            className="w-24 rounded border border-input bg-background px-2 py-1 text-sm text-right outline-none focus:ring-1 focus:ring-ring"
            placeholder="Qty" />
          <input type="number" min={0} max={1000} step={1}
            value={ql} onChange={(e) => setQl(e.target.value)}
            className="w-20 rounded border border-input bg-background px-2 py-1 text-sm text-right outline-none focus:ring-1 focus:ring-ring"
            placeholder={entry.itemType === 'COMMODITY' ? 'QL *' : 'QL'} />
          <input value={loc} onChange={(e) => setLoc(e.target.value)}
            className="w-36 rounded border border-input bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring"
            placeholder="Location" />
          <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
            className="text-green-500 hover:text-green-400 disabled:opacity-50">
            <Check className="h-4 w-4" />
          </button>
          <button onClick={() => { setEditing(false); setSaveError(''); }}
            className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        {saveError && <p className="text-xs text-destructive">{saveError}</p>}
      </div>
    );
  }

  return (
    <div className="py-2">
      <div className="flex items-center gap-2 text-sm group">
        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
          <span className="font-medium">{entry.itemName}</span>
          <span className="text-xs rounded px-1.5 py-0.5 font-mono bg-muted text-muted-foreground shrink-0">
            {entry.itemType === 'COMMODITY' ? 'COM' : 'ITEM'}
          </span>
          {entry.forSale && (
            <span className="text-xs rounded-full px-2 py-0.5 bg-green-500/10 text-green-400 font-medium">
              Listed
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-muted-foreground shrink-0">
          {entry.qualityLevel !== null && <span className="text-xs">QL {entry.qualityLevel}</span>}
          {entry.location && <span className="text-xs">📍 {entry.location}</span>}
          <span className="tabular-nums text-xs">{fmtQty(entry.quantity, entry.itemType)}</span>
          {/* Action buttons — revealed on hover */}
          <button onClick={() => { setEditing(true); setListing(false); }}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
            title="Edit inventory entry">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setListing((v) => !v)}
            className={cn(
              'opacity-0 group-hover:opacity-100 transition-opacity',
              listing ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
            title={entry.forSale ? 'Manage listing' : 'List for sale'}>
            <Tag className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => deleteMut.mutate()} disabled={deleteMut.isPending}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive/80 disabled:opacity-50"
            title="Remove from inventory">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Listing editor — shown when tag button is toggled */}
      {listing && (
        <ListingEditor entry={entry} guildId={guildId} onClose={() => setListing(false)} />
      )}

      {/* Price summary when listed and editor is closed */}
      {!listing && entry.forSale && (
        <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            {entry.quantityListed != null ? fmtQty(entry.quantityListed, entry.itemType) : 'All'} listed
          </span>
          <PriceBadge listing={entry} />
        </div>
      )}
    </div>
  );
}

// ── Tab 2 — My Inventory ──────────────────────────────────────────────────────

function InventoryTab({ guildId }: { guildId: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();

  const [selected, setSelected] = useState<UexResult | null>(null);
  const [labelValue, setLabelValue] = useState('');
  const [qty, setQty] = useState('1');
  const [ql, setQl] = useState('');
  const [loc, setLoc] = useState('');
  const [formError, setFormError] = useState('');

  const { data: inventory = [], isLoading } = useQuery({
    queryKey: ['exchange-inventory', guildId],
    queryFn: () => inventoryApi.getMyInventory(guildId),
  });

  const addMut = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error('No item selected');
      const quantity = parseFloat(qty);
      if (isNaN(quantity) || quantity < 0) throw new Error('Invalid quantity');
      if (selected.type === 'COMMODITY' && ql === '') throw new Error('Quality Level is required for commodities');
      const qualityLevel = ql !== '' ? parseInt(ql, 10) : null;
      if (qualityLevel !== null && (isNaN(qualityLevel) || qualityLevel < 0 || qualityLevel > 1000)) {
        throw new Error('QL must be 0–1000');
      }
      return inventoryApi.upsertEntry(guildId, {
        itemType: selected.type,
        externalItemId: selected.item.id,
        itemName: selected.item.name,
        quantity,
        qualityLevel,
        location: loc.trim() || null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exchange-inventory', guildId] });
      setSelected(null); setLabelValue(''); setQty('1'); setQl(''); setLoc(''); setFormError('');
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const isCommodity = selected?.type === 'COMMODITY';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="h-4 w-4" /> Add Item
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <UexCombobox
            placeholder="Search for an item or commodity to add…"
            onSelect={(r) => { setSelected(r); setLabelValue(r.item.name); setQl(''); }}
            value={labelValue}
            onClear={() => { setSelected(null); setLabelValue(''); }}
          />
          <div className="flex flex-wrap gap-2">
            <div className="flex-1 min-w-[100px]">
              <label className="text-xs text-muted-foreground block mb-1">
                {isCommodity ? 'Quantity (cSCU)' : 'Quantity'}
              </label>
              <input type="number" min={0} step={isCommodity ? 0.001 : 1}
                value={qty} onChange={(e) => setQty(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="w-28">
              <label className="text-xs text-muted-foreground block mb-1">
                Quality (0–1000){isCommodity ? ' *' : ''}
              </label>
              <input type="number" min={0} max={1000} step={1}
                value={ql} onChange={(e) => setQl(e.target.value)}
                placeholder={isCommodity ? 'Required' : 'Optional'}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="text-xs text-muted-foreground block mb-1">Location (optional)</label>
              <input value={loc} onChange={(e) => setLoc(e.target.value)}
                placeholder="e.g. Lorville - TDD"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring" />
            </div>
          </div>
          {formError && <p className="text-xs text-destructive">{formError}</p>}
          <Button size="sm" onClick={() => addMut.mutate()} disabled={!selected || addMut.isPending}>
            {addMut.isPending ? 'Saving…' : 'Add to Inventory'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4" /> My Inventory
            {user && <span className="text-xs font-normal text-muted-foreground ml-1">— {user.globalName ?? user.username}</span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 rounded" />)}</div>}
          {!isLoading && inventory.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">Your inventory is empty. Add items above.</p>
          )}
          {!isLoading && inventory.length > 0 && (
            <div className="divide-y divide-border">
              {inventory.map((entry) => (
                <InventoryRow key={entry.id} entry={entry} guildId={guildId} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Tab 3 — Trades ────────────────────────────────────────────────────────────

function TradeRow({
  trade,
  guildId,
  role,
}: {
  trade: TradeDto;
  guildId: string;
  role: 'buyer' | 'seller';
}) {
  const qc = useQueryClient();
  const listing = trade.listingSnapshot;
  const invalidate = () => qc.invalidateQueries({ queryKey: ['marketplace-trades', guildId] });

  const acceptMut  = useMutation({ mutationFn: () => marketplaceApi.acceptTrade(guildId, trade.id),  onSuccess: invalidate });
  const declineMut = useMutation({ mutationFn: () => marketplaceApi.declineTrade(guildId, trade.id), onSuccess: invalidate });
  const cancelMut  = useMutation({ mutationFn: () => marketplaceApi.cancelTrade(guildId, trade.id),  onSuccess: invalidate });

  const busy = acceptMut.isPending || declineMut.isPending || cancelMut.isPending;

  const statusColor =
    trade.status === 'ACCEPTED'  ? 'text-green-400' :
    trade.status === 'DECLINED'  ? 'text-destructive' :
    trade.status === 'CANCELLED' ? 'text-muted-foreground' :
    'text-amber-400';

  return (
    <div className="flex items-center gap-3 py-3 text-sm flex-wrap">
      <div className="flex-1 min-w-0">
        <div className="font-medium">
          {fmtQty(trade.quantityRequested, listing.itemType)} × {listing.itemName}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {role === 'seller'
            ? `From ${trade.buyerUsername} · ${listing.guildName}`
            : `Seller: ${listing.username} · ${listing.guildName}`}
          {trade.note && <span className="ml-2 italic">"{trade.note}"</span>}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={cn('text-xs font-medium', statusColor)}>{trade.status}</span>
        {trade.status === 'PENDING' && role === 'seller' && (
          <>
            <Button size="sm" onClick={() => acceptMut.mutate()} disabled={busy}>Accept</Button>
            <Button size="sm" variant="outline" onClick={() => declineMut.mutate()} disabled={busy}>Decline</Button>
            <Button size="sm" variant="ghost" onClick={() => cancelMut.mutate()} disabled={busy}
              className="text-muted-foreground hover:text-foreground">
              Cancel
            </Button>
          </>
        )}
        {trade.status === 'PENDING' && role === 'buyer' && (
          <Button size="sm" variant="ghost" onClick={() => cancelMut.mutate()} disabled={busy}
            className="text-muted-foreground hover:text-foreground">
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

function TradesTab({ guildId }: { guildId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['marketplace-trades', guildId],
    queryFn: () => marketplaceApi.getTrades(guildId),
    staleTime: 15_000,
  });

  const incoming = data?.incoming ?? [];
  const outgoing = data?.outgoing ?? [];

  if (isLoading) {
    return <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>;
  }

  if (incoming.length === 0 && outgoing.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-12">
        No trade requests yet.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {incoming.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Incoming Requests ({incoming.length})
          </h3>
          <Card>
            <CardContent className="pt-2 pb-0">
              <div className="divide-y divide-border">
                {incoming.map((t) => (
                  <TradeRow key={t.id} trade={t} guildId={guildId} role="seller" />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {outgoing.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            My Requests ({outgoing.length})
          </h3>
          <Card>
            <CardContent className="pt-2 pb-0">
              <div className="divide-y divide-border">
                {outgoing.map((t) => (
                  <TradeRow key={t.id} trade={t} guildId={guildId} role="buyer" />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type TabId = 'browse' | 'inventory' | 'trades';

export function MarketplacePage() {
  const { guildId } = useParams<{ guildId: string }>();
  const [activeTab, setActiveTab] = useState<TabId>('browse');

  // Fetch pending count eagerly so the Trades tab label is decorated immediately,
  // without waiting for the user to click the tab.
  const { data: pendingCount = 0 } = useQuery({
    queryKey: ['marketplace-pending-count', guildId],
    queryFn: () => marketplaceApi.getPendingCount(guildId!),
    enabled: !!guildId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  if (!guildId) return null;

  const TABS: { id: TabId; label: string; Icon: React.ElementType; badge?: number }[] = [
    { id: 'browse',    label: 'Browse',       Icon: Store },
    { id: 'inventory', label: 'My Inventory', Icon: Package },
    { id: 'trades',    label: 'Trades',       Icon: ArrowLeftRight, badge: pendingCount },
  ];

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Marketplace</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Browse listings from all guilds, manage your inventory, and track trade requests.
        </p>
      </div>

      <div className="flex border-b border-border">
        {TABS.map(({ id, label, Icon, badge }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            {badge != null && badge > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-black">
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab === 'browse'    && <BrowseTab guildId={guildId} />}
      {activeTab === 'inventory' && <InventoryTab guildId={guildId} />}
      {activeTab === 'trades'    && <TradesTab guildId={guildId} />}
    </div>
  );
}
