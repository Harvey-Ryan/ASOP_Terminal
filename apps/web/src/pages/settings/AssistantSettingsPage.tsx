// AI assistant settings (v1.56.0), for the server's admins (Manage Server):
// provider and model, the key (write-only: it goes in once and never comes
// back; only "key ending xxxx" is shown), where and for whom it answers, limits
// and usage, flagged questions, and general guidance on choosing a model.

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bot, KeyRound, ShieldCheck, Trash2 } from 'lucide-react';
import {
  ASSISTANT_KEY_STATUS_TEXT, ASSISTANT_LIMITS, ASSISTANT_PROVIDERS,
  type AssistantProvider, type AssistantSettings, type AssistantSettingsDto,
} from '@dem/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { RolePicker, ToggleSwitch } from '@/components/settings/SettingsControls';
import { settingsApi } from '@/api/settings';
import { assistantApi } from '@/api/assistant';
import { ApiError } from '@/api/client';

const inputCls = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring';
const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong.');
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
const fmt = (n: number) => n.toLocaleString();

const settingsOnly = (d: AssistantSettingsDto): AssistantSettings => ({
  enabled: d.enabled, provider: d.provider, baseUrl: d.baseUrl, model: d.model, channelIds: d.channelIds, roleIds: d.roleIds,
  dailyQuestionLimit: d.dailyQuestionLimit, monthlyTokenLimit: d.monthlyTokenLimit, answerChars: d.answerChars,
  priceInPerM: d.priceInPerM, priceOutPerM: d.priceOutPerM,
});

export function AssistantSettingsPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['assistant', guildId], queryFn: () => assistantApi.get(guildId!), retry: false });
  const channels = useQuery({ queryKey: ['channels', guildId], queryFn: () => settingsApi.getChannels(guildId!), enabled: q.isSuccess });
  const roles = useQuery({ queryKey: ['roles', guildId], queryFn: () => settingsApi.getRoles(guildId!), enabled: q.isSuccess });
  const flags = useQuery({ queryKey: ['assistant-flags', guildId], queryFn: () => assistantApi.flags(guildId!), enabled: q.isSuccess });

  const [form, setForm] = useState<AssistantSettings | null>(null);
  const [key, setKey] = useState('');
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (q.data) setForm(settingsOnly(q.data)); }, [q.data]);

  const done = (d: AssistantSettingsDto, text: string) => {
    qc.setQueryData(['assistant', guildId], d);
    void qc.invalidateQueries({ queryKey: ['setup', guildId] });
    setNote({ ok: true, text });
  };
  const failed = (e: unknown) => setNote({ ok: false, text: errText(e) });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => assistantApi.update(guildId!, { enabled }),
    onSuccess: (d) => { done(d, d.enabled ? 'The assistant is on.' : 'The assistant is off.'); setForm((f) => (f ? { ...f, enabled: d.enabled } : f)); },
    onError: (e, enabled) => { setForm((f) => (f ? { ...f, enabled: !enabled } : f)); failed(e); },
  });
  const save = useMutation({ mutationFn: (patch: Partial<AssistantSettings>) => assistantApi.update(guildId!, patch), onSuccess: (d) => done(d, 'Saved.'), onError: failed });
  const saveKey = useMutation({
    mutationFn: () => assistantApi.saveKey(guildId!, key),
    // The box is emptied whatever happens: the key never stays in the page.
    onSuccess: (d) => { setKey(''); done(d, 'Key checked and saved.'); },
    onError: (e) => { setKey(''); failed(e); },
  });
  const testKey = useMutation({ mutationFn: () => assistantApi.testKey(guildId!), onSuccess: (d) => done(d, d.key.status === 'ok' ? 'The key works.' : 'Checked: see the key status.'), onError: failed });
  const removeKey = useMutation({ mutationFn: () => assistantApi.removeKey(guildId!), onSuccess: (d) => done(d, 'Key removed. The assistant is off.'), onError: failed });
  const dismiss = useMutation({ mutationFn: (id: string) => assistantApi.dismissFlag(guildId!, id), onSuccess: () => void qc.invalidateQueries({ queryKey: ['assistant-flags', guildId] }) });

  if (q.isError) {
    return (
      <div className="max-w-2xl space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">AI Assistant</h1>
        <p className="text-sm text-muted-foreground">{errText(q.error)}</p>
      </div>
    );
  }
  if (!q.data || !form) return <div className="max-w-3xl space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-64" /></div>;

  const d = q.data;
  const saved = settingsOnly(d);
  const set = <K extends keyof AssistantSettings>(k: K, v: AssistantSettings[K]) => { setForm({ ...form, [k]: v }); setNote(null); };
  const dirty = (keys: (keyof AssistantSettings)[]) => keys.some((k) => JSON.stringify(form[k]) !== JSON.stringify(saved[k]));
  const pick = (keys: (keyof AssistantSettings)[]) => Object.fromEntries(keys.map((k) => [k, form[k]])) as Partial<AssistantSettings>;
  const provider = ASSISTANT_PROVIDERS.find((p) => p.id === form.provider)!;
  const modelKeys: (keyof AssistantSettings)[] = ['provider', 'baseUrl', 'model'];
  const accessKeys: (keyof AssistantSettings)[] = ['channelIds', 'roleIds'];
  const limitKeys: (keyof AssistantSettings)[] = ['dailyQuestionLimit', 'monthlyTokenLimit', 'answerChars', 'priceInPerM', 'priceOutPerM'];
  const textChannels = (channels.data?.channels ?? []).filter((c) => c.type === 0 || c.type === 5);
  const channelOptions = textChannels.map((c) => ({ id: c.id, name: `#${c.name}`, color: 0, position: c.position }));
  const monthTokens = d.usage.monthTokensIn + d.usage.monthTokensOut;
  const usedShare = Math.min(1, monthTokens / d.monthlyTokenLimit);
  const maxDay = Math.max(1, ...d.usage.days.map((x) => x.tokens));
  const keyStatus = d.key.status;
  const num = (v: string) => (v === '' ? NaN : Number(v));

  const SaveRow = ({ keys }: { keys: (keyof AssistantSettings)[] }) => (
    <div className="flex items-center gap-3">
      <Button size="sm" disabled={!dirty(keys) || save.isPending} onClick={() => save.mutate(pick(keys))}>{save.isPending ? 'Saving…' : 'Save'}</Button>
    </div>
  );

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><Bot className="h-6 w-6" /> AI Assistant</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Members tag ASOP Terminal in Discord with a plain question (“when's the next op?”, “where do I mine Quantanium?”) and it answers from your server's
          events, DKP and fleet, and the game data. It uses your own AI provider and key, so your server pays the provider directly.
          Members can also sign up for events, and officers can create events from templates and edit, cancel or share them. Every change is shown first
          with Confirm and Cancel buttons that only the person who asked can press, and it uses the same permissions as the website. It never hands out loot
          or changes DKP, roles or settings.
        </p>
      </div>

      {d.globallyOff && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          The ASOP team has switched the assistant off for every server for now. Your settings are kept and apply again when it's back on.
        </div>
      )}

      {note && <p className={note.ok ? 'text-sm text-emerald-400' : 'text-sm text-destructive'} role="status">{note.text}</p>}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Switch</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <ToggleSwitch label="Answer questions in this server" checked={form.enabled}
            description={d.key.saved ? 'Members can tag the bot with questions.' : 'Choose a model and save a key first.'}
            onChange={(v) => { set('enabled', v); toggle.mutate(v); }} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Provider and model</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="ai-provider" className="text-sm font-medium">Provider</label>
            <select id="ai-provider" className={inputCls} value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value as AssistantProvider, baseUrl: null })}>
              {ASSISTANT_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <p className="text-xs text-muted-foreground">{provider.note}</p>
          </div>
          {form.provider === 'openai' && (
            <div className="space-y-1">
              <label htmlFor="ai-base" className="text-sm font-medium">Address <span className="font-normal text-muted-foreground">(leave empty for OpenAI)</span></label>
              <input id="ai-base" className={inputCls} placeholder={provider.defaultBaseUrl} value={form.baseUrl ?? ''} onChange={(e) => set('baseUrl', e.target.value || null)} />
              <p className="text-xs text-muted-foreground">The provider's OpenAI-compatible address, from its documentation (for example https://openrouter.ai/api/v1).</p>
            </div>
          )}
          <div className="space-y-1">
            <label htmlFor="ai-model" className="text-sm font-medium">Model</label>
            <input id="ai-model" className={inputCls} value={form.model} onChange={(e) => set('model', e.target.value.trim())} placeholder="The model id from your provider's model list" />
          </div>
          {d.key.saved && (form.provider !== saved.provider || (form.baseUrl ?? null) !== (saved.baseUrl ?? null)) && (
            <p className="text-xs text-amber-300">Changing the provider or address removes the saved key and switches the assistant off.</p>
          )}
          <SaveRow keys={modelKeys} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><KeyRound className="h-4 w-4" /> API key</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {d.key.saved ? (
            <div className="space-y-1 text-sm">
              <p>Key ending <span className="font-mono">{d.key.last4}</span>, saved {when(d.key.savedAt)}.</p>
              <p className={keyStatus === 'ok' ? 'text-emerald-400' : 'text-amber-300'}>
                {keyStatus ? ASSISTANT_KEY_STATUS_TEXT[keyStatus] : 'Not checked yet'}{d.key.checkedAt ? ` (checked ${when(d.key.checkedAt)})` : ''}
              </p>
            </div>
          ) : <p className="text-sm text-muted-foreground">No key saved.</p>}
          <form className="space-y-2" autoComplete="off" onSubmit={(e) => { e.preventDefault(); if (key) saveKey.mutate(); }}>
            <label htmlFor="ai-key" className="text-sm font-medium">{d.key.saved ? 'Replace the key' : 'Add a key'}</label>
            <input id="ai-key" name="ai-key" type="password" className={inputCls} value={key} onChange={(e) => setKey(e.target.value)}
              autoComplete="new-password" spellCheck={false} data-1p-ignore data-lpignore="true" data-bwignore="true" data-form-type="other"
              placeholder="Paste the key from your provider" />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" type="submit" disabled={!key || !saved.model || saveKey.isPending}>{saveKey.isPending ? 'Checking…' : 'Check and save'}</Button>
              {d.key.saved && <Button size="sm" variant="outline" type="button" disabled={testKey.isPending} onClick={() => testKey.mutate()}>{testKey.isPending ? 'Checking…' : 'Check again'}</Button>}
              {d.key.saved && <Button size="sm" variant="outline" type="button" disabled={removeKey.isPending}
                onClick={() => { if (window.confirm('Remove the key? The assistant stops until a new one is saved.')) removeKey.mutate(); }}>Remove key</Button>}
            </div>
            {!saved.model && <p className="text-xs text-muted-foreground">Save the provider and model first: the key is checked with them.</p>}
          </form>
          <div className="flex items-start gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <span>
              The key is checked with one tiny request, then stored encrypted. It's never sent back to this page or any other: not to you, other admins or the ASOP team,
              and it isn't in logs or data exports. Only the last four characters are shown. Set a spending cap in your provider's account too; that's the real safety net.
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Where and for whom</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">Channels</p>
            <p className="text-xs text-muted-foreground">It answers in these channels and their threads. None chosen = every channel it can see.</p>
            <RolePicker roles={channelOptions} selected={form.channelIds} onChange={(ids) => set('channelIds', ids)} />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">Roles</p>
            <p className="text-xs text-muted-foreground">Who can ask. None chosen = everyone in the server. Server admins always can.</p>
            <RolePicker roles={(roles.data ?? []).filter((r) => r.id !== guildId)} selected={form.roleIds} onChange={(ids) => set('roleIds', ids)} />
          </div>
          <SaveRow keys={accessKeys} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Limits and usage</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <NumberField id="ai-daily" label="Questions per member per day" value={form.dailyQuestionLimit} lim={ASSISTANT_LIMITS.dailyQuestions}
              onChange={(v) => set('dailyQuestionLimit', v)} />
            <NumberField id="ai-month" label="Tokens per month (whole server)" value={form.monthlyTokenLimit} lim={ASSISTANT_LIMITS.monthlyTokens} step={10_000}
              onChange={(v) => set('monthlyTokenLimit', v)} />
            <NumberField id="ai-chars" label="Longest answer (characters)" value={form.answerChars} lim={ASSISTANT_LIMITS.answerChars} step={100}
              onChange={(v) => set('answerChars', v)} />
          </div>
          <p className="text-xs text-muted-foreground">Limits reset at midnight UTC and on the 1st of the month (UTC); the bot tells members which limit they reached and when it resets.
            Longer answers cost more: the model is held to the same length.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="ai-pin" className="text-sm font-medium">Input price, $ per million tokens <span className="font-normal text-muted-foreground">(optional)</span></label>
              <input id="ai-pin" type="number" min={0} step="0.01" className={inputCls} value={form.priceInPerM ?? ''} onChange={(e) => set('priceInPerM', Number.isFinite(num(e.target.value)) ? num(e.target.value) : null)} />
            </div>
            <div className="space-y-1">
              <label htmlFor="ai-pout" className="text-sm font-medium">Output price, $ per million tokens <span className="font-normal text-muted-foreground">(optional)</span></label>
              <input id="ai-pout" type="number" min={0} step="0.01" className={inputCls} value={form.priceOutPerM ?? ''} onChange={(e) => set('priceOutPerM', Number.isFinite(num(e.target.value)) ? num(e.target.value) : null)} />
            </div>
          </div>
          <SaveRow keys={limitKeys} />

          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-sm font-medium">This month</p>
            <p className="text-sm text-muted-foreground">
              {fmt(d.usage.monthQuestions)} question{d.usage.monthQuestions === 1 ? '' : 's'} · {fmt(monthTokens)} of {fmt(d.monthlyTokenLimit)} tokens
              {d.usage.monthCostEstimate !== null && ` · about $${d.usage.monthCostEstimate.toFixed(2)}`}
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(usedShare * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Monthly tokens used">
              <div className={usedShare > 0.9 ? 'h-full bg-amber-400' : 'h-full bg-primary'} style={{ width: `${usedShare * 100}%` }} />
            </div>
            <div className="flex h-16 items-end gap-0.5" aria-label="Tokens per day, last 30 days">
              {d.usage.days.map((x) => (
                <div key={x.day} className="flex-1 rounded-t bg-primary/60" style={{ height: `${Math.max(2, (x.tokens / maxDay) * 100)}%`, opacity: x.tokens ? 1 : 0.25 }}
                  title={`${x.day}: ${fmt(x.questions)} questions, ${fmt(x.tokens)} tokens`} />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Last 30 days. ASOP keeps counts only, never the questions or answers. The cost is an estimate from the prices above; your provider's bill is the real figure.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Flagged questions</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Questions the model judged abusive or harmful (it doesn't answer them). Only this server's admins see them; each is deleted after 90 days, and the member can see and delete theirs under Your data.
          </p>
          {flags.isLoading ? <Skeleton className="h-12" /> : !flags.data?.length ? <p className="text-sm text-muted-foreground">None.</p> : (
            <ul className="divide-y divide-border">
              {flags.data.map((f) => (
                <li key={f.id} className="flex items-start gap-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="break-words">“{f.question}”</p>
                    <p className="text-xs text-muted-foreground">{f.username} · {when(f.createdAt)} · {f.reason}</p>
                  </div>
                  <Button size="sm" variant="ghost" aria-label="Dismiss" disabled={dismiss.isPending} onClick={() => dismiss.mutate(f.id)}><Trash2 className="h-4 w-4" /></Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ModelGuide />
    </div>
  );
}

function NumberField({ id, label, value, lim, step = 1, onChange }: {
  id: string; label: string; value: number; lim: { min: number; max: number }; step?: number; onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <input id={id} type="number" min={lim.min} max={lim.max} step={step} className={inputCls} value={value}
        onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(Math.min(lim.max, Math.max(lim.min, Math.round(n)))); }} />
    </div>
  );
}

/** General guidance only: ASOP doesn't recommend or test particular models (admins choose). */
function ModelGuide() {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Choosing a model</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p>ASOP doesn't recommend particular models; pick what suits your server's budget. Some general points:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li><span className="text-foreground">It must support tool calling</span> (also called function calling). Without it the assistant can't look anything up. The key check fails for models that can't.</li>
          <li><span className="text-foreground">Size and cost:</span> the smallest models are cheapest but misread more questions and pick the wrong lookup more often. Mid-size models cost more and make far fewer mistakes.</li>
          <li><span className="text-foreground">“Thinking” models</span> spend part of each answer's allowance thinking, so they cost more and can run out of room on short answers. A model without thinking, or set to minimal thinking, suits quick lookups.</li>
          <li><span className="text-foreground">Try it first:</span> ask a few real questions (the next event, your DKP, where to mine an ore) and check the answers before opening it to everyone.</li>
          <li><span className="text-foreground">Self-hosted models</span> (such as Ollama) aren't supported yet.</li>
          <li><span className="text-foreground">Privacy:</span> questions, and what the bot looks up for them, go to the provider you pick. Read its data policy.</li>
          <li><span className="text-foreground">Spending cap:</span> set one in your provider's account. ASOP's limits work from estimates; the provider's cap is the real safety net.</li>
        </ul>
      </CardContent>
    </Card>
  );
}
