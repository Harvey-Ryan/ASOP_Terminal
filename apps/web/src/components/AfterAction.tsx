// After-action notes (v1.19.0): the officers' outcome and write-up once an
// event is over, and attendees' comments under it.

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AFTER_ACTION_OUTCOMES, canComment, type AfterActionOutcome, type EventDto } from '@dem/shared';
import { eventsApi } from '@/api/events';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const OUTCOMES = Object.entries(AFTER_ACTION_OUTCOMES) as [AfterActionOutcome, { label: string; emoji: string }][];

/** Success / Partial / Failed, click again to clear. */
export function OutcomePicker({ value, onChange, className }: { value: AfterActionOutcome | null; onChange: (v: AfterActionOutcome | null) => void; className?: string }) {
  return (
    <div role="radiogroup" aria-label="Outcome" className="flex flex-wrap gap-2">
      {OUTCOMES.map(([key, o]) => (
        <button key={key} type="button" role="radio" aria-checked={value === key} onClick={() => onChange(value === key ? null : key)}
          className={cn('rounded-md border px-3 py-1 text-sm transition-colors', className, value === key ? 'border-current font-semibold' : 'opacity-60 hover:opacity-100')}>
          {o.emoji} {o.label}
        </button>
      ))}
    </div>
  );
}

const panelBtn = 'h-8 px-3 text-base bg-primary text-primary-foreground border-2 border-primary-foreground hover:bg-accent hover:text-accent-foreground';
const textareaCls = 'w-full rounded-md border-2 border-primary-foreground/60 bg-primary-foreground/10 px-3 py-2 text-base text-primary-foreground placeholder:text-primary-foreground/50 focus:outline-none focus:border-primary-foreground';

/** On a finished event's detail panel (gold rows). */
export function AfterActionSection({ ev, guildId, canEdit, userId, onSaved }: {
  ev: EventDto; guildId: string; canEdit: boolean; userId?: string; onSaved: (ev: EventDto) => void;
}) {
  const aar = ev.afterAction;
  const [editing, setEditing] = useState(false);
  const [outcome, setOutcome] = useState<AfterActionOutcome | null>(aar?.outcome ?? null);
  const [notes, setNotes] = useState(aar?.notes ?? '');
  const mine = ev.comments.find((c) => c.userId === userId);
  const [draft, setDraft] = useState<string | null>(null);

  const saveNotes = useMutation({
    mutationFn: () => eventsApi.afterAction(guildId, ev.id, { outcome, notes }),
    onSuccess: (e) => { setEditing(false); onSaved(e); },
  });
  const saveComment = useMutation({
    mutationFn: (body: string) => eventsApi.comment(guildId, ev.id, body),
    onSuccess: (e) => { setDraft(null); onSaved(e); },
  });
  const removeComment = useMutation({
    mutationFn: (who: string) => eventsApi.removeComment(guildId, ev.id, who),
    onSuccess: onSaved,
  });

  const mayComment = !!userId && canComment({
    status: ev.status,
    confirmedAttendees: ev.confirmedAttendees ? JSON.stringify(ev.confirmedAttendees) : null,
    vcAttendees: JSON.stringify(ev.vcAttendees),
    rsvps: ev.rsvps,
  }, userId);
  const o = aar?.outcome ? AFTER_ACTION_OUTCOMES[aar.outcome] : null;

  return (
    <div className="flex-1 space-y-3">
      {editing ? (
        <div className="space-y-2">
          <OutcomePicker value={outcome} onChange={setOutcome} />
          <textarea aria-label="After-action notes" rows={4} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="How did it go? What worked, and what should change next time?" className={textareaCls} />
          <div className="flex gap-2">
            <Button size="sm" className={panelBtn} disabled={saveNotes.isPending} onClick={() => saveNotes.mutate()}>{saveNotes.isPending ? 'Saving…' : 'Save'}</Button>
            <Button size="sm" className={panelBtn} onClick={() => { setEditing(false); setOutcome(aar?.outcome ?? null); setNotes(aar?.notes ?? ''); }}>Cancel</Button>
          </div>
        </div>
      ) : aar ? (
        <div>
          {o && <p className="text-lg font-semibold">{o.emoji} {o.label}</p>}
          {aar.notes && <p className="whitespace-pre-wrap text-lg">{aar.notes}</p>}
          <p className="mt-1 text-sm opacity-70">
            {aar.byName && `${aar.byName} · `}{new Date(aar.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            {canEdit && <button type="button" className="ml-3 underline underline-offset-2" onClick={() => setEditing(true)}>Edit</button>}
          </p>
        </div>
      ) : canEdit ? (
        <Button size="sm" className={panelBtn} onClick={() => setEditing(true)}>Write after-action notes</Button>
      ) : (
        <span className="text-lg italic opacity-50">None yet</span>
      )}

      {/* Comments from people who were there */}
      {(ev.comments.length > 0 || mayComment) && (
        <div className="space-y-2 border-t border-primary-foreground/30 pt-3">
          {ev.comments.map((c) => (
            <div key={c.userId} className="text-base">
              <span className="font-semibold">{c.username}: </span>
              <span className="whitespace-pre-wrap">{c.body}</span>
              {c.userId === userId && draft === null && (
                <button type="button" className="ml-2 text-sm underline underline-offset-2 opacity-70 hover:opacity-100" onClick={() => setDraft(c.body)}>Edit</button>
              )}
              {(c.userId === userId || canEdit) && (
                <button type="button" className="ml-2 text-sm underline underline-offset-2 opacity-70 hover:opacity-100"
                  onClick={() => (c.userId === userId ? saveComment.mutate('') : removeComment.mutate(c.userId))}>Remove</button>
              )}
            </div>
          ))}
          {mayComment && (draft !== null || !mine) && (
            <div className="space-y-2">
              <textarea aria-label="Your comment" rows={2} maxLength={500} value={draft ?? ''} onChange={(e) => setDraft(e.target.value)}
                placeholder="You were there: add a comment" className={textareaCls} />
              <div className="flex gap-2">
                <Button size="sm" className={panelBtn} disabled={!draft?.trim() || saveComment.isPending} onClick={() => saveComment.mutate(draft ?? '')}>
                  {mine ? 'Save comment' : 'Comment'}
                </Button>
                {mine && <Button size="sm" className={panelBtn} onClick={() => setDraft(null)}>Cancel</Button>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
