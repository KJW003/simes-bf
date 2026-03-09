import React, { useState } from 'react';
import { useAppContext } from '@/contexts/AppContext';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Moon, Sun, Bell, Monitor, RefreshCw, Check, User,
  Clock, Receipt,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePreferences, savePreferences, PREF_DEFAULTS, TARIFF_PRESETS, type UserPreferences } from '@/hooks/usePreferences';

export default function SettingsPage() {
  const { currentUser } = useAppContext();
  const current = usePreferences();
  const [prefs, setPrefs] = useState<UserPreferences>(current);
  const [saved, setSaved] = useState(false);

  const update = <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
    setPrefs(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const save = () => {
    savePreferences(prefs);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title="Paramètres"
        description="Personnalisez votre expérience SIMES"
        breadcrumbs={[
          { label: 'Accueil', href: '/' },
          { label: 'Paramètres' },
        ]}
      />

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <User className="w-4 h-4 text-primary" />
            Profil
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-muted-foreground">Nom</Label>
              <div className="text-sm font-medium">{currentUser.name}</div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Email</Label>
              <div className="text-sm font-medium">{currentUser.email}</div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Rôle</Label>
              <Badge variant="outline" className="text-xs">{currentUser.role}</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Affichage */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Monitor className="w-4 h-4 text-primary" />
            Affichage
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Thème</Label>
              <p className="text-xs text-muted-foreground">Apparence de l'interface</p>
            </div>
            <div className="flex gap-1">
              {(['light', 'dark', 'system'] as const).map(t => (
                <Button
                  key={t}
                  variant={prefs.theme === t ? 'default' : 'outline'}
                  size="sm"
                  className="h-8 text-xs gap-1"
                  onClick={() => update('theme', t)}
                >
                  {t === 'light' && <Sun className="w-3 h-3" />}
                  {t === 'dark' && <Moon className="w-3 h-3" />}
                  {t === 'system' && <Monitor className="w-3 h-3" />}
                  {t === 'light' ? 'Clair' : t === 'dark' ? 'Sombre' : 'Système'}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Mode compact</Label>
              <p className="text-xs text-muted-foreground">Réduit les espacements pour plus de données</p>
            </div>
            <Switch checked={prefs.compactMode} onCheckedChange={v => update('compactMode', v)} />
          </div>
        </CardContent>
      </Card>

      {/* Données */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-primary" />
            Données & Rafraîchissement
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Intervalle de rafraîchissement</Label>
              <p className="text-xs text-muted-foreground">Fréquence de mise à jour des données live</p>
            </div>
            <Select value={String(prefs.refreshInterval)} onValueChange={v => update('refreshInterval', Number(v))}>
              <SelectTrigger className="w-28 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5 sec</SelectItem>
                <SelectItem value="10">10 sec</SelectItem>
                <SelectItem value="15">15 sec</SelectItem>
                <SelectItem value="30">30 sec</SelectItem>
                <SelectItem value="60">1 min</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Plage par défaut</Label>
              <p className="text-xs text-muted-foreground">Période initiale pour les graphiques historiques</p>
            </div>
            <Select value={prefs.defaultTimeRange} onValueChange={v => update('defaultTimeRange', v)}>
              <SelectTrigger className="w-24 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1D">1 jour</SelectItem>
                <SelectItem value="7D">7 jours</SelectItem>
                <SelectItem value="1M">1 mois</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="w-4 h-4 text-primary" />
            Notifications
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Alertes en temps réel</Label>
              <p className="text-xs text-muted-foreground">Afficher les notifications dans la barre</p>
            </div>
            <Switch checked={prefs.notificationsEnabled} onCheckedChange={v => update('notificationsEnabled', v)} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Sons</Label>
              <p className="text-xs text-muted-foreground">Alertes sonores pour incidents critiques</p>
            </div>
            <Switch checked={prefs.soundEnabled} onCheckedChange={v => update('soundEnabled', v)} />
          </div>
        </CardContent>
      </Card>

      {/* Énergie */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" />
            Paramètres Énergie
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-sm font-medium">Facteur CO₂</Label>
              <p className="text-xs text-muted-foreground">kgCO₂e par kWh (réseau local)</p>
            </div>
            <Input
              type="number"
              step="0.01"
              className="w-24 h-8 text-xs text-right"
              value={prefs.co2Factor}
              onChange={e => update('co2Factor', Number(e.target.value))}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-sm font-medium">Tarif moyen</Label>
              <p className="text-xs text-muted-foreground">{prefs.currency}/kWh pour estimation rapide</p>
            </div>
            <Input
              type="number"
              className="w-24 h-8 text-xs text-right"
              value={prefs.tariffRate}
              onChange={e => update('tariffRate', Number(e.target.value))}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-sm font-medium">Devise</Label>
              <p className="text-xs text-muted-foreground">Monnaie d'affichage</p>
            </div>
            <Select value={prefs.currency} onValueChange={v => update('currency', v)}>
              <SelectTrigger className="w-28 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="FCFA">FCFA</SelectItem>
                <SelectItem value="EUR">EUR (€)</SelectItem>
                <SelectItem value="USD">USD ($)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Configuration tarifaire */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Receipt className="w-4 h-4 text-primary" />
            Configuration tarifaire (SONABEL)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label className="text-sm font-medium">Groupe tarifaire</Label>
              <Select
                value={prefs.tariffGroup}
                onValueChange={g => {
                  const groupPreset = TARIFF_PRESETS[g];
                  if (!groupPreset) return;
                  const firstPlan = Object.keys(groupPreset.plans)[0];
                  const plan = groupPreset.plans[firstPlan];
                  if (!plan) return;
                  setPrefs(prev => ({ ...prev, tariffGroup: g, tariffPlan: firstPlan, hpRate: plan.hpRate, peakRate: plan.peakRate, monthlyRedevance: plan.monthlyRedevance, primePerKw: plan.primePerKw }));
                  setSaved(false);
                }}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.keys(TARIFF_PRESETS).map(g => (
                    <SelectItem key={g} value={g}>{g}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-sm font-medium">Plan tarifaire</Label>
              <Select
                value={prefs.tariffPlan}
                onValueChange={p => {
                  const groupPreset = TARIFF_PRESETS[prefs.tariffGroup];
                  if (!groupPreset) return;
                  const plan = groupPreset.plans[p];
                  if (!plan) return;
                  setPrefs(prev => ({ ...prev, tariffPlan: p, hpRate: plan.hpRate, peakRate: plan.peakRate, monthlyRedevance: plan.monthlyRedevance, primePerKw: plan.primePerKw }));
                  setSaved(false);
                }}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TARIFF_PRESETS[prefs.tariffGroup]?.plans ?? {}).map(([k, plan]) => (
                    <SelectItem key={k} value={k}>{k} – {plan.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-sm font-medium">Puissance souscrite (kW)</Label>
              <Input
                type="number"
                className="h-8 text-xs"
                value={prefs.subscribedPowerKw}
                onChange={e => update('subscribedPowerKw', Number(e.target.value))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Tarif HP (XOF/kWh)</Label>
              <Input type="number" className="h-8 text-xs text-right" value={prefs.hpRate} onChange={e => update('hpRate', Number(e.target.value))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Tarif Pointe (XOF/kWh)</Label>
              <Input type="number" className="h-8 text-xs text-right" value={prefs.peakRate} onChange={e => update('peakRate', Number(e.target.value))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Redevance (XOF/mois)</Label>
              <Input type="number" className="h-8 text-xs text-right" value={prefs.monthlyRedevance} onChange={e => update('monthlyRedevance', Number(e.target.value))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Prime/kW (XOF)</Label>
              <Input type="number" className="h-8 text-xs text-right" value={prefs.primePerKw} onChange={e => update('primePerKw', Number(e.target.value))} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Save */}
      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => setPrefs(PREF_DEFAULTS)}>
          Réinitialiser
        </Button>
        <Button onClick={save} className="gap-2">
          {saved ? <Check className="w-4 h-4" /> : null}
          {saved ? 'Enregistré !' : 'Enregistrer'}
        </Button>
      </div>
    </div>
  );
}
