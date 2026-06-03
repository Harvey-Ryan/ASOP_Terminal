import { useState, useEffect, useRef } from 'react';
import { NavLink, Link, Outlet, useNavigate, useMatch, useLocation } from 'react-router-dom';
import { LogOut, List, LayoutDashboard, ExternalLink, ChevronDown, Settings, Puzzle, CalendarDays, Gavel, Coins, Database, ArrowLeftRight, ShoppingCart, Rocket, Package, Gift, Ship, KanbanSquare, Menu, Users, BookOpen, Calculator } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
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
import { RsiVerifyGate } from '@/components/RsiVerifyGate';
import { settingsApi } from '@/api/settings';
import { allianceApi } from '@/api/alliance';
import { marketplaceApi } from '@/api/marketplace';
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

      <div className="mt-3 pt-3 border-t border-border">
        <Link
          to="/dashboard/settings/notifications"
          onClick={onClose}
          className="block text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Notification Settings
        </Link>
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

  const { data: myPerms } = useQuery({
    queryKey: ['my-permissions', activeGuildId],
    queryFn: () => settingsApi.getMyPermissions(activeGuildId!),
    enabled: !!activeGuildId,
    staleTime: 5 * 60_000,
  });
  const { data: pendingInvitations = [] } = useQuery({
    queryKey: ['alliance-invitations', activeGuildId],
    queryFn: () => allianceApi.getInvitations(activeGuild!.id),
    enabled: !!activeGuild,
    staleTime: 30_000,
  });

  const eventBotEnabled = myPerms?.eventBotEnabled  ?? true;
  const dkpEnabled      = myPerms?.dkpEnabled      ?? true;
  const exchangeEnabled = myPerms?.exchangeEnabled  ?? true;

  const { data: pendingTradeCount = 0 } = useQuery({
    queryKey: ['marketplace-pending-count', activeGuildId],
    queryFn: () => marketplaceApi.getPendingCount(activeGuildId!),
    enabled: !!activeGuildId && exchangeEnabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const { data: unreadMessageCount = 0 } = useQuery({
    queryKey: ['marketplace-unread-count', activeGuildId],
    queryFn: () => marketplaceApi.getUnreadMessageCount(activeGuildId!),
    enabled: !!activeGuildId && exchangeEnabled,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  const lootEnabled     = myPerms?.lootEnabled      ?? true;
  const fleetEnabled        = myPerms?.fleetEnabled        ?? true;
  const blueprintsEnabled   = myPerms?.blueprintsEnabled   ?? true;
  const craftingEnabled     = myPerms?.craftingEnabled     ?? true;

  const [sidebarOpen, setSidebarOpen] = useState(false);
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
        {/* Brand + hamburger */}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 lg:hidden text-muted-foreground hover:text-foreground"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div
            className="flex cursor-pointer items-center gap-3 hover:opacity-80 transition-opacity"
            onClick={() => navigate('/dashboard')}
          >
            <img src="/AsopLogo.jpg" alt="ASOP Terminal" className="h-8 w-8 shrink-0 rounded-lg object-cover" />
            <span className="font-semibold tracking-tight">ASOP Terminal</span>
          </div>
        </div>

        {/* Right side: connected server + user widget */}
        <div className="flex items-center gap-2">
          {activeGuild && (
            <div className="hidden sm:flex items-center gap-2.5 border-l border-border pl-3 mr-1">
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground leading-none">
                  Connected To
                </span>
                <div className="flex items-center gap-1.5">
                  <GuildIcon guild={activeGuild} />
                  <span className="text-sm font-medium truncate max-w-[160px]">{activeGuild.name}</span>
                  {activeGuild.hasBotInstalled && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" title="Bot installed" />
                  )}
                </div>
              </div>
            </div>
          )}
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
        {/* Mobile overlay backdrop */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/50 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* ── Sidebar ── */}
        <aside className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-card transition-transform lg:static lg:z-auto lg:translate-x-0 lg:w-60',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}>
          {/* Server list */}
          <nav className="flex-1 overflow-y-auto p-2 space-y-0.5" onClick={() => setSidebarOpen(false)}>
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
              <NavLink
                to={`/dashboard/servers/${activeGuild.id}`}
                end
                className="flex items-center gap-3 rounded-md py-2 pl-9 pr-3 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                <LayoutDashboard className="h-4 w-4 shrink-0" />
                Dashboard
              </NavLink>

              {dkpEnabled && (
                <NavLink
                  to={`/dashboard/servers/${activeGuild.id}/auctions`}
                  className="flex items-center gap-3 rounded-md py-2 pl-9 pr-3 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  <Gavel className="h-4 w-4 shrink-0" />
                  Auctions
                </NavLink>
              )}

              {dkpEnabled && (
                <NavLink
                  to={`/dashboard/servers/${activeGuild.id}/dkp`}
                  className="flex items-center gap-3 rounded-md py-2 pl-9 pr-3 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  <Coins className="h-4 w-4 shrink-0" />
                  {dkpLabel}
                </NavLink>
              )}

              {exchangeEnabled && (
                <NavLink
                  to={`/dashboard/servers/${activeGuild.id}/marketplace`}
                  className="flex items-center gap-3 rounded-md py-2 pl-9 pr-3 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  <ArrowLeftRight className="h-4 w-4 shrink-0" />
                  Marketplace
                  {(pendingTradeCount > 0 || unreadMessageCount > 0) && (
                    <span className="ml-auto flex items-center gap-1 shrink-0">
                      {pendingTradeCount > 0 && (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-yellow-400 px-1 text-[10px] font-bold text-black">
                          {pendingTradeCount}
                        </span>
                      )}
                      {unreadMessageCount > 0 && (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                          {unreadMessageCount > 99 ? '99+' : unreadMessageCount}
                        </span>
                      )}
                    </span>
                  )}
                </NavLink>
              )}

              {fleetEnabled && (
                <NavLink
                  to={`/dashboard/servers/${activeGuild.id}/fleet`}
                  className="flex items-center gap-3 rounded-md py-2 pl-9 pr-3 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  <Ship className="h-4 w-4 shrink-0" />
                  Fleet
                </NavLink>
              )}

              {showAdminNav && (
                <NavLink
                  to={`/dashboard/servers/${activeGuild.id}/roster`}
                  className="flex items-center gap-3 rounded-md py-2 pl-9 pr-3 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  <Users className="h-4 w-4 shrink-0" />
                  RSI Roster
                </NavLink>
              )}

              {lootEnabled && (
                <NavLink
                  to={`/dashboard/servers/${activeGuild.id}/loot`}
                  className="flex items-center gap-3 rounded-md py-2 pl-9 pr-3 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  <Package className="h-4 w-4 shrink-0" />
                  Loot
                </NavLink>
              )}

              {(blueprintsEnabled || craftingEnabled) && (
                <>
                  <p className="px-3 pb-1 pt-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    In Development
                  </p>
                  {blueprintsEnabled && (
                    <NavLink
                      to={`/dashboard/servers/${activeGuild.id}/blueprints`}
                      className="flex items-center gap-3 rounded-md py-2 pl-9 pr-3 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                    >
                      <BookOpen className="h-4 w-4 shrink-0" />
                      Blueprints
                    </NavLink>
                  )}
                  {craftingEnabled && (
                    <NavLink
                      to={`/dashboard/servers/${activeGuild.id}/crafting-calculator`}
                      className="flex items-center gap-3 rounded-md py-2 pl-9 pr-3 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                    >
                      <Calculator className="h-4 w-4 shrink-0" />
                      Crafting Calculator
                    </NavLink>
                  )}
                </>
              )}

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

          {/* ── Org Settings section ── */}
          {showAdminNav && (
            <>
              <p className="px-3 pb-1 pt-5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Org Settings
              </p>

              {/* Module Settings */}
              <NavLink
                to={`/dashboard/servers/${activeGuild.id}/settings/modules`}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground font-medium'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )
                }
              >
                <Puzzle className="h-4 w-4 shrink-0" />
                Module Settings
              </NavLink>

              {/* Game Data */}
              <NavLink
                to={`/dashboard/servers/${activeGuild.id}/settings/game-data`}
                className={navCls}
              >
                <Database className="h-4 w-4 shrink-0" />
                Game Data
              </NavLink>

              {/* SC Database */}
              <NavLink
                to={`/dashboard/servers/${activeGuild.id}/settings/sc-data`}
                className={navCls}
              >
                <Rocket className="h-4 w-4 shrink-0" />
                SC Database
              </NavLink>

              {/* Org Settings */}
              <NavLink
                to={`/dashboard/servers/${activeGuild.id}/settings/bot`}
                className={navCls}
              >
                <Settings className="h-4 w-4 shrink-0" />
                Org Settings
              </NavLink>
            </>
          )}
        </nav>

        {/* Sidebar footer – help + dashboard link */}
        <div className="border-t border-border p-2 space-y-0.5">
          <HelpPanel
            isManager={showAdminNav}
            dkpLabel={dkpLabel}
            eventBotEnabled={eventBotEnabled}
            dkpEnabled={dkpEnabled}
            lootEnabled={lootEnabled}
            exchangeEnabled={exchangeEnabled}
            fleetEnabled={fleetEnabled}
            rsiOrgRequired={myPerms?.rsiOrgRequired ?? false}
          />
          <NavLink
            to="/dashboard"
            end
            className={navCls}
          >
            <List className="h-4 w-4 shrink-0" />
            Server List
          </NavLink>
          <NavLink
            to="/dashboard/kanban"
            className={navCls}
          >
            <KanbanSquare className="h-4 w-4 shrink-0" />
            Development Milestones
          </NavLink>
          <a
            href={INVITE_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <ExternalLink className="h-4 w-4 shrink-0" />
            Add Bot to Server
          </a>
        </div>

      </aside>

        {/* ── Main area ── */}
        <main className="flex-1 overflow-y-auto p-6">
          {activeGuildId ? (
            <RsiVerifyGate guildId={activeGuildId}>
              <Outlet context={{ displayName } satisfies DashboardOutletContext} />
            </RsiVerifyGate>
          ) : (
            <Outlet context={{ displayName } satisfies DashboardOutletContext} />
          )}
        </main>
      </div>

      {/* ── Bottom branding bar ── */}
      <footer className="shrink-0 border-t border-border bg-card px-4 py-3 flex items-center justify-between gap-6">
        <a href="https://buymeacoffee.com/asopterminal" target="_blank" rel="noreferrer" className="shrink-0 opacity-60 hover:opacity-100 transition-opacity whitespace-nowrap text-sm font-medium text-muted-foreground hover:text-foreground">
          🍺 Buy Me a Beer
        </a>
        <p className="text-[18px] leading-tight text-muted-foreground text-center opacity-40">
          Star Citizen®, Roberts Space Industries® and Cloud Imperium® are registered trademarks of Cloud Imperium Rights LLC
        </p>
        <img
          src="/MadeByTheCommunity_White.png"
          alt="Made by the Community"
          className="h-10 object-contain shrink-0 opacity-40 hover:opacity-100 hover:scale-[3] origin-bottom-right transition-all duration-200 cursor-pointer z-50"
        />
      </footer>
    </div>
  );
}
