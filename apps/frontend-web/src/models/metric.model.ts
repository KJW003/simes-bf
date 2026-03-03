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
