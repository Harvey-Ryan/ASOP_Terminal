// Admin → Overview (v1.13.0): is everything up, how many errors, what's going on.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { adminApi } from '@/api/admin';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ADMIN, LoadFailed, Section, Stat, ago } from './adminUi';
import { formatBytes } from '@/components/ImageUsage';

export function AdminOverviewPage() {
  const q = useQuery({ queryKey: ['admin', 'overview'], queryFn: adminApi.overview, refetchInterval: 30_000 });
  if (q.isError) return <LoadFailed error={q.error} />;
  const o = q.data;
  if (!o)
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );

  const maxHour = Math.max(1, ...o.errorsByHour.map((h) => h.errors + h.warnings));
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {o.services.map((s) => (
          <Stat
            key={s.service}
            label={s.service === 'api' ? 'Website & API' : 'Discord bot'}
            value={s.up ? 'Up' : 'Not reporting'}
            tone={s.up ? 'good' : 'bad'}
            sub={
              <>
                {s.release || '—'} · {s.up ? `started ${ago(s.startedAt)}` : `last seen ${ago(s.beatAt)}`}
                {s.service === 'bot' && s.up && (
                  <>
                    {' '}
                    · {String(s.details['guilds'] ?? '?')} servers · ping {String(s.details['wsPingMs'] ?? '?')} ms
                  </>
                )}
              </>
            }
          />
        ))}
        <Stat
          label="Database"
          value={`${o.database.latencyMs} ms`}
          tone={o.database.latencyMs > 500 ? 'warn' : 'good'}
          sub="round trip"
        />
        <Stat
          label="Game data"
          value={o.gameData?.build ?? 'Not set up'}
          tone={o.gameData?.build ? undefined : 'warn'}
          sub={o.gameData ? `loaded ${ago(o.gameData.syncedAt)} · checked ${ago(o.gameData.checkedAt)}` : undefined}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Errors, last hour"
          value={o.errors.lastHour}
          tone={o.errors.lastHour > 0 ? 'bad' : 'good'}
          to={`${ADMIN}/errors?view=all&period=1h&level=error`}
        />
        <Stat
          label="Errors, 24 h"
          value={o.errors.last24h}
          sub={
            Object.entries(o.errors.bySource24h)
              .map(([k, v]) => `${k} ${v}`)
              .join(' · ') || 'none'
          }
          to={`${ADMIN}/errors?period=24h`}
        />
        <Stat
          label="New kinds, 24 h"
          value={o.errors.newKinds24h}
          tone={o.errors.newKinds24h > 0 ? 'warn' : undefined}
          to={`${ADMIN}/errors?period=24h`}
        />
        <Stat
          label="Open kinds (7 days)"
          value={o.errors.openKinds}
          sub={`${o.errors.warnings24h} warnings in 24 h`}
          to={`${ADMIN}/errors?period=7d&status=open`}
        />
      </div>

      <Section title="Errors per hour, last 24 hours">
        <div className="flex h-32 items-end gap-1" role="img" aria-label="Errors and warnings per hour">
          {o.errorsByHour.map((h) => (
            // h-full: the bars are a share of the column's height, so the column needs one (an
            // items-end row would otherwise shrink it to its content and every bar to 0 px).
            <div
              key={h.hour}
              className="flex h-full flex-1 flex-col justify-end"
              title={`${new Date(h.hour).toLocaleTimeString([], { hour: 'numeric' })}: ${h.errors} errors, ${h.warnings} warnings`}
            >
              {h.warnings > 0 && (
                <div
                  className="bg-yellow-400/60"
                  style={{ height: `${(h.warnings / maxHour) * 100}%`, minHeight: 3 }}
                />
              )}
              {h.errors > 0 && (
                <div className="bg-red-500/80" style={{ height: `${(h.errors / maxHour) * 100}%`, minHeight: 3 }} />
              )}
              {h.errors + h.warnings === 0 && <div className="h-px bg-muted" />}
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
          <span>{new Date(o.errorsByHour[0]!.hour).toLocaleTimeString([], { hour: 'numeric' })}</span>
          <span>
            <span className="mr-1 inline-block h-2 w-2 bg-red-500/80" />
            errors <span className="ml-2 mr-1 inline-block h-2 w-2 bg-yellow-400/60" />
            warnings
          </span>
          <span>now</span>
        </div>
      </Section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Servers"
          value={o.servers.total}
          sub={`+${o.servers.joined7d} / −${o.servers.left7d} this week`}
          to={`${ADMIN}/servers`}
        />
        {o.requests ? (
          <Stat
            label="Requests, 24 h"
            value={o.requests.last24h.toLocaleString()}
            sub={`${o.requests.failed24h} failed · slowest ${(o.requests.slowest24hMs / 1000).toFixed(1)} s`}
            tone={o.requests.failed24h > 0 ? 'warn' : undefined}
          />
        ) : (
          <Stat label="Requests, 24 h" value="Off" sub="Request logging is switched off" />
        )}
        <Stat label="Events" value={o.activity.upcomingEvents} sub={`upcoming · ${o.activity.liveEvents} live now`} />
        <Stat
          label="People signed in, 7 days"
          value={o.activity.activeUsers7d}
          sub={`${o.activity.openLootSessions} loot sessions open`}
        />
      </div>

      <StorageSection />

      <DownloadsSection />

      <WeaponAuditSection />

      {!o.feed.configured && (
        <p className="rounded-md border border-primary/40 bg-primary/10 p-3 text-sm">
          The admin Discord feed isn't set up yet.{' '}
          <Link to={`${ADMIN}/feed`} className="text-primary underline">
            Choose a channel
          </Link>{' '}
          to get error alerts and a daily digest.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Live: v{o.release.version}
        {o.release.commit && ` (${o.release.commit})`}. Refreshes every 30 seconds.
      </p>
    </div>
  );
}

const AUDIT_WORDS: Record<string, string> = {
  'missing-weapon': 'Gun missing from our page',
  'guessed-turret': 'Turret gun with no mount record',
  'role-differs': 'Who fires it disagrees with the files',
};

/**
 * Ship weapons check (v1.63.0): on every game-data build, each ship's guns as
 * we read them (who fires them, none missing) against the files' mount list.
 */
function WeaponAuditSection() {
  const q = useQuery({
    queryKey: ['admin', 'weapon-audit'],
    queryFn: adminApi.weaponAudit,
    refetchInterval: 5 * 60_000,
  });
  const a = q.data;
  if (q.isError)
    return (
      <Section title="Ship weapons check">
        <p className="text-sm text-red-400">Couldn't load the ship weapons check.</p>
      </Section>
    );
  if (q.isPending) return <Skeleton className="h-24" />;
  return (
    <Section title="Ship weapons check">
      {!a ? (
        <p className="text-sm text-muted-foreground">The ship data hasn't been built since the last restart yet.</p>
      ) : !a.problems.length ? (
        <p className="text-sm">
          All {a.ships} ships agree with the game files
          <span className="text-muted-foreground">
            {' '}
            · {a.build ?? a.commit.slice(0, 7)} · checked {ago(a.checkedAt)}
          </span>
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            {a.problems.length} of {a.ships} ships need a look
            <span className="text-muted-foreground">
              {' '}
              · {a.build ?? a.commit.slice(0, 7)} · checked {ago(a.checkedAt)}
            </span>
          </p>
          <ul className="flex flex-col gap-2 text-sm">
            {a.problems.map((p) => (
              <li key={p.className}>
                <span className="font-medium">{p.name}</span>{' '}
                <span className="text-xs text-muted-foreground">{p.className}</span>
                <ul className="ml-4 list-disc text-muted-foreground">
                  {p.issues.map((i, k) => (
                    <li key={k}>
                      {AUDIT_WORDS[i.kind] ?? i.kind} · <span className="font-mono text-xs">{i.where}</span>: {i.detail}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Run on every new game build: who fires each gun (pilot, crew turret the pilot can take over, crew turret,
        automatic) as the ship pages show it, checked against the game files&rsquo; own mount list. Changes are posted
        to the admin feed.
      </p>
    </Section>
  );
}

/** Clicks on the Mining page's RockCrawler download button (v1.59.0). */
function DownloadsSection() {
  const q = useQuery({
    queryKey: ['admin', 'downloads', 'rockcrawler'],
    queryFn: () => adminApi.downloads('rockcrawler'),
    refetchInterval: 5 * 60_000,
  });
  const d = q.data;
  if (q.isError)
    return (
      <Section title="RockCrawler downloads">
        <p className="text-sm text-red-400">Couldn't load the download counts.</p>
      </Section>
    );
  if (!d) return <Skeleton className="h-40" />;
  const maxDay = Math.max(1, ...d.days.map((x) => x.total));
  const dayLabel = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return (
    <Section title="RockCrawler downloads">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Today" value={d.today} sub="since midnight UTC" />
        <Stat label="Last 7 days" value={d.last7d} />
        <Stat label="Last 30 days" value={d.last30d} />
        <Stat
          label="All time"
          value={d.allTime}
          sub={
            d.since
              ? `since ${dayLabel(d.since)} · ${d.bySource.tools} public site · ${d.bySource.dashboard} dashboard`
              : 'nothing counted yet'
          }
        />
      </div>
      <div className="mt-4 flex h-28 items-end gap-1" role="img" aria-label="Download clicks per day, last 30 days">
        {d.days.map((x) => (
          <div
            key={x.day}
            className="flex h-full flex-1 flex-col justify-end"
            title={`${dayLabel(x.day)}: ${x.total} (${x.tools} public site, ${x.dashboard} dashboard)`}
          >
            {x.dashboard > 0 && (
              <div className="bg-sky-400/70" style={{ height: `${(x.dashboard / maxDay) * 100}%`, minHeight: 3 }} />
            )}
            {x.tools > 0 && (
              <div className="bg-primary/80" style={{ height: `${(x.tools / maxDay) * 100}%`, minHeight: 3 }} />
            )}
            {x.total === 0 && <div className="h-px bg-muted" />}
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
        <span>{dayLabel(d.days[0]!.day)}</span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 bg-primary/80" />
          public site <span className="ml-2 mr-1 inline-block h-2 w-2 bg-sky-400/70" />
          server dashboard
        </span>
        <span>today</span>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Clicks on &ldquo;Download for Windows&rdquo; on the Mining page, by UTC day. A visitor clicking again within 10
        minutes counts once. Nothing about who clicked is kept. Downloads from GitHub directly or through
        RockCrawler&rsquo;s own updates aren&rsquo;t included.
      </p>
    </Section>
  );
}

/** Uploaded images on disk, per server (v1.40.0). */
function StorageSection() {
  const q = useQuery({ queryKey: ['admin', 'storage'], queryFn: adminApi.storage, refetchInterval: 5 * 60_000 });
  const st = q.data;
  const [showAll, setShowAll] = useState(false);
  if (q.isError)
    return (
      <Section title="Image storage">
        <p className="p-4 text-sm text-red-400">Couldn't read the uploads folder.</p>
      </Section>
    );
  if (!st) return <Skeleton className="h-40" />;
  const shown = showAll ? st.servers : st.servers.slice(0, 10);
  const disk = st.disk;
  return (
    <Section title="Image storage">
      <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
        <Stat
          label="Images, all servers"
          value={formatBytes(st.totalBytes)}
          sub={`${st.files.toLocaleString()} files · ${st.servers.length} servers`}
        />
        <Stat
          label="Disk"
          value={disk ? `${formatBytes(disk.freeBytes)} free` : 'Unknown'}
          tone={
            disk && disk.freeBytes / disk.sizeBytes < 0.1
              ? 'bad'
              : disk && disk.freeBytes / disk.sizeBytes < 0.25
                ? 'warn'
                : undefined
          }
          sub={disk ? `of ${formatBytes(disk.sizeBytes)} (the volume holding uploads)` : "Can't read the disk size"}
        />
        <Stat label="Per-server limit" value={formatBytes(st.capBytes)} sub="UPLOADS_SERVER_CAP_MB" />
        <Stat
          label="Largest server"
          value={st.servers[0] ? formatBytes(st.servers[0].bytes) : '—'}
          sub={
            st.servers[0]
              ? `${st.servers[0].name ?? st.servers[0].guildId} · ${Math.round((st.servers[0].bytes / st.capBytes) * 100)}% of its limit`
              : undefined
          }
        />
      </div>
      {st.servers.length > 0 && (
        <div className="overflow-x-auto border-t">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Server</th>
                <th className="px-4 py-2 text-right font-medium">Files</th>
                <th className="px-4 py-2 text-right font-medium">Size</th>
                <th className="px-4 py-2 font-medium">Of its limit</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => {
                const share = s.bytes / st.capBytes;
                return (
                  <tr key={s.guildId} className="border-t">
                    <td className="px-4 py-2">
                      <Link to={`${ADMIN}/servers/${s.guildId}`} className="hover:text-primary hover:underline">
                        {s.name ?? <span className="font-mono text-xs">{s.guildId}</span>}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.files}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatBytes(s.bytes)}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn(
                              'h-full',
                              share >= 0.9 ? 'bg-red-500' : share >= 0.75 ? 'bg-amber-500' : 'bg-primary',
                            )}
                            style={{ width: `${Math.min(100, share * 100)}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground tabular-nums">{Math.round(share * 100)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {st.servers.length > 10 && (
            <button
              type="button"
              className="w-full border-t px-4 py-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? 'Show the top 10' : `Show all ${st.servers.length} servers`}
            </button>
          )}
        </div>
      )}
    </Section>
  );
}
