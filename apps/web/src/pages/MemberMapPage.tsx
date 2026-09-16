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
 * Returns local time at a geographic location.
 *
 * When an IANA timezone string is supplied (e.g. "America/Chicago") the
 * browser's Intl API is used for a fully DST-aware result like "13:05 (CDT)".
 * Falls back to a longitude-based solar estimate ("HH:MM (≈UTC±N)") for pins
 * placed before the timezone field was added, or if Intl throws.
 */
function getLocalTime(lng: number, timezone?: string | null): string {
  if (timezone) {
    try {
      const now   = new Date();
      const parts = new Intl.DateTimeFormat('en-US', {
        hour:         '2-digit',
        minute:       '2-digit',
        hour12:       false,
        timeZone:     timezone,
        timeZoneName: 'short',          // "CDT", "EST", "GMT+2", etc.
      }).formatToParts(now);
      const h    = parts.find((p) => p.type === 'hour')?.value   ?? '??';
      const m    = parts.find((p) => p.type === 'minute')?.value ?? '??';
      const abbr = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
      return `${h}:${m}${abbr ? ` (${abbr})` : ''}`;
    } catch {
      /* fall through */
    }
  }
  // Longitude-based solar estimate — no DST awareness
  const offsetH = lng / 15;
  const localMs = Date.now() + offsetH * 3_600_000;
  const d       = new Date(localMs);
  const h       = d.getUTCHours().toString().padStart(2, '0');
  const m       = d.getUTCMinutes().toString().padStart(2, '0');
  const sign    = offsetH >= 0 ? '+' : '';
  const rounded = Math.round(offsetH);
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

// ── Module-level pin-tooltip state ───────────────────────────────────────────
// Tracks the currently click-pinned tooltip so clicking the globe or any other
// pin dismisses it. Uses a single document listener (added once on first pin).

let activeDismiss: (() => void) | null = null;
let docListenerAdded = false;

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
  const namedPins = point.pins.filter((p) => p.displayName);
  const anonCount = point.pins.filter((p) => !p.displayName).length;
  const count  = point.pins.length;
  const isMine = point.isMine;
  const headPx = isCluster && count > 1 ? 26 : 18;
  const stemH  = 10;
  const accent = isMine ? '#f97316' : '#fb923c';
  const border = isMine ? '#ea580c' : '#f97316';
  const glow   = isMine ? '#f9731660' : '#fb923c40';
  const delay  = Math.min(idx * 18, 260);

  // Register a single document click handler the first time any pin is created.
  // Clicking outside a pin (anywhere on the globe canvas or page) dismisses the
  // currently click-pinned tooltip.
  if (!docListenerAdded) {
    docListenerAdded = true;
    document.addEventListener('click', () => { activeDismiss?.(); });
  }

  // pointer-events:auto on anchor is critical: globe.gl's CSS3D renderer sets
  // pointer-events:none on its container div, and children inherit it unless
  // they explicitly override. Without this, mouseenter/click never fire.
  const anchor  = document.createElement('div');
  anchor.style.cssText = 'position:relative;width:0;height:0;overflow:visible;pointer-events:auto;';

  const wrapper = document.createElement('div');
  wrapper.style.cssText = `
    position:absolute;bottom:0;left:${-(headPx / 2)}px;width:${headPx}px;
    display:flex;flex-direction:column;align-items:center;cursor:pointer;
    animation:pinRise 0.35s cubic-bezier(0.34,1.4,0.64,1) ${delay}ms both;
    transform-origin:bottom center;pointer-events:auto;
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
  // Appears on hover; click pins it open until dismissed.

  let tip: HTMLDivElement | null = null;
  let pinned = false;

  /** Parse "City, State, Country" into a two-part display. */
  function parseMunicipality(m: string): { city: string; region: string } {
    const parts = m.split(', ');
    return { city: parts[0] ?? m, region: parts.slice(1).join(', ') };
  }

  function buildTip(): HTMLDivElement {
    const el = document.createElement('div');
    // pointer-events:auto (not none): letting the tooltip itself receive events
    // prevents mouseleave from firing on wrapper when the cursor moves from the
    // pin head up into the tooltip card, which would otherwise hide it instantly.
    el.style.cssText = `
      position:absolute;bottom:calc(100% + 10px);left:50%;transform:translateX(-50%);
      background:rgba(12,5,0,.97);border:1px solid ${border}88;border-radius:10px;
      padding:11px 14px;z-index:100;pointer-events:auto;
      font-family:system-ui,sans-serif;
      box-shadow:0 8px 28px rgba(0,0,0,.9),0 0 0 1px rgba(249,115,22,.06);
      min-width:160px;max-width:250px;
    `;

    // ── Location: City on its own line, region (state, country) smaller below
    const refMunicipality = point.pins[0]?.municipality ?? '';
    const { city, region } = parseMunicipality(refMunicipality);

    const cityEl = document.createElement('div');
    cityEl.textContent = city;
    cityEl.style.cssText = `
      font-size:14px;font-weight:800;color:${accent};
      letter-spacing:.01em;white-space:nowrap;
    `;
    el.appendChild(cityEl);

    if (region) {
      const regionEl = document.createElement('div');
      regionEl.textContent = region;
      regionEl.style.cssText = `
        font-size:12px;color:rgba(255,215,170,.68);
        margin-top:2px;margin-bottom:6px;white-space:nowrap;
      `;
      el.appendChild(regionEl);
    }

    // ── Divider
    const div1 = document.createElement('div');
    div1.style.cssText = 'height:1px;background:rgba(249,115,22,.22);margin:6px 0;';
    el.appendChild(div1);

    // ── Local time (IANA-accurate when timezone is stored, fallback to solar estimate)
    const refPin  = point.pins[0];
    const refLng  = refPin?.lng ?? point.lng;
    const timeRow = document.createElement('div');
    timeRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;';
    const clockSpan = document.createElement('span');
    clockSpan.textContent = '🕐';
    clockSpan.style.cssText = 'font-size:12px;line-height:1;';
    const timeSpan = document.createElement('span');
    timeSpan.textContent = getLocalTime(refLng, refPin?.timezone);
    timeSpan.style.cssText = 'font-size:12px;color:rgba(249,115,22,.9);font-weight:500;';
    timeRow.appendChild(clockSpan);
    timeRow.appendChild(timeSpan);
    el.appendChild(timeRow);

    // ── Divider
    const div2 = document.createElement('div');
    div2.style.cssText = 'height:1px;background:rgba(249,115,22,.22);margin:6px 0;';
    el.appendChild(div2);

    if (count === 1) {
      // ── Single pin: show who placed it
      const pin = point.pins[0];
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;';

      const lbl = document.createElement('span');
      lbl.textContent = 'Placed by';
      lbl.style.cssText = 'font-size:11px;color:rgba(255,200,150,.55);letter-spacing:.03em;';
      row.appendChild(lbl);

      const nameEl = document.createElement('span');
      if (pin?.displayName) {
        nameEl.textContent = pin.displayName;
        nameEl.style.cssText = 'font-size:12px;color:rgba(255,220,180,1);font-weight:700;';
      } else {
        nameEl.textContent = 'Anonymous';
        nameEl.style.cssText = 'font-size:12px;color:rgba(249,115,22,.42);font-style:italic;';
      }
      row.appendChild(nameEl);
      el.appendChild(row);
    } else {
      // ── Cluster: member count + named list + anonymous count
      const cntEl = document.createElement('div');
      cntEl.textContent = `${count} members`;
      cntEl.style.cssText = 'font-size:12px;color:rgba(251,146,60,.7);margin-bottom:4px;font-weight:600;';
      el.appendChild(cntEl);

      if (namedPins.length > 0 || anonCount > 0) {
        const div3 = document.createElement('div');
        div3.style.cssText = 'height:1px;background:rgba(249,115,22,.22);margin:6px 0;';
        el.appendChild(div3);

        namedPins.forEach((p) => {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:3px;';
          const icon = document.createElement('span');
          icon.textContent = '👤';
          icon.style.cssText = 'font-size:11px;line-height:1;';
          const nm = document.createElement('span');
          nm.textContent = p.displayName!;
          nm.style.cssText = 'font-size:12px;color:rgba(255,220,180,1);font-weight:600;';
          row.appendChild(icon);
          row.appendChild(nm);
          el.appendChild(row);
        });

        if (anonCount > 0) {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;gap:6px;';
          const icon = document.createElement('span');
          icon.textContent = '👤';
          icon.style.cssText = 'font-size:11px;line-height:1;';
          const nm = document.createElement('span');
          nm.textContent = `${anonCount} anonymous`;
          nm.style.cssText = 'font-size:12px;color:rgba(249,115,22,.45);font-style:italic;';
          row.appendChild(icon);
          row.appendChild(nm);
          el.appendChild(row);
        }
      }
    }

    // ── Subtle "click to pin / close" affordance at the bottom
    const hint = document.createElement('div');
    hint.style.cssText = `
      font-size:10px;color:rgba(249,115,22,.32);margin-top:8px;
      text-align:center;letter-spacing:.04em;
    `;
    hint.textContent = pinned ? 'click pin to close' : 'click to keep open';
    el.appendChild(hint);

    return el;
  }

  function show() {
    if (tip) return;
    tip = buildTip();
    wrapper.appendChild(tip);
    head.style.transform = 'scale(1.2)';
    head.style.boxShadow = `0 0 18px ${glow},0 2px 8px rgba(0,0,0,.8)`;
  }

  function dismiss() {
    pinned = false;
    tip?.remove(); tip = null;
    head.style.transform = '';
    head.style.boxShadow = `0 0 10px ${glow},0 2px 6px rgba(0,0,0,.7)`;
    if (activeDismiss === dismiss) activeDismiss = null;
  }

  wrapper.addEventListener('mouseenter', () => { if (!pinned) show(); });
  wrapper.addEventListener('mouseleave', () => { if (!pinned) dismiss(); });
  wrapper.addEventListener('click', (e) => {
    e.stopPropagation(); // prevent document listener from immediately dismissing
    if (pinned) {
      dismiss();
    } else {
      // Dismiss any previously pinned tooltip first, then pin this one
      activeDismiss?.();
      show();
      pinned = true;
      activeDismiss = dismiss;
      // Rebuild tip so the hint text reflects the pinned state
      tip?.remove(); tip = null;
      tip = buildTip();
      wrapper.appendChild(tip);
    }
  });

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

// ── StarField ─────────────────────────────────────────────────────────────────
// 2D canvas behind the globe: twinkling stars + occasional shooting stars.
// Placed before the globe div in DOM order so it naturally sits behind the
// transparent WebGL canvas without needing an explicit z-index war.

interface StarParticle {
  x: number; y: number;
  r: number;
  baseA: number;           // base alpha (brightness)
  phase: number;           // current twinkling phase
  twinkleSpeed: number;    // radians per second
  /** 0 = white, 1 = cool blue, 2 = warm gold */
  hue: 0 | 1 | 2;
}

interface ShootingParticle {
  x: number; y: number;
  nx: number; ny: number;  // normalized direction
  vel: number;             // px / s
  tail: number;            // tail length px
  totalDist: number;       // total travel distance px
  gone: number;            // distance already traveled
}

const StarField: FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const STAR_COUNT = 340;
    let stars: StarParticle[] = [];
    let shooting: ShootingParticle[] = [];
    let nextShootAt = 0;
    let rafId = 0;
    let lastT = 0;

    // Star colour variants
    const STAR_COLORS = [
      '255,255,255',    // white
      '190,210,255',    // cool blue
      '255,240,190',    // warm gold
    ] as const;

    function init() {
      const w = canvas!.offsetWidth  || canvas!.clientWidth  || 800;
      const h = canvas!.offsetHeight || canvas!.clientHeight || 600;
      canvas!.width  = w;
      canvas!.height = h;

      // Distribute hues: ~70% white, ~20% blue, ~10% gold
      stars = Array.from({ length: STAR_COUNT }, () => {
        const rnd = Math.random();
        const hue: 0 | 1 | 2 = rnd < 0.70 ? 0 : rnd < 0.90 ? 1 : 2;
        // Size buckets: small majority, a few medium, rare large
        const sizeBucket = Math.random();
        const r = sizeBucket < 0.82
          ? Math.random() * 0.65 + 0.15   // 0.15–0.80 (small)
          : sizeBucket < 0.96
            ? Math.random() * 0.70 + 0.80 // 0.80–1.50 (medium)
            : Math.random() * 0.80 + 1.50; // 1.50–2.30 (bright)
        return {
          x:           Math.random() * w,
          y:           Math.random() * h,
          r,
          baseA:       Math.random() * 0.50 + 0.28,
          phase:       Math.random() * Math.PI * 2,
          twinkleSpeed: Math.random() * 1.0 + 0.25,
          hue,
        };
      });
    }

    function spawnShooting() {
      const w = canvas!.width;
      // Angle 28–62° below horizontal; randomly left-to-right or right-to-left
      const angleDeg = 28 + Math.random() * 34;
      const rad = angleDeg * Math.PI / 180;
      const goRight = Math.random() > 0.4; // slightly prefer left→right
      const nx = goRight ?  Math.cos(rad) : -Math.cos(rad);
      const ny = Math.sin(rad);
      // Spawn off-screen top; X biased toward the incoming side
      const spawnX = goRight
        ? -120 + Math.random() * w * 0.55
        :  w * 0.45 + Math.random() * w * 0.55 + 120;
      const spawnY = -60 - Math.random() * 140;
      shooting.push({
        x: spawnX, y: spawnY,
        nx, ny,
        vel:       480 + Math.random() * 420,
        tail:      80  + Math.random() * 140,
        totalDist: 280 + Math.random() * 380,
        gone: 0,
      });
    }

    function frame(now: number) {
      if (lastT === 0) lastT = now;
      const dt = Math.min((now - lastT) / 1000, 0.05);
      lastT = now;

      const w = canvas!.width;
      const h = canvas!.height;
      ctx!.clearRect(0, 0, w, h);

      // ── Twinkling stars ───────────────────────────────────────────────────
      for (const s of stars) {
        s.phase += s.twinkleSpeed * dt;
        // Two-frequency shimmer so stars feel organic, not mechanical
        const shimmer = 0.62 + 0.25 * Math.sin(s.phase) + 0.13 * Math.sin(s.phase * 1.7 + 1.2);
        const a = s.baseA * shimmer;
        ctx!.beginPath();
        ctx!.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${STAR_COLORS[s.hue]},${a.toFixed(3)})`;
        ctx!.fill();
      }

      // ── Spawn shooting star ───────────────────────────────────────────────
      if (now >= nextShootAt) {
        spawnShooting();
        // 10% chance of a quick second burst shortly after
        if (Math.random() < 0.10) {
          setTimeout(() => { if (canvas) spawnShooting(); }, 400 + Math.random() * 600);
        }
        nextShootAt = now + 3200 + Math.random() * 5500;
      }

      // ── Shooting stars ────────────────────────────────────────────────────
      shooting = shooting.filter((s) => s.gone < s.totalDist);
      for (const s of shooting) {
        s.gone += s.vel * dt;
        s.x    += s.nx  * s.vel * dt;
        s.y    += s.ny  * s.vel * dt;

        const progress = Math.min(s.gone / s.totalDist, 1);
        // Bell curve: smooth fade-in and fade-out
        const alpha = Math.sin(Math.PI * progress);

        // Tail gradient: bright head → transparent tail
        const tx = s.x - s.nx * s.tail;
        const ty = s.y - s.ny * s.tail;
        const grad = ctx!.createLinearGradient(s.x, s.y, tx, ty);
        grad.addColorStop(0,    `rgba(255,255,248,${(alpha * 0.92).toFixed(3)})`);
        grad.addColorStop(0.20, `rgba(255,245,220,${(alpha * 0.55).toFixed(3)})`);
        grad.addColorStop(0.55, `rgba(200,220,255,${(alpha * 0.22).toFixed(3)})`);
        grad.addColorStop(1,    `rgba(180,210,255,0)`);

        ctx!.beginPath();
        ctx!.moveTo(s.x, s.y);
        ctx!.lineTo(tx, ty);
        ctx!.strokeStyle = grad;
        ctx!.lineWidth   = 1.5;
        ctx!.stroke();

        // Bright head: soft glow + sharp core
        const glowR = 3.5;
        const glow  = ctx!.createRadialGradient(s.x, s.y, 0, s.x, s.y, glowR);
        glow.addColorStop(0,   `rgba(255,255,255,${(alpha * 0.90).toFixed(3)})`);
        glow.addColorStop(0.4, `rgba(255,250,230,${(alpha * 0.45).toFixed(3)})`);
        glow.addColorStop(1,   `rgba(200,220,255,0)`);
        ctx!.beginPath();
        ctx!.arc(s.x, s.y, glowR, 0, Math.PI * 2);
        ctx!.fillStyle = glow;
        ctx!.fill();
      }

      rafId = requestAnimationFrame(frame);
    }

    init();
    // First shooting star appears 1–3 s after load so the page doesn't feel
    // static for too long.
    nextShootAt = performance.now() + 1000 + Math.random() * 2000;
    rafId = requestAnimationFrame(frame);

    const ro = new ResizeObserver(init);
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      aria-hidden="true"
    />
  );
};

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

interface SearchBoxProps {
  guildId:    string;
  onFlyTo:    (lat: number, lng: number) => void;
  onPinHere:  (result: MunicipalitySearchResult) => void;
}

const SearchBox: FC<SearchBoxProps> = ({ guildId, onFlyTo, onPinHere }) => {
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

  function fly(r: MunicipalitySearchResult) {
    onFlyTo(r.lat, r.lng); setQuery(r.municipality); setOpen(false);
  }
  function pin(e: React.MouseEvent, r: MunicipalitySearchResult) {
    e.stopPropagation();
    onPinHere(r); setQuery(r.municipality); setOpen(false);
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
          style={{ color: 'rgba(255,200,150,.9)' } as React.CSSProperties}
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
            <div key={i}
              className="flex items-stretch border-b last:border-b-0"
              style={{ borderColor: 'rgba(249,115,22,.1)' }}>

              {/* Click to fly the globe there */}
              <button
                onClick={() => fly(r)}
                className="flex-1 min-w-0 text-left px-3 py-2.5 transition-colors hover:bg-orange-950/50">
                <div className="text-sm font-semibold leading-tight" style={{ color: '#fb923c' }}>
                  {r.municipality}
                </div>
                <div className="text-xs mt-0.5 truncate" style={{ color: 'rgba(249,115,22,.35)' }}>
                  {r.displayName}
                </div>
              </button>

              {/* Pin button — place pin directly at this location */}
              <button
                onClick={(e) => pin(e, r)}
                title="Place my pin here"
                className="flex items-center gap-1 px-3 py-2 shrink-0 text-xs font-medium transition-colors hover:bg-orange-500/15"
                style={{
                  color: orange,
                  borderLeft: '1px solid rgba(249,115,22,.15)',
                }}>
                <MapPin className="h-3.5 w-3.5" />
                <span>Pin</span>
              </button>
            </div>
          ))}

          <div className="px-3 py-1.5 text-center text-xs"
            style={{ color: 'rgba(249,115,22,.2)', borderTop: '1px solid rgba(249,115,22,.08)' }}>
            Click a result to fly there · Pin to place your marker
          </div>
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

  /** Called when the user clicks "Pin" on a search result.
   *  Bypasses the globe-click flow and goes straight to the confirmation dialog. */
  function handlePinHere(result: MunicipalitySearchResult) {
    setGeocodeResult({ lat: result.lat, lng: result.lng, municipality: result.municipality });
    setPlacingMode(false);   // dismiss any active "click the globe" banner
    setFormError(null);
    flyTo(result.lat, result.lng);
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
  const myPinLocalTime = myPin ? getLocalTime(myPin.lng, myPin.timezone) : null;

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

      {/* ── Star field — must come before globe so it sits behind the transparent WebGL canvas */}
      <StarField />

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
            <SearchBox guildId={guildId} onFlyTo={flyTo} onPinHere={handlePinHere} />
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
