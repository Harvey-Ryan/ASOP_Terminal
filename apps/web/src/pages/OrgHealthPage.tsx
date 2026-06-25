import { useState } from 'react';
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
  const stored = localStorage.getItem(key);
  const [val, setVal] = useState<T>(stored !== null ? (JSON.parse(stored) as T) : defaultVal);
  function set(v: T) {
    localStorage.setItem(key, JSON.stringify(v));
    setVal(v);
  }
  return [val, set];
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
  loading: boolean;
  grid: number[][] | undefined;
  max: number;
  mapStyle: HeatmapStyle;
  onStyleChange: (v: HeatmapStyle) => void;
  ratioGrid?: (number | null)[][];
  showRatio?: boolean;
  children?: React.ReactNode;
}

function HeatmapPanel({
  title,
  loading,
  grid,
  max,
  mapStyle,
  onStyleChange,
  ratioGrid,
  showRatio,
  children,
}: HeatmapPanelProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-base">{title}</CardTitle>
          <StyleDropdown value={mapStyle} onChange={onStyleChange} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {children}
        {loading && <Skeleton className="h-40 w-full" />}
        {!loading && !grid && (
          <p className="text-sm text-muted-foreground text-center py-6">
            No data available — activity will appear here as it accumulates.
          </p>
        )}
        {grid && (
          <HeatMap
            grid={grid}
            max={max}
            style={mapStyle}
            ratioGrid={ratioGrid}
            showRatio={showRatio}
          />
        )}
      </CardContent>
    </Card>
  );
}

export function OrgHealthPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const { user } = useAuth();

  const { data: myPerms } = useQuery({
    queryKey: ['my-permissions', guildId],
    queryFn: () => settingsApi.getMyPermissions(guildId!),
    enabled: !!guildId,
    staleTime: 60_000,
  });

  const isPrivileged = myPerms?.canManageEvents ?? false;
  const heatmapPublic = myPerms?.activityHeatmapPublic ?? true;

  // Prefs (localStorage)
  const [timezone, setTimezone] = useHeatmapPref(`heatmap-${guildId}-timezone`, 'UTC');
  const [days, setDays] = useHeatmapPref<number>(`heatmap-${guildId}-days`, 180);
  const [guildStyle, setGuildStyle] = useHeatmapPref<HeatmapStyle>(`heatmap-${guildId}-guild-style`, 'block');
  const [memberStyle, setMemberStyle] = useHeatmapPref<HeatmapStyle>(`heatmap-${guildId}-member-style`, 'block');
  const [eventStyle, setEventStyle] = useHeatmapPref<HeatmapStyle>(`heatmap-${guildId}-event-style`, 'block');
  const [selectedMemberId, setSelectedMemberId] = useState<string>(user?.id ?? '');
  const [eventMetric, setEventMetric] = useState<'attendance' | 'ratio'>('attendance');
  const [activityType, setActivityType] = useState<'combined' | 'message' | 'voice'>('combined');

  // Queries
  const { data: leaderboard } = useQuery({
    queryKey: ['rolecall-leaderboard', guildId, 1],
    queryFn: () => roleCallApi.getLeaderboard(guildId!, 1),
    enabled: !!guildId && isPrivileged,
    retry: false,
  });

  const { data: guildHeatmap, isLoading: guildLoading } = useQuery({
    queryKey: ['heatmap-guild', guildId, days, timezone, activityType],
    queryFn: () => roleCallApi.getGuildHeatmap(guildId!, { days, timezone, type: activityType }),
    enabled: !!guildId && (isPrivileged || heatmapPublic),
    retry: false,
  });

  const effectiveMemberId = isPrivileged ? selectedMemberId : (user?.id ?? '');

  const { data: memberHeatmap, isLoading: memberLoading } = useQuery({
    queryKey: ['heatmap-member', guildId, effectiveMemberId, days, timezone, activityType],
    queryFn: () => roleCallApi.getMemberHeatmap(guildId!, effectiveMemberId, { days, timezone, type: activityType }),
    enabled: !!guildId && !!effectiveMemberId,
    retry: false,
  });

  const { data: eventHeatmap, isLoading: eventLoading } = useQuery({
    queryKey: ['heatmap-event', guildId, days, timezone],
    queryFn: () => settingsApi.getEventHeatmap(guildId!, { days, timezone }),
    enabled: !!guildId && (isPrivileged || heatmapPublic),
    retry: false,
  });

  if (!isPrivileged && !heatmapPublic) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <p className="text-sm text-muted-foreground">Org Health is restricted to guild managers.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground font-medium">Window</label>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {DAYS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground font-medium">Timezone</label>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>{tz.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Guild Activity */}
      <HeatmapPanel
        title="Guild Activity"
        loading={guildLoading}
        grid={guildHeatmap?.grid}
        max={guildHeatmap?.max ?? 0}
        mapStyle={guildStyle}
        onStyleChange={setGuildStyle}

      >
        <div className="flex gap-2">
          {([['combined', 'Combined'], ['message', 'Text'], ['voice', 'Voice']] as const).map(([val, label]) => (
            <button
              key={val}
              onClick={() => setActivityType(val)}
              className={`px-3 py-1 rounded-md text-xs font-medium border transition-colors ${
                activityType === val
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-input hover:bg-accent'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </HeatmapPanel>

      {/* Member Activity */}
      <HeatmapPanel
        title="Member Activity"
        loading={memberLoading}
        grid={memberHeatmap?.grid}
        max={memberHeatmap?.max ?? 0}
        mapStyle={memberStyle}
        onStyleChange={setMemberStyle}

      >
        {isPrivileged && leaderboard && (
          <select
            value={selectedMemberId}
            onChange={(e) => setSelectedMemberId(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">Select member</option>
            {leaderboard.rows.map((r) => (
              <option key={r.user_id} value={r.user_id}>{r.displayName}</option>
            ))}
          </select>
        )}
        {!isPrivileged && (
          <p className="text-xs text-muted-foreground">Showing your personal activity.</p>
        )}
      </HeatmapPanel>

      {/* Event Planning */}
      <HeatmapPanel
        title="Event Planning"
        loading={eventLoading}
        grid={eventHeatmap?.attendanceGrid}
        max={eventHeatmap?.maxAttendance ?? 0}
        mapStyle={eventStyle}
        onStyleChange={setEventStyle}

        ratioGrid={eventHeatmap?.ratioGrid}
        showRatio={eventMetric === 'ratio'}
      >
        <div className="flex gap-2">
          {(['attendance', 'ratio'] as const).map((opt) => (
            <button
              key={opt}
              onClick={() => setEventMetric(opt)}
              className={`px-3 py-1 rounded-md text-xs font-medium border transition-colors ${
                eventMetric === opt
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-input hover:bg-accent'
              }`}
            >
              {opt === 'attendance' ? 'Attendance' : 'RSVP Ratio'}
            </button>
          ))}
        </div>
        {eventHeatmap && (
          <p className="text-xs text-muted-foreground">
            Based on {eventHeatmap.eventCount} past {eventHeatmap.eventCount === 1 ? 'event' : 'events'}.
          </p>
        )}
      </HeatmapPanel>
    </div>
  );
}
