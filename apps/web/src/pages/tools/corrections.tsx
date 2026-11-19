// Community corrections in the tools (v1.53.0):
// - <Fix> wraps one stat: a corrected value is marked (dotted underline, who
//   corrected it on hover), and a subtle ✎ appears on hover to submit one.
// - <CorrectionsProvider> holds the live list, the viewer's choice and the
//   submit window for a page.
// - <DataViewToggle> ("Corrected · Game files") and <BuildBadge> sit in the
//   tools header.

import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  CORRECTION_KINDS, correctableField, correctionCredit, correctionKey, shortBuild,
  type ApiResponse, type CorrectionDto, type LiveCorrectionDto,
} from '@dem/shared';
import { api, ApiError } from '../../api/client';
import { authApi } from '../../api/auth';
import { useAuth } from '../../hooks/useAuth';
import { setDataView, uploadEvidence, useCorrectionRole, useDataView, useGameBuild, useLiveCorrections, type DataView } from '../../lib/corrections';
import { fmt } from '../../lib/gameTools';

export interface FixTarget {
  kind: string;
  recordKey: string;
  recordName: string;
  field: string;
  /** What the game files say (the value shown when there's no correction) */
  game: number | null;
  build: string | null;
}

interface Ctx {
  index: ReadonlyMap<string, LiveCorrectionDto>;
  view: DataView;
  build: string | null;
  open: (t: FixTarget) => void;
}
const CorrectionsContext = createContext<Ctx | null>(null);

/** The live corrections and the viewer's choice, for applying them to records. */
export function useCorrections() {
  const { index } = useLiveCorrections();
  const view = useDataView();
  return { index: view === 'corrected' ? index : new Map<string, LiveCorrectionDto>(), allIndex: index, view };
}

export function CorrectionsProvider({ build, children }: { build: string | null; children: ReactNode }) {
  const { allIndex, view } = useCorrections();
  const [target, setTarget] = useState<FixTarget | null>(null);
  return (
    <CorrectionsContext.Provider value={{ index: allIndex, view, build, open: setTarget }}>
      {children}
      {target && <SubmitWindow target={target} existing={allIndex.get(correctionKey(target.kind, target.recordKey, target.field)) ?? null} onClose={() => setTarget(null)} />}
    </CorrectionsContext.Provider>
  );
}

/**
 * One stat that can be corrected. `value` is the number shown (already
 * corrected when the viewer sees corrections); children render it.
 */
export function Fix({ kind, recordKey, recordName, field, value, children }: {
  kind: string; recordKey: string; recordName: string; field: string; value: number | null | undefined; children: ReactNode;
}) {
  const ctx = useContext(CorrectionsContext);
  if (!ctx || !correctableField(kind, field)) return <>{children}</>;
  const c = ctx.index.get(correctionKey(kind, recordKey, field));
  const shownCorrected = !!c && ctx.view === 'corrected';
  const game = c ? c.gameValue : value ?? null;
  const title = c
    ? shownCorrected
      ? `${correctionCredit(c)}. Game files say ${c.gameValue ?? '—'}.${c.disputed ? ' Disputed: being re-checked.' : ''}`
      : `Members corrected this to ${c.value}. Switch to "Corrected" to use it.`
    : undefined;
  return (
    <span className="gt-fix">
      <span className={shownCorrected ? (c!.disputed ? 'gt-fixed gt-fixed-disputed' : 'gt-fixed') : c ? 'gt-fix-available' : undefined} title={title}>
        {children}
      </span>
      <button type="button" className="gt-fix-btn" aria-label={`Submit a correction to ${recordName}'s ${correctableField(kind, field)!.label.toLowerCase()}`}
        title="Submit correction" onClick={(e) => { e.stopPropagation(); ctx.open({ kind, recordKey, recordName, field, game, build: ctx.build }); }}>✎</button>
    </span>
  );
}

// ── Submit ───────────────────────────────────────────────────────────────────

function SubmitWindow({ target, existing, onClose }: { target: FixTarget; existing: LiveCorrectionDto | null; onClose: () => void }) {
  const { user } = useAuth();
  const role = useCorrectionRole();
  const location = useLocation();
  const qc = useQueryClient();
  const f = correctableField(target.kind, target.field)!;
  const kind = CORRECTION_KINDS[target.kind]!;
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [credit, setCredit] = useState(true);
  const [evidence, setEvidence] = useState<string | null>(null);
  const [busy, setBusy] = useState<'upload' | 'send' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<CorrectionDto | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy('upload'); setError(null);
    try { setEvidence(await uploadEvidence(file)); } catch (e) { setError(e instanceof ApiError ? e.message : 'Upload failed'); } finally { setBusy(null); }
  };
  const send = async () => {
    setBusy('send'); setError(null);
    try {
      const res = await api.post<ApiResponse<CorrectionDto>>('/corrections', { kind: target.kind, recordKey: target.recordKey, field: target.field, value, note, evidenceUrl: evidence, credit });
      setSent(res.data!);
      void qc.invalidateQueries({ queryKey: ['corrections'] });
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Couldn’t send it'); } finally { setBusy(null); }
  };

  const signedOut = !user;
  const notMember = !!user && role.data && !role.data.member;

  return (
    <div className="gt-modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="gt-fix-h" className="gt-modal" style={{ maxWidth: 560 }}>
        <div className="flex items-center justify-between gap-4 px-5 py-4" style={{ borderBottom: '1px solid var(--gt-line)' }}>
          <div className="flex flex-col">
            <span className="gt-label gt-label-acc">Submit a correction</span>
            <h2 id="gt-fix-h" className="m-0 text-lg gt-hi">{target.recordName} · {f.label}</h2>
          </div>
          <button type="button" className="gt-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="flex flex-col gap-4 px-5 py-5 overflow-auto">
          <div className="flex flex-wrap gap-x-8 gap-y-2">
            <span className="flex flex-col"><span className="gt-label">Game files say</span><span className="gt-mono text-xl gt-hi">{target.game == null ? '—' : `${fmt(target.game, target.game % 1 ? 2 : 0)}${f.unit ?? ''}`}</span></span>
            {existing && <span className="flex flex-col"><span className="gt-label">Already corrected to</span><span className="gt-mono text-xl gt-acc">{existing.value}{f.unit ?? ''}</span></span>}
            {target.build && <span className="flex flex-col"><span className="gt-label">Build</span><span className="gt-mono text-sm gt-dim pt-1.5">{target.build}</span></span>}
          </div>

          {sent ? (
            <div className="flex flex-col gap-3">
              <p className="m-0 gt-hi">Thanks — it&rsquo;s in the queue.</p>
              <p className="m-0 text-sm gt-dim">Two other members check it in game, then a data reviewer approves it. You&rsquo;ll find it under <Link to="/tools/corrections?view=mine" className="gt-link">Corrections → Mine</Link>.</p>
              <div><button type="button" className="gt-btn" onClick={onClose}>Close</button></div>
            </div>
          ) : signedOut ? (
            <div className="flex flex-col gap-3">
              <p className="m-0 text-sm">Sign in with Discord to send a correction. Members of a server that uses ASOP can send and confirm them.</p>
              <div><a className="gt-btn gt-btn-primary" href={authApi.loginUrl(location.pathname + location.search)}>Sign in with Discord</a></div>
            </div>
          ) : notMember ? (
            <p className="m-0 text-sm">Corrections come from members of a server that uses ASOP. Join one of their Discord servers to send them.</p>
          ) : (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm">What it really is{f.unit ? ` (${f.unit})` : ''}</span>
                <input className="gt-input gt-mono text-xl" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={target.game == null ? '' : String(target.game)} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm">Where you saw it</span>
                <textarea className="gt-input gt-textarea" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Item stats in the shop at Lorville, 4.10.3" />
              </label>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm">Screenshot <span className="gt-dim">(required: the in-game value, clearly visible)</span></span>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
                <div className="flex items-center gap-3">
                  <button type="button" className="gt-btn" disabled={busy === 'upload'} onClick={() => fileRef.current?.click()}>{busy === 'upload' ? 'Uploading…' : evidence ? 'Change screenshot' : 'Add screenshot'}</button>
                  {evidence && <a href={evidence} target="_blank" rel="noreferrer" className="text-sm gt-link">View</a>}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={credit} onChange={(e) => setCredit(e.target.checked)} />
                Credit me by my Discord name (otherwise &ldquo;an ASOP member&rdquo;)
              </label>
              {error && <p className="m-0 text-sm gt-bad">{error}</p>}
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className="gt-btn gt-btn-primary" disabled={!value.trim() || !evidence || note.trim().length < 5 || busy !== null} onClick={() => void send()}>{busy === 'send' ? 'Sending…' : 'Send correction'}</button>
                <span className="text-xs gt-dim">Shown once 2 members confirm it and a data reviewer approves it.</span>
              </div>
            </>
          )}
          <p className="m-0 text-xs gt-dim">{kind.where}. Corrections are a layer on top of the game files: anyone can switch back to the files&rsquo; numbers at the top of the page.</p>
        </div>
      </div>
    </div>
  );
}

// ── Header bits ──────────────────────────────────────────────────────────────

export function DataViewToggle() {
  const view = useDataView();
  const { data } = useLiveCorrections();
  const count = data?.corrections.length ?? 0;
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Which numbers to show">
      <button type="button" className="gt-btn" style={{ minHeight: 32, padding: '0 10px' }} aria-pressed={view === 'corrected'} onClick={() => setDataView('corrected')}
        title={`Use the ${count} correction${count === 1 ? '' : 's'} members confirmed and a reviewer approved`}>Corrected</button>
      <button type="button" className="gt-btn" style={{ minHeight: 32, padding: '0 10px' }} aria-pressed={view === 'files'} onClick={() => setDataView('files')}
        title="Show the game files' numbers exactly as they are">Game files</button>
    </div>
  );
}

export function BuildBadge() {
  const { data } = useGameBuild();
  const short = shortBuild(data?.build);
  if (!short) return null;
  const synced = data?.syncedAt ? new Date(data.syncedAt) : null;
  const behind = data?.newerAvailable === true;
  const title = `${data!.build}${synced ? ` · synced ${synced.toLocaleString()}` : ''}${behind ? ' · newer game data found, updating' : ''}`;
  return (
    <span className={`gt-build${behind ? ' gt-build-behind' : ''}`} title={title}>
      <span aria-hidden="true" className="gt-build-dot" />
      {short}{behind && <span className="hidden sm:inline"> · updating</span>}
    </span>
  );
}
