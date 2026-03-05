/**
 * shared/ct-transform.js
 *
 * Applies Current Transformer (CT) ratio correction to raw Acrel metrics.
 *
 * The Acrel meter reports raw current values. When a CT is installed,
 * the actual measured current = raw_I × CT_ratio.
 * All metrics that are derived from current must also be scaled:
 *   - Currents (I) → × CT
 *   - Active Power (P = V × I × cosφ) → × CT
 *   - Reactive Power (Q) → × CT
 *   - Apparent Power (S = V × I) → × CT
 *   - Energy (∫P·dt) → × CT
 *
 * Metrics NOT affected by CT:
 *   - Voltages (V)
 *   - Power Factor (cosφ, ratio)
 *   - Frequency (Hz)
 *   - THD (%, ratio)
 *   - Temperatures
 *   - DI/DO/Alarm states
 *   - Radio metadata (RSSI, SNR, f_cnt)
 *   - Voltage unbalance
 */

// Columns that must be multiplied by CT ratio
const CT_AFFECTED_COLS = new Set([
  // Currents
  "current_a", "current_b", "current_c",
  "current_sum", "aftercurrent",

  // Active power (kW) — P = V × I
  "active_power_a", "active_power_b", "active_power_c", "active_power_total",

  // Reactive power (kVar) — Q = V × I × sinφ
  "reactive_power_a", "reactive_power_b", "reactive_power_c", "reactive_power_total",

  // Apparent power (kVA) — S = V × I
  "apparent_power_a", "apparent_power_b", "apparent_power_c", "apparent_power_total",

  // Current unbalance
  "current_unbalance",

  // Global energies (kWh = ∫P·dt)
  "energy_total", "energy_import", "energy_export",
  "reactive_energy_import", "reactive_energy_export",

  // Phase energies
  "energy_total_a", "energy_import_a", "energy_export_a",
  "energy_total_b", "energy_import_b", "energy_export_b",
  "energy_total_c", "energy_import_c", "energy_export_c",

  // SONABEL tariff energy slices
  "energy_spike", "energy_peak", "energy_flat", "energy_valley",
]);

/**
 * Apply CT ratio to a metrics object in-place.
 * @param {Object} metrics   - The picked metrics (from pickMetrics)
 * @param {number} ctRatio   - The CT ratio (default 1 = no transform)
 * @returns {Object} The same metrics object, mutated
 */
function applyCT(metrics, ctRatio) {
  if (!ctRatio || ctRatio === 1) return metrics;

  for (const key of CT_AFFECTED_COLS) {
    if (metrics[key] !== undefined && metrics[key] !== null) {
      const raw = Number(metrics[key]);
      if (!Number.isNaN(raw)) {
        metrics[key] = raw * ctRatio;
      }
    }
  }

  return metrics;
}

module.exports = { CT_AFFECTED_COLS, applyCT };
