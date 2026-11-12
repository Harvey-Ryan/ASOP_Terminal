import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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
const MemberMapPage = lazyPage(() => import('./pages/MemberMapPage'), 'MemberMapPage');

export default function App() {
  return (
    <TooltipProvider>
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />

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
          <Route path="servers/:guildId/blueprints" element={<ModuleGate setting="blueprintsEnabled"><CraftingDataGate><BlueprintsPage /></CraftingDataGate></ModuleGate>} />
          <Route path="servers/:guildId/blueprints/:blueprintUuid" element={<ModuleGate setting="blueprintsEnabled"><CraftingDataGate><BlueprintsPage /></CraftingDataGate></ModuleGate>} />
          <Route path="servers/:guildId/crafting-calculator" element={<ModuleGate setting="craftingEnabled"><CraftingDataGate><CraftingCalculatorPage /></CraftingDataGate></ModuleGate>} />
          <Route path="servers/:guildId/crafting-calculator/:blueprintUuid" element={<ModuleGate setting="craftingEnabled"><CraftingDataGate><CraftingCalculatorDetailPage /></CraftingDataGate></ModuleGate>} />
          <Route path="servers/:guildId/settings/modules/blueprints" element={<ModuleGate setting="blueprintsEnabled"><BlueprintsSettingsPage /></ModuleGate>} />
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
