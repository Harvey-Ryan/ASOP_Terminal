import { useState, useEffect, useRef } from 'react';
import { NavLink, Link, Outlet, useNavigate, useMatch, useLocation } from 'react-router-dom';
import { LogOut, List, LayoutDashboard, ExternalLink, ChevronDown, Settings, Puzzle, CalendarDays, Gavel, Coins, Database, ArrowLeftRight, ShoppingCart, Rocket, Package, Gift, Ship, KanbanSquare, Menu, Users, BookOpen, Calculator, ChevronsLeft, ChevronsRight, Scale } from 'lucide-react';
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

  const [sidebarOpen,   setSidebarOpen]   = useState(false);
  const [profileOpen,   setProfileOpen]   = useState(false);
  const [navCollapsed,  setNavCollapsed]  = useState(() =>
    localStorage.getItem('nav-collapsed') === 'true',
  );

  function toggleNav() {
    setNavCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('nav-collapsed', String(next));
      return next;
    });
  }
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
      navCollapsed
        ? 'flex items-center justify-center rounded-md p-2 text-sm transition-colors'
        : 'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
      isActive
        ? 'bg-primary text-primary-foreground font-medium'
        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
    );

  const serverNavCls = cn(
    navCollapsed
      ? 'flex items-center justify-center rounded-md p-2 text-sm transition-colors'
      : 'flex items-center gap-3 rounded-md py-2 pl-3 pr-3 text-sm transition-colors',
    'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
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
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-card transition-all duration-300 lg:relative lg:z-auto lg:translate-x-0',
          navCollapsed ? 'lg:w-14' : 'lg:w-56',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}>
          {/* Collapse toggle — desktop only, sits on the right edge */}
          <button
            onClick={toggleNav}
            title={navCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="absolute -right-3 top-6 z-50 hidden lg:flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground shadow-sm transition-colors"
          >
            {navCollapsed
              ? <ChevronsRight className="h-3.5 w-3.5" />
              : <ChevronsLeft  className="h-3.5 w-3.5" />
            }
          </button>

          {/* Server list */}
          <nav className="flex-1 overflow-y-auto p-2 space-y-0.5" onClick={() => setSidebarOpen(false)}>
          {guilds.length === 0 ? (
            <div className="px-3 py-3">
              {!navCollapsed && <p className="text-xs text-muted-foreground mb-2">No servers with the bot installed.</p>}
              <a
                href={INVITE_URL}
                target="_blank"
                rel="noreferrer"
                title="Add to a server"
                className={cn(
                  navCollapsed
                    ? 'flex items-center justify-center rounded-md p-2 text-xs text-primary hover:bg-accent transition-colors'
                    : 'flex items-center gap-1.5 text-xs text-primary hover:underline',
                )}
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                {!navCollapsed && 'Add to a server'}
              </a>
            </div>
          ) : activeGuild ? (
            <>
              <NavLink
                to={`/dashboard/servers/${activeGuild.id}`}
                end
                title={navCollapsed ? 'Dashboard' : undefined}
                className={serverNavCls}
              >
                <LayoutDashboard className="h-4 w-4 shrink-0" />
                {!navCollapsed && 'Dashboard'}
              </NavLink>

              {dkpEnabled && (
                <NavLink
                  to={`/dashboard/servers/${activeGuild.id}/auctions`}
                  title={navCollapsed ? 'Auctions' : undefined}
                  className={serverNavCls}
                >
                  <Gavel className="h-4 w-4 shrink-0" />
                  {!navCollapsed && 'Auctions'}
                </NavLink>
              )}

              {dkpEnabled && (
                <NavLink
                  to={`/dashboard/servers/${activeGuild.id}/dkp`}
                  title={navCollapsed ? dkpLabel : undefined}
                  className={serverNavCls}
                >
                  <Coins className="h-4 w-4 shrink-0" />
                  {!navCollapsed && dkpLabel}
                </NavLink>
              )}

              {exchangeEnabled && (
                <NavLink
                  to={`/dashboard/servers/${activeGuild.id}/marketplace`}
                  title={navCollapsed ? 'Marketplace' : undefined}
                  className={cn(serverNavCls, 'relative')}
                >
                  <ArrowLeftRight className="h-4 w-4 shrink-0" />
                  {!navCollapsed && (
                    <>
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
                    </>
                  )}
                  {navCollapsed && (pendingTradeCount > 0 || unreadMessageCount > 0) && (
                    <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-primary" />
                  )}
                </NavLink>
              )}

              {fleetEnabled && (
                <NavLink
                  to={`/dashboard/servers/${activeGuild.id}/fleet`}
                  title={navCollapsed ? 'Fleet' : undefined}
                  className={serverNavCls}
                >
                  <Ship className="h-4 w-4 shrink-0" />
                  {!navCollapsed && 'Fleet'}
                </NavLink>
              )}

              {showAdminNav && (
                <NavLink
                  to={`/dashboard/servers/${activeGuild.id}/roster`}
                  title={navCollapsed ? 'RSI Roster' : undefined}
                  className={serverNavCls}
                >
                  <Users className="h-4 w-4 shrink-0" />
                  {!navCollapsed && 'RSI Roster'}
                </NavLink>
              )}

              {lootEnabled && (
                <NavLink
                  to={`/dashboard/servers/${activeGuild.id}/loot`}
                  title={navCollapsed ? 'Loot' : undefined}
                  className={serverNavCls}
                >
                  <Package className="h-4 w-4 shrink-0" />
                  {!navCollapsed && 'Loot'}
                </NavLink>
              )}

              {(blueprintsEnabled || craftingEnabled) && (
                <>
                  {!navCollapsed && (
                    <p className="px-3 pb-1 pt-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      In Development
                    </p>
                  )}
                  {blueprintsEnabled && (
                    <NavLink
                      to={`/dashboard/servers/${activeGuild.id}/blueprints`}
                      title={navCollapsed ? 'Blueprints' : undefined}
                      className={serverNavCls}
                    >
                      <BookOpen className="h-4 w-4 shrink-0" />
                      {!navCollapsed && 'Blueprints'}
                    </NavLink>
                  )}
                  {craftingEnabled && (
                    <NavLink
                      to={`/dashboard/servers/${activeGuild.id}/crafting-calculator`}
                      title={navCollapsed ? 'Crafting Calc' : undefined}
                      className={serverNavCls}
                    >
                      <Calculator className="h-4 w-4 shrink-0" />
                      {!navCollapsed && 'Crafting Calc'}
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
                  title={navCollapsed ? guild.name : undefined}
                  className={navCls}
                >
                  <GuildIcon guild={guild} />
                  {!navCollapsed && <span className="truncate">{guild.name}</span>}
                  {!navCollapsed && guild.hasBotInstalled && (
                    <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" title="Bot installed" />
                  )}
                </NavLink>
              ))}
            </>
          )}

          {/* ── Org Settings section ── */}
          {showAdminNav && (
            <>
              {!navCollapsed && (
                <p className="px-3 pb-1 pt-5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Org Settings
                </p>
              )}

              <NavLink
                to={`/dashboard/servers/${activeGuild!.id}/settings/modules`}
                title={navCollapsed ? 'Module Settings' : undefined}
                className={navCls}
              >
                <Puzzle className="h-4 w-4 shrink-0" />
                {!navCollapsed && 'Module Settings'}
              </NavLink>

              <NavLink
                to={`/dashboard/servers/${activeGuild!.id}/settings/game-data`}
                title={navCollapsed ? 'Game Data' : undefined}
                className={navCls}
              >
                <Database className="h-4 w-4 shrink-0" />
                {!navCollapsed && 'Game Data'}
              </NavLink>

              <NavLink
                to={`/dashboard/servers/${activeGuild!.id}/settings/sc-data`}
                title={navCollapsed ? 'SC Database' : undefined}
                className={navCls}
              >
                <Rocket className="h-4 w-4 shrink-0" />
                {!navCollapsed && 'SC Database'}
              </NavLink>

              <NavLink
                to={`/dashboard/servers/${activeGuild!.id}/settings/bot`}
                title={navCollapsed ? 'Org Settings' : undefined}
                className={navCls}
              >
                <Settings className="h-4 w-4 shrink-0" />
                {!navCollapsed && 'Org Settings'}
              </NavLink>
            </>
          )}
        </nav>

        {/* Sidebar footer – help + dashboard link */}
        <div className="border-t border-border p-2 space-y-0.5">
          {!navCollapsed && (
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
          )}
          <NavLink
            to="/dashboard"
            end
            title={navCollapsed ? 'Server List' : undefined}
            className={navCls}
          >
            <List className="h-4 w-4 shrink-0" />
            {!navCollapsed && 'Server List'}
          </NavLink>
          <NavLink
            to="/dashboard/kanban"
            title={navCollapsed ? 'Roadmap' : undefined}
            className={navCls}
          >
            <KanbanSquare className="h-4 w-4 shrink-0" />
            {!navCollapsed && 'Roadmap'}
          </NavLink>
          <a
            href="https://buymeacoffee.com/asopterminal"
            target="_blank"
            rel="noreferrer"
            className="lg:hidden flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <span className="shrink-0">🍺</span>
            Buy Me a Beer
          </a>
        </div>

      </aside>

        {/* ── Main area ── */}
        <main className="flex-1 overflow-hidden flex flex-col min-h-0">
          <div className="flex-1 min-h-0 overflow-y-auto p-6">
            <Outlet context={{ displayName } satisfies DashboardOutletContext} />
          </div>

          {/* ── Desktop footer ── */}
          <footer className="hidden lg:flex shrink-0 items-center justify-between border-t border-border px-6 h-9 gap-4">
            <div className="flex items-center gap-2 min-w-0">
              <div className="relative group">
                <Scale className="h-3.5 w-3.5 shrink-0 text-muted-foreground cursor-default" />
                <div className="pointer-events-none absolute bottom-full left-0 mb-2 w-80 rounded-lg border border-border bg-popover text-popover-foreground text-xs p-3 shadow-xl leading-relaxed opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50">
                  ASOP Terminal is an unofficial fan-made tool and is not affiliated with, endorsed by, or connected to Cloud Imperium Games or Roberts Space Industries Corp. Star Citizen® is a registered trademark of Cloud Imperium Rights LLC.
                </div>
              </div>
              <span className="text-xs text-muted-foreground truncate">
                Unofficial fan-made tool · Not affiliated with Cloud Imperium Games
              </span>
            </div>

            <a
              href="https://buymeacoffee.com/asopterminal"
              target="_blank"
              rel="noreferrer"
              className="shrink-0 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <span>🍺</span>
              Buy Me a Beer
            </a>
          </footer>
        </main>
      </div>

    </div>
  );
}
