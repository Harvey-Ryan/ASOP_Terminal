import { useMemo } from 'react';
import { contours } from 'd3-contour';
import { cn } from '@/lib/utils';

export type HeatmapStyle = 'block' | 'dots' | 'hour-chart' | 'day-chart' | 'contour';

interface HeatMapProps {
  grid: number[][];       // [7][24] — row=day(0=Sun), col=hour
  max: number;
  style: HeatmapStyle;
  className?: string;
  smooth?: boolean;       // apply Gaussian kernel along the hour axis
  // Optional second overlay for ratio (used in event panel)
  ratioGrid?: (number | null)[][];
  showRatio?: boolean;    // if true, color by ratioGrid instead of grid
}

// 1-D Gaussian kernel (sigma=1, radius=3) applied along hours, wrapping at 0/23.
// Ratios are not smoothed since they aren't linearly additive.
function gaussianSmooth(grid: number[][]): number[][] {
  const HOURS = 24;
  const sigma = 1.0;
  const radius = 3;
  const weights = Array.from({ length: radius * 2 + 1 }, (_, i) => {
    const k = i - radius;
    return Math.exp(-(k * k) / (2 * sigma * sigma));
  });
  const total = weights.reduce((a, b) => a + b, 0);

  return grid.map((row) =>
    Array.from({ length: HOURS }, (_, h) => {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const srcH = ((h + k) % HOURS + HOURS) % HOURS;
        sum += (row[srcH] ?? 0) * (weights[k + radius] ?? 0);
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

function intensity(value: number, max: number): number {
  if (max === 0 || value === 0) return 0;
  return 0.15 + (value / max) * 0.85;
}

function cellColor(alpha: number): string {
  return `hsl(var(--primary) / ${alpha})`;
}

export function HeatMap({ grid, max, style, className, smooth, ratioGrid, showRatio }: HeatMapProps) {
  // Contour always uses smoothing — discrete grid produces unreadable stepped lines without it.
  const activeGrid = useMemo(
    () => ((smooth || style === 'contour') && !showRatio ? gaussianSmooth(grid) : grid),
    [grid, smooth, style, showRatio],
  );
  const activeMax = useMemo(
    () => ((smooth || style === 'contour') && !showRatio ? Math.max(1, ...activeGrid.flat()) : max),
    [activeGrid, smooth, style, showRatio, max],
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
                const alpha = intensity(val, effectiveMax);
                return (
                  <div
                    key={h}
                    className="flex-1 mx-px"
                    title={`${day} ${HOUR_LABELS[h]}: ${val.toFixed(val < 10 ? 1 : 0)}`}
                  >
                    {isBlock ? (
                      <div
                        className="w-full rounded-sm"
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
        </div>
      </div>
    );
  }

  // ── Hour chart ─────────────────────────────────────────────────────────────

  if (style === 'hour-chart') {
    const hourTotals = Array.from({ length: 24 }, (_, h) =>
      DAY_LABELS.reduce((sum, _, d) => sum + cellValue(d, h), 0)
    );
    const barMax = Math.max(1, ...hourTotals);
    return (
      <div className={cn('w-full overflow-x-auto', className)}>
        <div className="min-w-[400px]">
          <div className="flex items-end gap-px" style={{ height: '100px' }}>
            {hourTotals.map((val, h) => (
              <div key={h} className="flex-1 flex flex-col items-center justify-end" title={`${HOUR_LABELS[h]}: ${val.toFixed(1)}`}>
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
        </div>
      </div>
    );
  }

  // ── Day chart ──────────────────────────────────────────────────────────────

  if (style === 'day-chart') {
    const dayTotals = DAY_LABELS.map((_, d) =>
      Array.from({ length: 24 }, (__, h) => cellValue(d, h)).reduce((a, b) => a + b, 0)
    );
    const barMax = Math.max(1, ...dayTotals);
    return (
      <div className={cn('w-full', className)}>
        <div className="flex items-end gap-2" style={{ height: '100px' }}>
          {dayTotals.map((val, d) => (
            <div key={d} className="flex-1 flex flex-col items-center justify-end" title={`${DAY_LABELS[d]}: ${val.toFixed(1)}`}>
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
      </div>
    );
  }

  // ── Contour map ────────────────────────────────────────────────────────────

  if (style === 'contour') {
    const HOURS = 24, DAYS = 7, LEVELS = 8;

    const values: number[] = new Array(DAYS * HOURS).fill(0);
    for (let d = 0; d < DAYS; d++) {
      for (let h = 0; h < HOURS; h++) {
        values[d * HOURS + h] = cellValue(d, h);
      }
    }

    const peak = showRatio ? 1 : Math.max(1, ...values);
    const thresholds = Array.from({ length: LEVELS }, (_, i) =>
      (peak * (i + 1)) / (LEVELS + 1)
    );

    const contourData = contours().size([HOURS, DAYS]).thresholds(thresholds)(values);

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
              {/* Base fill */}
              <rect x={0} y={0} width={24} height={7} fill="hsl(var(--muted))" opacity={0.4} />
              {/* Filled contour layers, lowest threshold first */}
              {contourData.map((c, i) => {
                const alpha = 0.15 + (i / (LEVELS - 1)) * 0.8;
                return (
                  <path
                    key={i}
                    d={geoJsonToPath(c.coordinates as [number, number][][][])}
                    fill={cellColor(alpha)}
                  />
                );
              })}
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
        </div>
      </div>
    );
  }

  return null;
}
