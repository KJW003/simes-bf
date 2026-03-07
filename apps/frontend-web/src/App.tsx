import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AppProvider, useAppContext } from "@/contexts/AppContext";
import { canAccessOrgRoute } from "@/lib/access-control";
import { MainLayout } from "@/components/layout/MainLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Auth
import Login from "./pages/Login";
// Org Mode Pages
import Dashboard from "./pages/org/Dashboard";
import DataMonitor from "./pages/org/DataMonitor";
import Anomalies from "./pages/org/Anomalies";
import PowerQuality from "./pages/org/PowerQuality";
import History from "./pages/org/History";
import Forecasts from "./pages/org/Forecasts";
import Invoice from "./pages/org/Invoice";
import PvBattery from "./pages/org/SolairePerformance";
import Predimensionnement from "./pages/org/Predimensionnement";
import EnergyAudit from "./pages/org/EnergyAudit";
import Reports from "./pages/org/Reports";
import Administration from "./pages/org/Administration";
import ZonePage from "./pages/org/ZonePage";
import PointDetails from "./pages/org/PointDetails";
import Points from "./pages/org/Points";

// Platform Mode Pages
import NocOverview from "./pages/platform/NocOverview";
import Incidents from "./pages/platform/Incidents";
import Tenants from "./pages/platform/Tenants";
import Sites from "./pages/platform/Sites";
import Gateways from "./pages/platform/Gateways";
import Devices from "./pages/platform/Devices";
import PipelineHealth from "./pages/platform/PipelineHealth";
import Logs from "./pages/platform/Logs";
import PurgeReadings from "./pages/platform/PurgeReadings";

import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function AppRoutes() {
  const { mode, currentUser, hasSolar } = useAppContext();
  const role = currentUser.role;
  const isPlatformUser = role === 'platform_super_admin';
  const isPlatformMode = isPlatformUser || mode === 'platform';
  
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedLayout />}>
        {isPlatformMode ? (
          <>
            <Route path="/" element={<NocOverview />} />
            <Route path="/platform" element={<NocOverview />} />
            <Route path="/platform/incidents" element={<Incidents />} />
            <Route path="/platform/tenants" element={<Tenants />} />
            <Route path="/platform/sites" element={<Sites />} />
            <Route path="/platform/gateways" element={<Gateways />} />
            <Route path="/platform/devices" element={<Devices />} />
            <Route path="/platform/pipeline" element={<PipelineHealth />} />
            <Route path="/platform/logs" element={<Logs />} />
            <Route path="/platform/purge" element={<PurgeReadings />} />
            <Route path="/platform/admin" element={<Administration />} />
          </>
        ) : (
          <>
            {canAccessOrgRoute(role, "dashboard") && <Route path="/" element={<Dashboard />} />}
            {canAccessOrgRoute(role, "dataMonitor") && <Route path="/data-monitor" element={<DataMonitor />} />}
            {canAccessOrgRoute(role, "dataMonitor") && <Route path="/points" element={<Points />} />}
            {canAccessOrgRoute(role, "powerQuality") && <Route path="/power-quality" element={<PowerQuality />} />}
            {canAccessOrgRoute(role, "history") && <Route path="/history" element={<History />} />}
            {canAccessOrgRoute(role, "forecasts") && <Route path="/forecasts" element={<Forecasts />} />}
            {canAccessOrgRoute(role, "invoice") && <Route path="/invoice" element={<Invoice />} />}
            {hasSolar && canAccessOrgRoute(role, "pvBattery") && <Route path="/pv-battery" element={<PvBattery />} />}
            {canAccessOrgRoute(role, "predimensionnement") && <Route path="/predimensionnement" element={<Predimensionnement />} />}
            {canAccessOrgRoute(role, "energyAudit") && <Route path="/energy-audit" element={<EnergyAudit />} />}
            {canAccessOrgRoute(role, "anomalies") && <Route path="/anomalies" element={<Anomalies />} />}
            {canAccessOrgRoute(role, "reports") && <Route path="/reports" element={<Reports />} />}
            {canAccessOrgRoute(role, "admin") && <Route path="/admin" element={<Administration />} />}
            {canAccessOrgRoute(role, "dataMonitor") && <Route path="/terrain/:terrainId/zones/:zoneId" element={<ZonePage />} />}
            {canAccessOrgRoute(role, "dataMonitor") && <Route path="/points/:pointId" element={<PointDetails />} />}
          </>
        )}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

function ProtectedLayout() {
  const { isAuthenticated, sessionChecked } = useAppContext();
  const location = useLocation();

  // Wait for session restore before redirecting
  if (!sessionChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Chargement…</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <MainLayout />;
}

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter basename={import.meta.env.BASE_URL}>
            <AppRoutes />
          </BrowserRouter>
        </AppProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
