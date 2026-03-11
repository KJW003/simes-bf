import React, { useState, useCallback, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useAppContext } from '@/contexts/AppContext';
import { useApiHealth } from '@/hooks/useApiHealth';
import { TopBar } from './TopBar';
import { OrgSidebar } from './OrgSidebar';
import { PlatformSidebar } from './PlatformSidebar';
import { cn } from '@/lib/utils';

export function MainLayout() {
  const { mode, selectedTerrain } = useAppContext();
  const { isOnline, latencyMs } = useApiHealth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const toggleSidebar = useCallback(() => setSidebarOpen(v => !v), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const location = useLocation();

  // Close mobile sidebar on navigation
  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

  const Sidebar = mode === 'org' ? OrgSidebar : PlatformSidebar;
  
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top Bar */}
      <TopBar onToggleSidebar={toggleSidebar} />
      
      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Desktop sidebar — always visible on md+ */}
        <div className="hidden md:flex">
          <Sidebar />
        </div>

        {/* Mobile sidebar — overlay drawer */}
        {sidebarOpen && (
          <div className="fixed inset-0 z-40 md:hidden flex">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/50" onClick={closeSidebar} />
            {/* Drawer */}
            <div className="relative z-50 animate-slide-in-left">
              <Sidebar onClose={closeSidebar} />
            </div>
          </div>
        )}
        
        {/* Page Content */}
        <main className="flex-1 overflow-auto">
          <div className="p-3 md:p-6 animate-fade-in">
            {mode === 'platform' && (
              <div className="mb-4 rounded-lg border border-severity-critical/20 bg-severity-critical-bg/40 px-4 py-2.5 text-sm text-severity-critical-foreground flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-severity-critical animate-pulse" />
                Mode plateforme actif - supervision multi-organisations.
              </div>
            )}
            <Outlet />
          </div>
        </main>
      </div>

      {/* System Status Footer Bar */}
      <footer className="h-7 border-t border-border/60 bg-card/60 backdrop-blur-sm flex items-center px-4 gap-4 text-[10px] text-muted-foreground select-none overflow-hidden">
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={cn(
            'w-1.5 h-1.5 rounded-full',
            isOnline ? 'bg-green-500' : 'bg-red-500 animate-pulse'
          )} />
          <span>{isOnline ? 'API connectée' : 'API hors ligne'}</span>
          {latencyMs != null && <span className="text-muted-foreground/60">({latencyMs} ms)</span>}
        </div>

        <span className="text-border hidden sm:inline">|</span>

        {selectedTerrain && (
          <>
            <div className="hidden sm:flex items-center gap-1.5">
              <span className={cn(
                'w-1.5 h-1.5 rounded-full',
                selectedTerrain.status === 'online' ? 'bg-green-500' :
                selectedTerrain.status === 'degraded' ? 'bg-amber-400 animate-pulse' : 'bg-gray-400'
              )} />
              <span>Concentrateur: {selectedTerrain.name}</span>
              <span className="text-muted-foreground/60">
                ({selectedTerrain.dataCompleteness24h.toFixed(0)}% disponibilité)
              </span>
            </div>
            <span className="text-border hidden sm:inline">|</span>
            <span className="hidden sm:inline">{selectedTerrain.pointsCount} points</span>
            <span className="text-border hidden sm:inline">|</span>
          </>
        )}

        <div className="flex-1" />

        <span className="text-muted-foreground/50">SIMES-BF v1.0 — {mode === 'platform' ? 'Plateforme' : 'Organisation'}</span>
      </footer>
    </div>
  );
}
