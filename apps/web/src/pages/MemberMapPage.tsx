import { useEffect, useRef, useState, useMemo, useCallback, type FC } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Globe2, MapPin, Trash2, Eye, EyeOff, RotateCcw, Crosshair, X, Check, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { memberPinsApi } from '@/api/memberPins';
import type { MemberPinDto, UpsertMemberPinBody } from '@dem/shared';

// ── Helpers ───────────────────────────────────────────────────────────────────

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

interface Cluster {
  lat: number;
  lng: number;
  municipality: string;
  pins: MemberPinDto[];
}

function clusterPins(pins: MemberPinDto[]): Cluster[] {
  const map = new Map<string, Cluster>();
  for (const pin of pins) {
    const key = `${pin.lat.toFixed(4)},${pin.lng.toFixed(4)}`;
    if (!map.has(key)) {
      map.set(key, { lat: pin.lat, lng: pin.lng, municipality: pin.municipality, pins: [] });
    }
    map.get(key)!.pins.push(pin);
  }
  return Array.from(map.values());
}

export interface GlobePoint {
  id: string;
  lat: number;
  lng: number;
  pins: MemberPinDto[];
  isMine: boolean;
}

// ── Keyframe injection ────────────────────────────────────────────────────────

function injectGlobeStyles() {
  if (document.getElementById('globe-pin-styles')) return;
  const style = document.createElement('style');
  style.id = 'globe-pin-styles';
  style.textContent = `
    @keyframes pinBloom {
      from { opacity: 0; transform: scale(0.15) translateY(8px); }
      to   { opacity: 1; transform: scale(1) translateY(0); }
    }
  `;
  document.head.appendChild(style);
}

// ── Pin DOM factory (runs outside React render) ───────────────────────────────

function createPinElement(point: GlobePoint, isCluster: boolean, idx: number): HTMLElement {
  const named   = point.pins.filter((p) => p.displayName);
  const count   = point.pins.length;
  const isMine  = point.isMine;
  const accent  = isMine ? '#34d399' : '#818cf8';
  const border  = isMine ? '#10b981' : '#6366f1';
  const glow    = isMine ? '#10b98150' : '#6366f150';
  const headPx  = isCluster && count > 1 ? 28 : 20;

  const wrapper = document.createElement('div');
  wrapper.style.cssText = `
    display:flex; flex-direction:column; align-items:center;
    cursor:pointer; position:relative;
    animation: pinBloom 0.4s cubic-bezier(0.34,1.56,0.64,1) both;
    animation-delay: ${Math.min(idx * 20, 280)}ms;
    transform-origin: bottom center;
  `;

  const head = document.createElement('div');
  head.style.cssText = `
    width:${headPx}px; height:${headPx}px; border-radius:50%;
    background:${accent}; border:2px solid ${border};
    display:flex; align-items:center; justify-content:center;
    color:#0a0e1a; font-size:10px; font-weight:800; font-family:system-ui,sans-serif;
    box-shadow:0 0 10px ${glow}, 0 2px 6px rgba(0,0,0,.6);
    transition:transform .15s ease, box-shadow .15s ease; flex-shrink:0;
  `;
  if (isCluster && count > 1) head.textContent = String(count);

  const stem = document.createElement('div');
  stem.style.cssText = `
    width:2px; height:8px; background:${accent};
    margin-top:-1px; box-shadow:0 2px 4px rgba(0,0,0,.4); flex-shrink:0;
  `;

  wrapper.appendChild(head);
  wrapper.appendChild(stem);

  // Tooltip
  let tip: HTMLDivElement | null = null;

  function show() {
    const el = document.createElement('div');
    el.style.cssText = `
      position:absolute; bottom:calc(100% + 6px); left:50%; transform:translateX(-50%);
      background:rgba(8,12,26,.96); border:1px solid ${border}55; border-radius:8px;
      padding:8px 12px; white-space:nowrap; z-index:100; pointer-events:none;
      font-family:system-ui,sans-serif; box-shadow:0 4px 20px rgba(0,0,0,.75);
      min-width:130px;
    `;

    const loc = document.createElement('div');
    loc.textContent = point.pins[0]?.municipality ?? '';
    loc.style.cssText = `font-size:11px; font-weight:700; color:${accent}; text-transform:uppercase; letter-spacing:.05em; margin-bottom:${named.length > 0 || count > 1 ? '5px' : '0'};`;
    el.appendChild(loc);

    if (count > 1) {
      const cnt = document.createElement('div');
      cnt.textContent = `${count} member${count !== 1 ? 's' : ''}`;
      cnt.style.cssText = 'font-size:11px; color:rgba(255,255,255,.45); margin-bottom:4px;';
      el.appendChild(cnt);
    }

    if (named.length > 0) {
      const divider = document.createElement('div');
      divider.style.cssText = 'height:1px; background:rgba(255,255,255,.1); margin:4px 0;';
      el.appendChild(divider);
      named.forEach((p) => {
        const nm = document.createElement('div');
        nm.textContent = `• ${p.displayName}`;
        nm.style.cssText = 'font-size:11px; color:rgba(255,255,255,.85);';
        el.appendChild(nm);
      });
    }

    tip = el;
    wrapper.appendChild(el);
    head.style.transform = 'scale(1.2)';
    head.style.boxShadow = `0 0 16px ${glow}, 0 2px 8px rgba(0,0,0,.7)`;
  }

  function hide() {
    tip?.remove(); tip = null;
    head.style.transform = '';
    head.style.boxShadow = `0 0 10px ${glow}, 0 2px 6px rgba(0,0,0,.6)`;
  }

  wrapper.addEventListener('mouseenter', show);
  wrapper.addEventListener('mouseleave', hide);
  return wrapper;
}

// ── GlobeWrapper: lazy-loaded sub-component that mounts react-globe.gl ───────

interface GlobeWrapperProps {
  points: GlobePoint[];
  scatterProgress: number;
  onGlobeClick: (lat: number, lng: number) => void;
  onAltitudeChange: (alt: number) => void;
}

const GlobeWrapper: FC<GlobeWrapperProps> = ({ points, scatterProgress, onGlobeClick, onAltitudeChange }) => {
  const mountRef   = useRef<HTMLDivElement>(null);
  const globeRef   = useRef<any>(null);

  // Init globe imperatively once the div is mounted
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    let cancelled = false;

    injectGlobeStyles();

    import('globe.gl').then((mod) => {
      if (cancelled || !el) return;
      const Globe = (mod.default ?? mod) as any;

      const globe = new Globe(el)
        .globeImageUrl('//unpkg.com/three-globe/example/img/earth-night.jpg')
        .backgroundColor('rgba(0,0,0,0)')
        .showAtmosphere(true)
        .atmosphereColor('#4a5fa0')
        .atmosphereAltitude(0.12)
        .htmlElementsData([])
        .htmlLat((d: GlobePoint) => d.lat)
        .htmlLng((d: GlobePoint) => d.lng)
        .htmlAltitude(0.01)
        .htmlElement((_d: GlobePoint) => document.createElement('div')); // placeholder

      globe.width(el.clientWidth).height(el.clientHeight);
      globeRef.current = globe;

      // Altitude tracking
      const camera   = globe.camera();
      const controls = globe.controls();
      const onCamChange = () => {
        if (!camera || !controls) return;
        const dist = camera.position.distanceTo(controls.target);
        const alt  = Math.max(0, dist / 100 - 1);
        onAltitudeChange(alt);
      };
      controls.addEventListener('change', onCamChange);

      // Click handler
      globe.onGlobeClick((coords: { lat: number; lng: number }) => {
        onGlobeClick(coords.lat, coords.lng);
      });

      // Resize observer
      const obs = new ResizeObserver(() => {
        globe.width(el.clientWidth).height(el.clientHeight);
      });
      obs.observe(el);

      return () => {
        obs.disconnect();
        controls.removeEventListener('change', onCamChange);
      };
    }).catch(console.error);

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push updated points + element factory whenever they change
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    globe
      .htmlElementsData([...points])   // new array reference triggers re-render
      .htmlElement((d: GlobePoint, idx: number) => {
        const isCluster = d.pins.length > 1 && scatterProgress < 0.5;
        return createPinElement(d, isCluster, idx as number);
      });
  }, [points, scatterProgress]);

  return <div ref={mountRef} className="w-full h-full" />;
};

// ── Main page ─────────────────────────────────────────────────────────────────

export function MemberMapPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const { user }    = useAuth();
  const queryClient = useQueryClient();

  const [altitude,       setAltitude]       = useState(1.8);
  const [placingMode,    setPlacingMode]    = useState(false);
  const [geocoding,      setGeocoding]      = useState(false);
  const [geocodeResult,  setGeocodeResult]  = useState<{ lat: number; lng: number; municipality: string } | null>(null);
  const [showName,       setShowName]       = useState(false);
  const [formError,      setFormError]      = useState<string | null>(null);

  const placingModeRef = useRef(placingMode);
  useEffect(() => { placingModeRef.current = placingMode; }, [placingMode]);

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: allPins = [], isLoading: pinsLoading } = useQuery({
    queryKey: ['member-pins', guildId],
    queryFn:  () => memberPinsApi.list(guildId!),
    enabled:  !!guildId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const { data: myPin } = useQuery({
    queryKey: ['member-pins', guildId, 'mine'],
    queryFn:  () => memberPinsApi.getMine(guildId!),
    enabled:  !!guildId,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (myPin?.displayName != null) setShowName(true);
  }, [myPin]);

  // ── Mutations ────────────────────────────────────────────────────────────
  const upsertMutation = useMutation({
    mutationFn: (body: UpsertMemberPinBody) => memberPinsApi.upsert(guildId!, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['member-pins', guildId] });
      queryClient.invalidateQueries({ queryKey: ['member-pins', guildId, 'mine'] });
      cancelPlacement();
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const removeMutation = useMutation({
    mutationFn: () => memberPinsApi.remove(guildId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['member-pins', guildId] });
      queryClient.invalidateQueries({ queryKey: ['member-pins', guildId, 'mine'] });
    },
  });

  // ── Scatter calculation ──────────────────────────────────────────────────
  const scatterProgress = useMemo(() => 1 - smoothstep(0.12, 0.5, altitude), [altitude]);

  const globePoints = useMemo((): GlobePoint[] => {
    const clusters  = clusterPins(allPins);
    const myPinId   = myPin?.id;

    return clusters.flatMap((cluster): GlobePoint[] => {
      const isMine = cluster.pins.some((p) => p.id === myPinId);

      if (scatterProgress < 0.5 || cluster.pins.length === 1) {
        return [{
          id:    `cluster-${cluster.lat.toFixed(4)}-${cluster.lng.toFixed(4)}`,
          lat:   cluster.lat,
          lng:   cluster.lng,
          pins:  cluster.pins,
          isMine,
        }];
      }

      // Scatter in a ring; animate out based on scatterProgress
      const radius   = Math.min(0.25 + cluster.pins.length * 0.04, 0.9);
      const progress = (scatterProgress - 0.5) * 2; // remap [0.5,1] → [0,1]

      return cluster.pins.map((pin, i): GlobePoint => {
        const angle = (i / cluster.pins.length) * 2 * Math.PI - Math.PI / 2;
        return {
          id:    pin.id,
          lat:   lerp(cluster.lat, cluster.lat + radius * Math.sin(angle), progress),
          lng:   lerp(cluster.lng, cluster.lng + radius * Math.cos(angle), progress),
          pins:  [pin],
          isMine: pin.id === myPinId,
        };
      });
    });
  }, [allPins, scatterProgress, myPin]);

  // ── Globe click handler ──────────────────────────────────────────────────
  const handleGlobeClick = useCallback(async (lat: number, lng: number) => {
    if (!placingModeRef.current || !guildId) return;
    setGeocoding(true);
    setGeocodeResult(null);
    setFormError(null);
    try {
      const result = await memberPinsApi.geocode(guildId, lat, lng);
      setGeocodeResult(result);
    } catch {
      setFormError('Could not identify location. Try clicking a different spot.');
    } finally {
      setGeocoding(false);
    }
  }, [guildId]);

  function startPlacing() {
    setPlacingMode(true);
    setGeocodeResult(null);
    setFormError(null);
  }

  function cancelPlacement() {
    setPlacingMode(false);
    setGeocodeResult(null);
    setFormError(null);
  }

  async function useMyLocation() {
    if (!navigator.geolocation) {
      setFormError('Geolocation is not supported by your browser.');
      return;
    }
    setPlacingMode(true);
    setGeocoding(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (!guildId) return;
        try {
          const result = await memberPinsApi.geocode(guildId, pos.coords.latitude, pos.coords.longitude);
          setGeocodeResult(result);
        } catch {
          setFormError('Could not identify your location.');
        } finally {
          setGeocoding(false);
        }
      },
      () => {
        setGeocoding(false);
        setFormError('Location access denied. Click the globe to place manually.');
      },
    );
  }

  function confirmPin() {
    if (!geocodeResult) return;
    upsertMutation.mutate({ ...geocodeResult, showName });
  }

  // ── Derived ──────────────────────────────────────────────────────────────
  const totalMembers = allPins.length;
  const namedCount   = allPins.filter((p) => p.displayName).length;
  const hasMyPin     = !!myPin;

  const btnPrimary = 'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground border border-primary-foreground/20 hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50';
  const btnDanger  = 'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium bg-destructive/10 text-destructive border border-destructive/30 hover:bg-destructive/20 transition-colors disabled:opacity-50';
  const btnGhost   = 'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground border border-border hover:border-foreground/20 transition-colors';

  return (
    <div className="h-full -m-6 relative overflow-hidden bg-[#05080f]">

      {/* ── Globe ───────────────────────────────────────────────────────── */}
      <div className="absolute inset-0">
        {pinsLoading && (
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-400 opacity-60" />
          </div>
        )}
        <GlobeWrapper
          points={globePoints}
          scatterProgress={scatterProgress}
          onGlobeClick={handleGlobeClick}
          onAltitudeChange={setAltitude}
        />
      </div>

      {/* ── Placing mode banner ─────────────────────────────────────────── */}
      {placingMode && !geocodeResult && !geocoding && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 rounded-full px-4 py-2 bg-indigo-950/80 border border-indigo-500/40 text-indigo-300 text-sm font-medium shadow-xl backdrop-blur-sm pointer-events-auto">
          <Crosshair className="h-4 w-4 animate-pulse" />
          Click anywhere on the globe to drop your pin
          <button onClick={cancelPlacement} className="ml-1 rounded-full p-0.5 hover:bg-indigo-500/20 transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ── Geocoding spinner ───────────────────────────────────────────── */}
      {geocoding && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 rounded-full px-4 py-2 bg-card/90 border border-border text-muted-foreground text-sm shadow-xl backdrop-blur-sm pointer-events-none">
          <Loader2 className="h-4 w-4 animate-spin" />
          Identifying location…
        </div>
      )}

      {/* ── Placement confirmation ──────────────────────────────────────── */}
      {geocodeResult && !geocoding && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 w-80 rounded-xl border border-border bg-card/95 shadow-2xl backdrop-blur-md overflow-hidden pointer-events-auto">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-primary/40">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-indigo-400" />
              <span className="text-sm font-bold uppercase tracking-widest text-primary-foreground/80">
                {hasMyPin ? 'Update Pin' : 'Place Pin'}
              </span>
            </div>
            <button onClick={cancelPlacement} className="rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="px-4 py-4 space-y-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Location</p>
              <p className="text-base font-semibold text-foreground leading-snug">{geocodeResult.municipality}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {geocodeResult.lat.toFixed(3)}°, {geocodeResult.lng.toFixed(3)}°
              </p>
            </div>

            {/* Name toggle */}
            <div className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-muted/40 border border-border">
              <div className="min-w-0 mr-3">
                <p className="text-sm font-medium text-foreground">Show my name</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                  {showName
                    ? `Visible as "${user?.globalName ?? user?.username ?? '…'}"`
                    : 'Anonymous — no one sees your name'}
                </p>
              </div>
              <button
                onClick={() => setShowName((v) => !v)}
                aria-checked={showName}
                role="switch"
                className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 transition-colors focus:outline-none ${showName ? 'bg-indigo-500 border-indigo-500' : 'bg-muted border-border'}`}
              >
                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform mt-px ${showName ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
              </button>
            </div>

            {formError && <p className="text-xs text-destructive">{formError}</p>}

            <div className="flex gap-2">
              <button onClick={confirmPin} disabled={upsertMutation.isPending} className={`${btnPrimary} flex-1 justify-center`}>
                {upsertMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                {upsertMutation.isPending ? 'Saving…' : (hasMyPin ? 'Update' : 'Place Pin')}
              </button>
              <button onClick={cancelPlacement} className={btnGhost}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Side panel ──────────────────────────────────────────────────── */}
      <div className="absolute top-4 right-4 z-20 w-64 flex flex-col gap-3 pointer-events-none">

        {/* Stats */}
        <div className="rounded-xl border border-border bg-card/85 shadow-xl backdrop-blur-md overflow-hidden pointer-events-auto">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-primary/30">
            <Globe2 className="h-4 w-4 text-indigo-400 shrink-0" />
            <span className="text-sm font-bold uppercase tracking-widest text-primary-foreground/80">Member Map</span>
          </div>
          <div className="px-4 py-3 grid grid-cols-2 gap-3">
            <div>
              <p className="text-2xl font-black tabular-nums text-foreground">{totalMembers}</p>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Pinned</p>
            </div>
            <div>
              <p className="text-2xl font-black tabular-nums text-foreground">{namedCount}</p>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Named</p>
            </div>
          </div>
        </div>

        {/* My pin */}
        <div className="rounded-xl border border-border bg-card/85 shadow-xl backdrop-blur-md overflow-hidden pointer-events-auto">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-primary/30">
            <MapPin className="h-4 w-4 text-emerald-400 shrink-0" />
            <span className="text-sm font-bold uppercase tracking-widest text-primary-foreground/80">Your Pin</span>
          </div>

          {hasMyPin ? (
            <div className="px-4 py-3 space-y-3">
              <div>
                <p className="text-sm font-semibold text-foreground leading-snug">{myPin!.municipality}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  {myPin!.displayName
                    ? <Eye className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    : <EyeOff className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                  <span className="text-[11px] text-muted-foreground truncate">
                    {myPin!.displayName ? `Showing as "${myPin!.displayName}"` : 'Anonymous'}
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={startPlacing}
                  disabled={placingMode || geocoding}
                  className={`${btnPrimary} flex-1 justify-center text-xs`}
                >
                  <RotateCcw className="h-3 w-3" />
                  Update
                </button>
                <button
                  onClick={() => removeMutation.mutate()}
                  disabled={removeMutation.isPending}
                  className={`${btnDanger} text-xs`}
                  title="Remove pin"
                >
                  {removeMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                </button>
              </div>
            </div>
          ) : (
            <div className="px-4 py-3 space-y-3">
              <p className="text-[12px] text-muted-foreground leading-snug">
                You haven't placed a pin yet. Mark your location to appear on the guild map.
              </p>
              {formError && <p className="text-xs text-destructive">{formError}</p>}
              <div className="flex flex-col gap-2">
                <button
                  onClick={startPlacing}
                  disabled={placingMode || geocoding}
                  className={`${btnPrimary} justify-center text-xs`}
                >
                  <MapPin className="h-3.5 w-3.5" />
                  {placingMode ? 'Click the globe…' : 'Drop Pin'}
                </button>
                <button
                  onClick={useMyLocation}
                  disabled={placingMode || geocoding}
                  className={`${btnGhost} justify-center text-xs`}
                >
                  <Crosshair className="h-3.5 w-3.5" />
                  Use My Location
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Hint */}
        <p className="text-[10px] text-white/25 text-center leading-snug px-1 pointer-events-none">
          Drag to spin · Scroll to zoom · Zoom in to expand clusters
        </p>
      </div>
    </div>
  );
}
