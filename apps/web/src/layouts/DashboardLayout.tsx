import { useState, useEffect, useRef } from 'react';
import { NavLink, Outlet, useNavigate, useMatch, useLocation } from 'react-router-dom';
import { LogOut, List, LayoutDashboard, ExternalLink, ChevronDown, ChevronRight, Settings, Puzzle, CalendarDays, Gavel, Coins, Database } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { applyShade, loadShade } from '@/lib/shade';
import { loadDisplayName, saveDisplayName } from '@/lib/displayName';
import { canManageGuild } from '@dem/shared';
import { useDkpLabel } from '@/hooks/useDkpLabel';
import { HelpPanel } from '@/components/HelpPanel';
import type { ManagedGuild, DiscordUser } from '@dem/shared';

const INVITE_URL = `https://discord.com/oauth2/authorize?client_id=${import.meta.env.VITE_DISCORD_CLIENT_ID}&permissions=8&scope=bot+applications.commands`;

export type DashboardOutletContext = { displayName: string };

// ── Profile dropdown ──────────────────────────────────────────────────────────

function ProfileDropdown({
  user,
  onSave,
  onClose,
}: {
  user: DiscordUser;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const discordName = user.globalName ?? user.username;
  const [savedName] = useState(() => loadDisplayName(user.id));
  const [input, setInput] = useState(savedName);

  function save() {
    onSave(input.trim());
    onClose();
  }

  function reset() {
    onSave('');
    onClose();
  }

  return (
    <div className="absolute right-0 top-full mt-2 z-50 w-72 rounded-lg border border-border bg-card p-4 shadow-xl">
      {/* Discord identity (read-only) */}
      <div className="flex items-center gap-3 mb-4 pb-3 border-b border-border">
        <Avatar className="h-10 w-10 shrink-0">
          <AvatarImage src={user.avatarUrl} alt={discordName} />
          <AvatarFallback className="text-sm">{discordName[0]?.toUpperCase() ?? '?'}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{discordName}</p>
          <p className="text-xs text-muted-foreground truncate">@{user.username}</p>
        </div>
      </div>

      {/* Display name editor */}
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Display Name</p>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') onClose();
          }}
          placeholder={discordName}
          autoFocus
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
        />
        <p className="text-xs text-muted-foreground">Overrides your Discord name in this app.</p>
        <div className="flex gap-2 pt-1">
          <Button size="sm" onClick={save} className="flex-1">
            Save
          </Button>
          {savedName && (
            <Button size="sm" variant="ghost" onClick={reset}>
              Reset
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Guild icon ────────────────────────────────────────────────────────────────

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

// ── Layout ────────────────────────────────────────────────────────────────────

export function DashboardLayout() {
  const { user, guilds, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const serverMatch = useMatch({ path: '/dashboard/servers/:guildId', end: false });
  const activeGuildId = serverMatch?.params.guildId;
  const activeGuild = guilds.find((g) => g.id === activeGuildId);
  const showAdminNav = !!activeGuild && canManageGuild(activeGuild);
  const dkpLabel = useDkpLabel(activeGuildId);

  const onModuleRoute = location.pathname.includes('/settings/modules');
  const [modulesOpen, setModulesOpen] = useState(onModuleRoute);

  const [profileOpen, setProfileOpen] = useState(false);
  const [localDisplayName, setLocalDisplayName] = useState('');
  const profileRef = useRef<HTMLDivElement>(null);

  // Load shade + display name once auth resolves
  useEffect(() => {
    if (!user?.id) return;
    applyShade(loadShade(user.id));
    setLocalDisplayName(loadDisplayName(user.id));
  }, [user?.id]);

  // Click-outside to close profile dropdown
  useEffect(() => {
    if (!profileOpen) return;
    function handler(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [profileOpen]);

  function handleSaveDisplayName(name: string) {
    if (!user?.id) return;
    saveDisplayName(user.id, name);
    setLocalDisplayName(name);
  }

  const discordName = user?.globalName ?? user?.username ?? '…';
  const displayName = localDisplayName || discordName;
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
        <div className="flex items-center gap-2">
          {user ? (
            <div className="relative" ref={profileRef}>
              <button
                onClick={() => setProfileOpen((o) => !o)}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-accent',
                  profileOpen && 'bg-accent',
                )}
                aria-haspopup="true"
                aria-expanded={profileOpen}
              >
                <span className="hidden text-sm text-muted-foreground sm:block">{displayName}</span>
                <Avatar className="h-8 w-8">
                  <AvatarImage src={user.avatarUrl} alt={displayName} />
                  <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                </Avatar>
                <ChevronDown
                  className={cn(
                    'hidden h-3 w-3 shrink-0 text-muted-foreground transition-transform sm:block',
                    profileOpen && 'rotate-180',
                  )}
                />
              </button>

              {profileOpen && (
                <ProfileDropdown
                  user={user}
                  onSave={handleSaveDisplayName}
                  onClose={() => setProfileOpen(false)}
                />
              )}
            </div>
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

              <NavLink
                to={`/dashboard/servers/${activeGuild.id}/auctions`}
                className="flex items-center gap-3 rounded-md py-2 pl-9 pr-3 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                <Gavel className="h-4 w-4 shrink-0" />
                Auctions
              </NavLink>

              <NavLink
                to={`/dashboard/servers/${activeGuild.id}/dkp`}
                className="flex items-center gap-3 rounded-md py-2 pl-9 pr-3 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                <Coins className="h-4 w-4 shrink-0" />
                {dkpLabel}
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
                <>
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
                  <NavLink
                    to={`/dashboard/servers/${activeGuild.id}/settings/modules/dkp`}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 rounded-md py-2 pl-9 pr-3 text-sm transition-colors',
                        isActive
                          ? 'bg-primary text-primary-foreground font-medium'
                          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                      )
                    }
                  >
                    <Coins className="h-4 w-4 shrink-0" />
                    DKP
                  </NavLink>
                </>
              )}

              {/* Game Data */}
              <NavLink
                to={`/dashboard/servers/${activeGuild.id}/settings/game-data`}
                className={navCls}
              >
                <Database className="h-4 w-4 shrink-0" />
                Game Data
              </NavLink>

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

        {/* Sidebar footer – help + dashboard link */}
        <div className="border-t border-border p-2 space-y-0.5">
          <HelpPanel isManager={showAdminNav} dkpLabel={dkpLabel} />
          <NavLink
            to="/dashboard"
            end
            className={navCls}
          >
            <List className="h-4 w-4 shrink-0" />
            Server List
          </NavLink>
        </div>

        {/* Sidebar footer – branding */}
        <div className="border-t border-border px-3 py-4 space-y-2 opacity-50">
          <a href="https://uexcorp.space/" target="_blank" rel="noreferrer" className="block w-1/2 mx-auto">
            <img
              src="/uex-api-badge-powered.png"
              alt="Powered by UEX Corp API"
              className="w-full object-contain opacity-50 hover:opacity-80 transition-opacity"
            />
          </a>
          <img
            src="/MadeByTheCommunity_White.png"
            alt="Made by the Community"
            className="w-1/2 object-contain mx-auto"
          />
          <p className="text-[15px] leading-tight text-muted-foreground">
            Star Citizen®, Roberts Space Industries® and Cloud Imperium ® are registered trademarks of Cloud Imperium Rights LLC
          </p>
        </div>
      </aside>

        {/* ── Main area ── */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet context={{ displayName } satisfies DashboardOutletContext} />
        </main>
      </div>
    </div>
  );
}
