import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { ServerPage } from './pages/ServerPage';
import { EventCreatePage } from './pages/events/EventCreatePage';
import { EventAuditPage } from './pages/events/EventAuditPage';
import { LootPage } from './pages/events/LootPage';
import { LootModulePage } from './pages/LootModulePage';
import { StandaloneLootSessionPage } from './pages/StandaloneLootSessionPage';
import { ModuleEventBotPage } from './pages/settings/ModuleEventBotPage';
import { BotSettingsPage } from './pages/settings/BotSettingsPage';
import { PermissionsPage } from './pages/settings/PermissionsPage';
import { DkpSettingsPage } from './pages/settings/DkpSettingsPage';
import { GameDataPage } from './pages/settings/GameDataPage';
import { ScDataPage } from './pages/settings/ScDataPage';
import { AuctionsPage } from './pages/AuctionsPage';
import { DkpPage } from './pages/DkpPage';
import { ExchangePage } from './pages/ExchangePage';
import { ExchangeSettingsPage } from './pages/settings/ExchangeSettingsPage';
import { FleetPage } from './pages/FleetPage';
import { BlueprintsPage } from './pages/BlueprintsPage';
import { CraftingCalculatorPage } from './pages/CraftingCalculatorPage';
import { BlueprintsSettingsPage } from './pages/settings/BlueprintsSettingsPage';
import { CraftingCalculatorSettingsPage } from './pages/settings/CraftingCalculatorSettingsPage';
import { RosterPage } from './pages/RosterPage';
import { KanbanPage } from './pages/KanbanPage';
import { FleetSettingsPage } from './pages/settings/FleetSettingsPage';
import { LootSettingsPage } from './pages/settings/LootSettingsPage';
import { DashboardLayout } from './layouts/DashboardLayout';
import { ProtectedRoute } from './components/ProtectedRoute';

export default function App() {
  return (
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
          <Route path="servers/:guildId/events/new" element={<EventCreatePage />} />
          <Route path="servers/:guildId/events/:eventId/audit" element={<EventAuditPage />} />
          <Route path="servers/:guildId/events/:eventId/loot" element={<LootPage />} />
          <Route path="servers/:guildId/settings/permissions" element={<PermissionsPage />} />
          <Route path="servers/:guildId/settings/modules/event-bot" element={<ModuleEventBotPage />} />
          <Route path="servers/:guildId/settings/modules/dkp" element={<DkpSettingsPage />} />
          <Route path="servers/:guildId/settings/bot" element={<BotSettingsPage />} />
          <Route path="servers/:guildId/settings/game-data" element={<GameDataPage />} />
          <Route path="servers/:guildId/settings/sc-data" element={<ScDataPage />} />
          <Route path="servers/:guildId/auctions" element={<AuctionsPage />} />
          <Route path="servers/:guildId/dkp" element={<DkpPage />} />
          <Route path="servers/:guildId/exchange" element={<ExchangePage />} />
          <Route path="servers/:guildId/settings/modules/exchange" element={<ExchangeSettingsPage />} />
          <Route path="servers/:guildId/fleet" element={<FleetPage />} />
          <Route path="servers/:guildId/roster" element={<RosterPage />} />
          <Route path="servers/:guildId/settings/modules/fleet" element={<FleetSettingsPage />} />
          <Route path="servers/:guildId/settings/modules/loot" element={<LootSettingsPage />} />
          <Route path="servers/:guildId/loot" element={<LootModulePage />} />
          <Route path="servers/:guildId/loot/sessions/:sessionId" element={<StandaloneLootSessionPage />} />
          <Route path="servers/:guildId/blueprints" element={<BlueprintsPage />} />
          <Route path="servers/:guildId/crafting-calculator" element={<CraftingCalculatorPage />} />
          <Route path="servers/:guildId/settings/modules/blueprints" element={<BlueprintsSettingsPage />} />
          <Route path="servers/:guildId/settings/modules/crafting-calculator" element={<CraftingCalculatorSettingsPage />} />
          <Route path="kanban" element={<KanbanPage />} />
        </Route>

        {/* Catch-all → dashboard (ProtectedRoute will redirect to /login if needed) */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
