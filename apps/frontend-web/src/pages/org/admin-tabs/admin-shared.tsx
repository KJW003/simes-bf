// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Admin – shared constants, helpers, and reusable components
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { Component, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// ─── Measure Categories ────────────────────────────────────
export const MEASURE_CATEGORIES = [
  { value: "LOAD", label: "Charge (LOAD)" },
  { value: "GRID", label: "Réseau (GRID)" },
  { value: "PV", label: "Solaire (PV)" },
  { value: "BATTERY", label: "Batterie (BATTERY)" },
  { value: "GENSET", label: "Groupe (GENSET)" },
  { value: "UNKNOWN", label: "Inconnu (UNKNOWN)" },
];

// ─── Role labels ───────────────────────────────────────────
export const roleLabels: Record<string, string> = {
  platform_super_admin: "Super Admin",
  org_admin: "Admin Org",
  operator: "Opérateur",
  manager: "Manager",
};

// ─── Job types ─────────────────────────────────────────────
export const JOB_TYPES = [
  { value: 'aggregate', label: 'Agrégation télémétrie', desc: 'Re-calcule 15m + daily' },
  { value: 'forecast', label: 'Entraînement ML (prévisions)', desc: 'Entraîne tous les modèles LightGBM' },
  { value: 'report', label: 'Rapport', desc: 'Génère un rapport PDF' },
  { value: 'facture', label: 'Facture', desc: 'Génère une facture' },
  { value: 'audit-pv', label: 'Audit PV', desc: 'Analyse solaire' },
  { value: 'roi', label: 'ROI', desc: 'Analyse rentabilité' },
] as const;

// ─── Terrain label (Org › Site › Terrain) ─────────────────
export function terrainLabelFn(t: any) {
  const parts: string[] = [];
  if (t.org_name) parts.push(t.org_name);
  if (t.site_name) parts.push(t.site_name);
  parts.push(t.name);
  return parts.join(" › ");
}

// ─── Error Boundary ────────────────────────────────────────
export class TabErrorBoundary extends Component<{ children: ReactNode; name: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <Card className="m-4">
          <CardContent className="py-8 text-center space-y-2">
            <p className="text-destructive font-medium">Erreur dans l'onglet {this.props.name}</p>
            <p className="text-sm text-muted-foreground">{this.state.error.message}</p>
            <Button size="sm" variant="outline" onClick={() => this.setState({ error: null })}>Réessayer</Button>
          </CardContent>
        </Card>
      );
    }
    return this.props.children;
  }
}
