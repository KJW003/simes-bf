# Audit Général UI — SIMES-BF Frontend

**Date** : Janvier 2025  
**Scope** : `apps/frontend-web/src/`  

---

## 1. Architecture globale

| Couche | Technologie | État |
|--------|-------------|------|
| Framework | React 18.3 + TypeScript 5.8 | ✅ |
| Build | Vite 5.4 | ✅ |
| Routing | React Router v6 (26 routes) | ✅ |
| State | React Context + TanStack Query | ✅ |
| UI | ShadCN/Radix + Tailwind CSS 3.4 | ✅ |
| Charts | Recharts | ✅ |
| Cartes | react-leaflet | ✅ |
| Widgets | Widget Engine (18 widgets, drag & drop) | ✅ |

**Verdict** : Stack moderne et cohérent. Pas de dépendance obsolète.

---

## 2. Redondances identifiées et corrigées

### 2.1 Imports inutilisés dans App.tsx ✅ Corrigé

- `DataMonitor` et `Points` étaient importés mais jamais utilisés (les routes `/data-monitor` et `/points` pointent vers `ZonesPoints`).
- **Action** : Imports supprimés.

### 2.2 Widget dupliqué `cost-energy` ✅ Corrigé

- Le widget `cost-energy` faisait doublon avec `dashboard-daily-cost` (même donnée, format KPI vs chart).
- **Action** : Retiré du layout par défaut, auto-nettoyage des layouts existants, version de stockage incrémentée (v8).

### 2.3 Pages `DataMonitor.tsx` et `Points.tsx` — Non utilisées

- Ces deux pages ne sont plus routées (remplacées par `ZonesPoints.tsx`).
- **Recommandation** : Supprimer ces fichiers. Conserver les fonctionnalités intégrées dans ZonesPoints.
- **Impact** : Aucun — aucune route ne pointe vers ces composants.

### 2.4 Composants orphelins

| Composant | Fichier | Importé ? | Recommandation |
|-----------|---------|-----------|----------------|
| `HarmonicsPanel` | `components/energy/HarmonicsPanel.tsx` | ❌ Non | Supprimer ou intégrer dans PowerQuality |
| `EnergyQualitySummary` | `components/widgets/EnergyQualitySummary.tsx` | ❌ Non | Supprimer ou intégrer dans PointDetails |

---

## 3. Analyse par page

### 3.1 Pages Org (17 pages)

| Page | Route | État | Notes |
|------|-------|------|-------|
| Dashboard | `/` | ✅ | WidgetBoard avec 18 widgets disponibles |
| ZonesPoints | `/data-monitor`, `/points` | ✅ | Fusion zones + points réussie |
| PowerQuality | `/power-quality` | ✅ | Affichage harmoniques, THD, déséquilibre |
| Donnees (History) | `/donnees`, `/history` | ✅ | Export CSV, sélection colonnes |
| Forecasts | `/forecasts` | ⚠️ | Régression linéaire client — LightGBM recommandé |
| Invoice | `/invoice` | ✅ | Calcul facturation avec tarifs |
| SolairePerformance | `/pv-battery` | ✅ | Conditionné par `hasSolar` |
| Predimensionnement | `/predimensionnement` | ✅ | Dimensionnement PV/batteries |
| EnergyAudit | `/energy-audit` | ✅ | Audit énergétique guidé |
| Anomalies | `/anomalies` | ✅ | Alarmes + config intégrée |
| Reports | `/reports` | ✅ | Rapports PDF/Excel |
| Administration | `/admin` | ✅ | Gestion utilisateurs/terrains |
| Settings | `/settings` | ✅ | Préférences utilisateur |
| ZonePage | `/terrain/:id/zones/:id` | ✅ | Détail d'une zone |
| PointDetails | `/points/:id` | ✅ | Détail d'un point |
| DataMonitor | — | ❌ | Non routé, à supprimer |
| Points | — | ❌ | Non routé, à supprimer |

### 3.2 Pages Platform (9 pages)

Toutes fonctionnelles, pas de redondance. Routes protégées par rôle `platform_super_admin`.

---

## 4. Hooks — Analyse

| Hook | Responsabilité | Taille | État |
|------|---------------|--------|------|
| `useApi` | Toutes les queries TanStack | ✅ Centralisé | ✅ |
| `usePreferences` | Préférences utilisateur + sync serveur | ✅ | ✅ |
| `useAlarmEngine` | Règles d'alarme + évaluation + sync | ✅ | ✅ |
| `useApiHealth` | Health check API | ✅ | ✅ |
| `use-toast` | Notifications ShadCN | ✅ | ✅ |

**Verdict** : 5 hooks ciblés, aucune duplication.

---

## 5. Widget Engine — Analyse

**18 widgets enregistrés** dans `widget-registry.ts` :

| Catégorie | Widgets | État |
|-----------|---------|------|
| Dashboard | KPIs, Load Curve, Map, Alarms, Config, Daily Cost, Carbon, Power Peaks | ✅ |
| Utilitaires | Energy Quality, Live Load, Cost Energy, Forecast | ✅ |
| Insights | Diagnostics, Active Alerts | ✅ |
| Solaire | PV Production, Performance Ratio, Battery Status | ✅ |

**Observations** :
- `cost-energy` maintenu dans le registre (backward compat) mais retiré du layout par défaut ✅
- Tous les resolvers utilisent les données pré-chargées (pas de requêtes supplémentaires) ✅
- Renderers encapsulés dans `React.memo` ✅

---

## 6. Performance

### Optimisations en place
- `React.memo` sur les composants coûteux (widgets, charts)
- `useMemo` pour les calculs dérivés
- TanStack Query avec `staleTime: 30s` et `gcTime: 10min`
- Layout sauvegardé en localStorage (cache) + sync serveur débounced (500ms–1s)
- Agrégation côté serveur (TimescaleDB 15min/jour)

### Points d'attention
- **Bundle size** : 1.4 Mo (gzip 391 Ko) — le code-splitting est recommandé pour les routes lazy
- **React Router lazy loading** : non implémenté — les 26 pages sont chargées upfront
- **Charts** : Recharts (lourd ~200 Ko) — alternative : recharts/es ou visx pour les widgets légers

### Recommandation : Lazy Loading des routes

```tsx
// Exemple d'optimisation future
const Dashboard = lazy(() => import('./pages/org/Dashboard'));
const Forecasts = lazy(() => import('./pages/org/Forecasts'));
// ... etc
```

Impact estimé : bundle initial réduit à ~500-600 Ko (gzip ~200 Ko).

---

## 7. Simes_Ui — Dossier legacy

Le dossier `Simes_Ui/` est une version antérieure de l'interface utilisant des données mock. Il contient des composants qui n'existent plus dans `frontend-web` (`HarmonicsPanel`, `EnergyQualitySummary` dans `PointDetails`).

**Recommandation** : Ajouter un `README.md` marquant ce dossier comme deprecated, ou le retirer du déploiement.

---

## 8. Résumé des actions

### Fait (cette session)
- [x] Suppression imports inutiles (`DataMonitor`, `Points`) de App.tsx
- [x] Suppression widget dupliqué `cost-energy` du layout par défaut
- [x] Auto-nettoyage des layouts stockés contenant `cost-energy`
- [x] Synchronisation serveur de tous les paramètres utilisateur

### Recommandé (futur)
- [ ] Supprimer `DataMonitor.tsx` et `Points.tsx` (fichiers orphelins)
- [ ] Supprimer ou réintégrer `HarmonicsPanel.tsx` et `EnergyQualitySummary.tsx`
- [ ] Implémenter le lazy loading des routes (React.lazy + Suspense)
- [ ] Configurer le code-splitting Vite (manualChunks)
- [ ] Marquer `Simes_Ui/` comme deprecated

---

## 9. Conclusion

L'interface SIMES-BF est **bien structurée** avec une architecture cohérente. Les principales redondances (imports inutiles, widget dupliqué) ont été corrigées. Les optimisations restantes sont mineures (lazy loading, suppression de fichiers orphelins) et n'impactent pas la fonctionnalité.
