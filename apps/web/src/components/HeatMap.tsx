import { cn } from '@/lib/utils';

export type HeatmapStyle = 'block' | 'dots' | 'hour-chart' | 'day-chart';

interface HeatMapProps {
  grid: number[][];       // [7][24] — row=day(0=Sun), col=hour
  max: number;
  style: HeatmapStyle;
  className?: string;
  // Optional second overlay for ratio (used in event panel)
  ratioGrid?: (number | null)[][];
  showRatio?: boolean;    // if true, color by ratioGrid instead of grid
}

const DAY_LABELS  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => {
  if (i === 0)  return '12a';
  if (i === 12) return '12p';
  return i < 12 ? `${i}a` : `${i - 12}p`;
});

// Returns opacity 0–1 for a value given max
function intensity(value: number, max: number): number {
  if (max === 0 || value === 0) return 0;
  return 0.15 + (value / max) * 0.85;
}

function cellColor(alpha: number): string {
  return `hsl(var(--primary) / ${alpha})`;
}

export function HeatMap({ grid, max, style, className, ratioGrid, showRatio }: HeatMapProps) {
  const effectiveMax = showRatio ? 1 : max;

  function cellValue(d: number, h: number): number {
    if (showRatio && ratioGrid) return ratioGrid[d][h] ?? 0;
    return grid[d][h];
  }

  if (style === 'block' || style === 'dots') {
    const isBlock = style === 'block';
    return (
      <div className={cn('w-full overflow-x-auto', className)}>
        <div className="min-w-[600px]">
          {/* Hour header */}
          <div className="flex pl-10 mb-1">
            {HOUR_LABELS.map((label, h) => (
              <div key={h} className="flex-1 text-center text-[10px] text-muted-foreground">
                {h % 3 === 0 ? label : ''}
              </div>
            ))}
          </div>
          {/* Rows */}
          {DAY_LABELS.map((day, d) => (
            <div key={d} className="flex items-center mb-0.5">
              <div className="w-10 text-xs text-muted-foreground text-right pr-2 shrink-0">{day}</div>
              {Array.from({ length: 24 }, (_, h) => {
                const val  = cellValue(d, h);
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

  if (style === 'hour-chart') {
    // 24 bars — each bar = sum of that hour across all days
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

  if (style === 'day-chart') {
    // 7 bars — each bar = sum of that day across all hours
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

  return null;
}
