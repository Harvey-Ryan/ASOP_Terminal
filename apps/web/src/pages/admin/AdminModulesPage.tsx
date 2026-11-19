// Admin → Modules (v1.28.0): hide a module for every server. A hidden module
// is off everywhere (menu, pages, settings tile, bot /help, setup checklist)
// whatever each server chose; showing it again gives servers back their own
// choice.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminModuleDto, ModuleSetting } from '@dem/shared';
import { adminApi } from '@/api/admin';
import { ToggleSwitch } from '@/components/settings/SettingsControls';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { LoadFailed, Section } from './adminUi';

export function AdminModulesPage() {
  const qc = useQueryClient();
  const modules = useQuery({ queryKey: ['admin', 'modules'], queryFn: adminApi.modules });
  const [note, setNote] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (hidden: ModuleSetting[]) => adminApi.saveModules(hidden),
    onSuccess: (list) => {
      qc.setQueryData(['admin', 'modules'], list);
      // Your own menu and settings pick it up straight away.
      void qc.invalidateQueries({ queryKey: ['my-permissions'] });
    },
  });

  if (modules.isError) return <LoadFailed error={modules.error} />;
  if (!modules.data) return <Skeleton className="h-96 max-w-2xl" />;
  const list = modules.data;

  function setShown(m: AdminModuleDto, shown: boolean) {
    const hidden = list.filter((x) => (x.setting === m.setting ? !shown : x.hidden)).map((x) => x.setting);
    setNote(`${m.label} ${shown ? 'is shown again; each server has its own setting back' : 'is now hidden for every server'}.`);
    save.mutate(hidden);
  }

  return (
    <div className="max-w-2xl space-y-4">
      <Section title="Modules for every server">
        <p className="mb-4 text-sm text-muted-foreground">
          A hidden module is off on every server, whatever its officers chose: it leaves the menu, its pages and settings tile, the bot's /help and the setup checklist.
          Servers keep their own setting, so showing it again puts things back as they were. The bot picks up a change within a minute.
        </p>
        <ul className="divide-y">
          {list.map((m) => (
            <li key={m.setting} className="py-3 first:pt-0 last:pb-0">
              <ToggleSwitch
                checked={!m.hidden}
                onChange={(shown) => setShown(m, shown)}
                label={`${m.label}${m.hidden ? ' (hidden)' : ''}`}
                description={`${m.serversOn} server${m.serversOn === 1 ? ' has' : 's have'} it switched on${m.hidden ? ' and will get it back when shown' : ''}.`}
              />
            </li>
          ))}
        </ul>
        <p className="mt-4 min-h-5 text-sm" role="status">
          {save.isPending ? 'Saving…' : save.isError ? <span className="text-destructive">Couldn't save: {save.error instanceof Error ? save.error.message : 'unknown error'}</span> : note}
        </p>
      </Section>
      <AiSwitch />
    </div>
  );
}

/**
 * The AI assistant's emergency switch (v1.56.0): off for every server at once.
 * Keys and each server's own setting are kept (and never shown here); turning
 * it off needs "TURN OFF AI" typed. Flagged questions stay with each server.
 */
function AiSwitch() {
  const qc = useQueryClient();
  const ai = useQuery({ queryKey: ['admin', 'ai'], queryFn: adminApi.ai });
  const [typed, setTyped] = useState('');
  const set = useMutation({
    mutationFn: (disabled: boolean) => adminApi.setAi(disabled, disabled ? typed : undefined),
    onSuccess: (d) => { qc.setQueryData(['admin', 'ai'], d); setTyped(''); },
  });
  if (ai.isError) return <LoadFailed error={ai.error} />;
  if (!ai.data) return <Skeleton className="h-40 max-w-2xl" />;
  const d = ai.data;
  return (
    <Section title="AI assistant (every server)">
      {d.disabled && (
        <p className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200" role="status">
          The assistant is off for every server{d.disabledAt ? ` since ${new Date(d.disabledAt).toLocaleString()}` : ''}. Server admins see a notice on its settings page.
        </p>
      )}
      <p className="mb-3 text-sm text-muted-foreground">
        {d.serversOn} server{d.serversOn === 1 ? ' has' : 's have'} it switched on; {d.keysSaved} key{d.keysSaved === 1 ? ' is' : 's are'} saved.
        Switching it off stops every answer within a minute and keeps each server's settings and key, so switching it back on restores them. Keys and flagged questions are never shown here.
      </p>
      {d.disabled ? (
        <Button size="sm" disabled={set.isPending} onClick={() => set.mutate(false)}>Switch it back on</Button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input aria-label="Type TURN OFF AI to confirm" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type TURN OFF AI"
            className="w-48 rounded-md border border-input bg-background px-3 py-1.5 text-sm" />
          <Button size="sm" variant="destructive" disabled={typed !== 'TURN OFF AI' || set.isPending} onClick={() => set.mutate(true)}>Turn off for every server</Button>
        </div>
      )}
      {set.isError && <p className="mt-2 text-sm text-destructive">{set.error instanceof Error ? set.error.message : 'Couldn\'t save.'}</p>}
    </Section>
  );
}
