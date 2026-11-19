import { Suspense, type ComponentType, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { ServerPage } from './pages/ServerPage';
import { CraftingDataGate } from './components/CraftingDataGate';
import { ModuleGate } from './components/ModuleGate';
import { DashboardLayout } from './layouts/DashboardLayout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { TooltipProvider } from '@/components/ui/tooltip';
import { lazyPage } from './lib/lazyPage';

// Every page except the common landing pages loads when first opened (v1.12.0);
// DashboardLayout shows a spinner meanwhile. The map page also pulls in
// Three.js (~1 MB) only when visited.
const EventCreatePage = lazyPage(() => import('./pages/events/EventCreatePage'), 'EventCreatePage');
const EventAuditPage = lazyPage(() => import('./pages/events/EventAuditPage'), 'EventAuditPage');
const LootPage = lazyPage(() => import('./pages/events/LootPage'), 'LootPage');
const BriefingPage = lazyPage(() => import('./pages/events/BriefingPage'), 'BriefingPage');
const EventTemplatesPage = lazyPage(() => import('./pages/events/EventTemplatesPage'), 'EventTemplatesPage');
const TemplateBriefingPage = lazyPage(() => import('./pages/events/EventTemplatesPage'), 'TemplateBriefingPage');
const MembersPage = lazyPage(() => import('./pages/MembersPage'), 'MembersPage');
const JobsPage = lazyPage(() => import('./pages/JobsPage'), 'JobsPage');
const JobsSettingsPage = lazyPage(() => import('./pages/settings/JobsSettingsPage'), 'JobsSettingsPage');
const MemberHistoryPage = lazyPage(() => import('./pages/MembersPage'), 'MemberHistoryPage');
const LootModulePage = lazyPage(() => import('./pages/LootModulePage'), 'LootModulePage');
const StandaloneLootSessionPage = lazyPage(() => import('./pages/StandaloneLootSessionPage'), 'StandaloneLootSessionPage');
const ModuleEventBotPage = lazyPage(() => import('./pages/settings/ModuleEventBotPage'), 'ModuleEventBotPage');
const BotSettingsPage = lazyPage(() => import('./pages/settings/BotSettingsPage'), 'BotSettingsPage');
const PermissionsPage = lazyPage(() => import('./pages/settings/PermissionsPage'), 'PermissionsPage');
const DkpSettingsPage = lazyPage(() => import('./pages/settings/DkpSettingsPage'), 'DkpSettingsPage');
const GameDataPage = lazyPage(() => import('./pages/settings/GameDataPage'), 'GameDataPage');
const ScDataPage = lazyPage(() => import('./pages/settings/ScDataPage'), 'ScDataPage');
const AuctionsPage = lazyPage(() => import('./pages/AuctionsPage'), 'AuctionsPage');
const DkpPage = lazyPage(() => import('./pages/DkpPage'), 'DkpPage');
const MarketplacePage = lazyPage(() => import('./pages/MarketplacePage'), 'MarketplacePage');
const ExchangeSettingsPage = lazyPage(() => import('./pages/settings/ExchangeSettingsPage'), 'ExchangeSettingsPage');
const FleetPage = lazyPage(() => import('./pages/FleetPage'), 'FleetPage');
const BlueprintsPage = lazyPage(() => import('./pages/BlueprintsPage'), 'BlueprintsPage');
const CraftingCalculatorPage = lazyPage(() => import('./pages/CraftingCalculatorPage'), 'CraftingCalculatorPage');
const CraftingCalculatorDetailPage = lazyPage(() => import('./pages/CraftingCalculatorPage'), 'CraftingCalculatorDetailPage');
const BlueprintsSettingsPage = lazyPage(() => import('./pages/settings/BlueprintsSettingsPage'), 'BlueprintsSettingsPage');
const WikeloPage = lazyPage(() => import('./pages/WikeloPage'), 'WikeloPage');
const WikeloSettingsPage = lazyPage(() => import('./pages/settings/WikeloSettingsPage'), 'WikeloSettingsPage');
const CraftingCalculatorSettingsPage = lazyPage(() => import('./pages/settings/CraftingCalculatorSettingsPage'), 'CraftingCalculatorSettingsPage');
const RosterPage = lazyPage(() => import('./pages/RosterPage'), 'RosterPage');
const RoleCallPage = lazyPage(() => import('./pages/RoleCallPage'), 'RoleCallPage');
const ActivitySettingsPage = lazyPage(() => import('./pages/settings/ActivitySettingsPage'), 'ActivitySettingsPage');
const TournamentSettingsPage = lazyPage(() => import('./pages/settings/TournamentSettingsPage'), 'TournamentSettingsPage');
const KanbanPage = lazyPage(() => import('./pages/KanbanPage'), 'KanbanPage');
const NotificationSettingsPage = lazyPage(() => import('./pages/NotificationSettingsPage'), 'NotificationSettingsPage');
// TrafficPage (pages/TrafficPage.tsx) is unrouted while request logging is off (v1.21.1).
const TournamentPage = lazyPage(() => import('./pages/TournamentPage'), 'TournamentPage');
const FleetSettingsPage = lazyPage(() => import('./pages/settings/FleetSettingsPage'), 'FleetSettingsPage');
const LootSettingsPage = lazyPage(() => import('./pages/settings/LootSettingsPage'), 'LootSettingsPage');
const ModuleSettingsHubPage = lazyPage(() => import('./pages/settings/ModuleSettingsHubPage'), 'ModuleSettingsHubPage');
const AlliesPage = lazyPage(() => import('./pages/settings/AlliesPage'), 'AlliesPage');
const AdminLayout = lazyPage(() => import('./pages/admin/AdminLayout'), 'AdminLayout');
const AdminOverviewPage = lazyPage(() => import('./pages/admin/AdminOverviewPage'), 'AdminOverviewPage');
const AdminErrorsPage = lazyPage(() => import('./pages/admin/AdminErrorsPage'), 'AdminErrorsPage');
const AdminErrorDetailPage = lazyPage(() => import('./pages/admin/AdminErrorDetailPage'), 'AdminErrorDetailPage');
const AdminServersPage = lazyPage(() => import('./pages/admin/AdminServersPage'), 'AdminServersPage');
const AdminServerPage = lazyPage(() => import('./pages/admin/AdminServerPage'), 'AdminServerPage');
const AdminActivityPage = lazyPage(() => import('./pages/admin/AdminActivityPage'), 'AdminActivityPage');
const AdminFeedPage = lazyPage(() => import('./pages/admin/AdminFeedPage'), 'AdminFeedPage');
const AdminModulesPage = lazyPage(() => import('./pages/admin/AdminModulesPage'), 'AdminModulesPage');
// Game Tools (v1.44.0): public, outside the dashboard.
const ToolsLayout = lazyPage(() => import('./pages/tools/ToolsLayout'), 'ToolsLayout');
const ToolsShipsHomePage = lazyPage(() => import('./pages/tools/ShipsPage'), 'ShipsHomePage');
const ToolsShipPage = lazyPage(() => import('./pages/tools/ShipsPage'), 'ShipPage');
// v1.46.0: Ships inside each server's dashboard, and the other tools on the public site.
const MiningPage = lazyPage(() => import('./pages/tools/MiningPage'), 'MiningPage');
// v1.53.0: community corrections queue.
const CorrectionsPage = lazyPage(() => import('./pages/tools/CorrectionsPage'), 'CorrectionsPage');
const DashboardToolsFrame = lazyPage(() => import('./pages/tools/ToolsLayout'), 'DashboardToolsFrame');
// lazyPage drops props, so this one says what it takes.
const SignInForTool = lazyPage(() => import('./pages/tools/ToolsLayout'), 'SignInForTool') as unknown as ComponentType<{ name: string; children: ReactNode }>;
const MemberMapPage = lazyPage(() => import('./pages/MemberMapPage'), 'MemberMapPage');

export default function App() {
  return (
    <TooltipProvider>
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/tools" element={<Suspense fallback={null}><ToolsLayout /></Suspense>}>
          <Route index element={<ToolsShipsHomePage />} />
          <Route path="ships" element={<Navigate to="/tools" replace />} />
          <Route path="ships/:className" element={<ToolsShipPage />} />
          <Route path="mining" element={<MiningPage />} />
          <Route path="corrections" element={<CorrectionsPage />} />
          {/* v1.45.0: Loadout lives on the ship page; the Optimizer is hidden for now. */}
          <Route path="loadout/:className" element={<ToolsLegacyRedirect />} />
          <Route path="optimizer/:className" element={<ToolsLegacyRedirect />} />
          <Route path="crafting" element={<SignInForTool name="Crafting"><CraftingDataGate><CraftingCalculatorPage /></CraftingDataGate></SignInForTool>} />
          <Route path="crafting/:blueprintUuid" element={<SignInForTool name="Crafting"><CraftingDataGate><CraftingCalculatorDetailPage /></CraftingDataGate></SignInForTool>} />
          <Route path="blueprints" element={<SignInForTool name="Blueprints"><CraftingDataGate><BlueprintsPage /></CraftingDataGate></SignInForTool>} />
          <Route path="blueprints/:blueprintUuid" element={<SignInForTool name="Blueprints"><CraftingDataGate><BlueprintsPage /></CraftingDataGate></SignInForTool>} />
          <Route path="wikelo" element={<SignInForTool name="Wikelo"><WikeloPage /></SignInForTool>} />
          <Route path="wikelo/:missionId" element={<SignInForTool name="Wikelo"><WikeloPage /></SignInForTool>} />
          <Route path="*" element={<Navigate to="/tools" replace />} />
        </Route>

        {/* Protected – all dashboard routes share the sidebar layout */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="servers/:guildId" element={<ServerPage />} />
          <Route path="servers/:guildId/events/new" element={<ModuleGate setting="eventBotEnabled"><EventCreatePage /></ModuleGate>} />
          <Route path="servers/:guildId/events/:eventId/audit" element={<ModuleGate setting="eventBotEnabled"><EventAuditPage /></ModuleGate>} />
          <Route path="servers/:guildId/events/:eventId/loot" element={<ModuleGate setting="lootEnabled"><LootPage /></ModuleGate>} />
          <Route path="servers/:guildId/events/:eventId/briefing" element={<ModuleGate setting="eventBotEnabled"><BriefingPage /></ModuleGate>} />
          <Route path="servers/:guildId/templates" element={<ModuleGate setting="eventBotEnabled"><EventTemplatesPage /></ModuleGate>} />
          <Route path="servers/:guildId/templates/:templateId/briefing" element={<ModuleGate setting="eventBotEnabled"><TemplateBriefingPage /></ModuleGate>} />
          <Route path="servers/:guildId/settings/permissions" element={<PermissionsPage />} />
          <Route path="servers/:guildId/settings/modules" element={<ModuleSettingsHubPage />} />
          <Route path="servers/:guildId/settings/modules/event-bot" element={<ModuleGate setting="eventBotEnabled"><ModuleEventBotPage /></ModuleGate>} />
          <Route path="servers/:guildId/settings/modules/dkp" element={<ModuleGate setting="dkpEnabled"><DkpSettingsPage /></ModuleGate>} />
          <Route path="servers/:guildId/settings/bot" element={<BotSettingsPage />} />
          <Route path="servers/:guildId/settings/allies" element={<AlliesPage />} />
          <Route path="servers/:guildId/settings/game-data" element={<GameDataPage />} />
          <Route path="servers/:guildId/settings/sc-data" element={<ScDataPage />} />
          <Route path="servers/:guildId/auctions" element={<ModuleGate setting="dkpEnabled"><AuctionsPage /></ModuleGate>} />
          <Route path="servers/:guildId/dkp" element={<ModuleGate setting="dkpEnabled"><DkpPage /></ModuleGate>} />
          <Route path="servers/:guildId/marketplace" element={<ModuleGate setting="exchangeEnabled"><MarketplacePage /></ModuleGate>} />
          {/* Legacy redirect — keep until any bookmarks expire */}
          <Route path="servers/:guildId/exchange" element={<Navigate to="../marketplace" replace />} />
          <Route path="servers/:guildId/settings/modules/exchange" element={<ModuleGate setting="exchangeEnabled"><ExchangeSettingsPage /></ModuleGate>} />
          <Route path="servers/:guildId/fleet" element={<ModuleGate setting="fleetEnabled"><FleetPage /></ModuleGate>} />
          <Route path="fleet" element={<FleetPage />} />
          <Route path="servers/:guildId/roster" element={<RosterPage />} />
          <Route path="servers/:guildId/members" element={<MembersPage />} />
          <Route path="servers/:guildId/members/:userId" element={<MemberHistoryPage />} />
          <Route path="servers/:guildId/jobs" element={<ModuleGate setting="jobsEnabled"><JobsPage /></ModuleGate>} />
          <Route path="servers/:guildId/settings/modules/jobs" element={<ModuleGate setting="jobsEnabled"><JobsSettingsPage /></ModuleGate>} />
          <Route path="servers/:guildId/activity" element={<ModuleGate setting="activityEnabled"><RoleCallPage /></ModuleGate>} />
          <Route path="servers/:guildId/tournaments" element={<ModuleGate setting="tournamentsEnabled"><TournamentPage /></ModuleGate>} />
          <Route path="servers/:guildId/settings/modules/fleet" element={<ModuleGate setting="fleetEnabled"><FleetSettingsPage /></ModuleGate>} />
          <Route path="servers/:guildId/settings/modules/loot" element={<ModuleGate setting="lootEnabled"><LootSettingsPage /></ModuleGate>} />
          <Route path="servers/:guildId/loot" element={<ModuleGate setting="lootEnabled"><LootModulePage /></ModuleGate>} />
          <Route path="servers/:guildId/loot/sessions/:sessionId" element={<ModuleGate setting="lootEnabled"><StandaloneLootSessionPage /></ModuleGate>} />
          <Route path="servers/:guildId/ships" element={<DashboardToolsFrame />}>
            <Route index element={<ToolsShipsHomePage />} />
            <Route path=":className" element={<ToolsShipPage />} />
          </Route>
          <Route path="servers/:guildId/mining" element={<DashboardToolsFrame />}>
            <Route index element={<MiningPage />} />
          </Route>
          <Route path="servers/:guildId/blueprints" element={<ModuleGate setting="blueprintsEnabled"><CraftingDataGate><BlueprintsPage /></CraftingDataGate></ModuleGate>} />
          <Route path="servers/:guildId/blueprints/:blueprintUuid" element={<ModuleGate setting="blueprintsEnabled"><CraftingDataGate><BlueprintsPage /></CraftingDataGate></ModuleGate>} />
          <Route path="servers/:guildId/crafting-calculator" element={<ModuleGate setting="craftingEnabled"><CraftingDataGate><CraftingCalculatorPage /></CraftingDataGate></ModuleGate>} />
          <Route path="servers/:guildId/crafting-calculator/:blueprintUuid" element={<ModuleGate setting="craftingEnabled"><CraftingDataGate><CraftingCalculatorDetailPage /></CraftingDataGate></ModuleGate>} />
          <Route path="servers/:guildId/settings/modules/blueprints" element={<ModuleGate setting="blueprintsEnabled"><BlueprintsSettingsPage /></ModuleGate>} />
          <Route path="servers/:guildId/wikelo" element={<ModuleGate setting="wikeloEnabled"><WikeloPage /></ModuleGate>} />
          <Route path="servers/:guildId/wikelo/:missionId" element={<ModuleGate setting="wikeloEnabled"><WikeloPage /></ModuleGate>} />
          <Route path="servers/:guildId/settings/modules/wikelo" element={<ModuleGate setting="wikeloEnabled"><WikeloSettingsPage /></ModuleGate>} />
          <Route path="servers/:guildId/settings/modules/crafting-calculator" element={<ModuleGate setting="craftingEnabled"><CraftingCalculatorSettingsPage /></ModuleGate>} />

          <Route path="servers/:guildId/settings/modules/activity" element={<ModuleGate setting="activityEnabled"><ActivitySettingsPage /></ModuleGate>} />
          <Route path="servers/:guildId/settings/modules/tournaments" element={<ModuleGate setting="tournamentsEnabled"><TournamentSettingsPage /></ModuleGate>} />
          <Route path="servers/:guildId/map" element={<MemberMapPage />} />
          <Route path="kanban" element={<KanbanPage />} />
          {/* Admin panel (v1.13.0): platform admins only; AdminLayout shows "not found" to everyone else. */}
          <Route path="admin" element={<AdminLayout />}>
            <Route index element={<AdminOverviewPage />} />
            <Route path="errors" element={<AdminErrorsPage />} />
            <Route path="errors/:id" element={<AdminErrorDetailPage />} />
            <Route path="servers" element={<AdminServersPage />} />
            <Route path="servers/:guildId" element={<AdminServerPage />} />
            <Route path="activity" element={<AdminActivityPage />} />
            <Route path="modules" element={<AdminModulesPage />} />
            <Route path="feed" element={<AdminFeedPage />} />
          </Route>
          <Route path="settings/notifications" element={<NotificationSettingsPage />} />
        </Route>

        {/* Catch-all → dashboard (ProtectedRoute will redirect to /login if needed) */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
    </TooltipProvider>
  );
}

/** Old Loadout and Optimizer links open the ship's page (keeping a shared loadout). */
function ToolsLegacyRedirect() {
  const { className = '' } = useParams();
  const { search, pathname } = useLocation();
  const keep = pathname.startsWith('/tools/loadout') ? search : '';
  return <Navigate to={`/tools/ships/${encodeURIComponent(className)}${keep}`} replace />;
}
