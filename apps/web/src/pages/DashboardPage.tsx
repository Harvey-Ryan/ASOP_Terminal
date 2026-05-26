import { Link, useOutletContext } from 'react-router-dom';
import { Bot, ExternalLink, Swords } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { lootApi } from '@/api/loot';
import type { MyPickDto } from '@dem/shared';
import type { DashboardOutletContext } from '@/layouts/DashboardLayout';

function DraftPickCard({ pick }: { pick: MyPickDto }) {
  const isMyTurn = pick.isMyTurn;
  return (
    <div className={`flex items-center justify-between rounded-xl border px-4 py-3 gap-4 ${
      isMyTurn
        ? 'border-amber-500/40 bg-amber-500/10'
        : 'border-border bg-card'
    }`}>
      <div className="flex items-center gap-3 min-w-0">
        <Swords className={`h-5 w-5 shrink-0 ${isMyTurn ? 'text-amber-500' : 'text-muted-foreground'}`} />
        <div className="min-w-0">
          <p className={`font-medium truncate ${isMyTurn ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}`}>
            {isMyTurn ? `It's your turn to pick in ${pick.guildName}` : `Snake draft in progress — ${pick.guildName}`}
          </p>
          <p className="text-sm text-muted-foreground truncate">
            {pick.eventName}
            {pick.itemCount > 0 && ` · ${pick.itemCount} item${pick.itemCount !== 1 ? 's' : ''} remaining`}
          </p>
        </div>
      </div>
      <Button
        asChild
        size="sm"
        className={`shrink-0 border-0 ${isMyTurn ? 'bg-amber-500 hover:bg-amber-600 text-white' : ''}`}
        variant={isMyTurn ? 'default' : 'outline'}
      >
        <Link to={pick.eventId
          ? `/dashboard/servers/${pick.guildId}/events/${pick.eventId}/loot`
          : `/dashboard/servers/${pick.guildId}/loot/sessions/${pick.sessionId}`
        }>
          {isMyTurn ? 'Pick Now' : 'View Loot'}
        </Link>
      </Button>
    </div>
  );
}

const INVITE_URL = `https://discord.com/oauth2/authorize?client_id=${import.meta.env.VITE_DISCORD_CLIENT_ID}&permissions=8&scope=bot+applications.commands`;

export function DashboardPage() {
  const { user, guilds, isLoading } = useAuth();
  const { displayName } = useOutletContext<DashboardOutletContext>();

  const myPicksQuery = useQuery({
    queryKey: ['loot', 'my-picks'],
    queryFn: () => lootApi.getMyPicks(),
    enabled: !!user,
    refetchInterval: 30_000,
  });

  const myPicks = myPicksQuery.data ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {isLoading ? (
            <Skeleton className="h-8 w-48" />
          ) : (
            <>Welcome, {displayName}</>
          )}
        </h1>
        <p className="mt-1 text-muted-foreground">
          Select a server below to manage its events and templates.
        </p>
      </div>

      {/* Snake draft notifications */}
      {myPicks.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold uppercase text-muted-foreground tracking-wide">Active Drafts</h2>
          {myPicks.map((pick) => (
            <DraftPickCard key={pick.sessionId} pick={pick} />
          ))}
        </div>
      )}

      {/* Server grid */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : guilds.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <Bot className="h-10 w-10 text-muted-foreground mb-4" />
          <p className="font-medium">No servers with the bot installed</p>
          <p className="mt-1 text-sm text-muted-foreground max-w-xs">
            Add the bot to a server where you have <strong>Manage Server</strong> permissions to get started.
          </p>
          <Button asChild className="mt-5 gap-2">
            <a href={INVITE_URL} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
              Add to Server
            </a>
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {guilds.map((guild) => (
            <Link
              key={guild.id}
              to={`/dashboard/servers/${guild.id}`}
              className="group flex items-center gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-accent"
            >
              {guild.iconUrl ? (
                <img
                  src={guild.iconUrl}
                  alt={guild.name}
                  className="h-12 w-12 shrink-0 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted text-lg font-bold">
                  {guild.name[0]}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{guild.name}</p>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {guild.owner ? 'Owner' : 'Admin'}
                  </span>
                  {guild.hasBotInstalled && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-900/40 px-2 py-0.5 text-xs text-green-400">
                      Bot active
                    </span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
