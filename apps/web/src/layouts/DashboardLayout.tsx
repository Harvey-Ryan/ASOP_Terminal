import { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate, useMatch, useLocation } from 'react-router-dom';
import { LogOut, LayoutDashboard, ExternalLink, ChevronDown, ChevronRight, Settings, Puzzle, CalendarDays } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { applyShade, loadShade } from '@/lib/shade';
import { canManageGuild } from '@dem/shared';
import type { ManagedGuild } from '@dem/shared';

function GuildIcon({ guild }: { guild: ManagedGuild }) {
  if (guild.iconUrl) {
    return <img src={guild.iconUrl} alt={guild.name} className="h-6 w-6 shrink-0 rounded-full object-cover" />;
  }
  return (
    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">
      {guild.name[0]}
    </div>
  );
}

export function DashboardLayout() {
  const { user, guilds, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const serverMatch = useMatch({ path: '/dashboard/servers/:guildId', end: false });
  const activeGuildId = serverMatch?.params.guildId;
  const activeGuild = guilds.find((g) => g.id === activeGuildId);
  const showAdminNav = !!activeGuild && canManageGuild(activeGuild);

  const onModuleRoute = location.pathname.includes('/settings/modules');
  const [modulesOpen, setModulesOpen] = useState(onModuleRoute);

  // Re-apply stored shade preference whenever the user loads
  useEffect(() => {
    if (!user?.id) return;
    applyShade(loadShade(user.id));
  }, [user?.id]);

  const displayName = user?.globalName ?? user?.username ?? '…';
  const initials = displayName[0]?.toUpperCase() ?? '?';

  const navCls = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
      isActive
        ? 'bg-primary text-primary-foreground font-medium'
        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
    );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      {/* ── Top nav bar ── */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-4">
        {/* Brand */}
        <div
          className="flex cursor-pointer items-center gap-3 hover:opacity-80 transition-opacity"
          onClick={() => navigate('/dashboard')}
        >
          <img src="/favicon.png" alt="ASOP Terminal" className="h-8 w-8 shrink-0 rounded-lg object-cover" />
          <span className="font-semibold tracking-tight">ASOP Terminal</span>
        </div>

        {/* User widget */}
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <span className="hidden text-sm text-muted-foreground sm:block">{displayName}</span>
              <Avatar className="h-8 w-8">
                <AvatarImage src={user.avatarUrl} alt={displayName} />
                <AvatarFallback className="text-xs">{initials}</AvatarFallback>
              </Avatar>
            </>
          ) : (
            <Skeleton className="h-8 w-32 rounded-full" />
          )}

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            title="Log out"
            onClick={logout}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* ── Sidebar + content row ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Sidebar ── */}
        <aside className="flex w-60 flex-col border-r border-border bg-card">
          {/* Server list */}
          <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          <p className="px-3 pb-1 pt-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Connected To
          </p>

          {guilds.length === 0 ? (
            <div className="px-3 py-3">
              <p className="text-xs text-muted-foreground mb-2">No servers with the bot installed.</p>
              <a
                href={INVITE_URL}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                Add to a server
              </a>
            </div>
          ) : activeGuild ? (
            <>
              <div className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium">
                <GuildIcon guild={activeGuild} />
                <span className="flex-1 truncate">{activeGuild.name}</span>
                {activeGuild.hasBotInstalled && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" title="Bot installed" />
                )}
              </div>

              <NavLink
                to={`/dashboard/servers/${activeGuild.id}`}
                end
                className="flex items-center gap-3 rounded-md py-2 pl-9 pr-3 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                <LayoutDashboard className="h-4 w-4 shrink-0" />
                Dashboard
              </NavLink>
            </>
          ) : (
            <>
              {guilds.map((guild) => (
                <NavLink
                  key={guild.id}
                  to={`/dashboard/servers/${guild.id}`}
                  end
                  className={navCls}
                >
                  <GuildIcon guild={guild} />
                  <span className="truncate">{guild.name}</span>
                  {guild.hasBotInstalled && (
                    <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" title="Bot installed" />
                  )}
                </NavLink>
              ))}
            </>
          )}

          {/* ── Admin-only settings section ── */}
          {showAdminNav && (
            <>
              <p className="px-3 pb-1 pt-5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Admin
              </p>

              {/* Module Settings (expandable) */}
              <button
                onClick={() => setModulesOpen((o) => !o)}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                <Puzzle className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-left">Module Settings</span>
                {modulesOpen
                  ? <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                  : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
              </button>

              {modulesOpen && (
                <NavLink
                  to={`/dashboard/servers/${activeGuild.id}/settings/modules/event-bot`}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-md py-2 pl-9 pr-3 text-sm transition-colors',
                      isActive
                        ? 'bg-primary text-primary-foreground font-medium'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    )
                  }
                >
                  <CalendarDays className="h-4 w-4 shrink-0" />
                  Event Bot
                </NavLink>
              )}

              {/* Admin */}
              <NavLink
                to={`/dashboard/servers/${activeGuild.id}/settings/bot`}
                className={navCls}
              >
                <Settings className="h-4 w-4 shrink-0" />
                Admin
              </NavLink>
            </>
          )}
        </nav>

        {/* Sidebar footer – dashboard link */}
        <div className="border-t border-border p-2">
          <NavLink
            to="/dashboard"
            end
            className={navCls}
          >
            <LayoutDashboard className="h-4 w-4 shrink-0" />
            Overview
          </NavLink>
        </div>
      </aside>

        {/* ── Main area ── */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
