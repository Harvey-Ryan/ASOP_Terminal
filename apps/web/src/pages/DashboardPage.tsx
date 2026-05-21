import { Link, useOutletContext } from 'react-router-dom';
import { Bot, ExternalLink } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { DashboardOutletContext } from '@/layouts/DashboardLayout';

const INVITE_URL = `https://discord.com/oauth2/authorize?client_id=${import.meta.env.VITE_DISCORD_CLIENT_ID}&permissions=8&scope=bot+applications.commands`;

export function DashboardPage() {
  const { user, guilds, isLoading } = useAuth();
  const { displayName } = useOutletContext<DashboardOutletContext>();

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
