import React, { useState } from 'react';
import { useAppContext } from '@/contexts/AppContext';
import {
  Building2,
  MapPin,
  Radio,
  Search,
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
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export function TopBar() {
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

  const [searchQuery, setSearchQuery] = useState('');

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
    <header className="h-14 border-b border-border/60 bg-card/80 backdrop-blur-md flex items-center px-4 gap-4 sticky top-0 z-50 shadow-[0_1px_3px_-1px_rgba(0,0,0,0.06)]">
      <div className="flex items-center gap-2 min-w-[180px]">
        <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center">
          <span className="text-white font-bold text-sm">S</span>
        </div>
        <span className="font-semibold text-lg tracking-tight">SIMES-BF</span>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
          {mode === 'org' ? 'ORG' : 'NOC'}
        </Badge>
      </div>

      {mode === 'org' && currentUser.role !== 'platform_super_admin' && (
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-2">
                <Building2 className="w-4 h-4 text-muted-foreground" />
                <span className="max-w-[120px] truncate">{selectedOrg?.name ?? 'Organisation'}</span>
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

          <span className="text-muted-foreground">/</span>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-2">
                <MapPin className="w-4 h-4 text-muted-foreground" />
                <span className="max-w-[140px] truncate">{selectedSite?.name ?? 'Site'}</span>
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

          <span className="text-muted-foreground">/</span>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-2">
                <Radio className="w-4 h-4 text-muted-foreground" />
                <span className="max-w-[140px] truncate">{selectedTerrain?.name ?? 'Terrain'}</span>
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

          <div className="flex items-center gap-2 ml-2 pl-2 border-l">
            <Button
              variant={aggregatedView ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8 text-xs"
              onClick={() => setAggregatedView(!aggregatedView)}
            >
              {aggregatedView ? (
                <ToggleRight className="w-4 h-4 mr-1" />
              ) : (
                <ToggleLeft className="w-4 h-4 mr-1" />
              )}
              Vue agrégée
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

      <div className="relative w-72 group">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground transition-colors group-focus-within:text-primary" />
        <Input
          placeholder={
            mode === 'platform'
              ? 'Rechercher organisations, incidents, sites...'
              : 'Rechercher zones, alertes, concentrateurs...'
          }
          className="pl-9 h-8 text-sm bg-muted/40 border-transparent hover:border-border focus:border-ring focus:bg-background transition-all"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 relative hover:bg-accent/80">
            <Bell className="w-4 h-4" />
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-severity-critical text-white text-[10px] rounded-full flex items-center justify-center animate-count-up font-medium">
              3
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          <DropdownMenuLabel>Notifications</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="flex-col items-start gap-1 py-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-severity-critical" />
              <span className="font-medium text-sm">Anomalie critique détectée</span>
            </div>
            <span className="text-xs text-muted-foreground ml-4">
              Déséquilibre de courant sur Atelier Mécanique
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem className="flex-col items-start gap-1 py-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-severity-warning" />
              <span className="font-medium text-sm">PF bas persistant</span>
            </div>
            <span className="text-xs text-muted-foreground ml-4">
              Ligne Compresseurs depuis 3 h
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-center text-sm text-primary">
            Voir toutes les notifications
          </DropdownMenuItem>
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
          <DropdownMenuItem className="gap-2">
            <User className="w-4 h-4" />
            Profil
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2">
            <Settings className="w-4 h-4" />
            Paramètres
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
