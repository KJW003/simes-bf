// ============================================================
// SIMES – Energy Source Taxonomy
// (SOLID: Single Responsibility – energy source classification)
// ============================================================

/**
 * High-level energy source category assigned to each
 * measurement point or used for aggregation.
 */
export type EnergySourceCategory =
  | 'GRID'
  | 'PV'
  | 'BATTERY'
  | 'GENSET'
  | 'LOAD'
  | 'UNKNOWN';

/** Human-readable French labels. */
export const ENERGY_SOURCE_LABELS: Record<EnergySourceCategory, string> = {
  GRID: 'Réseau',
  PV: 'Solaire PV',
  BATTERY: 'Batterie',
  GENSET: 'Groupe électrogène',
  LOAD: 'Charge',
  UNKNOWN: 'Inconnu',
};

/** CSS colour tokens used across charts / badges. */
export const ENERGY_SOURCE_COLORS: Record<EnergySourceCategory, string> = {
  GRID: 'hsl(var(--chart-1))',
  PV: 'hsl(var(--chart-4))',
  BATTERY: 'hsl(var(--chart-3))',
  GENSET: 'hsl(var(--chart-5))',
  LOAD: 'hsl(var(--chart-2))',
  UNKNOWN: 'hsl(var(--muted-foreground))',
};
