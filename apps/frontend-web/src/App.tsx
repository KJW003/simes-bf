import React, { Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AppProvider, useAppContext } from "@/contexts/AppContext";
import { canAccessOrgRoute } from "@/lib/access-control";
import { MainLayout } from "@/components/layout/MainLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Loader2 } from "lucide-react";

// Auth – keep eager (first paint)
import Login from "./pages/Login";

// Lazy-loaded Org pages
const Dashboard = React.lazy(() => import("./pages/org/Dashboard"));
const Anomalies = React.lazy(() => import("./pages/org/Anomalies"));
const PowerQuality = React.lazy(() => import("./pages/org/PowerQuality"));
const History = React.lazy(() => import("./pages/org/Donnees"));
const Forecasts = React.lazy(() => import("./pages/org/Forecasts"));
const Invoice = React.lazy(() => import("./pages/org/Invoice"));
const PvBattery = React.lazy(() => import("./pages/org/SolairePerformance"));
const Predimensionnement = React.lazy(() => import("./pages/org/Predimensionnement"));
const EnergyAudit = React.lazy(() => import("./pages/org/EnergyAudit"));
const Exports = React.lazy(() => import("./pages/org/Exports"));
const Administration = React.lazy(() => import("./pages/org/Administration"));
const ZonePage = React.lazy(() => import("./pages/org/ZonePage"));
const PointDetails = React.lazy(() => import("./pages/org/PointDetails"));
const ZonesPoints = React.lazy(() => import("./pages/org/ZonesPoints"));
const SettingsPage = React.lazy(() => import("./pages/org/Settings"));

// Lazy-loaded Platform pages
const NocOverview = React.lazy(() => import("./pages/platform/NocOverview"));
const Incidents = React.lazy(() => import("./pages/platform/Incidents"));
const Tenants = React.lazy(() => import("./pages/platform/Tenants"));
const Sites = React.lazy(() => import("./pages/platform/Sites"));
const Gateways = React.lazy(() => import("./pages/platform/Gateways"));
const Devices = React.lazy(() => import("./pages/platform/Devices"));
const PipelineHealth = React.lazy(() => import("./pages/platform/PipelineHealth"));
const Logs = React.lazy(() => import("./pages/platform/Logs"));
const PurgeReadings = React.lazy(() => import("./pages/platform/PurgeReadings"));

import NotFound from "./pages/NotFound";

const LazyFallback = () => (
  <div className="flex items-center justify-center min-h-[40vh]">
    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
  </div>
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 30 * 60 * 1000,       // keep cache 30 min (survives navigation)
      staleTime: 2 * 60_000,          // consider fresh for 2 min
      refetchOnWindowFocus: false,    // don't refetch when tab refocused
      retry: 1,
    },
  },
});

function AppRoutes() {
  const { mode, currentUser, hasSolar } = useAppContext();
  const role = currentUser.role;
  const isPlatformUser = role === 'platform_super_admin';
  const isPlatformMode = isPlatformUser || mode === 'platform';
  
  return (
    <Suspense fallback={<LazyFallback />}>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedLayout />}>
        {isPlatformMode && (
          <>
            <Route path="/platform" element={<ErrorBoundary><NocOverview /></ErrorBoundary>} />
            <Route path="/platform/incidents" element={<ErrorBoundary><Incidents /></ErrorBoundary>} />
            <Route path="/platform/tenants" element={<ErrorBoundary><Tenants /></ErrorBoundary>} />
            <Route path="/platform/sites" element={<ErrorBoundary><Sites /></ErrorBoundary>} />
            <Route path="/platform/gateways" element={<ErrorBoundary><Gateways /></ErrorBoundary>} />
            <Route path="/platform/devices" element={<ErrorBoundary><Devices /></ErrorBoundary>} />
            <Route path="/platform/pipeline" element={<ErrorBoundary><PipelineHealth /></ErrorBoundary>} />
            <Route path="/platform/logs" element={<ErrorBoundary><Logs /></ErrorBoundary>} />
            {isPlatformUser && <Route path="/platform/purge" element={<ErrorBoundary><PurgeReadings /></ErrorBoundary>} />}
            <Route path="/platform/admin" element={<ErrorBoundary><Administration /></ErrorBoundary>} />
          </>
        )}
        {/* Org routes — always rendered (access-control handles permissions) */}
        {canAccessOrgRoute(role, "dashboard") && <Route path="/" element={<ErrorBoundary><Dashboard /></ErrorBoundary>} />}
        {canAccessOrgRoute(role, "dataMonitor") && <Route path="/data-monitor" element={<ErrorBoundary><ZonesPoints /></ErrorBoundary>} />}
        {canAccessOrgRoute(role, "dataMonitor") && <Route path="/points" element={<ErrorBoundary><ZonesPoints /></ErrorBoundary>} />}
        {canAccessOrgRoute(role, "powerQuality") && <Route path="/power-quality" element={<ErrorBoundary><PowerQuality /></ErrorBoundary>} />}
        {canAccessOrgRoute(role, "history") && <Route path="/donnees" element={<ErrorBoundary><History /></ErrorBoundary>} />}
        {canAccessOrgRoute(role, "history") && <Route path="/history" element={<ErrorBoundary><History /></ErrorBoundary>} />}
        {canAccessOrgRoute(role, "forecasts") && <Route path="/forecasts" element={<ErrorBoundary><Forecasts /></ErrorBoundary>} />}
        {canAccessOrgRoute(role, "invoice") && <Route path="/invoice" element={<ErrorBoundary><Invoice /></ErrorBoundary>} />}
        {hasSolar && canAccessOrgRoute(role, "pvBattery") && <Route path="/pv-battery" element={<ErrorBoundary><PvBattery /></ErrorBoundary>} />}
        {canAccessOrgRoute(role, "predimensionnement") && <Route path="/predimensionnement" element={<ErrorBoundary><Predimensionnement /></ErrorBoundary>} />}
        {canAccessOrgRoute(role, "energyAudit") && <Route path="/energy-audit" element={<ErrorBoundary><EnergyAudit /></ErrorBoundary>} />}
        {canAccessOrgRoute(role, "anomalies") && <Route path="/anomalies" element={<ErrorBoundary><Anomalies /></ErrorBoundary>} />}
        {canAccessOrgRoute(role, "exports") && <Route path="/exports" element={<ErrorBoundary><Exports /></ErrorBoundary>} />}
        {canAccessOrgRoute(role, "admin") && <Route path="/admin" element={<ErrorBoundary><Administration /></ErrorBoundary>} />}
        {canAccessOrgRoute(role, "dataMonitor") && <Route path="/terrain/:terrainId/zones/:zoneId" element={<ErrorBoundary><ZonePage /></ErrorBoundary>} />}
        {canAccessOrgRoute(role, "dataMonitor") && <Route path="/points/:pointId" element={<ErrorBoundary><PointDetails /></ErrorBoundary>} />}
        <Route path="/settings" element={<ErrorBoundary><SettingsPage /></ErrorBoundary>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
    </Suspense>
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
