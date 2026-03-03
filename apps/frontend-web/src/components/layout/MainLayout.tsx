import React from 'react';
import { Outlet } from 'react-router-dom';
import { useAppContext } from '@/contexts/AppContext';
import { TopBar } from './TopBar';
import { OrgSidebar } from './OrgSidebar';
import { PlatformSidebar } from './PlatformSidebar';

export function MainLayout() {
  const { mode } = useAppContext();
  
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top Bar */}
      <TopBar />
      
      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        {mode === 'org' ? <OrgSidebar /> : <PlatformSidebar />}
        
        {/* Page Content */}
        <main className="flex-1 overflow-auto">
          <div className="p-6 animate-fade-in">
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
    </div>
  );
}
