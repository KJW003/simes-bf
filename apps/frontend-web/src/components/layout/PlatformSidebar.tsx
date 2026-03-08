import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAppContext } from '@/contexts/AppContext';
import {
  LayoutDashboard,
  AlertOctagon,
  Building2,
  MapPin,
  Radio,
  Cpu,
  Activity,
  FileSearch,
  Settings,
  Trash2,
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

export function PlatformSidebar({ onClose }: { onClose?: () => void } = {}) {
  const { currentUser } = useAppContext();
  const isSuperAdmin = currentUser.role === 'platform_super_admin';

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
          <NavSection title="Vue d'ensemble">
            <NavItem to="/platform" icon={LayoutDashboard} label="Vue NOC" />
            <NavItem
              to="/platform/incidents"
              icon={AlertOctagon}
              label="Incidents"
            />
          </NavSection>

          <NavSection title="Ressources">
            <NavItem to="/platform/tenants" icon={Building2} label="Organisations" />
            <NavItem to="/platform/sites" icon={MapPin} label="Sites & Terrains" />
            <NavItem to="/platform/gateways" icon={Radio} label="Concentrateurs" />
            <NavItem to="/platform/devices" icon={Cpu} label="Appareils" />
          </NavSection>

          <NavSection title="Infrastructure">
            <NavItem
              to="/platform/pipeline"
              icon={Activity}
              label="Pipeline"
            />
            <NavItem to="/platform/logs" icon={FileSearch} label="Logs" />
          </NavSection>

          {isSuperAdmin && (
            <NavSection title="Administration">
              <NavItem to="/platform/purge" icon={Trash2} label="Purge en masse" />
              <NavItem to="/platform/admin" icon={Settings} label="Configuration" />
            </NavSection>
          )}
        </nav>
      </ScrollArea>
    </aside>
  );
}
