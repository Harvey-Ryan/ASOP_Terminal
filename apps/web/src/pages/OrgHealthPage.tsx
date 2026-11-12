// Org Health (Activity): when the server, one member, and the server's events
// are busiest, as week-by-hour heat maps in the viewer's time zone. v1.24.0:
// recorded attendance only, a key, readable values, "best times", and members
// always see their own map.
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { roleCallApi } from '@/api/rolecall';
import { settingsApi } from '@/api/settings';
import { useAuth } from '@/hooks/useAuth';
import { HeatMap } from '@/components/HeatMap';
import type { HeatmapStyle } from '@/components/HeatMap';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type React from 'react';
import { bestTimes, cellName, type BestTime, type HeatGrid } from '@dem/shared';

const TIMEZONES = [
  { value: 'UTC',                               label: 'UTC' },
  { value: 'America/New_York',                  label: 'Eastern — New York' },
  { value: 'America/Chicago',                   label: 'Central — Chicago' },
  { value: 'America/Denver',                    label: 'Mountain — Denver' },
  { value: 'America/Los_Angeles',               label: 'Pacific — Los Angeles' },
  { value: 'America/Phoenix',                   label: 'Arizona — Phoenix' },
  { value: 'America/Anchorage',                 label: 'Alaska — Anchorage' },
  { value: 'Pacific/Honolulu',                  label: 'Hawaii — Honolulu' },
  { value: 'America/Toronto',                   label: 'Eastern Canada — Toronto' },
  { value: 'America/Vancouver',                 label: 'Pacific Canada — Vancouver' },
  { value: 'America/Mexico_City',               label: 'Mexico City' },
  { value: 'America/Bogota',                    label: 'Colombia — Bogotá' },
  { value: 'America/Lima',                      label: 'Peru — Lima' },
  { value: 'America/Santiago',                  label: 'Chile — Santiago' },
  { value: 'America/Sao_Paulo',                 label: 'Brazil — São Paulo' },
  { value: 'America/Argentina/Buenos_Aires',    label: 'Argentina — Buenos Aires' },
  { value: 'Atlantic/Reykjavik',                label: 'Iceland — Reykjavik' },
  { value: 'Europe/London',                     label: 'UK — London' },
  { value: 'Europe/Dublin',                     label: 'Ireland — Dublin' },
  { value: 'Europe/Lisbon',                     label: 'Portugal — Lisbon' },
  { value: 'Europe/Paris',                      label: 'France — Paris' },
  { value: 'Europe/Berlin',                     label: 'Germany — Berlin' },
  { value: 'Europe/Madrid',                     label: 'Spain — Madrid' },
  { value: 'Europe/Rome',                       label: 'Italy — Rome' },
  { value: 'Europe/Amsterdam',                  label: 'Netherlands — Amsterdam' },
  { value: 'Europe/Brussels',                   label: 'Belgium — Brussels' },
  { value: 'Europe/Warsaw',                     label: 'Poland — Warsaw' },
  { value: 'Europe/Prague',                     label: 'Czech Republic — Prague' },
  { value: 'Europe/Vienna',                     label: 'Austria — Vienna' },
  { value: 'Europe/Stockholm',                  label: 'Sweden — Stockholm' },
  { value: 'Europe/Oslo',                       label: 'Norway — Oslo' },
  { value: 'Europe/Copenhagen',                 label: 'Denmark — Copenhagen' },
  { value: 'Europe/Helsinki',                   label: 'Finland — Helsinki' },
  { value: 'Europe/Athens',                     label: 'Greece — Athens' },
  { value: 'Europe/Bucharest',                  label: 'Romania — Bucharest' },
  { value: 'Europe/Sofia',                      label: 'Bulgaria — Sofia' },
  { value: 'Europe/Istanbul',                   label: 'Turkey — Istanbul' },
  { value: 'Europe/Moscow',                     label: 'Russia — Moscow' },
  { value: 'Asia/Jerusalem',                    label: 'Israel — Jerusalem' },
  { value: 'Asia/Riyadh',                       label: 'Saudi Arabia — Riyadh' },
  { value: 'Asia/Dubai',                        label: 'UAE — Dubai' },
  { value: 'Asia/Karachi',                      label: 'Pakistan — Karachi' },
  { value: 'Asia/Kolkata',                      label: 'India — Kolkata' },
  { value: 'Asia/Dhaka',                        label: 'Bangladesh — Dhaka' },
  { value: 'Asia/Bangkok',                      label: 'Thailand — Bangkok' },
  { value: 'Asia/Singapore',                    label: 'Singapore' },
  { value: 'Asia/Hong_Kong',                    label: 'Hong Kong' },
  { value: 'Asia/Shanghai',                     label: 'China — Shanghai' },
  { value: 'Asia/Tokyo',                        label: 'Japan — Tokyo' },
  { value: 'Asia/Seoul',                        label: 'South Korea — Seoul' },
  { value: 'Australia/Perth',                   label: 'Australia — Perth' },
  { value: 'Australia/Brisbane',                label: 'Australia — Brisbane' },
  { value: 'Australia/Sydney',                  label: 'Australia — Sydney' },
  { value: 'Pacific/Auckland',                  label: 'New Zealand — Auckland' },
];

const DAYS_OPTIONS = [
  { value: 30,  label: 'Last 30 days' },
  { value: 90,  label: 'Last 90 days' },
  { value: 180, label: 'Last 6 months' },
];

function useHeatmapPref<T>(key: string, defaultVal: T): [T, (v: T) => void] {
  const [val, setVal] = useState<T>(() => {
    try { const stored = localStorage.getItem(key); return stored !== null ? (JSON.parse(stored) as T) : defaultVal; } catch { return defaultVal; }
  });
  function set(v: T) {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode: just this visit */ }
    setVal(v);
  }
  return [val, set];
}

/** The viewer's own time zone: the default (v1.24.0; was UTC). */
const BROWSER_TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();

const pct = (v: number) => `${Math.round(v * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Busiest: Sat 8–11 PM · Sun 8–10 PM" */
function BestLine({ label, times, extra }: { label: string; times: BestTime[]; extra?: (t: BestTime) => string }) {
  if (!times.length) return null;
  return (
    <p className="text-sm">
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-medium">{times.map((t) => (extra ? `${t.label} (${extra(t)})` : t.label)).join(' · ')}</span>
    </p>
  );
}

function StyleDropdown({ value, onChange }: { value: HeatmapStyle; onChange: (v: HeatmapStyle) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as HeatmapStyle)}
      className="rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <option value="block">Block</option>
      <option value="dots">Dots</option>
      <option value="hour-chart">Hour Chart</option>
      <option value="day-chart">Day Chart</option>
      <option value="contour">Contour</option>
    </select>
  );
}

interface HeatmapPanelProps {
  title: string;
  subtitle: string;
  loading: boolean;
  grid: number[][] | undefined;
  max: number;
  mapStyle: HeatmapStyle;
  onStyleChange: (v: HeatmapStyle) => void;
  ratioGrid?: (number | null)[][];
  showRatio?: boolean;
  overlayGrid?: number[][];
  describe?: (day: number, hour: number) => string;
  legend?: { low: string; high: string; empty?: string };
  /** Shown above the map ("Busiest: …") */
  best?: React.ReactNode;
  empty?: string;
  children?: React.ReactNode;
}

function HeatmapPanel({
  title, subtitle, loading, grid, max, mapStyle, onStyleChange, ratioGrid, showRatio, overlayGrid, describe, legend, best, empty, children,
}: HeatmapPanelProps) {
  const nothing = !grid || grid.flat().every((v) => !v);
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
          </div>
          <StyleDropdown value={mapStyle} onChange={onStyleChange} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {children}
        {loading && <Skeleton className="h-40 w-full" />}
        {!loading && nothing && (
          <p className="text-sm text-muted-foreground text-center py-6">{empty ?? 'No activity yet in this window. It will appear here as it builds up.'}</p>
        )}
        {!loading && !nothing && grid && (
          <>
            {best}
            <HeatMap grid={grid} max={max} style={mapStyle} ratioGrid={ratioGrid} showRatio={showRatio} overlayGrid={overlayGrid} describe={describe} legend={legend} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Reads a RoleCall activity square: relative to the week's busiest hour (RoleCall's numbers have no unit). */
function activityWords(grid: HeatGrid | undefined, max: number) {
  return (d: number, h: number) => {
    const v = grid?.[d]?.[h] ?? 0;
    return `${cellName(d, h)}: ${v && max ? `${Math.max(1, Math.round((v / max) * 100))}% as busy as the busiest hour` : 'no activity'}`;
  };
}

export function OrgHealthPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const { user } = useAuth();
  const me = user?.id ?? ''; // Discord id

  const { data: myPerms } = useQuery({
    queryKey: ['my-permissions', guildId],
    queryFn: () => settingsApi.getMyPermissions(guildId!),
    enabled: !!guildId,
    staleTime: 60_000,
  });

  const isPrivileged = myPerms?.canManageEvents ?? false;
  const heatmapPublic = myPerms?.activityHeatmapPublic ?? true;
  // Wait for permissions before asking for the server's maps (members of a
  // server that keeps them private would only be refused).
  const showServerMaps = !!myPerms && (isPrivileged || heatmapPublic);

  // Prefs (localStorage)
  const [timezone, setTimezone] = useHeatmapPref(`heatmap-${guildId}-timezone`, BROWSER_TZ);
  const [days, setDays] = useHeatmapPref<number>(`heatmap-${guildId}-days`, 180);
  const [guildStyle, setGuildStyle] = useHeatmapPref<HeatmapStyle>(`heatmap-${guildId}-guild-style`, 'block');
  const [memberStyle, setMemberStyle] = useHeatmapPref<HeatmapStyle>(`heatmap-${guildId}-member-style`, 'block');
  const [eventStyle, setEventStyle] = useHeatmapPref<HeatmapStyle>(`heatmap-${guildId}-event-style`, 'block');
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');
  const [memberSearch, setMemberSearch] = useState('');
  const [eventMetric, setEventMetric] = useState<'attendance' | 'ratio'>('attendance');

  const tzOptions = useMemo(() => (TIMEZONES.some((t) => t.value === BROWSER_TZ)
    ? TIMEZONES
    : [{ value: BROWSER_TZ, label: `Your time zone — ${BROWSER_TZ.replace(/_/g, ' ')}` }, ...TIMEZONES]), []);

  // Everyone RoleCall knows in this server, for the member picker (every page, inactive too).
  const { data: everyone } = useQuery({
    queryKey: ['rolecall-everyone', guildId],
    queryFn: async () => {
      const first = await roleCallApi.getLeaderboard(guildId!, 1, true);
      const rest = await Promise.all(Array.from({ length: Math.min(19, Math.max(0, first.totalPages - 1)) }, (_, i) => roleCallApi.getLeaderboard(guildId!, i + 2, true)));
      return [first, ...rest].flatMap((p) => p.rows).map((r) => ({ id: r.user_id, name: r.displayName || r.username }));
    },
    enabled: !!guildId && isPrivileged,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const memberOptions = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    return (everyone ?? []).filter((m) => m.id !== me && (!q || m.name.toLowerCase().includes(q))).sort((a, b) => a.name.localeCompare(b.name));
  }, [everyone, memberSearch, me]);

  // Server activity: combined for non-contour styles; text + voice for
  // dual-layer contour. One request brings all three, so switching style
  // doesn't ask again.
  const { data: guildLayers, isLoading: guildLoading } = useQuery({
    queryKey: ['heatmap-guild', guildId, days, timezone],
    queryFn: () => roleCallApi.getGuildHeatmaps(guildId!, { days, timezone }),
    enabled: !!guildId && showServerMaps,
    retry: false,
  });
  const guildHeatmap = guildLayers?.combined;
  const guildTextHeatmap = guildLayers?.message;
  const guildVoiceHeatmap = guildLayers?.voice;

  const isDualLayer = guildStyle === 'contour';
  const guildGrid    = isDualLayer ? guildTextHeatmap?.grid   : guildHeatmap?.grid;
  const guildMax     = isDualLayer ? (guildTextHeatmap?.max ?? 0) : (guildHeatmap?.max ?? 0);
  const guildOverlay = isDualLayer ? guildVoiceHeatmap?.grid  : undefined;

  // Officers can pick anyone; everyone else sees their own.
  const effectiveMemberId = isPrivileged && selectedMemberId ? selectedMemberId : me;
  const viewingSelf = effectiveMemberId === me;

  const { data: memberLayers, isLoading: memberLoading } = useQuery({
    queryKey: ['heatmap-member', guildId, effectiveMemberId, days, timezone],
    queryFn: () => roleCallApi.getMemberHeatmaps(guildId!, effectiveMemberId, { days, timezone }),
    enabled: !!guildId && !!effectiveMemberId,
    retry: false,
  });
  const memberHeatmap = memberLayers?.combined;
  const memberTextHeatmap = memberLayers?.message;
  const memberVoiceHeatmap = memberLayers?.voice;

  const isMemberDual    = memberStyle === 'contour';
  const memberGrid      = isMemberDual ? memberTextHeatmap?.grid  : memberHeatmap?.grid;
  const memberMax       = isMemberDual ? (memberTextHeatmap?.max ?? 0) : (memberHeatmap?.max ?? 0);
  const memberOverlay   = isMemberDual ? memberVoiceHeatmap?.grid : undefined;

  const { data: eventHeatmap, isLoading: eventLoading } = useQuery({
    queryKey: ['heatmap-event', guildId, days, timezone],
    queryFn: () => settingsApi.getEventHeatmap(guildId!, { days, timezone }),
    enabled: !!guildId && showServerMaps,
    retry: false,
  });

  // Best times and the words for each square.
  const serverBest = useMemo(() => bestTimes(guildHeatmap?.grid ?? []), [guildHeatmap]);
  const memberBest = useMemo(() => bestTimes(memberHeatmap?.grid ?? []), [memberHeatmap]);
  const hasEvents = (d: number, h: number) => (eventHeatmap?.eventCountGrid[d]?.[h] ?? 0) > 0;
  const turnoutBest = useMemo(() => bestTimes(eventHeatmap?.attendanceGrid ?? [], 3, hasEvents), [eventHeatmap]); // eslint-disable-line react-hooks/exhaustive-deps
  const showUpBest = useMemo(() => bestTimes(eventHeatmap?.ratioGrid ?? [], 3, hasEvents), [eventHeatmap]); // eslint-disable-line react-hooks/exhaustive-deps

  const eventWords = (d: number, h: number) => {
    const n = eventHeatmap?.eventCountGrid[d]?.[h] ?? 0;
    if (!n) return `${cellName(d, h)}: no events`;
    if (eventMetric === 'ratio') {
      const r = eventHeatmap?.ratioGrid[d]?.[h];
      return `${cellName(d, h)}: ${r == null ? 'nobody signed up' : `${pct(r)} of sign-ups showed up`} · ${plural(n, 'event')}`;
    }
    const avg = eventHeatmap?.attendanceGrid[d]?.[h] ?? 0;
    return `${cellName(d, h)}: ${avg} ${avg === 1 ? 'person' : 'people'} on average · ${plural(n, 'event')}`;
  };

  const tzLabel = tzOptions.find((t) => t.value === timezone)?.label ?? timezone;

  return (
    <div className="space-y-6">
      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor="hm-window" className="text-xs text-muted-foreground font-medium">Window</label>
          <select id="hm-window" value={days} onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring">
            {DAYS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="hm-tz" className="text-xs text-muted-foreground font-medium">Time zone</label>
          <select id="hm-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}
            className="max-w-[16rem] rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring">
            {!tzOptions.some((t) => t.value === timezone) && <option value={timezone}>{timezone}</option>}
            {tzOptions.map((tz) => <option key={tz.value} value={tz.value}>{tz.value === BROWSER_TZ ? `${tz.label} (yours)` : tz.label}</option>)}
          </select>
        </div>
      </div>

      {myPerms && !showServerMaps && (
        <p className="text-sm text-muted-foreground">This server shows its activity heat maps to officers only. Here is your own activity.</p>
      )}

      {showServerMaps && (
        <HeatmapPanel
          title="Server Activity"
          subtitle={`When people are active in this server's text and voice channels, by hour (${tzLabel}).`}
          loading={guildLoading}
          grid={guildGrid}
          max={guildMax}
          mapStyle={guildStyle}
          onStyleChange={setGuildStyle}
          overlayGrid={guildOverlay}
          describe={activityWords(guildGrid, guildMax)}
          legend={{ low: 'Quiet', high: 'Busiest' }}
          best={<BestLine label="Busiest" times={serverBest} />}
        />
      )}

      <HeatmapPanel
        title={viewingSelf ? 'Your Activity' : 'Member Activity'}
        subtitle={viewingSelf ? 'When you are active in this server, by hour.' : 'When this member is active in this server, by hour.'}
        loading={memberLoading}
        grid={memberGrid}
        max={memberMax}
        mapStyle={memberStyle}
        onStyleChange={setMemberStyle}
        overlayGrid={memberOverlay}
        describe={activityWords(memberGrid, memberMax)}
        legend={{ low: 'Quiet', high: 'Busiest' }}
        best={<BestLine label="Most active" times={memberBest} />}
        empty={viewingSelf ? 'No activity from you in this window yet.' : 'No activity from this member in this window.'}
      >
        {isPrivileged && (
          <div className="flex flex-wrap gap-2">
            <input aria-label="Find a member" placeholder="Find a member" value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)}
              className="h-9 min-w-[10rem] flex-1 rounded-md border border-input bg-background px-3 text-sm" />
            <select aria-label="Member" value={effectiveMemberId} onChange={(e) => setSelectedMemberId(e.target.value === me ? '' : e.target.value)}
              className="h-9 min-w-[12rem] flex-1 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
              <option value={me}>You</option>
              {!viewingSelf && !memberOptions.some((m) => m.id === effectiveMemberId) && (
                <option value={effectiveMemberId}>{everyone?.find((m) => m.id === effectiveMemberId)?.name ?? 'Selected member'}</option>
              )}
              {memberOptions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        )}
      </HeatmapPanel>

      {showServerMaps && (
        <HeatmapPanel
          title="Event Planning"
          subtitle="When people turn up to this server's events, by the hour each event started."
          loading={eventLoading}
          grid={eventHeatmap?.eventCount ? eventHeatmap.attendanceGrid : undefined}
          max={eventHeatmap?.maxAttendance ?? 0}
          mapStyle={eventStyle}
          onStyleChange={setEventStyle}
          ratioGrid={eventHeatmap?.ratioGrid}
          showRatio={eventMetric === 'ratio'}
          describe={eventWords}
          legend={eventMetric === 'ratio' ? { low: '0%', high: '100% showed up', empty: 'No events' } : { low: 'Fewer', high: 'Most people', empty: 'No events' }}
          best={eventMetric === 'ratio'
            ? <BestLine label="Best show-up" times={showUpBest} extra={(t) => pct(t.peak)} />
            : <BestLine label="Best turnout" times={turnoutBest} extra={(t) => `${t.peak} on average`} />}
          empty="No finished events with attendance recorded in this window."
        >
          <div className="flex gap-2">
            {(['attendance', 'ratio'] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                aria-pressed={eventMetric === opt}
                onClick={() => setEventMetric(opt)}
                className={`px-3 py-1 rounded-md text-xs font-medium border transition-colors ${
                  eventMetric === opt ? 'bg-primary text-primary-foreground border-primary' : 'border-input hover:bg-accent'
                }`}
              >
                {opt === 'attendance' ? 'Turnout' : 'Show-up rate'}
              </button>
            ))}
          </div>
          {eventHeatmap && (
            <p className="text-xs text-muted-foreground">
              {eventMetric === 'ratio'
                ? 'Of the people who signed up (not maybes), the share who came. '
                : 'Average number of people at an event that started in that hour. '}
              Based on {plural(eventHeatmap.eventCount, 'event')} with attendance recorded
              {eventHeatmap.notRecorded ? `; ${plural(eventHeatmap.notRecorded, 'event')} without an attendance check or anyone in voice ${eventHeatmap.notRecorded === 1 ? 'is' : 'are'} left out` : ''}.
            </p>
          )}
        </HeatmapPanel>
      )}
    </div>
  );
}
