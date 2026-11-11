import { useId, useMemo, useState } from 'react';
import { contours } from 'd3-contour';
import { cn } from '@/lib/utils';

export type HeatmapStyle = 'block' | 'dots' | 'hour-chart' | 'day-chart' | 'contour';

interface HeatMapProps {
  grid: number[][];       // [7][24] — row=day(0=Sun), col=hour
  max: number;
  style: HeatmapStyle;
  className?: string;
  // Optional second overlay for ratio (used in event panel)
  ratioGrid?: (number | null)[][];
  showRatio?: boolean;    // if true, color by ratioGrid instead of grid
  // Dual-layer contour: when provided, grid = text (orange), overlayGrid = voice (yellow)
  overlayGrid?: number[][];
  /** What a square means, in words ("Saturday 8 PM: 12 people on average · 3 events"); shown on hover or tap (v1.24.0) */
  describe?: (day: number, hour: number) => string;
  /** The key's two ends ("Less" / "More", "0%" / "100%") */
  legend?: { low: string; high: string; empty?: string };
}

// 2-D separable Gaussian: horizontal pass (wrapping) then vertical pass (clamping).
// Ratios are not smoothed since they aren't linearly additive.
function gaussianSmooth(grid: number[][]): number[][] {
  const HOURS = 24, DAYS = 7;

  const makeWeights = (sigma: number, radius: number) =>
    Array.from({ length: radius * 2 + 1 }, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma)));

  // Horizontal pass — sigma=1, radius=3, wrapping at hour boundaries
  const hWeights = makeWeights(1.0, 3);
  const hTotal   = hWeights.reduce((a, b) => a + b, 0);
  const hSmoothed = grid.map((row) =>
    Array.from({ length: HOURS }, (_, h) => {
      let sum = 0;
      for (let k = -3; k <= 3; k++) {
        const srcH = ((h + k) % HOURS + HOURS) % HOURS;
        sum += (row[srcH] ?? 0) * (hWeights[k + 3] ?? 0);
      }
      return sum / hTotal;
    })
  );

  // Vertical pass — sigma=1, radius=2, clamping at day boundaries
  const vWeights = makeWeights(1.0, 2);
  return Array.from({ length: DAYS }, (_, d) =>
    Array.from({ length: HOURS }, (_, h) => {
      let sum = 0, total = 0;
      for (let k = -2; k <= 2; k++) {
        const srcD = Math.max(0, Math.min(DAYS - 1, d + k));
        const w = vWeights[k + 2] ?? 0;
        sum += (hSmoothed[srcD]?.[h] ?? 0) * w;
        total += w;
      }
      return sum / total;
    })
  );
}

// Converts GeoJSON MultiPolygon coordinates to an SVG path string.
function geoJsonToPath(coordinates: [number, number][][][]): string {
  return coordinates.map((polygon) =>
    polygon.map((ring) =>
      ring.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(3)} ${y.toFixed(3)}`).join(' ') + ' Z'
    ).join(' ')
  ).join(' ');
}

const DAY_LABELS  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => {
  if (i === 0)  return '12a';
  if (i === 12) return '12p';
  return i < 12 ? `${i}a` : `${i - 12}p`;
});

// A quiet low end (v1.24.0): the faintest activity is faint, so quiet hours don't look busy.
function intensity(value: number, max: number): number {
  if (max === 0 || value === 0) return 0;
  return 0.08 + (value / max) * 0.92;
}

const LEGEND_STEPS = [0.08, 0.3, 0.55, 0.78, 1];

/** The colour key under a map, and the line that reads out the square you're on. */
function Key({ legend, readout, ratio }: { legend?: HeatMapProps['legend']; readout: string; ratio: boolean }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 pl-10 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1">
        {legend?.low ?? 'Less'}
        {LEGEND_STEPS.map((a) => <span key={a} className={cn('inline-block h-3 w-3 rounded-sm', ratio && 'ring-1 ring-inset ring-foreground/30')} style={{ backgroundColor: cellColor(a) }} />)}
        {legend?.high ?? 'More'}
      </span>
      {legend?.empty && <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: 'hsl(var(--muted))', opacity: 0.3 }} />{legend.empty}</span>}
      <span aria-live="polite" className="min-w-0 basis-full text-xs text-foreground/80 sm:basis-auto">{readout}</span>
    </div>
  );
}

function cellColor(alpha: number): string {
  return `hsl(var(--primary) / ${alpha})`;
}

export function HeatMap({ grid, max, style, className, ratioGrid, showRatio, overlayGrid, describe, legend }: HeatMapProps) {
  const uid = useId().replace(/:/g, '');
  const [at, setAt] = useState<{ d: number; h: number } | null>(null);
  const [bar, setBar] = useState<string | null>(null);
  const barReadout = <p aria-live="polite" className="mt-1 text-xs text-foreground/80">{bar ?? 'Hover over or tap a bar to see its value.'}</p>;
  const readout = at && describe ? describe(at.d, at.h) : describe ? 'Hover over or tap a square to see what it means.' : '';
  /** In ratio mode a square with no events (null) is empty; 0% is a real value and still shows. */
  const hasValue = (d: number, h: number) => !(showRatio && ratioGrid) || ratioGrid[d]?.[h] != null;

  // Contour uses 2D Gaussian smoothing — discrete grid produces stepped lines without it.
  const activeGrid = useMemo(
    () => (style === 'contour' && !showRatio ? gaussianSmooth(grid) : grid),
    [grid, style, showRatio],
  );
  const activeMax = useMemo(
    () => (style === 'contour' && !showRatio ? Math.max(1, ...activeGrid.flat()) : max),
    [activeGrid, style, showRatio, max],
  );

  // Smoothed overlay grid (voice) for dual-layer contour.
  const smoothedOverlay = useMemo(
    () => (style === 'contour' && overlayGrid ? gaussianSmooth(overlayGrid) : null),
    [overlayGrid, style],
  );
  const overlayPeak = useMemo(
    () => (smoothedOverlay ? Math.max(1, ...smoothedOverlay.flat()) : 1),
    [smoothedOverlay],
  );
  const effectiveMax = showRatio ? 1 : activeMax;

  function cellValue(d: number, h: number): number {
    if (showRatio && ratioGrid) return ratioGrid[d]?.[h] ?? 0;
    return activeGrid[d]?.[h] ?? 0;
  }

  // ── Block / Dots ───────────────────────────────────────────────────────────

  if (style === 'block' || style === 'dots') {
    const isBlock = style === 'block';
    return (
      <div className={cn('w-full overflow-x-auto', className)}>
        <div className="min-w-[600px]">
          <div className="flex pl-10 mb-1">
            {HOUR_LABELS.map((label, h) => (
              <div key={h} className="flex-1 text-center text-[10px] text-muted-foreground">
                {h % 3 === 0 ? label : ''}
              </div>
            ))}
          </div>
          {DAY_LABELS.map((day, d) => (
            <div key={d} className="flex items-center mb-0.5">
              <div className="w-10 text-xs text-muted-foreground text-right pr-2 shrink-0">{day}</div>
              {Array.from({ length: 24 }, (_, h) => {
                const val   = cellValue(d, h);
                const present = hasValue(d, h);
                // A real 0% (events, nobody came) still shows, faintly, with an outline.
                const alpha = present && showRatio ? Math.max(0.08, intensity(val, effectiveMax)) : intensity(val, effectiveMax);
                const selected = at?.d === d && at?.h === h;
                return (
                  <div
                    key={h}
                    className="flex-1 mx-px cursor-pointer"
                    title={describe ? describe(d, h) : `${day} ${HOUR_LABELS[h]}: ${Number.isInteger(val) ? val : val.toFixed(1)}`}
                    onMouseEnter={() => setAt({ d, h })}
                    onClick={() => setAt({ d, h })}
                  >
                    {isBlock ? (
                      <div
                        className={cn('w-full rounded-sm', selected && 'ring-2 ring-foreground', !selected && present && showRatio && 'ring-1 ring-inset ring-foreground/30')}
                        style={{
                          height: '20px',
                          backgroundColor: alpha > 0 ? cellColor(alpha) : 'hsl(var(--muted))',
                          opacity: alpha > 0 ? 1 : 0.3,
                        }}
                      />
                    ) : (
                      <div className="flex items-center justify-center" style={{ height: '20px' }}>
                        {alpha > 0 && (
                          <div
                            className="rounded-full"
                            style={{
                              width:  `${Math.max(4, alpha * 18)}px`,
                              height: `${Math.max(4, alpha * 18)}px`,
                              backgroundColor: cellColor(alpha),
                            }}
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          <Key legend={legend} readout={readout} ratio={!!showRatio} />
        </div>
      </div>
    );
  }

  // ── Hour chart ─────────────────────────────────────────────────────────────

  if (style === 'hour-chart') {
    // Totals per hour; for a show-up rate, the average of the squares with events.
    const hourTotals = Array.from({ length: 24 }, (_, h) => {
      const cells = DAY_LABELS.map((_, d) => d).filter((d) => hasValue(d, h)).map((d) => cellValue(d, h));
      const sum = cells.reduce((a, b) => a + b, 0);
      return showRatio ? (cells.length ? sum / cells.length : 0) : sum;
    });
    const barMax = Math.max(showRatio ? 0.0001 : 1, ...hourTotals);
    const barText = (label: string, v: number) => (showRatio ? `${label}: ${Math.round(v * 100)}% showed up` : `${label}: ${Math.round((v / barMax) * 100)}% of the busiest`);
    return (
      <div className={cn('w-full overflow-x-auto', className)}>
        <div className="min-w-[400px]">
          <div className="flex items-end gap-px" style={{ height: '100px' }}>
            {hourTotals.map((val, h) => (
              <div key={h} className="flex-1 flex flex-col items-center justify-end cursor-pointer" title={barText(HOUR_LABELS[h]!, val)}
                onMouseEnter={() => setBar(barText(HOUR_LABELS[h]!, val))} onClick={() => setBar(barText(HOUR_LABELS[h]!, val))}>
                <div
                  className="w-full rounded-t-sm"
                  style={{
                    height: `${Math.max(2, (val / barMax) * 90)}px`,
                    backgroundColor: cellColor(0.15 + (val / barMax) * 0.85),
                  }}
                />
              </div>
            ))}
          </div>
          <div className="flex mt-1">
            {HOUR_LABELS.map((label, h) => (
              <div key={h} className="flex-1 text-center text-[10px] text-muted-foreground">
                {h % 3 === 0 ? label : ''}
              </div>
            ))}
          </div>
          {barReadout}
        </div>
      </div>
    );
  }

  // ── Day chart ──────────────────────────────────────────────────────────────

  if (style === 'day-chart') {
    const dayTotals = DAY_LABELS.map((_, d) => {
      const cells = Array.from({ length: 24 }, (__, h) => h).filter((h) => hasValue(d, h)).map((h) => cellValue(d, h));
      const sum = cells.reduce((a, b) => a + b, 0);
      return showRatio ? (cells.length ? sum / cells.length : 0) : sum;
    });
    const barMax = Math.max(showRatio ? 0.0001 : 1, ...dayTotals);
    const barText = (label: string, v: number) => (showRatio ? `${label}: ${Math.round(v * 100)}% showed up` : `${label}: ${Math.round((v / barMax) * 100)}% of the busiest`);
    return (
      <div className={cn('w-full', className)}>
        <div className="flex items-end gap-2" style={{ height: '100px' }}>
          {dayTotals.map((val, d) => (
            <div key={d} className="flex-1 flex flex-col items-center justify-end cursor-pointer" title={barText(DAY_LABELS[d]!, val)}
                onMouseEnter={() => setBar(barText(DAY_LABELS[d]!, val))} onClick={() => setBar(barText(DAY_LABELS[d]!, val))}>
              <div
                className="w-full rounded-t-sm"
                style={{
                  height: `${Math.max(2, (val / barMax) * 90)}px`,
                  backgroundColor: cellColor(0.15 + (val / barMax) * 0.85),
                }}
              />
            </div>
          ))}
        </div>
        <div className="flex mt-1 gap-2">
          {DAY_LABELS.map((label, d) => (
            <div key={d} className="flex-1 text-center text-xs text-muted-foreground">{label}</div>
          ))}
        </div>
        {barReadout}
      </div>
    );
  }

  // ── Contour map ────────────────────────────────────────────────────────────

  if (style === 'contour') {
    const HOURS = 24, DAYS = 7, LEVELS = 12;

    const baseValues: number[] = new Array(DAYS * HOURS).fill(0);
    for (let d = 0; d < DAYS; d++) {
      for (let h = 0; h < HOURS; h++) {
        baseValues[d * HOURS + h] = cellValue(d, h);
      }
    }

    const basePeak = showRatio ? 1 : Math.max(1, ...baseValues);
    const baseThresholds = Array.from({ length: LEVELS }, (_, i) => (basePeak * (i + 1)) / (LEVELS + 1));
    const baseContourData = contours().size([HOURS, DAYS]).thresholds(baseThresholds)(baseValues);

    // Voice overlay contour data (only when dual-layer mode is active)
    const overlayContourData = smoothedOverlay
      ? (() => {
          const vals: number[] = new Array(DAYS * HOURS).fill(0);
          for (let d = 0; d < DAYS; d++) {
            for (let h = 0; h < HOURS; h++) {
              vals[d * HOURS + h] = smoothedOverlay[d]?.[h] ?? 0;
            }
          }
          const thresholds = Array.from({ length: LEVELS }, (_, i) => (overlayPeak * (i + 1)) / (LEVELS + 1));
          return contours().size([HOURS, DAYS]).thresholds(thresholds)(vals);
        })()
      : null;

    const filterId  = `cf-${uid}`;
    const clipId    = `cc-${uid}`;
    const isDual    = !!overlayContourData;

    return (
      <div className={cn('w-full overflow-x-auto', className)}>
        <div className="min-w-[600px]">
          {/* Hour labels */}
          <div className="flex pl-10 mb-1">
            {HOUR_LABELS.map((label, h) => (
              <div key={h} className="flex-1 text-center text-[10px] text-muted-foreground">
                {h % 3 === 0 ? label : ''}
              </div>
            ))}
          </div>
          <div className="flex items-stretch">
            {/* Day labels */}
            <div className="w-10 shrink-0 flex flex-col">
              {DAY_LABELS.map((day) => (
                <div key={day} className="flex-1 flex items-center justify-end pr-2">
                  <span className="text-xs text-muted-foreground">{day}</span>
                </div>
              ))}
            </div>
            {/* SVG contour map — viewBox matches grid coords (24 wide × 7 tall) */}
            <svg
              viewBox="0 0 24 7"
              preserveAspectRatio="none"
              className="flex-1"
              style={{ height: '140px' }}
            >
              <defs>
                <filter id={filterId} x="-5%" y="-10%" width="110%" height="120%">
                  <feGaussianBlur in="SourceGraphic" stdDeviation="0.28" />
                </filter>
                <clipPath id={clipId}>
                  <rect x={0} y={0} width={24} height={7} />
                </clipPath>
              </defs>
              {/* Base fill */}
              <rect x={0} y={0} width={24} height={7} fill="hsl(var(--muted))" opacity={0.4} />
              {/* Bottom layer: text (orange) or single-layer (primary color) */}
              <g clipPath={`url(#${clipId})`}>
                <g filter={`url(#${filterId})`}>
                  {baseContourData.map((c, i) => {
                    const alpha = 0.15 + (i / (LEVELS - 1)) * 0.8;
                    const fill = isDual
                      ? `rgba(255,155,50,${alpha})`
                      : cellColor(alpha);
                    return (
                      <path
                        key={i}
                        d={geoJsonToPath(c.coordinates as [number, number][][][])}
                        fill={fill}
                      />
                    );
                  })}
                </g>
              </g>
              {/* Top layer: voice (yellow) — only in dual-layer mode */}
              {overlayContourData && (
                <g clipPath={`url(#${clipId})`}>
                  <g filter={`url(#${filterId})`}>
                    {overlayContourData.map((c, i) => {
                      const alpha = 0.15 + (i / (LEVELS - 1)) * 0.8;
                      return (
                        <path
                          key={i}
                          d={geoJsonToPath(c.coordinates as [number, number][][][])}
                          fill={`rgba(255,200,60,${alpha})`}
                        />
                      );
                    })}
                  </g>
                </g>
              )}
              {/* Subtle day-row dividers */}
              {Array.from({ length: 6 }, (_, d) => (
                <line
                  key={d}
                  x1={0} y1={d + 1} x2={24} y2={d + 1}
                  stroke="hsl(var(--background))"
                  strokeWidth="0.04"
                  opacity={0.6}
                />
              ))}
            </svg>
          </div>
          {!isDual && <Key legend={legend} readout="" ratio={!!showRatio} />}
          {/* Color key — only shown in dual-layer mode */}
          {isDual && (
            <div className="flex gap-4 mt-2 pl-10">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm" style={{ background: 'rgba(255,155,50,0.9)' }} />
                <span className="text-[11px] text-muted-foreground">Text</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm" style={{ background: 'rgba(255,200,60,0.9)' }} />
                <span className="text-[11px] text-muted-foreground">Voice</span>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
