import { useParams, useNavigate } from 'react-router-dom';
import { CalendarDays, Coins, ShoppingCart, Gift, Ship, BookOpen, Calculator, Network, Trophy, Swords, ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface ModuleTile {
  label: string;
  description: string;
  icon: LucideIcon;
  slug: string;
}

const MODULES: ModuleTile[] = [
  {
    label: 'Event Bot',
    description: 'Forum channel, VC category, reminders, and recurring events.',
    icon: CalendarDays,
    slug: 'event-bot',
  },
  {
    label: 'DKP',
    description: 'Currency label, auction channel, bid increments, and duration.',
    icon: Coins,
    slug: 'dkp',
  },
  {
    label: 'Marketplace',
    description: 'Cross-guild item listings, trade requests, and inventory settings.',
    icon: ShoppingCart,
    slug: 'exchange',
  },
  {
    label: 'Loot',
    description: 'Default distribution method and loot session defaults.',
    icon: Gift,
    slug: 'loot',
  },
  {
    label: 'Fleet',
    description: 'Fleet manager channel and ship role configuration.',
    icon: Ship,
    slug: 'fleet',
  },
  {
    label: 'Blueprints',
    description: 'Blueprint library access and contribution settings.',
    icon: BookOpen,
    slug: 'blueprints',
  },
  {
    label: 'Crafting Calculator',
    description: 'Material cost source and crafting fee defaults.',
    icon: Calculator,
    slug: 'crafting-calculator',
  },
  {
    label: 'Alliance',
    description: 'Cross-guild alliance links, invitations, and shared event settings.',
    icon: Network,
    slug: 'alliance',
  },
  {
    label: 'Activity',
    description: 'RoleCallBot integration — inactivity tracking, leaderboard, and role change log.',
    icon: Trophy,
    slug: 'activity',
  },
  {
    label: 'Tournaments',
    description: 'Enable/disable the module and configure the default announcement channel for tournament threads.',
    icon: Swords,
    slug: 'tournaments',
  },
];

export function ModuleSettingsHubPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const navigate = useNavigate();

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Module Settings</h1>
        <p className="text-muted-foreground mt-0.5 text-sm">Configure each module independently.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {MODULES.map(({ label, description, icon: Icon, slug }) => (
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
