import { useParams, useNavigate } from 'react-router-dom';
import { CalendarDays, Coins, ShoppingCart, Gift, Ship, BookOpen, Calculator, Trophy, Swords, ChevronRight, Briefcase } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ModuleSetting } from '@dem/shared';
import { useQuery } from '@tanstack/react-query';
import { SetupChecklist } from '@/components/SetupChecklist';
import { settingsApi } from '@/api/settings';

interface ModuleTile {
  label: string;
  description: string;
  icon: LucideIcon;
  slug: string;
  setting: ModuleSetting;
}

const MODULES: ModuleTile[] = [
  {
    label: 'Event Bot',
    description: 'Forum channel, VC category, reminders, and recurring events.',
    icon: CalendarDays,
    slug: 'event-bot',
    setting: 'eventBotEnabled',
  },
  {
    label: 'DKP',
    description: 'Currency label, auction channel, bid increments, and duration.',
    icon: Coins,
    slug: 'dkp',
    setting: 'dkpEnabled',
  },
  {
    label: 'Marketplace',
    description: 'Cross-guild item listings, trade requests, and inventory settings.',
    icon: ShoppingCart,
    slug: 'exchange',
    setting: 'exchangeEnabled',
  },
  {
    label: 'Loot',
    description: 'Default distribution method and loot session defaults.',
    icon: Gift,
    slug: 'loot',
    setting: 'lootEnabled',
  },
  {
    label: 'Fleet',
    description: 'Fleet manager channel and ship role configuration.',
    icon: Ship,
    slug: 'fleet',
    setting: 'fleetEnabled',
  },
  {
    label: 'Blueprints',
    description: 'Blueprint library access and contribution settings.',
    icon: BookOpen,
    slug: 'blueprints',
    setting: 'blueprintsEnabled',
  },
  {
    label: 'Crafting Calculator',
    description: 'Material cost source and crafting fee defaults.',
    icon: Calculator,
    slug: 'crafting-calculator',
    setting: 'craftingEnabled',
  },
  {
    label: 'Activity',
    description: 'RoleCallBot integration — inactivity tracking, leaderboard, and role change log.',
    icon: Trophy,
    slug: 'activity',
    setting: 'activityEnabled',
  },
  {
    label: 'Job Board',
    description: 'Members post small jobs and others take them; optional Discord channel.',
    icon: Briefcase,
    slug: 'jobs',
    setting: 'jobsEnabled',
  },
  {
    label: 'Tournaments',
    description: 'Enable/disable the module and configure the default announcement channel for tournament threads.',
    icon: Swords,
    slug: 'tournaments',
    setting: 'tournamentsEnabled',
  },
];

export function ModuleSettingsHubPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const navigate = useNavigate();
  // Activity (RoleCall) only exists for the servers it tracks (v1.25.0).
  const { data: perms } = useQuery({ queryKey: ['my-permissions', guildId], queryFn: () => settingsApi.getMyPermissions(guildId!), enabled: !!guildId, staleTime: 60_000 });
  // Modules a platform admin hid for every server have no settings to show (v1.28.0).
  const hidden = new Set(perms?.hiddenModules ?? []);
  const modules = MODULES.filter((m) => !hidden.has(m.setting) && (m.slug !== 'activity' || perms?.activityAvailable !== false));

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Module Settings</h1>
        <p className="text-muted-foreground mt-0.5 text-sm">Configure each module independently.</p>
      </div>

      <SetupChecklist guildId={guildId!} variant="page" />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {modules.map(({ label, description, icon: Icon, slug }) => (
          <button
            key={slug}
            type="button"
            onClick={() => navigate(`/dashboard/servers/${guildId}/settings/modules/${slug}`)}
            className="group flex items-center gap-4 rounded-xl border border-border bg-card px-5 py-4 text-left transition-colors hover:border-primary/50 hover:bg-accent"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary/15 transition-colors">
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sm leading-snug">{label}</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-snug line-clamp-2">{description}</p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
          </button>
        ))}
      </div>
    </div>
  );
}
