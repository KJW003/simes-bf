// ============================================================
// SIMES – Electrical Metric Taxonomy
// (SOLID: Single Responsibility – metric classification)
// ============================================================

/**
 * Each metric key maps to a physical electrical quantity
 * that can be requested from a measurement point.
 */
export type MetricKey =
  | 'P'       // Active Power (kW)
  | 'Q'       // Reactive Power (kVAR)
  | 'S'       // Apparent Power (kVA)
  | 'Energy'  // Cumulative energy (kWh)
  | 'PF'      // Power Factor (0–1)
  | 'THD'     // Total Harmonic Distortion (%)
  | 'V'       // Voltage (V)
  | 'I'       // Current (A)
  | 'Freq'    // Frequency (Hz)
  | 'VUnbal'  // Voltage Unbalance (%)
  | 'IUnbal'; // Current Unbalance (%)

/** French labels for UI display. */
export const METRIC_LABELS: Record<MetricKey, string> = {
  P: 'Puissance active (kW)',
  Q: 'Puissance réactive (kVAR)',
  S: 'Puissance apparente (kVA)',
  Energy: 'Énergie (kWh)',
  PF: 'Facteur de puissance',
  THD: 'THD (%)',
  V: 'Tension (V)',
  I: 'Courant (A)',
  Freq: 'Fréquence (Hz)',
  VUnbal: 'Déséquilibre tension (%)',
  IUnbal: 'Déséquilibre courant (%)',
};

/** SI / electrical units. */
export const METRIC_UNITS: Record<MetricKey, string> = {
  P: 'kW',
  Q: 'kVAR',
  S: 'kVA',
  Energy: 'kWh',
  PF: '',
  THD: '%',
  V: 'V',
  I: 'A',
  Freq: 'Hz',
  VUnbal: '%',
  IUnbal: '%',
};

/** Available DB columns per MetricKey, with French labels. */
export type SubMetric = { col: string; label: string };

export const METRIC_SUB_COLUMNS: Record<MetricKey, SubMetric[]> = {
  V: [
    { col: 'voltage_a', label: 'Va (Phase A)' },
    { col: 'voltage_b', label: 'Vb (Phase B)' },
    { col: 'voltage_c', label: 'Vc (Phase C)' },
    { col: 'voltage_ab', label: 'Vab (Ligne AB)' },
    { col: 'voltage_bc', label: 'Vbc (Ligne BC)' },
    { col: 'voltage_ca', label: 'Vca (Ligne CA)' },
  ],
  I: [
    { col: 'current_a', label: 'Ia (Phase A)' },
    { col: 'current_b', label: 'Ib (Phase B)' },
    { col: 'current_c', label: 'Ic (Phase C)' },
    { col: 'current_sum', label: 'I somme' },
  ],
  P: [
    { col: 'active_power_a', label: 'Pa (Phase A)' },
    { col: 'active_power_b', label: 'Pb (Phase B)' },
    { col: 'active_power_c', label: 'Pc (Phase C)' },
    { col: 'active_power_total', label: 'P total' },
  ],
  Q: [
    { col: 'reactive_power_a', label: 'Qa (Phase A)' },
    { col: 'reactive_power_b', label: 'Qb (Phase B)' },
    { col: 'reactive_power_c', label: 'Qc (Phase C)' },
    { col: 'reactive_power_total', label: 'Q total' },
  ],
  S: [
    { col: 'apparent_power_a', label: 'Sa (Phase A)' },
    { col: 'apparent_power_b', label: 'Sb (Phase B)' },
    { col: 'apparent_power_c', label: 'Sc (Phase C)' },
    { col: 'apparent_power_total', label: 'S total' },
  ],
  PF: [
    { col: 'power_factor_a', label: 'PFa (Phase A)' },
    { col: 'power_factor_b', label: 'PFb (Phase B)' },
    { col: 'power_factor_c', label: 'PFc (Phase C)' },
    { col: 'power_factor_total', label: 'PF total' },
  ],
  THD: [
    { col: 'thdi_a', label: 'THDi A' },
    { col: 'thdi_b', label: 'THDi B' },
    { col: 'thdi_c', label: 'THDi C' },
    { col: 'thdu_a', label: 'THDu A' },
    { col: 'thdu_b', label: 'THDu B' },
    { col: 'thdu_c', label: 'THDu C' },
  ],
  Energy: [
    { col: 'energy_import', label: 'Énergie importée' },
    { col: 'energy_export', label: 'Énergie exportée' },
    { col: 'energy_total', label: 'Énergie totale' },
  ],
  Freq: [
    { col: 'frequency', label: 'Fréquence' },
  ],
  VUnbal: [
    { col: 'voltage_unbalance', label: 'Déséquilibre tension' },
  ],
  IUnbal: [
    { col: 'current_unbalance', label: 'Déséquilibre courant' },
  ],
};
