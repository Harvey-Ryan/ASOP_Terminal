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
    </div>
  );
}
