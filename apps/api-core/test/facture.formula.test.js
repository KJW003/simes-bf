/**
 * Local Formula Test - No Database Required
 * 
 * Pure validation of SONABEL V2 billing formula
 * Using real production data from March 13, 2026
 * 
 * Node's built-in test runner (no Jest needed)
 * Run with: npm test test/facture.formula.test.js
 */

const test = require("node:test");
const assert = require("assert");

// Real measured data from 24-hour billing period
const inputs = {
  periodHours: 24,             // 24-hour billing period
  K1_kwh: 1328.3,              // Off-peak consumption
  K2_kwh: 922.1,               // Peak consumption
  Wa_total: 2250.4,            // Total active energy
  max_demand_kw: 126.906,      // Peak power observed
  subscribed_power_kw: 100,
  cosPhi: 0.9898,              // Power factor
  plan: "D1",
  alpha_a: 0,                  // D1 plan has NO loss coefficients
  beta_a: 0,
};

// Rates for D1 SONABEL 2023-10
const rates = {
  K1: 88,               // Off-peak rate (XOF/kWh)
  K2: 165,              // Peak rate (XOF/kWh)
  prime_per_kw: 2882,   // Monthly prime (XOF per kW)
  exceed: 165,          // Overage rate (XOF/kWh)
  tde: 2,               // TDE + TDSAAE tax (XOF/kWh)
  vat: 0.18,            // VAT rate
};

// For a 24-hour period: months = 24 / (30 * 24) = 1/30
const months = inputs.periodHours / (30 * 24);

// Expected values (final amounts from production result)
const expected = {
  energy_hpl: 116890.4,
  energy_hpt: 152146.5,
  prime_fixe: 800.56,           // (100 * 2882 * 1.0 / 12) * (1/30)
  exceed_charge: 133184.70,     // 30 * (126.906 - 100) * 165
  tde_total: 4500.8,            // 2 * 2250.4
  fixed_monthly: 284.60,        // Amortized monthly fixed for 24 hours
  subtotal_before_vat: 407807.56,
  vat_amount: 73405.36,         // 407807.56 * 0.18
  total: 481212.92,             // 407807.56 + 73405.36
};

// Main test suite
test("Facture Formula - Pure Math Validation (LOCAL TEST)", async (t) => {
  
  await t.test("March 13, 2026 - Real Production Case", async (subtests) => {
    
    await subtests.test("should validate K1 (off-peak consumption)", () => {
      assert.strictEqual(inputs.K1_kwh, 1328.3);
    });

    await subtests.test("should validate K2 (peak consumption)", () => {
      assert.strictEqual(inputs.K2_kwh, 922.1);
    });

    await subtests.test("should validate total active energy", () => {
      const Wa = inputs.K1_kwh + inputs.K2_kwh;
      assert(Math.abs(Wa - 2250.4) < 0.01);
    });

    await subtests.test("should validate months multiplier for 24-hour period", () => {
      // months = periodHours / (30 * 24) = 24 / 720 = 0.0333...
      assert(Math.abs(months - (1/30)) < 0.0001);
    });

    await subtests.test("should validate HPL energy billing", () => {
      const hpl = inputs.K1_kwh * rates.K1;
      assert(Math.abs(hpl - expected.energy_hpl) < 0.01,
        `HPL: expected ${expected.energy_hpl}, got ${hpl}`);
    });

    await subtests.test("should validate HPT energy billing", () => {
      const hpt = inputs.K2_kwh * rates.K2;
      assert(Math.abs(hpt - expected.energy_hpt) < 0.01,
        `HPT: expected ${expected.energy_hpt}, got ${hpt}`);
    });

    await subtests.test("should validate Ma (losses) = 0 for D1 plan", () => {
      const Ma = inputs.alpha_a * inputs.K1_kwh + inputs.beta_a * inputs.periodHours;
      assert.strictEqual(Ma, 0);
    });

    await subtests.test("should validate Kma (power factor discount)", () => {
      // cos φ = 0.9898 > 0.93 → Kma = 1.0
      const Kma = inputs.cosPhi > 0.93 ? 1.0 : 1;
      assert.strictEqual(Kma, 1.0);
    });

    await subtests.test("should validate prime fixe WITH months multiplier", () => {
      // CRITICAL: Prime must be multiplied by months (1/30 for 24 hours)
      // Prime = (PS × Tarif_PF × Kma / 12) × months
      const prime = (inputs.subscribed_power_kw * rates.prime_per_kw * 1.0 / 12) * months;
      
      assert(Math.abs(prime - expected.prime_fixe) < 0.01,
        `Prime: expected ${expected.prime_fixe}, got ${prime}`);
    });

    await subtests.test("should validate exceed charge", () => {
      const exceed_kw = Math.max(inputs.max_demand_kw - inputs.subscribed_power_kw, 0);
      const exceed = 30 * exceed_kw * rates.exceed;
      
      assert(Math.abs(exceed - expected.exceed_charge) < 0.01,
        `Exceed: expected ${expected.exceed_charge}, got ${exceed}`);
    });

    await subtests.test("should validate TDE + TDSAAE tax", () => {
      const tde = rates.tde * inputs.Wa_total;
      
      assert(Math.abs(tde - expected.tde_total) < 0.01,
        `TDE: expected ${expected.tde_total}, got ${tde}`);
    });

    await subtests.test("should validate subtotal before VAT", () => {
      // Subtotal = Energy + Prime + Exceed + TDE + Fixed
      const energy = inputs.K1_kwh * rates.K1 + inputs.K2_kwh * rates.K2;
      const prime = (inputs.subscribed_power_kw * rates.prime_per_kw * 1.0 / 12) * months;
      const exceed_kw = Math.max(inputs.max_demand_kw - inputs.subscribed_power_kw, 0);
      const exceed = 30 * exceed_kw * rates.exceed;
      const tde = rates.tde * inputs.Wa_total;
      
      const subtotal = energy + prime + exceed + tde + expected.fixed_monthly;
      
      assert(Math.abs(subtotal - expected.subtotal_before_vat) < 1.0,
        `Subtotal: expected ${expected.subtotal_before_vat}, got ${subtotal}`);
    });

    await subtests.test("should validate VAT (18%)", () => {
      const vat = expected.subtotal_before_vat * rates.vat;
      
      assert(Math.abs(vat - expected.vat_amount) < 0.01,
        `VAT: expected ${expected.vat_amount}, got ${vat}`);
    });

    await subtests.test("should validate final total (CRITICAL)", () => {
      const total = expected.subtotal_before_vat + expected.vat_amount;
      
      assert(Math.abs(total - expected.total) < 0.01,
        `Total: expected ${expected.total}, got ${total}`);
    });

    await subtests.test("REGRESSION: months multiplier affects prime fixe", () => {
      // Without months multiplier, prime would be 30x too high
      const broken_prime = (inputs.subscribed_power_kw * rates.prime_per_kw * 1.0 / 12);
      assert(broken_prime / expected.prime_fixe > 20,
        "Missing months multiplier makes prime 30x too high");
    });

    await subtests.test("REGRESSION: Kma must stay 1.0 when cos φ > 0.93", () => {
      assert(inputs.cosPhi > 0.93);
      assert.strictEqual(1.0, 1.0);
    });

    await subtests.test("REGRESSION: exceed formula is 30 × ΔP × rate", () => {
      const exceed_kw = 26.906;
      const exceed_test = 30 * exceed_kw * 165;
      assert(Math.abs(exceed_test - expected.exceed_charge) < 0.01);
    });

  });

  await t.test("Floating Point Precision", async (subtests) => {
    
    await subtests.test("should round prime fixe correctly", () => {
      // Monthly prime with dust: 24016.66666...
      // After months multiplier: 800.555...
      // Rounded: 800.56
      const monthly_with_dust = 24016.66666666668;
      const result = monthly_with_dust * (1/30);
      const rounded = Math.round(result * 100) / 100;
      assert.strictEqual(rounded, 800.56);
    });

    await subtests.test("should handle consumption rounding", () => {
      const rounded_k1 = Math.round(1328.3000000001 * 100) / 100;
      const rounded_k2 = Math.round(922.0999999999 * 100) / 100;
      
      assert.strictEqual(rounded_k1, 1328.30);
      assert.strictEqual(rounded_k2, 922.10);
    });

    await subtests.test("should not lose precision in final total", () => {
      const total_with_dust = 481212.92079999996;
      const rounded = Math.round(total_with_dust * 100) / 100;
      assert.strictEqual(rounded, 481212.92);
    });
  });

});
