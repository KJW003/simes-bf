# Plan Responsive — SIMES Frontend

## État actuel

| Composant | Mobile-ready ? | Détail |
|-----------|---------------|--------|
| **OrgSidebar / PlatformSidebar** | ❌ | `w-56` fixe, toujours visible, pas de hamburger |
| **TopBar** | ❌ | Chaîne Org→Site→Terrain déborde sur mobile |
| **MainLayout** | ❌ | Pas de breakpoint, sidebar toujours dans le flux |
| **Dashboard grids** | ✅ | `grid-cols-2 md:3 lg:6`, `ResponsiveContainer` |
| **Charts (Recharts)** | ✅ | `ResponsiveContainer width="100%"` |
| **Formulaires & filtres** | ✅ | `flex-wrap` déjà en place |

> **Verdict** : les pages internes sont correctes ; le **shell structurel** (sidebar + topbar + layout) est le bloqueur principal.

---

## Phase 1 — Shell responsive (prioritaire)

### 1.1 Sidebar collapsible
- Ajouter un état `sidebarOpen` dans `MainLayout` (ou via un petit contexte `useSidebar`)
- Sidebar : `hidden md:flex w-56` en desktop, `Sheet` (Radix) en mobile
- Sur mobile : overlay drawer glissant depuis la gauche, fermé par défaut
- Breakpoint pivot : `md` (768px)

### 1.2 Hamburger dans TopBar
- Bouton `Menu` visible uniquement `md:hidden` dans TopBar
- onClick → toggle le drawer sidebar
- Position : tout à gauche avant le logo

### 1.3 TopBar adaptive
- Chaîne Org/Site/Terrain : `hidden md:flex` → cachée sur mobile
- Sur mobile : afficher uniquement le terrain sélectionné (texte court) ou déplacer la sélection dans le drawer sidebar
- Dark mode toggle + user avatar : toujours visibles
- Badge API status : `hidden sm:inline` ✅ (déjà fait)

### 1.4 Padding adaptatif
- `p-6` → `p-3 md:p-6` sur la zone `<main>`
- Gap des grids : `gap-3 md:gap-4`

---

## Phase 2 — Pages & widgets

### 2.1 Dashboard
- ✅ Déjà responsive (grids collapse, flex-wrap)
- Carte Leaflet : hauteur `h-[300px] md:h-[400px]`
- AlarmWidget day picker : `hidden md:block` sur la colonne jours, remplacée par un `<Select>` sur mobile

### 2.2 Points
- Grid des cards : `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`
- Détail d'un point : stack vertical des graphiques sur `< md`

### 2.3 Rapports / Forecasts / Données
- Tables : `overflow-x-auto` avec scroll horizontal
- Filtres : `flex-col md:flex-row` si nécessaire

### 2.4 Paramètres
- Formulaire : déjà en colonne simple, responsive-ready

---

## Phase 3 — Polish

### 3.1 Touch-friendly
- Taille minimale des boutons : `min-h-10 min-w-10` (44px)
- Espacement entre éléments cliquables ≥ 8px
- Charts : tooltip `activeDot` plus gros (r=6)

### 3.2 Typography
- Titres `text-lg md:text-xl lg:text-2xl`
- KPI values : `text-xl md:text-2xl`

### 3.3 Footer / status bar
- `hidden sm:flex` sur les éléments secondaires (refresh, infra status)
- `flex-wrap` sur le conteneur principal

---

## Breakpoints Tailwind (rappel)

| Token | Largeur | Cible |
|-------|---------|-------|
| `sm`  | 640px   | Téléphone paysage |
| `md`  | 768px   | Tablette portrait — **pivot sidebar** |
| `lg`  | 1024px  | Tablette paysage / petit laptop |
| `xl`  | 1280px  | Desktop |

---

## Implémentation recommandée

1. Créer un contexte `SidebarContext` (ou utiliser un simple `useState` dans MainLayout)
2. Modifier `MainLayout.tsx` : sidebar conditionnelle + `<Sheet>` mobile
3. Modifier `TopBar.tsx` : hamburger `md:hidden`
4. Modifier `OrgSidebar.tsx` : accepter `onClose` prop pour fermer le drawer
5. Tester sur 375px (iPhone SE), 768px (iPad), 1280px (desktop)
6. Ajuster les padding/gaps au fur et à mesure

Estimation d'effort : ~2-3h pour Phase 1, ~1-2h pour Phase 2, ~1h pour Phase 3.
