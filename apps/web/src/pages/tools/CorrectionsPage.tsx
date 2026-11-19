// Corrections (v1.53.0): the queue of community corrections at
// /tools/corrections. Anyone can read it; members confirm, data reviewers
// approve, reject, uphold or revert; anyone can dispute a live one. Platform
// admins pick the data reviewers here too. Rules: packages/shared/src/corrections.ts.

import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CONFIRMATIONS_NEEDED, CORRECTION_KINDS, CORRECTION_STATUS_LABELS, correctableField,
  type ApiResponse, type CorrectionAction, type CorrectionDto, type DataReviewerDto,
} from '@dem/shared';
import { api, ApiError } from '../../api/client';
import { authApi } from '../../api/auth';
import { useAuth } from '../../hooks/useAuth';
import { uploadEvidence, useCorrectionRole } from '../../lib/corrections';

type Tab = 'open' | 'live' | 'closed' | 'mine';
const TABS: { id: Tab; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'live', label: 'Live' },
  { id: 'closed', label: 'Closed' },
  { id: 'mine', label: 'Mine' },
];

export function CorrectionsPage() {
  const { user } = useAuth();
  const role = useCorrectionRole();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get('view'))?.id ?? 'open') as Tab;
  const list = useQuery({
    queryKey: ['corrections', 'list', tab],
    queryFn: async () => (await api.get<ApiResponse<CorrectionDto[]>>(`/corrections?view=${tab}`)).data!,
    enabled: tab !== 'mine' || !!user,
  });
  const tabs = TABS.filter((t) => t.id !== 'mine' || user);

  return (
    <div className="flex flex-col">
      <section className="px-5 sm:px-10 pt-8 pb-5 flex flex-col gap-3 max-w-[900px]">
        <span className="gt-label gt-label-acc">Corrections</span>
        <h1 className="m-0 text-3xl font-bold gt-hi">When the game files are wrong</h1>
        <p className="m-0 gt-dim leading-relaxed">
          Members send a fix with a screenshot. {CONFIRMATIONS_NEEDED} other members check it in game, then a data reviewer who didn&rsquo;t confirm it approves it.
          Approved fixes show on the tools with a dotted underline and the name of who spotted it; switch to &ldquo;Game files&rdquo; at the top to see the files&rsquo; own numbers.
          When a game update brings the files in line, the fix retires by itself and keeps its credit.
        </p>
        <p className="m-0 text-sm gt-dim">To send one, hover over a number on the Mining page and click ✎.</p>
        {!user && <div><a className="gt-btn gt-btn-primary" href={authApi.loginUrl('/tools/corrections')}>Sign in to confirm or send corrections</a></div>}
        {role.data?.reviewer && <p className="m-0 text-sm gt-acc">You&rsquo;re a data reviewer.</p>}
      </section>

      <nav aria-label="Corrections" className="flex flex-wrap gap-x-6 px-5 sm:px-10" style={{ borderBottom: '1px solid var(--gt-line)', background: 'var(--gt-faint)' }}>
        {tabs.map((t) => (
          <button key={t.id} type="button" className="gt-tab" style={{ padding: '14px 0 12px', background: 'none', border: 0, borderBottom: `2px solid ${tab === t.id ? 'var(--gt-acc)' : 'transparent'}`, font: 'inherit', cursor: 'pointer' }}
            aria-current={tab === t.id ? 'page' : undefined} onClick={() => { const n = new URLSearchParams(params); if (t.id === 'open') n.delete('view'); else n.set('view', t.id); setParams(n, { replace: true }); }}>{t.label}</button>
        ))}
      </nav>

      <div className="px-5 sm:px-10 py-6 flex flex-col gap-4 max-w-[1000px]">
        {list.isLoading && <p className="gt-dim m-0">Loading…</p>}
        {list.error && <p className="gt-bad m-0">{list.error instanceof Error ? list.error.message : 'Couldn’t load the list'}</p>}
        {list.data && !list.data.length && <p className="gt-dim m-0">{tab === 'open' ? 'Nothing waiting. ' : ''}No corrections here yet.</p>}
        {list.data?.map((c) => <CorrectionCard key={c.id} c={c} />)}
      </div>

      {role.data?.platformAdmin && <Reviewers />}
    </div>
  );
}

const ACTION_LABELS: Record<CorrectionAction, string> = {
  confirm: 'I see this in game too',
  approve: 'Approve',
  reject: 'Reject',
  dispute: 'Dispute',
  uphold: 'Keep it',
  revert: 'Revert',
  withdraw: 'Withdraw',
};
const NEEDS_NOTE: CorrectionAction[] = ['reject', 'dispute', 'revert'];
const MAY_ADD_SCREENSHOT: CorrectionAction[] = ['confirm', 'dispute'];

function CorrectionCard({ c }: { c: CorrectionDto }) {
  const qc = useQueryClient();
  const f = correctableField(c.kind, c.field);
  const kind = CORRECTION_KINDS[c.kind];
  const unit = f?.unit ?? '';
  const [acting, setActing] = useState<CorrectionAction | null>(null);
  const [note, setNote] = useState('');
  const [ack, setAck] = useState(false);
  const [evidence, setEvidence] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const act = useMutation({
    mutationFn: async (a: CorrectionAction) => (await api.post<ApiResponse<CorrectionDto>>(`/corrections/${c.id}/${a}`, { note, evidenceUrl: evidence, acknowledgeBigChange: ack })).data!,
    onSuccess: () => { setActing(null); setNote(''); setEvidence(null); setError(null); void qc.invalidateQueries({ queryKey: ['corrections'] }); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'That didn’t work'),
  });

  const statusColour = c.status === 'LIVE' ? 'gt-good' : c.status === 'DISPUTED' || c.status === 'RECHECK' ? 'gt-bad' : c.status === 'RETIRED' ? 'gt-acc' : 'gt-dim';
  const begin = (a: CorrectionAction) => {
    setError(null);
    if (NEEDS_NOTE.includes(a) || MAY_ADD_SCREENSHOT.includes(a) || (a === 'approve' && c.bigChange)) setActing(a);
    else act.mutate(a);
  };

  return (
    <article className="flex flex-col gap-3 p-4" style={{ border: '1px solid var(--gt-line)', borderRadius: 6 }}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-xs gt-dim">{kind?.where ?? c.kind}</span>
          <span className="font-semibold gt-hi">{c.recordName} · {f?.label ?? c.field}</span>
        </div>
        <span className={`text-sm font-semibold ${statusColour}`}>{CORRECTION_STATUS_LABELS[c.status]}{c.status === 'RETIRED' && c.retiredBuild ? ` (${c.retiredBuild})` : ''}</span>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <span className="flex flex-col"><span className="gt-label">Game files</span><span className="gt-mono text-lg">{c.gameValue ?? '—'}{unit}</span></span>
        <span aria-hidden="true" className="gt-dim">→</span>
        <span className="flex flex-col"><span className="gt-label">Correction</span><span className="gt-mono text-lg gt-acc">{c.value}{unit}</span></span>
        {c.bigChange && <span className="text-xs gt-bad">Big change: check the screenshots closely</span>}
      </div>

      <p className="m-0 text-sm">&ldquo;{c.note}&rdquo; <span className="gt-dim">— {c.credit ?? 'an ASOP member'}{c.mine ? ' (you)' : ''}, {new Date(c.submittedAt).toLocaleDateString()}{c.build ? `, build ${c.build}` : ''}</span></p>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <a href={c.evidenceUrl} target="_blank" rel="noreferrer" className="gt-link">Screenshot</a>
        <span className="gt-dim">
          Confirmed by {c.confirmations}{c.status === 'PENDING' ? ` of ${CONFIRMATIONS_NEEDED}` : ''}{c.confirmers.length ? `: ${c.confirmers.join(', ')}` : ''}{c.youConfirmed ? ' (including you)' : ''}
        </span>
        {c.reviewer && <span className="gt-dim">Reviewed by {c.reviewer}</span>}
        <button type="button" className="gt-link text-sm" onClick={() => setShowHistory((v) => !v)}>{showHistory ? 'Hide history' : 'History'}</button>
      </div>
      {c.reviewNote && <p className="m-0 text-sm gt-dim">Reviewer: &ldquo;{c.reviewNote}&rdquo;</p>}

      {showHistory && (
        <ol className="m-0 pl-5 text-sm gt-dim flex flex-col gap-1">
          {c.history.map((h, i) => (
            <li key={i}>
              {new Date(h.at).toLocaleString()} · <span className="gt-hi">{h.action}</span>{h.actor ? ` by ${h.actor}` : ''}{h.note ? ` — “${h.note}”` : ''}
              {h.evidenceUrl && <> · <a href={h.evidenceUrl} target="_blank" rel="noreferrer" className="gt-link">screenshot</a></>}
            </li>
          ))}
        </ol>
      )}

      {c.actions.length > 0 && !acting && (
        <div className="flex flex-wrap gap-2">
          {c.actions.map((a) => (
            <button key={a} type="button" className={`gt-btn${a === 'approve' || a === 'confirm' ? ' gt-btn-primary' : ''}`} disabled={act.isPending} onClick={() => begin(a)}>{ACTION_LABELS[a]}</button>
          ))}
        </div>
      )}

      {acting && (
        <div className="flex flex-col gap-3 p-3" style={{ background: 'var(--gt-faint)', borderRadius: 4 }}>
          <span className="text-sm font-semibold gt-hi">{ACTION_LABELS[acting]}</span>
          <textarea className="gt-input gt-textarea" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={NEEDS_NOTE.includes(acting) ? 'Why? (needed, so others can check)' : 'Note (optional)'} />
          {MAY_ADD_SCREENSHOT.includes(acting) && (
            <div className="flex items-center gap-3">
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try { setEvidence(await uploadEvidence(file)); } catch (err) { setError(err instanceof ApiError ? err.message : 'Upload failed'); }
              }} />
              <button type="button" className="gt-btn" onClick={() => fileRef.current?.click()}>{evidence ? 'Change screenshot' : 'Add a screenshot (optional)'}</button>
              {evidence && <a href={evidence} target="_blank" rel="noreferrer" className="text-sm gt-link">View</a>}
            </div>
          )}
          {acting === 'approve' && c.bigChange && (
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I&rsquo;ve checked the screenshots for this big change</label>
          )}
          <div className="flex gap-2">
            <button type="button" className="gt-btn gt-btn-primary" disabled={act.isPending || (NEEDS_NOTE.includes(acting) && !note.trim()) || (acting === 'approve' && c.bigChange && !ack)} onClick={() => act.mutate(acting)}>
              {act.isPending ? 'Saving…' : ACTION_LABELS[acting]}
            </button>
            <button type="button" className="gt-btn" onClick={() => { setActing(null); setError(null); }}>Cancel</button>
          </div>
        </div>
      )}
      {error && <p className="m-0 text-sm gt-bad">{error}</p>}
    </article>
  );
}

// ── Data reviewers (platform admins) ─────────────────────────────────────────

function Reviewers() {
  const qc = useQueryClient();
  const [who, setWho] = useState('');
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['admin', 'reviewers'],
    queryFn: async () => (await api.get<ApiResponse<DataReviewerDto[]>>('/admin/reviewers')).data!,
  });
  const change = useMutation({
    mutationFn: async (op: { add?: string; remove?: string }) => (op.add
      ? await api.post<ApiResponse<DataReviewerDto[]>>('/admin/reviewers', { who: op.add })
      : await api.delete<ApiResponse<DataReviewerDto[]>>(`/admin/reviewers/${encodeURIComponent(op.remove!)}`)).data!,
    onSuccess: (data) => { qc.setQueryData(['admin', 'reviewers'], data); setWho(''); setError(null); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'That didn’t work'),
  });
  return (
    <section className="px-5 sm:px-10 py-6 flex flex-col gap-3 max-w-[700px]" style={{ borderTop: '1px solid var(--gt-line)' }}>
      <h2 className="gt-label gt-label-acc m-0">Data reviewers</h2>
      <p className="m-0 text-sm gt-dim">They approve corrections once members have confirmed them. Platform admins always can. Changes are logged.</p>
      {list.data?.map((r) => (
        <div key={r.discordId} className="flex items-center justify-between gap-3 py-2 gt-row">
          <span><span className="gt-hi">{r.username}</span> <span className="text-xs gt-dim">added by {r.addedBy ?? '—'} on {new Date(r.createdAt).toLocaleDateString()}</span></span>
          <button type="button" className="gt-btn" onClick={() => change.mutate({ remove: r.discordId })}>Remove</button>
        </div>
      ))}
      {list.data && !list.data.length && <p className="m-0 text-sm gt-dim">None yet.</p>}
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); if (who.trim()) change.mutate({ add: who.trim() }); }}>
        <label className="flex flex-col gap-1 flex-1 min-w-[220px]">
          <span className="text-sm">Discord username or id (they must have signed in to ASOP)</span>
          <input className="gt-input" value={who} onChange={(e) => setWho(e.target.value)} />
        </label>
        <button type="submit" className="gt-btn gt-btn-primary" disabled={!who.trim() || change.isPending}>Add reviewer</button>
      </form>
      {error && <p className="m-0 text-sm gt-bad">{error}</p>}
    </section>
  );
}
