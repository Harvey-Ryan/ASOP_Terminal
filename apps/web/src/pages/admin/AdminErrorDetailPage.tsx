// Admin → one error (v1.13.0): what happened, where, to whom, the stack, the
// other errors from the same request, and this kind's history and triage.

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Copy } from 'lucide-react';
import type { ErrorGroupStatus } from '@dem/shared';
import { adminApi } from '@/api/admin';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ADMIN, LevelDot, LoadFailed, Section, SourceBadge, ago, inputCls, when } from './adminUi';
import { OccurrenceList } from './AdminErrorsPage';

export function AdminErrorDetailPage() {
  const id = Number(useParams().id);
  const q = useQuery({ queryKey: ['admin', 'error', id], queryFn: () => adminApi.error(id), enabled: Number.isInteger(id) });
  if (q.isError) return <LoadFailed error={q.error} />;
  if (!q.data) return <Skeleton className="h-96" />;
  const { event: e, group, sameRef, recent } = q.data;

  const facts: [string, React.ReactNode][] = [
    ['When', <>{when(e.createdAt)} <span className="text-muted-foreground">({ago(e.createdAt)})</span></>],
    ['Ref', e.ref ? <Link className="font-mono text-primary hover:underline" to={`${ADMIN}/errors?view=all&ref=${e.ref}`}>{e.ref}</Link> : '—'],
    ['Server', e.guildId ? <Link className="text-primary hover:underline" to={`${ADMIN}/servers/${e.guildId}`}>{e.guildName ?? e.guildId}</Link> : '—'],
    ['User', e.userId ? <Link className="text-primary hover:underline" to={`${ADMIN}/errors?view=all&userId=${e.userId}`}>{e.userName ?? e.userId}</Link> : '—'],
    ['Version', e.release || '—'],
    ...Object.entries(e.context).map(([k, v]) => [k, <span className="break-all font-mono">{typeof v === 'string' ? v : JSON.stringify(v)}</span>] as [string, React.ReactNode]),
    ...(e.suppressed > 0 ? [['Dropped', `${e.suppressed} identical error(s) just before this one weren't stored (rate limit)`] as [string, React.ReactNode]] : []),
  ];

  return (
    <div className="space-y-4">
      <Link to={`${ADMIN}/errors`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Errors</Link>
      <div className="rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <LevelDot level={e.level} /><SourceBadge source={e.source} />
          <span className="text-xs uppercase text-muted-foreground">{e.level}</span>
        </div>
        <p className="mt-2 break-words font-mono text-base">{e.message}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Details" className="lg:col-span-1">
          <dl className="space-y-2 text-sm">
            {facts.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[6rem_1fr] gap-2"><dt className="capitalize text-muted-foreground">{k}</dt><dd className="min-w-0">{v}</dd></div>
            ))}
          </dl>
        </Section>
        <Section title="Stack" className="lg:col-span-2" actions={e.stack ? <CopyButton text={`${e.message}\n\n${e.stack}`} /> : undefined}>
          {e.stack ? <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed">{e.stack}</pre>
            : <p className="text-sm text-muted-foreground">No stack trace was recorded for this one (it was logged as a message).</p>}
        </Section>
      </div>

      {group && <Triage fingerprint={e.fingerprint} status={group.status} note={group.note} count={group.count} firstSeen={group.firstSeen} lastSeen={group.lastSeen} />}

      {sameRef.length > 0 && (
        <Section title={`Also during this request (Ref ${e.ref})`}>
          <OccurrenceList rows={sameRef} />
        </Section>
      )}
      <Section title="Earlier occurrences of this kind" actions={<Link className="text-sm text-primary hover:underline" to={`${ADMIN}/errors?view=all&fingerprint=${e.fingerprint}`}>See all</Link>}>
        {recent.length ? <OccurrenceList rows={recent} /> : <p className="text-sm text-muted-foreground">This is the only one.</p>}
      </Section>
    </div>
  );
}

function Triage({ fingerprint, status, note, count, firstSeen, lastSeen }: { fingerprint: string; status: ErrorGroupStatus; note: string; count: number; firstSeen: string; lastSeen: string }) {
  const qc = useQueryClient();
  const [text, setText] = useState(note);
  const save = useMutation({
    mutationFn: (body: { status?: ErrorGroupStatus; note?: string }) => adminApi.markGroup(fingerprint, body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin'] }); },
  });
  return (
    <Section title="This kind of error">
      <p className="text-sm">
        Seen <strong>{count}</strong> time{count === 1 ? '' : 's'}, first {ago(firstSeen)}, last {ago(lastSeen)}. Status: <strong className="capitalize">{status}</strong>.
        {status === 'resolved' && ' If it happens again it reopens, and the Discord feed says so.'}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input aria-label="Note" className={`${inputCls} min-w-[14rem] flex-1`} placeholder="Note (e.g. fixed in 1.13.1, Discord outage…)" value={text} maxLength={2000} onChange={(ev) => setText(ev.target.value)} />
        <Button size="sm" variant="outline" disabled={save.isPending || text === note} onClick={() => save.mutate({ note: text })}>Save note</Button>
        {status !== 'resolved' && <Button size="sm" disabled={save.isPending} onClick={() => save.mutate({ status: 'resolved', note: text })}>Resolve</Button>}
        {status !== 'ignored' && <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => save.mutate({ status: 'ignored', note: text })}>Ignore</Button>}
        {status !== 'open' && <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => save.mutate({ status: 'open' })}>Reopen</Button>}
      </div>
    </Section>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }); }}>
      <Copy className="mr-1 h-3.5 w-3.5" />{done ? 'Copied' : 'Copy'}
    </Button>
  );
}
