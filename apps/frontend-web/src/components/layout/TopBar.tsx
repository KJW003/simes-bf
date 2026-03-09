import React from 'react';
import { Link } from 'react-router-dom';
import { useAppContext } from '@/contexts/AppContext';
import { useApiHealth } from '@/hooks/useApiHealth';
import { useIncidents, useIncidentStats } from '@/hooks/useApi';
import { usePreferences, savePreferences } from '@/hooks/usePreferences';
import {
  Building2,
  MapPin,
  Radio,
  Bell,
  User,
  ChevronDown,
  Settings,
  LogOut,
  HelpCircle,
  ToggleLeft,
  ToggleRight,
  Wifi,
  WifiOff,
  AlertCircle,
  Check,
  Moon,
  Sun,
  ExternalLink,
  Menu,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export function TopBar({ onToggleSidebar }: { onToggleSidebar?: () => void }) {
  const {
    mode,
    currentUser,
    selectedOrg,
    selectedSite,
    selectedTerrain,
    availableOrgs,
    availableSites,
    availableTerrains,
    selectOrg,
    selectSite,
    selectTerrain,
    aggregatedView,
    setAggregatedView,
    logout,
  } = useAppContext();

  const { isOnline, latencyMs } = useApiHealth();
  const prefs = usePreferences();
  const darkMode = prefs.theme === 'dark' || (prefs.theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const toggleDarkMode = () => {
    savePreferences({ ...prefs, theme: darkMode ? 'light' : 'dark' });
  };

  // Fetch real incidents for notification center
  const { data: incidentsData } = useIncidents({ status: 'open' });
  const { data: incidentStats } = useIncidentStats();

  const incidents = (incidentsData as any)?.incidents ?? [];
  const openCount = (incidentStats as any)?.open ?? 0;
  const criticalCount = (incidentStats as any)?.critical ?? 0;

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'online':
        return <Wifi className="w-3 h-3 text-status-online" />;
      case 'offline':
        return <WifiOff className="w-3 h-3 text-status-offline" />;
      case 'degraded':
        return <AlertCircle className="w-3 h-3 text-status-degraded" />;
      default:
        return null;
    }
  };

  const formatLastSeen = (lastSeen: string) => {
    const diff = Date.now() - new Date(lastSeen).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "? l'instant";
    if (minutes < 60) return `il y a ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `il y a ${hours} h`;
    return `il y a ${Math.floor(hours / 24)} j`;
  };

  return (
    <header className="h-14 border-b border-border/60 bg-card/80 backdrop-blur-md flex items-center px-4 gap-2 md:gap-4 sticky top-0 z-50 shadow-[0_1px_3px_-1px_rgba(0,0,0,0.06)]">
      {/* Hamburger for mobile */}
      {onToggleSidebar && (
        <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" onClick={onToggleSidebar}>
          <Menu className="w-5 h-5" />
        </Button>
      )}

      <div className="flex items-center gap-2 min-w-[140px] md:min-w-[180px]">
        <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center">
          <span className="text-white font-bold text-sm">S</span>
        </div>
        <span className="font-semibold text-lg tracking-tight">SIMES-BF</span>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
          {mode === 'org' ? 'ORG' : 'NOC'}
        </Badge>
      </div>

      {mode === 'org' && currentUser.role !== 'platform_super_admin' && (
        <div className="flex items-center gap-1 md:gap-2 overflow-x-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-2">
                <Building2 className="w-4 h-4 text-muted-foreground" />
                <span className="max-w-[60px] md:max-w-[120px] truncate">{selectedOrg?.name ?? 'Organisation'}</span>
                <ChevronDown className="w-3 h-3 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Organisations</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {availableOrgs.map(org => (
                <DropdownMenuItem
                  key={org.id}
                  onClick={() => selectOrg(org.id)}
                  className="gap-2"
                >
                  {selectedOrg?.id === org.id && <Check className="w-4 h-4" />}
                  <span className={cn(selectedOrg?.id !== org.id && 'ml-6')}>{org.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <span className="text-muted-foreground hidden sm:inline">/</span>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1 md:gap-2">
                <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="max-w-[60px] md:max-w-[140px] truncate">{selectedSite?.name ?? 'Site'}</span>
                {selectedSite && getStatusIcon(selectedSite.status)}
                <ChevronDown className="w-3 h-3 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel>Sites</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {availableSites.map(site => (
                <DropdownMenuItem
                  key={site.id}
                  onClick={() => selectSite(site.id)}
                  className="gap-2 justify-between"
                >
                  <div className="flex items-center gap-2">
                    {selectedSite?.id === site.id && <Check className="w-4 h-4" />}
                    <span className={cn(selectedSite?.id !== site.id && 'ml-6')}>{site.name}</span>
                  </div>
                  {getStatusIcon(site.status)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <span className="text-muted-foreground hidden sm:inline">/</span>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1 md:gap-2">
                <Radio className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="max-w-[60px] md:max-w-[140px] truncate">{selectedTerrain?.name ?? 'Terrain'}</span>
                {selectedTerrain && (
                  <>
                    {getStatusIcon(selectedTerrain.status)}
                    <span className="text-xs text-muted-foreground">
                      {selectedTerrain.dataCompleteness24h.toFixed(0)}%
                    </span>
                  </>
                )}
                <ChevronDown className="w-3 h-3 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-80">
              <DropdownMenuLabel>Terrains (Concentrateurs)</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {availableTerrains.map(terrain => (
                <DropdownMenuItem
                  key={terrain.id}
                  onClick={() => selectTerrain(terrain.id)}
                  className="flex-col items-start gap-1 py-2"
                >
                  <div className="flex items-center gap-2 w-full justify-between">
                    <div className="flex items-center gap-2">
                      {selectedTerrain?.id === terrain.id && <Check className="w-4 h-4" />}
                      <span className={cn('font-medium', selectedTerrain?.id !== terrain.id && 'ml-6')}>
                        {terrain.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {getStatusIcon(terrain.status)}
                      <Badge variant="secondary" className="text-[10px]">
                        {terrain.dataCompleteness24h.toFixed(0)}%
                      </Badge>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground ml-6">
                    {formatLastSeen(terrain.lastSeen)} - {terrain.pointsCount} points
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="hidden md:flex items-center gap-2 ml-2 pl-2 border-l" title="Agrège les données de tous les terrains du site sélectionné">
            <Button
              variant={aggregatedView ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8 text-xs"
              onClick={() => setAggregatedView(!aggregatedView)}
              title="Affiche les données cumulées de tous les terrains du site au lieu d'un seul terrain"
            >
              {aggregatedView ? (
                <ToggleRight className="w-4 h-4 mr-1" />
              ) : (
                <ToggleLeft className="w-4 h-4 mr-1" />
              )}
              Vue agrégée site
            </Button>
          </div>
        </div>
      )}

      {mode === 'platform' && (
        <div className="flex items-center gap-2">
          <Badge className="bg-severity-critical text-white">NOC Plateforme</Badge>
          <span className="text-sm text-muted-foreground">
            Supervision de toutes les organisations
          </span>
        </div>
      )}

      <div className="flex-1" />

      {/* API connectivity indicator */}
      <div className="flex items-center gap-1.5" title={isOnline ? `API connectée (${latencyMs ?? '—'} ms)` : 'API déconnectée'}>
        <span className={cn(
          'w-2 h-2 rounded-full',
          isOnline ? 'bg-green-500' : 'bg-red-500 animate-pulse'
        )} />
        <span className="text-[10px] text-muted-foreground hidden sm:inline">
          {isOnline ? 'API' : 'Hors ligne'}
        </span>
      </div>

      {/* Dark Mode Toggle */}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 hover:bg-accent/80"
        onClick={toggleDarkMode}
        title={darkMode ? 'Mode clair' : 'Mode sombre'}
      >
        {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 relative hover:bg-accent/80">
            <Bell className="w-4 h-4" />
            {openCount > 0 && (
              <span className={cn(
                'absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full text-[10px] font-bold flex items-center justify-center px-1',
                criticalCount > 0 ? 'bg-red-500 text-white animate-pulse' : 'bg-amber-500 text-white'
              )}>
                {openCount > 99 ? '99+' : openCount}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-96 max-h-[480px] overflow-y-auto">
          <DropdownMenuLabel className="flex items-center justify-between">
            <span>Notifications</span>
            {openCount > 0 && (
              <Badge variant="outline" className={cn('text-[10px]', criticalCount > 0 ? 'badge-critical' : 'badge-warning')}>
                {openCount} ouverte{openCount > 1 ? 's' : ''}
              </Badge>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {incidents.length === 0 ? (
            <DropdownMenuItem className="flex-col items-start gap-1 py-3">
              <span className="text-xs text-muted-foreground flex items-center gap-2">
                <Check className="w-3 h-3 text-green-500" />
                Aucune alerte ouverte. Tout fonctionne correctement.
              </span>
            </DropdownMenuItem>
          ) : (
            <>
              {incidents.slice(0, 8).map((inc: any) => (
                <DropdownMenuItem key={inc.id} className="flex-col items-start gap-1 py-2.5 cursor-pointer">
                  <div className="flex items-center gap-2 w-full">
                    <span className={cn(
                      'w-2 h-2 rounded-full flex-shrink-0',
                      inc.severity === 'critical' ? 'bg-red-500 animate-pulse' :
                      inc.severity === 'warning' ? 'bg-amber-400' : 'bg-blue-400'
                    )} />
                    <span className="text-sm font-medium truncate flex-1">{inc.title}</span>
                    <Badge variant="outline" className={cn(
                      'text-[9px] flex-shrink-0',
                      inc.severity === 'critical' ? 'badge-critical' :
                      inc.severity === 'warning' ? 'badge-warning' : 'badge-info'
                    )}>
                      {inc.severity}
                    </Badge>
                  </div>
                  {inc.description && (
                    <span className="text-[11px] text-muted-foreground line-clamp-1 pl-4">{inc.description}</span>
                  )}
                  <span className="text-[10px] text-muted-foreground pl-4">
                    {new Date(inc.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </DropdownMenuItem>
              ))}
              {incidents.length > 8 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="justify-center py-2">
                    <Link to="/anomalies" className="text-xs text-primary flex items-center gap-1">
                      Voir toutes les alertes ({incidents.length})
                      <ExternalLink className="w-3 h-3" />
                    </Link>
                  </DropdownMenuItem>
                </>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 gap-2 hover:bg-accent/80">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center ring-1 ring-primary/10">
              <User className="w-3.5 h-3.5 text-primary" />
            </div>
            <span className="text-sm max-w-[100px] truncate">{currentUser.name}</span>
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <div className="flex flex-col">
              <span>{currentUser.name}</span>
              <span className="text-xs font-normal text-muted-foreground">{currentUser.email}</span>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="gap-2" asChild>
            <Link to="/settings">
              <User className="w-4 h-4" />
              Profil
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2" asChild>
            <Link to="/settings">
              <Settings className="w-4 h-4" />
              Paramètres
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2">
            <HelpCircle className="w-4 h-4" />
            Aide
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="gap-2 text-destructive" onClick={logout}>
            <LogOut className="w-4 h-4" />
            Déconnexion
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
