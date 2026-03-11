import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAppContext } from '@/contexts/AppContext';
import { canAccessOrgRoute } from '@/lib/access-control';
import {
  Home,
  Activity,
  Gauge,
  Database,
  TrendingUp,
  Receipt,
  Sun,
  AlertTriangle,
  FileText,
  Settings,
  Calculator,
  ShieldCheck,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

interface NavItemProps {
  to: string;
  icon: React.ElementType;
  label: string;
  badge?: number;
  badgeVariant?: 'default' | 'warning' | 'critical';
}

function NavItem({ to, icon: Icon, label, badge, badgeVariant = 'default' }: NavItemProps) {
  const location = useLocation();
  const isActive = location.pathname === to || location.pathname.startsWith(to + '/');

  return (
    <NavLink
      to={to}
      className={cn(
        'group relative flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all duration-150',
        'hover:bg-sidebar-accent/80 hover:text-sidebar-accent-foreground',
        isActive
          ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
          : 'text-sidebar-foreground/60 hover:text-sidebar-foreground/90'
      )}
    >
      {/* Active indicator bar */}
      <span
        className={cn(
          'absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-full bg-sidebar-primary transition-all duration-200',
          isActive ? 'h-4 opacity-100' : 'h-0 opacity-0'
        )}
      />
      <Icon className={cn(
        "w-4 h-4 flex-shrink-0 transition-colors duration-150",
        isActive ? 'text-sidebar-primary' : 'text-sidebar-foreground/50 group-hover:text-sidebar-foreground/70'
      )} />
      <span className="flex-1 truncate">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span
          className={cn(
            'text-[10px] font-semibold px-1.5 py-0.5 rounded-full min-w-[20px] text-center',
            badgeVariant === 'critical' && 'bg-severity-critical text-white',
            badgeVariant === 'warning' && 'bg-severity-warning text-white',
            badgeVariant === 'default' && 'bg-sidebar-primary text-sidebar-primary-foreground'
          )}
        >
          {badge}
        </span>
      )}
    </NavLink>
  );
}

function NavSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <h3 className="px-3 text-[10px] font-semibold text-sidebar-foreground/40 uppercase tracking-[0.1em] mb-2">
        {title}
      </h3>
      {children}
    </div>
  );
}

export function OrgSidebar({ onClose }: { onClose?: () => void } = {}) {
  const { currentUser, selectedTerrain, hasSolar } = useAppContext();
  const role = currentUser.role;

  return (
    <aside className="w-56 bg-sidebar border-r border-sidebar-border flex flex-col">
      {onClose && (
        <div className="flex items-center justify-between px-4 pt-3 pb-1 md:hidden">
          <span className="text-sm font-semibold">Menu</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-sidebar-accent">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      <ScrollArea className="flex-1 py-4">
        <nav className="px-3 space-y-6">
          <NavSection title="Principal">
            {canAccessOrgRoute(role, 'dashboard') && (
              <NavItem to="/" icon={Home} label="Tableau de bord" />
            )}
            {canAccessOrgRoute(role, 'dataMonitor') && (
              <NavItem to="/data-monitor" icon={Activity} label="Zones & Points" />
            )}
            {canAccessOrgRoute(role, 'powerQuality') && (
              <NavItem to="/power-quality" icon={Gauge} label="Qualité réseau" />
            )}
            {canAccessOrgRoute(role, 'history') && (
              <NavItem to="/donnees" icon={Database} label="Données" />
            )}
          </NavSection>

          <NavSection title="Analyse">
            {canAccessOrgRoute(role, 'anomalies') && (
              <NavItem
                to="/anomalies"
                icon={AlertTriangle}
                label="Alertes & Anomalies"
              />
            )}
            {canAccessOrgRoute(role, 'invoice') && (
              <NavItem to="/invoice" icon={Receipt} label="Facturation" />
            )}
            {canAccessOrgRoute(role, 'energyAudit') && (
              <NavItem to="/energy-audit" icon={ShieldCheck} label="Audit énergétique" />
            )}
            {canAccessOrgRoute(role, 'exports') && (
              <NavItem to="/exports" icon={FileText} label="Exports" />
            )}
            {canAccessOrgRoute(role, 'forecasts') && (
              <NavItem to="/forecasts" icon={TrendingUp} label="Prévisions (bientôt)" />
            )}
          </NavSection>

          {hasSolar && (
            <NavSection title="Solaire">
              {canAccessOrgRoute(role, 'pvBattery') && (
                <NavItem to="/pv-battery" icon={Sun} label="Performance solaire" />
              )}
              {canAccessOrgRoute(role, 'predimensionnement') && (
                <NavItem to="/predimensionnement" icon={Calculator} label="Prédimensionnement" />
              )}
            </NavSection>
          )}

          {canAccessOrgRoute(role, 'admin') && (
            <NavSection title="Administration">
              <NavItem to="/admin" icon={Settings} label="Configuration" />
              <NavItem to="/settings" icon={Settings} label="Paramètres" />
            </NavSection>
          )}
        </nav>
      </ScrollArea>

      {selectedTerrain && (
        <div className="p-3 border-t border-sidebar-border bg-sidebar-accent/30">
          <div className="text-[10px] text-sidebar-foreground/40 uppercase tracking-wider mb-1.5">Terrain actif</div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'w-2 h-2 rounded-full flex-shrink-0',
                selectedTerrain.status === 'online' && 'bg-status-online',
                selectedTerrain.status === 'offline' && 'bg-status-offline',
                selectedTerrain.status === 'degraded' && 'bg-status-degraded animate-pulse'
              )}
            />
            <span className="text-sm text-sidebar-foreground font-medium truncate">
              {selectedTerrain.name}
            </span>
          </div>
          <div className="text-[10px] text-sidebar-foreground/50 mt-1">
            {selectedTerrain.pointsCount} points — {selectedTerrain.dataCompleteness24h.toFixed(0)}% disponibilité
          </div>
        </div>
      )}
    </aside>
  );
}
