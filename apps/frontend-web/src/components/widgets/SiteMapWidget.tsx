import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polygon, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  MapPin, Settings2, Cloud, Thermometer, Wind, Droplets,
  Wifi, WifiOff, Clock, Radio, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTerrainOverview } from '@/hooks/useApi';

/* ─── Types ───────────────────────────────────────────── */
interface SiteMapConfig {
  lat: number;
  lng: number;
  zoom: number;
  gatewayLat: number;
  gatewayLng: number;
  zones: Array<{ name: string; color: string; coords: [number, number][] }>;
  pointLocations: Record<string, { lat: number; lng: number }>;
  /** minutes thresholds: online < staleThreshold, stale < offlineThreshold, else offline */
  staleThresholdMin: number;
  offlineThresholdMin: number;
}

interface WeatherData {
  temp: number;
  humidity: number;
  windSpeed: number;
  description: string;
  icon: string;
}

const STORAGE_KEY = 'simes-map-config';

const DEFAULT_CONFIG: SiteMapConfig = {
  lat: 12.3714,
  lng: -1.5197,
  zoom: 16,
  gatewayLat: 12.3714,
  gatewayLng: -1.5197,
  zones: [],
  pointLocations: {},
  staleThresholdMin: 15,
  offlineThresholdMin: 60,
};

function loadConfig(): SiteMapConfig {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    return s ? { ...DEFAULT_CONFIG, ...JSON.parse(s) } : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

/* ─── Custom marker icons ─────────────────────────────── */
function makeDotIcon(color: string) {
  return L.divIcon({
    className: '',
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -10],
  });
}

const ICON_ONLINE = makeDotIcon('#22c55e');
const ICON_STALE = makeDotIcon('#f59e0b');
const ICON_OFFLINE = makeDotIcon('#ef4444');

const ICON_GATEWAY = L.divIcon({
  className: '',
  html: `<div style="width:22px;height:22px;border-radius:4px;background:#3b82f6;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1"/></svg></div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  popupAnchor: [0, -14],
});

/* ─── Weather panel ───────────────────────────────────── */
function WeatherPanel({ lat, lng }: { lat: number; lng: number }) {
  const [weather, setWeather] = useState<WeatherData | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Open-Meteo free API — no key needed
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code`;
    fetch(url)
      .then(r => r.json())
      .then(d => {
        if (cancelled || !d.current) return;
        const code = d.current.weather_code;
        const desc =
          code <= 1 ? 'Ensoleillé' :
          code <= 3 ? 'Partiellement nuageux' :
          code <= 49 ? 'Nuageux / brumeux' :
          code <= 69 ? 'Pluie' :
          code <= 79 ? 'Neige' :
          code <= 82 ? 'Averses' :
          code <= 99 ? 'Orage' : 'Inconnu';
        const icon =
          code <= 1 ? '☀️' :
          code <= 3 ? '⛅' :
          code <= 49 ? '☁️' :
          code <= 69 ? '🌧️' :
          code <= 82 ? '🌦️' : '⛈️';
        setWeather({
          temp: d.current.temperature_2m,
          humidity: d.current.relative_humidity_2m,
          windSpeed: d.current.wind_speed_10m,
          description: desc,
          icon,
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [lat, lng]);

  if (!weather) return null;

  return (
    <div className="flex items-center gap-3 text-xs rounded-lg border bg-background/90 backdrop-blur px-3 py-2">
      <span className="text-lg">{weather.icon}</span>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1"><Thermometer className="w-3 h-3" />{weather.temp}°C</span>
        <span className="flex items-center gap-1"><Droplets className="w-3 h-3" />{weather.humidity}%</span>
        <span className="flex items-center gap-1"><Wind className="w-3 h-3" />{weather.windSpeed} km/h</span>
        <span className="text-muted-foreground">{weather.description}</span>
      </div>
    </div>
  );
}

/* ─── Recenter helper ─────────────────────────────────── */
function RecenterMap({ lat, lng, zoom }: { lat: number; lng: number; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], zoom);
  }, [lat, lng, zoom, map]);
  return null;
}

/* ─── Config dialog ───────────────────────────────────── */
function ConfigDialog({ open, onClose, config, onSave }: {
  open: boolean;
  onClose: () => void;
  config: SiteMapConfig;
  onSave: (c: SiteMapConfig) => void;
}) {
  const [cfg, setCfg] = useState(config);
  const [newZoneName, setNewZoneName] = useState('');

  const handleSave = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    onSave(cfg);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Settings2 className="w-5 h-5" /> Configuration de la carte</DialogTitle>
          <DialogDescription>Définissez la localisation du site, de la gateway et des zones.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Latitude du site</Label>
              <Input type="number" step="0.0001" className="h-8 text-xs" value={cfg.lat} onChange={e => setCfg(p => ({ ...p, lat: Number(e.target.value) }))} />
            </div>
            <div>
              <Label className="text-xs">Longitude du site</Label>
              <Input type="number" step="0.0001" className="h-8 text-xs" value={cfg.lng} onChange={e => setCfg(p => ({ ...p, lng: Number(e.target.value) }))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Latitude gateway</Label>
              <Input type="number" step="0.0001" className="h-8 text-xs" value={cfg.gatewayLat} onChange={e => setCfg(p => ({ ...p, gatewayLat: Number(e.target.value) }))} />
            </div>
            <div>
              <Label className="text-xs">Longitude gateway</Label>
              <Input type="number" step="0.0001" className="h-8 text-xs" value={cfg.gatewayLng} onChange={e => setCfg(p => ({ ...p, gatewayLng: Number(e.target.value) }))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Seuil Stale (min)</Label>
              <Input type="number" className="h-8 text-xs" value={cfg.staleThresholdMin} onChange={e => setCfg(p => ({ ...p, staleThresholdMin: Number(e.target.value) }))} />
            </div>
            <div>
              <Label className="text-xs">Seuil Offline (min)</Label>
              <Input type="number" className="h-8 text-xs" value={cfg.offlineThresholdMin} onChange={e => setCfg(p => ({ ...p, offlineThresholdMin: Number(e.target.value) }))} />
            </div>
          </div>

          <div>
            <Label className="text-xs font-medium mb-1 block">Zoom par défaut</Label>
            <Input type="number" min={1} max={20} className="h-8 text-xs w-24" value={cfg.zoom} onChange={e => setCfg(p => ({ ...p, zoom: Number(e.target.value) }))} />
          </div>

          {/* Zones */}
          <div>
            <Label className="text-xs font-medium mb-1 block">Zones ({cfg.zones.length})</Label>
            {cfg.zones.map((z, i) => (
              <div key={i} className="flex items-center gap-2 mb-1">
                <span className="w-3 h-3 rounded" style={{ background: z.color }} />
                <span className="text-xs flex-1">{z.name} ({z.coords.length} pts)</span>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setCfg(p => ({ ...p, zones: p.zones.filter((_, j) => j !== i) }))}>
                  <X className="w-3 h-3" />
                </Button>
              </div>
            ))}
            <div className="flex gap-2 mt-1">
              <Input placeholder="Nom de la zone" className="h-7 text-xs flex-1" value={newZoneName} onChange={e => setNewZoneName(e.target.value)} />
              <Button size="sm" className="h-7 text-xs" onClick={() => {
                if (!newZoneName.trim()) return;
                const colors = ['#3b82f680', '#10b98180', '#f59e0b80', '#ef444480', '#8b5cf680'];
                setCfg(p => ({
                  ...p,
                  zones: [...p.zones, {
                    name: newZoneName.trim(),
                    color: colors[p.zones.length % colors.length],
                    coords: [
                      [cfg.lat + 0.0005, cfg.lng - 0.0005],
                      [cfg.lat + 0.0005, cfg.lng + 0.0005],
                      [cfg.lat - 0.0005, cfg.lng + 0.0005],
                      [cfg.lat - 0.0005, cfg.lng - 0.0005],
                    ],
                  }],
                }));
                setNewZoneName('');
              }}>
                Ajouter
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Les coordonnées des zones peuvent être ajustées après.</p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
            <Button size="sm" onClick={handleSave}>Enregistrer</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Main Widget ─────────────────────────────────────── */
export function SiteMapWidget({ terrainId }: { terrainId: string }) {
  const [config, setConfig] = useState<SiteMapConfig>(loadConfig);
  const [configOpen, setConfigOpen] = useState(false);
  const { data: overviewData } = useTerrainOverview(terrainId);
  const points = (overviewData?.points ?? []) as Array<Record<string, any>>;
  const zones = (overviewData?.zones ?? []) as Array<Record<string, any>>;

  const getPointStatus = useCallback((p: Record<string, any>) => {
    const r = p.readings;
    const lastSeen = p.lastSeen as string | null;
    const minutesAgo = lastSeen ? Math.floor((Date.now() - new Date(lastSeen).getTime()) / 60000) : null;
    if (minutesAgo == null) return 'offline';
    if (minutesAgo < config.staleThresholdMin) return 'online';
    if (minutesAgo < config.offlineThresholdMin) return 'stale';
    return 'offline';
  }, [config.staleThresholdMin, config.offlineThresholdMin]);

  // Compute point positions — spread a grid around site if no custom locations
  const pointMarkers = useMemo(() => {
    return points.map((p, i) => {
      const custom = config.pointLocations[String(p.id)];
      const lat = custom?.lat ?? config.lat + (Math.floor(i / 4) - 1) * 0.0003;
      const lng = custom?.lng ?? config.lng + ((i % 4) - 1.5) * 0.0003;
      const status = getPointStatus(p);
      const r = p.readings;
      return { ...p, lat, lng, status, r };
    });
  }, [points, config, getPointStatus]);

  const onlineCount = pointMarkers.filter(p => p.status === 'online').length;
  const staleCount = pointMarkers.filter(p => p.status === 'stale').length;
  const offlineCount = pointMarkers.filter(p => p.status === 'offline').length;

  // Zone stats
  const zoneStats = useMemo(() => {
    return config.zones.map(z => {
      const inZone = points.filter(p => {
        const zone = zones.find(zn => String(zn.id) === String(p.zone_id));
        return zone && String(zone.name) === z.name;
      });
      return { name: z.name, count: inZone.length };
    });
  }, [config.zones, points, zones]);

  const fmt = (v: unknown, d = 2) => v != null && v !== '' ? Number(v).toFixed(d) : '—';

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <MapPin className="w-4 h-4 text-primary" />
            Carte du site
            <Badge variant="outline" className="text-[10px]">{points.length} points</Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-[10px]">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" />{onlineCount} on</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" />{staleCount} stale</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />{offlineCount} off</span>
            </div>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setConfigOpen(true)}>
              <Settings2 className="w-3 h-3" /> Config
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <WeatherPanel lat={config.lat} lng={config.lng} />
        <div className="rounded-lg overflow-hidden border" style={{ height: 400 }}>
          <MapContainer
            center={[config.lat, config.lng]}
            zoom={config.zoom}
            style={{ height: '100%', width: '100%' }}
            scrollWheelZoom
          >
            <RecenterMap lat={config.lat} lng={config.lng} zoom={config.zoom} />
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {/* Zone polygons */}
            {config.zones.map((z, i) => (
              <Polygon
                key={i}
                positions={z.coords}
                pathOptions={{ color: z.color.replace(/80$/, ''), fillColor: z.color, fillOpacity: 0.2, weight: 2 }}
              >
                <Popup>
                  <div className="text-sm font-medium">{z.name}</div>
                  <div className="text-xs text-gray-600">{zoneStats[i]?.count ?? 0} appareils</div>
                </Popup>
              </Polygon>
            ))}

            {/* Gateway marker */}
            <Marker position={[config.gatewayLat, config.gatewayLng]} icon={ICON_GATEWAY}>
              <Popup>
                <div className="text-sm font-medium flex items-center gap-1">
                  <span>🛜</span> Gateway
                </div>
                <div className="text-xs text-gray-600 mt-1">
                  Zones: {config.zones.length}<br />
                  Appareils: {points.length}<br />
                  En ligne: {onlineCount} / {points.length}
                </div>
              </Popup>
            </Marker>

            {/* Point markers */}
            {pointMarkers.map(p => (
              <Marker
                key={p.id}
                position={[p.lat, p.lng]}
                icon={p.status === 'online' ? ICON_ONLINE : p.status === 'stale' ? ICON_STALE : ICON_OFFLINE}
              >
                <Popup>
                  <div className="min-w-[180px]">
                    <div className="text-sm font-semibold">{p.name}</div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className={cn('w-2 h-2 rounded-full',
                        p.status === 'online' ? 'bg-green-500' : p.status === 'stale' ? 'bg-amber-400' : 'bg-red-500'
                      )} />
                      <span className="text-xs">{p.status === 'online' ? 'En ligne' : p.status === 'stale' ? 'Donnée ancienne' : 'Hors ligne'}</span>
                    </div>
                    {p.r && (
                      <div className="mt-1.5 text-xs space-y-0.5">
                        <div>Pt: <b>{fmt(p.r.active_power_total)} kW</b></div>
                        <div>Qt: <b>{fmt(p.r.reactive_power_total)} kvar</b></div>
                        <div>St: <b>{fmt(p.r.apparent_power_total)} kVA</b></div>
                      </div>
                    )}
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      </CardContent>

      <ConfigDialog open={configOpen} onClose={() => setConfigOpen(false)} config={config} onSave={setConfig} />
    </Card>
  );
}
