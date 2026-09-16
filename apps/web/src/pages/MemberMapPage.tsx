import {
  useEffect, useRef, useState, useMemo, useCallback,
  type FC, type KeyboardEvent,
} from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Globe2, MapPin, Trash2, Eye, EyeOff, RotateCcw,
  Crosshair, X, Check, Loader2, Search, Clock,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { memberPinsApi } from '@/api/memberPins';
import type { MemberPinDto, UpsertMemberPinBody, MunicipalitySearchResult } from '@dem/shared';

// ── Solar / time helpers ──────────────────────────────────────────────────────

/** Sub-solar point at the given Date (the lat/lng the sun is directly above). */
function getSolarPosition(date: Date): { lat: number; lng: number } {
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear   = Math.floor((date.getTime() - startOfYear) / 86_400_000);
  // Declination: ±23.45° over the year (max at summer solstice)
  const declination = -23.45 * Math.cos((2 * Math.PI / 365) * (dayOfYear + 10));
  const utcHours    = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  // Sub-solar longitude: 0° at solar noon (≈ 12:00 UTC for lon 0°), shifts 15°/hr
  const lng = (12 - utcHours) * 15;
  return { lat: declination, lng };
}

/**
 * Convert solar sub-point to a world-space unit vector.
 * Globe.gl orients its sphere so that lon=0° faces +Z and lat=90°N is +Y.
 */
function sunDirectionVector(lat: number, lng: number): [number, number, number] {
  const φ = (lat * Math.PI) / 180;
  const λ = (lng * Math.PI) / 180;
  return [
    Math.cos(φ) * Math.sin(λ), // east  → +X
    Math.sin(φ),                // north → +Y
    Math.cos(φ) * Math.cos(λ), // lon0  → +Z
  ];
}

/**
 * Approximate local solar time at a given longitude.
 * Returns "HH:MM (≈UTC±N)" — longitude/15 is not a real timezone but close
 * enough for a "where in the world" indicator.
 */
function getLocalTime(lng: number): string {
  const offsetH  = lng / 15;
  const localMs  = Date.now() + offsetH * 3_600_000;
  const d        = new Date(localMs);
  const h        = d.getUTCHours().toString().padStart(2, '0');
  const m        = d.getUTCMinutes().toString().padStart(2, '0');
  const sign     = offsetH >= 0 ? '+' : '';
  const rounded  = Math.round(offsetH);
  return `${h}:${m} (≈UTC${sign}${rounded})`;
}

// ── Scatter / cluster helpers ─────────────────────────────────────────────────

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export interface GlobePoint {
  id: string;
  lat: number;
  lng: number;
  pins: MemberPinDto[];
  isMine: boolean;
}

function clusterPins(pins: MemberPinDto[]): Array<{ lat: number; lng: number; municipality: string; pins: MemberPinDto[] }> {
  const map = new Map<string, { lat: number; lng: number; municipality: string; pins: MemberPinDto[] }>();
  for (const pin of pins) {
    const key = `${pin.lat.toFixed(4)},${pin.lng.toFixed(4)}`;
    if (!map.has(key)) map.set(key, { lat: pin.lat, lng: pin.lng, municipality: pin.municipality, pins: [] });
    map.get(key)!.pins.push(pin);
  }
  return Array.from(map.values());
}

// ── Style injection ───────────────────────────────────────────────────────────

function injectStyles() {
  if (document.getElementById('asop-globe-styles')) return;
  const s = document.createElement('style');
  s.id = 'asop-globe-styles';
  s.textContent = `
    @keyframes pinRise {
      from { opacity:0; transform:scaleY(0.1) translateY(4px); }
      to   { opacity:1; transform:scaleY(1)   translateY(0);   }
    }
  `;
  document.head.appendChild(s);
}

// ── Pin DOM factory ───────────────────────────────────────────────────────────
// Zero-height anchor so the pin tip sits exactly at the lat/lng coordinate
// regardless of whether globe.gl centers or top-left-positions the element.

function createPinElement(point: GlobePoint, isCluster: boolean, idx: number): HTMLElement {
  const named  = point.pins.filter((p) => p.displayName);
  const count  = point.pins.length;
  const isMine = point.isMine;
  const headPx = isCluster && count > 1 ? 26 : 18;
  const stemH  = 10;
  const accent = isMine ? '#f97316' : '#fb923c';
  const border = isMine ? '#ea580c' : '#f97316';
  const glow   = isMine ? '#f9731660' : '#fb923c40';
  const delay  = Math.min(idx * 18, 260);

  const anchor  = document.createElement('div');
  anchor.style.cssText = 'position:relative;width:0;height:0;overflow:visible;';

  const wrapper = document.createElement('div');
  wrapper.style.cssText = `
    position:absolute;bottom:0;left:${-(headPx / 2)}px;width:${headPx}px;
    display:flex;flex-direction:column;align-items:center;cursor:pointer;
    animation:pinRise 0.35s cubic-bezier(0.34,1.4,0.64,1) ${delay}ms both;
    transform-origin:bottom center;
  `;

  const head = document.createElement('div');
  head.style.cssText = `
    width:${headPx}px;height:${headPx}px;border-radius:50%;
    background:${accent};border:2px solid ${border};
    display:flex;align-items:center;justify-content:center;
    color:#080400;font-size:9px;font-weight:900;font-family:system-ui,sans-serif;
    box-shadow:0 0 10px ${glow},0 2px 6px rgba(0,0,0,.7);
    transition:transform .15s,box-shadow .15s;flex-shrink:0;
  `;
  if (isCluster && count > 1) head.textContent = String(count);

  const stem = document.createElement('div');
  stem.style.cssText = `
    width:2px;height:${stemH}px;
    background:linear-gradient(to bottom,${accent},transparent);flex-shrink:0;
  `;

  wrapper.appendChild(head);
  wrapper.appendChild(stem);

  // ── Tooltip ──────────────────────────────────────────────────────────────
  let tip: HTMLDivElement | null = null;

  function show() {
    const el = document.createElement('div');
    el.style.cssText = `
      position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);
      background:rgba(8,4,0,.96);border:1px solid ${border}55;border-radius:8px;
      padding:8px 12px;white-space:nowrap;z-index:100;pointer-events:none;
      font-family:system-ui,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,.8);
      min-width:140px;
    `;

    // Location
    const loc = document.createElement('div');
    loc.textContent = point.pins[0]?.municipality ?? '';
    loc.style.cssText = `
      font-size:11px;font-weight:700;color:${accent};
      text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;
    `;
    el.appendChild(loc);

    // Local time
    const refLng   = point.pins[0]?.lng ?? point.lng;
    const timeRow  = document.createElement('div');
    timeRow.style.cssText = 'display:flex;align-items:center;gap:4px;margin-bottom:3px;';
    const clockIcon = document.createElement('span');
    clockIcon.textContent = '🕐';
    clockIcon.style.cssText = 'font-size:10px;line-height:1;';
    const timeText = document.createElement('span');
    timeText.textContent = getLocalTime(refLng);
    timeText.style.cssText = 'font-size:10px;color:rgba(249,115,22,.55);';
    timeRow.appendChild(clockIcon);
    timeRow.appendChild(timeText);
    el.appendChild(timeRow);

    if (count > 1) {
      const cnt = document.createElement('div');
      cnt.textContent = `${count} member${count !== 1 ? 's' : ''}`;
      cnt.style.cssText = 'font-size:11px;color:rgba(251,146,60,.45);margin-top:3px;';
      el.appendChild(cnt);
    }

    if (named.length > 0) {
      const divider = document.createElement('div');
      divider.style.cssText = 'height:1px;background:rgba(249,115,22,.15);margin:5px 0;';
      el.appendChild(divider);
      named.forEach((p) => {
        const nm = document.createElement('div');
        nm.textContent = `• ${p.displayName}`;
        nm.style.cssText = 'font-size:11px;color:rgba(255,200,150,.85);';
        el.appendChild(nm);
      });
    }

    tip = el;
    wrapper.appendChild(el);
    head.style.transform = 'scale(1.2)';
    head.style.boxShadow = `0 0 18px ${glow},0 2px 8px rgba(0,0,0,.8)`;
  }

  function hide() {
    tip?.remove(); tip = null;
    head.style.transform = '';
    head.style.boxShadow = `0 0 10px ${glow},0 2px 6px rgba(0,0,0,.7)`;
  }

  wrapper.addEventListener('mouseenter', show);
  wrapper.addEventListener('mouseleave', hide);
  anchor.appendChild(wrapper);
  return anchor;
}

// ── Day/night GLSL shaders ────────────────────────────────────────────────────

const VERT = /* glsl */ `
  varying vec3 vWorldNormal;
  varying vec2 vUv;
  void main() {
    // World-space normal: sphere has uniform scale so mat3(modelMatrix) is exact
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D dayTexture;
  uniform sampler2D nightTexture;
  uniform vec3      sunDirection;   // unit vector in world space toward the sun
  varying vec3 vWorldNormal;
  varying vec2 vUv;
  void main() {
    float cosAngle = dot(vWorldNormal, sunDirection);
    // Soft terminator: blend over ±6° around the day/night boundary
    float blend    = smoothstep(-0.1, 0.1, cosAngle);
    vec4  day      = texture2D(dayTexture,   vUv);
    vec4  night    = texture2D(nightTexture, vUv);
    // Slightly dim city lights on the night side so they look natural
    gl_FragColor   = mix(night * 0.85, day, blend);
  }
`;

// ── GlobeWrapper ──────────────────────────────────────────────────────────────

interface GlobeWrapperProps {
  points: GlobePoint[];
  scatterProgress: number;
  onGlobeClick: (lat: number, lng: number) => void;
  onAltitudeChange: (alt: number) => void;
  onGlobeReady: (globe: any) => void;
}

const GlobeWrapper: FC<GlobeWrapperProps> = ({
  points, scatterProgress, onGlobeClick, onAltitudeChange, onGlobeReady,
}) => {
  const mountRef      = useRef<HTMLDivElement>(null);
  const globeRef      = useRef<any>(null);
  const materialRef   = useRef<any>(null);
  const latestPtsRef  = useRef<GlobePoint[]>(points);
  const latestScatRef = useRef<number>(scatterProgress);

  useEffect(() => { latestPtsRef.current  = points;          }, [points]);
  useEffect(() => { latestScatRef.current = scatterProgress; }, [scatterProgress]);

  // ── One-time init ────────────────────────────────────────────────────────
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    let destroyed   = false;
    let sunInterval: ReturnType<typeof setInterval> | null = null;

    injectStyles();

    // Load globe.gl and THREE in parallel; also start texture fetches immediately.
    Promise.all([
      import('globe.gl'),
      import('three').then(async (THREE) => {
        const loader  = new THREE.TextureLoader();
        const loadTex = (url: string): Promise<InstanceType<typeof THREE.Texture>> =>
          new Promise((res, rej) => loader.load(url, res as any, undefined, rej));
        const [dayTex, nightTex] = await Promise.all([
          loadTex('//unpkg.com/three-globe/example/img/earth-blue-marble.jpg'),
          loadTex('//unpkg.com/three-globe/example/img/earth-night.jpg'),
        ]);
        return { THREE, dayTex, nightTex };
      }),
    ]).then(([globeMod, { THREE, dayTex, nightTex }]) => {
      if (destroyed) { dayTex.dispose(); nightTex.dispose(); return; }

      const Globe    = (globeMod.default ?? globeMod) as any;
      const sunPos   = getSolarPosition(new Date());
      const [sx, sy, sz] = sunDirectionVector(sunPos.lat, sunPos.lng);

      // Build custom day/night shader material up front so the first rendered
      // frame already uses it — no texture-swap flash.
      const material = new THREE.ShaderMaterial({
        uniforms: {
          dayTexture:   { value: dayTex },
          nightTexture: { value: nightTex },
          sunDirection: { value: new THREE.Vector3(sx, sy, sz) },
        },
        vertexShader:   VERT,
        fragmentShader: FRAG,
      });
      materialRef.current = material;

      // Create globe, set custom material before first paint
      const globe = new Globe(el)
        .backgroundColor('rgba(0,0,0,0)')
        .showAtmosphere(true)
        .atmosphereColor('#b84400')
        .atmosphereAltitude(0.15)
        .htmlElementsData([])
        .htmlLat((d: GlobePoint) => d.lat)
        .htmlLng((d: GlobePoint) => d.lng)
        .htmlAltitude(0.012)
        .htmlTransitionDuration(0)
        .htmlElement(() => document.createElement('div'));

      globe.globeMaterial(material);
      globeRef.current = globe;
      onGlobeReady(globe);

      // Size on next paint (guarantees real clientWidth/Height)
      requestAnimationFrame(() => {
        if (!destroyed) globe.width(el.clientWidth).height(el.clientHeight);
      });

      // Apply any points already loaded before globe was ready (race condition)
      if (latestPtsRef.current.length > 0) {
        const pts = latestPtsRef.current;
        const sc  = latestScatRef.current;
        globe
          .htmlElementsData([...pts])
          .htmlElement((d: GlobePoint, idx: number) =>
            createPinElement(d, d.pins.length > 1 && sc < 0.5, idx ?? 0));
      }

      // Update sun direction every 30 s
      sunInterval = setInterval(() => {
        if (destroyed || !materialRef.current) return;
        const sp = getSolarPosition(new Date());
        const [x, y, z] = sunDirectionVector(sp.lat, sp.lng);
        materialRef.current.uniforms.sunDirection.value.set(x, y, z);
      }, 30_000);

      // Camera altitude → scatter
      const controls    = globe.controls();
      const camera      = globe.camera();
      const onCamChange = () => {
        if (!camera || !controls) return;
        const dist = camera.position.distanceTo(controls.target);
        onAltitudeChange(Math.max(0, dist / 100 - 1));
      };
      controls.addEventListener('change', onCamChange);

      globe.onGlobeClick((coords: { lat: number; lng: number }) => {
        onGlobeClick(coords.lat, coords.lng);
      });

      const obs = new ResizeObserver(() => {
        globe.width(el.clientWidth).height(el.clientHeight);
      });
      obs.observe(el);

      // Return inner cleanup (Promise.then can't return a cleanup, handled below)
      (el as any).__globeCleanup = () => {
        obs.disconnect();
        controls.removeEventListener('change', onCamChange);
      };
    }).catch(console.error);

    return () => {
      destroyed = true;
      if (sunInterval) clearInterval(sunInterval);
      const mat = materialRef.current;
      if (mat) {
        mat.uniforms.dayTexture.value?.dispose();
        mat.uniforms.nightTexture.value?.dispose();
        mat.dispose();
        materialRef.current = null;
      }
      (el as any).__globeCleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Update HTML elements when points / scatter change ────────────────────
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    globe
      .htmlElementsData([...points])
      .htmlElement((d: GlobePoint, idx: number) =>
        createPinElement(d, d.pins.length > 1 && scatterProgress < 0.5, idx ?? 0));
  }, [points, scatterProgress]);

  return <div ref={mountRef} style={{ width: '100%', height: '100%' }} />;
};

// ── Search box ────────────────────────────────────────────────────────────────

interface SearchBoxProps { guildId: string; onFlyTo: (lat: number, lng: number) => void; }

const SearchBox: FC<SearchBoxProps> = ({ guildId, onFlyTo }) => {
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState<MunicipalitySearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open,    setOpen]    = useState(false);
  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef   = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const q = query.trim();
    if (!q) { setResults([]); setOpen(false); return; }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await memberPinsApi.search(guildId, q);
        setResults(data); setOpen(data.length > 0);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 380);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [query, guildId]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  function pick(r: MunicipalitySearchResult) {
    onFlyTo(r.lat, r.lng); setQuery(r.municipality); setOpen(false);
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') { setOpen(false); setQuery(''); }
  }

  const panelBorder = 'rgba(249,115,22,0.22)';
  const orange      = '#f97316';

  return (
    <div ref={wrapRef} className="relative w-full">
      <div className="flex items-center gap-2 rounded-lg border px-3 py-2"
        style={{ background: 'rgba(8,4,0,.88)', borderColor: panelBorder, backdropFilter: 'blur(8px)' }}>
        {loading
          ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" style={{ color: orange }} />
          : <Search   className="h-3.5 w-3.5 shrink-0" style={{ color: 'rgba(249,115,22,.5)' }} />}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onKeyDown={onKey}
          placeholder="Search location…"
          className="flex-1 bg-transparent text-sm outline-none"
          style={{ color: 'rgba(255,200,150,.9)', '::placeholder': { color: 'rgba(249,115,22,.25)' } } as React.CSSProperties}
        />
        {query && (
          <button onClick={() => { setQuery(''); setResults([]); setOpen(false); }}
            className="rounded p-0.5 transition-colors hover:bg-orange-900/20"
            style={{ color: 'rgba(249,115,22,.45)' }}>
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute top-full mt-1 left-0 right-0 rounded-lg border overflow-hidden shadow-2xl z-50"
          style={{ background: 'rgba(10,5,0,.97)', borderColor: panelBorder }}>
          {results.map((r, i) => (
            <button key={i} onClick={() => pick(r)}
              className="w-full text-left px-3 py-2.5 text-sm transition-colors hover:bg-orange-950/60 border-b last:border-b-0"
              style={{ borderColor: 'rgba(249,115,22,.1)' }}>
              <div className="font-semibold leading-tight" style={{ color: '#fb923c' }}>{r.municipality}</div>
              <div className="text-xs mt-0.5 truncate" style={{ color: 'rgba(249,115,22,.38)' }}>{r.displayName}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────

export function MemberMapPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const { user }    = useAuth();
  const queryClient = useQueryClient();

  const [altitude,      setAltitude]      = useState(1.8);
  const [placingMode,   setPlacingMode]   = useState(false);
  const [geocoding,     setGeocoding]     = useState(false);
  const [geocodeResult, setGeocodeResult] = useState<{ lat: number; lng: number; municipality: string } | null>(null);
  const [showName,      setShowName]      = useState(false);
  const [formError,     setFormError]     = useState<string | null>(null);
  // Clock tick: force re-render every 60 s so local time stays current in the panel
  const [, setClockTick] = useState(0);

  const placingModeRef   = useRef(placingMode);
  const globeInstanceRef = useRef<any>(null);
  useEffect(() => { placingModeRef.current = placingMode; }, [placingMode]);

  useEffect(() => {
    const id = setInterval(() => setClockTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: allPins = [], isLoading: pinsLoading } = useQuery({
    queryKey:  ['member-pins', guildId],
    queryFn:   () => memberPinsApi.list(guildId!),
    enabled:   !!guildId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const { data: myPin } = useQuery({
    queryKey:  ['member-pins', guildId, 'mine'],
    queryFn:   () => memberPinsApi.getMine(guildId!),
    enabled:   !!guildId,
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

  // ── Scatter ──────────────────────────────────────────────────────────────
  const scatterProgress = useMemo(() => 1 - smoothstep(0.12, 0.5, altitude), [altitude]);

  const globePoints = useMemo((): GlobePoint[] => {
    const clusters = clusterPins(allPins);
    const myPinId  = myPin?.id;
    return clusters.flatMap((cluster): GlobePoint[] => {
      const isMine = cluster.pins.some((p) => p.id === myPinId);
      if (scatterProgress < 0.5 || cluster.pins.length === 1) {
        return [{ id: `c-${cluster.lat.toFixed(4)}-${cluster.lng.toFixed(4)}`, lat: cluster.lat, lng: cluster.lng, pins: cluster.pins, isMine }];
      }
      const radius   = Math.min(0.25 + cluster.pins.length * 0.04, 0.9);
      const progress = (scatterProgress - 0.5) * 2;
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

  // ── Globe callbacks ──────────────────────────────────────────────────────
  const handleGlobeReady = useCallback((globe: any) => { globeInstanceRef.current = globe; }, []);

  const handleGlobeClick = useCallback(async (lat: number, lng: number) => {
    if (!placingModeRef.current || !guildId) return;
    setGeocoding(true); setGeocodeResult(null); setFormError(null);
    try {
      const result = await memberPinsApi.geocode(guildId, lat, lng);
      setGeocodeResult(result);
    } catch { setFormError('Could not identify location. Try clicking a different spot.'); }
    finally { setGeocoding(false); }
  }, [guildId]);

  function flyTo(lat: number, lng: number) {
    globeInstanceRef.current?.pointOfView({ lat, lng, altitude: 0.6 }, 1200);
  }

  function startPlacing()    { setPlacingMode(true);  setGeocodeResult(null); setFormError(null); }
  function cancelPlacement() { setPlacingMode(false); setGeocodeResult(null); setFormError(null); }

  async function useMyLocation() {
    if (!navigator.geolocation) { setFormError('Geolocation not supported by your browser.'); return; }
    setPlacingMode(true); setGeocoding(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (!guildId) return;
        try {
          const result = await memberPinsApi.geocode(guildId, pos.coords.latitude, pos.coords.longitude);
          setGeocodeResult(result);
          flyTo(result.lat, result.lng);
        } catch { setFormError('Could not identify your location.'); }
        finally { setGeocoding(false); }
      },
      () => { setGeocoding(false); setFormError('Location access denied. Click the globe to place manually.'); },
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
  const myPinLocalTime = myPin ? getLocalTime(myPin.lng) : null;

  // ── Palette tokens (inline — avoids Tailwind CSS-variable collisions) ────
  const panelBg     = 'rgba(10,5,0,0.90)';
  const panelBorder = 'rgba(249,115,22,0.22)';
  const headerBg    = 'rgba(249,115,22,0.09)';
  const headerBord  = 'rgba(249,115,22,0.18)';
  const orange      = '#f97316';
  const orangeDim   = 'rgba(249,115,22,0.50)';
  const textMid     = 'rgba(255,200,150,0.52)';
  const textBright  = 'rgba(255,200,150,0.90)';

  const panelCard: React.CSSProperties = {
    borderRadius: '12px', border: `1px solid ${panelBorder}`,
    background: panelBg, boxShadow: '0 4px 32px rgba(0,0,0,0.70)',
    backdropFilter: 'blur(10px)', overflow: 'hidden',
  };
  const cardHdr: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '8px',
    padding: '10px 14px', borderBottom: `1px solid ${headerBord}`, background: headerBg,
  };

  return (
    // No overflow-hidden here: it would flatten globe.gl's CSS3D transforms
    <div className="h-full -m-6 relative" style={{ background: '#080400' }}>

      {/* ── Globe ─────────────────────────────────────────────────────── */}
      <div className="absolute inset-0">
        {pinsLoading && (
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <Loader2 className="h-8 w-8 animate-spin opacity-30" style={{ color: orange }} />
          </div>
        )}
        <GlobeWrapper
          points={globePoints}
          scatterProgress={scatterProgress}
          onGlobeClick={handleGlobeClick}
          onAltitudeChange={setAltitude}
          onGlobeReady={handleGlobeReady}
        />
      </div>

      {/* ── Placing banner ─────────────────────────────────────────────── */}
      {placingMode && !geocodeResult && !geocoding && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium pointer-events-auto"
          style={{ background: 'rgba(8,4,0,.85)', border: `1px solid ${orange}55`, color: '#fb923c', backdropFilter: 'blur(8px)', boxShadow: '0 4px 20px rgba(0,0,0,.6)' }}>
          <Crosshair className="h-4 w-4 animate-pulse" />
          Click anywhere on the globe to drop your pin
          <button onClick={cancelPlacement} className="ml-1 rounded-full p-0.5 transition-colors hover:bg-orange-900/30">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ── Geocoding spinner ──────────────────────────────────────────── */}
      {geocoding && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 rounded-full px-4 py-2 text-sm pointer-events-none"
          style={{ background: 'rgba(8,4,0,.85)', border: `1px solid ${panelBorder}`, color: textMid, backdropFilter: 'blur(8px)' }}>
          <Loader2 className="h-4 w-4 animate-spin" style={{ color: orange }} />
          Identifying location…
        </div>
      )}

      {/* ── Placement confirmation ─────────────────────────────────────── */}
      {geocodeResult && !geocoding && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 w-80 pointer-events-auto"
          style={panelCard}>
          <div style={cardHdr}>
            <MapPin className="h-4 w-4 shrink-0" style={{ color: orange }} />
            <span className="text-xs font-bold uppercase tracking-widest" style={{ color: orangeDim }}>
              {hasMyPin ? 'Update Pin' : 'Place Pin'}
            </span>
            <button onClick={cancelPlacement} className="ml-auto rounded p-0.5 transition-colors hover:bg-orange-900/20"
              style={{ color: textMid }}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="px-4 py-4 space-y-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: textMid }}>Location</p>
              <p className="text-base font-semibold leading-snug" style={{ color: textBright }}>{geocodeResult.municipality}</p>
              <div className="flex items-center gap-1.5 mt-1.5">
                <Clock className="h-3 w-3 shrink-0" style={{ color: orangeDim }} />
                <span className="text-xs" style={{ color: orangeDim }}>
                  {getLocalTime(geocodeResult.lng)}
                </span>
              </div>
              <p className="text-xs mt-1" style={{ color: 'rgba(249,115,22,.3)' }}>
                {geocodeResult.lat.toFixed(3)}°, {geocodeResult.lng.toFixed(3)}°
              </p>
            </div>

            {/* Name toggle */}
            <div className="flex items-center justify-between py-2.5 px-3 rounded-lg"
              style={{ background: 'rgba(249,115,22,.06)', border: `1px solid ${panelBorder}` }}>
              <div className="min-w-0 mr-3">
                <p className="text-sm font-medium" style={{ color: textBright }}>Show my name</p>
                <p className="text-xs mt-0.5 truncate" style={{ color: textMid }}>
                  {showName
                    ? `Visible as "${user?.globalName ?? user?.username ?? '…'}"`
                    : 'Anonymous — no one sees your name'}
                </p>
              </div>
              <button onClick={() => setShowName((v) => !v)} role="switch" aria-checked={showName}
                className="relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 transition-colors"
                style={{ background: showName ? orange : 'rgba(40,20,0,.8)', borderColor: showName ? orange : panelBorder }}>
                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform mt-px ${showName ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
              </button>
            </div>

            {formError && <p className="text-xs text-red-400">{formError}</p>}

            <div className="flex gap-2">
              <button onClick={confirmPin} disabled={upsertMutation.isPending}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
                style={{ background: orange, color: '#080400', border: `1px solid ${orange}` }}>
                {upsertMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                {upsertMutation.isPending ? 'Saving…' : (hasMyPin ? 'Update' : 'Place Pin')}
              </button>
              <button onClick={cancelPlacement}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                style={{ color: textMid, border: `1px solid ${panelBorder}`, background: 'transparent' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Side panel ────────────────────────────────────────────────── */}
      <div className="absolute top-4 right-4 z-20 flex flex-col gap-3 pointer-events-none" style={{ width: '244px' }}>

        {/* Search */}
        {guildId && (
          <div className="pointer-events-auto">
            <SearchBox guildId={guildId} onFlyTo={flyTo} />
          </div>
        )}

        {/* Stats */}
        <div style={panelCard} className="pointer-events-auto">
          <div style={cardHdr}>
            <Globe2 className="h-4 w-4 shrink-0" style={{ color: orange }} />
            <span className="text-xs font-bold uppercase tracking-widest" style={{ color: orangeDim }}>
              Member Map
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 px-4 py-3">
            <div>
              <p className="text-2xl font-black tabular-nums" style={{ color: textBright }}>{totalMembers}</p>
              <p className="text-xs uppercase tracking-wider mt-0.5" style={{ color: textMid }}>Pinned</p>
            </div>
            <div>
              <p className="text-2xl font-black tabular-nums" style={{ color: textBright }}>{namedCount}</p>
              <p className="text-xs uppercase tracking-wider mt-0.5" style={{ color: textMid }}>Named</p>
            </div>
          </div>
        </div>

        {/* Your Pin */}
        <div style={panelCard} className="pointer-events-auto">
          <div style={cardHdr}>
            <MapPin className="h-4 w-4 shrink-0" style={{ color: '#34d399' }} />
            <span className="text-xs font-bold uppercase tracking-widest" style={{ color: orangeDim }}>
              Your Pin
            </span>
          </div>

          {hasMyPin ? (
            <div className="px-4 py-3 space-y-2.5">
              <div>
                <p className="text-sm font-semibold leading-snug" style={{ color: textBright }}>{myPin!.municipality}</p>
                {/* Live local clock */}
                <div className="flex items-center gap-1.5 mt-1">
                  <Clock className="h-3 w-3 shrink-0" style={{ color: orangeDim }} />
                  <span className="text-xs" style={{ color: orangeDim }}>{myPinLocalTime}</span>
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  {myPin!.displayName
                    ? <Eye     className="h-3.5 w-3.5 shrink-0" style={{ color: '#34d399' }} />
                    : <EyeOff  className="h-3.5 w-3.5 shrink-0" style={{ color: textMid }} />}
                  <span className="text-xs truncate" style={{ color: textMid }}>
                    {myPin!.displayName ? `"${myPin!.displayName}"` : 'Anonymous'}
                  </span>
                </div>
              </div>
              <div className="flex gap-2 pt-0.5">
                <button onClick={startPlacing} disabled={placingMode || geocoding}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
                  style={{ background: orange, color: '#080400', border: `1px solid ${orange}` }}>
                  <RotateCcw className="h-3 w-3" /> Update
                </button>
                <button onClick={() => removeMutation.mutate()} disabled={removeMutation.isPending}
                  className="inline-flex items-center rounded-md px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50"
                  style={{ color: '#ef4444', border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.08)' }}
                  title="Remove pin">
                  {removeMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                </button>
              </div>
            </div>
          ) : (
            <div className="px-4 py-3 space-y-3">
              <p className="text-xs leading-snug" style={{ color: textMid }}>
                You haven't placed a pin yet. Mark your location to appear on the guild map.
              </p>
              {formError && <p className="text-xs text-red-400">{formError}</p>}
              <div className="flex flex-col gap-2">
                <button onClick={startPlacing} disabled={placingMode || geocoding}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50"
                  style={{ background: orange, color: '#080400', border: `1px solid ${orange}` }}>
                  <MapPin className="h-3.5 w-3.5" />
                  {placingMode ? 'Click the globe…' : 'Drop Pin'}
                </button>
                <button onClick={useMyLocation} disabled={placingMode || geocoding}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50"
                  style={{ color: textMid, border: `1px solid ${panelBorder}`, background: 'transparent' }}>
                  <Crosshair className="h-3.5 w-3.5" /> Use My Location
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Hint */}
        <p className="text-center text-xs leading-snug px-1 pointer-events-none"
          style={{ color: 'rgba(249,115,22,.18)' }}>
          Drag to spin · Scroll to zoom · Zoom in to expand clusters
        </p>
      </div>
    </div>
  );
}
