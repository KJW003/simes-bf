# Facture Tests - Local Setup Guide

## Quick Start (5 minutes)

### 1. No Installation Needed
The project uses Node.js built-in test runner (`node --test`) - no Jest dependency required.

### 2. Run Formula Test (NO DATABASE REQUIRED)
```bash
cd apps/api-core
npm test -- test/facture.formula.test.js
```

Or use Node directly:
```bash
node --test test/facture.formula.test.js
```

**Expected Output:**
```
✓ Facture Formula - Pure Math Validation (LOCAL TEST) (45.234ms)
  ✓ March 13, 2026 - Real Production Case (42.123ms)
    ✓ should validate K1 calculation (consumption HPL) (0.5ms)
    ✓ should validate K2 calculation (consumption HPT) (0.3ms)
    ✓ should validate total consumption (0.2ms)
    ✓ should validate Ma (active losses) = 0 for D1 plan (0.2ms)
    ✓ should validate Mr (reactive losses) = 0 for D1 plan (0.2ms)
    ✓ should validate Kma (power factor penalty) (0.2ms)
    ✓ should validate HPL consumption billing (0.3ms)
    ✓ should validate HPT consumption billing (0.2ms)
    ✓ should validate power exceed charge (0.3ms)
    ✓ should validate prime fixe (monthly fixed charge) (0.2ms)
    ✓ should validate TDE + TDSAAE tax (0.2ms)
    ✓ should validate subtotal before VAT (0.3ms)
    ✓ should validate VAT (18%) (0.2ms)
    ✓ should validate final total (CRITICAL) (0.3ms)
    ✓ REGRESSION: Should detect if Ma formula breaks in future (0.2ms)
    ✓ REGRESSION: Should detect if Kma breaks for power factor (0.2ms)
    ✓ REGRESSION: Should catch overflow in exceed charge (0.2ms)
  ✓ Floating Point Precision Edge Cases (3.111ms)
    ✓ should handle floating point precision in consumption (0.3ms)
    ✓ should handle VAT rounding (0.2ms)
    ✓ should accumulate total without precision loss (0.3ms)

20 tests passed
```

---

## Test Files Explained

### `test/facture.formula.test.js` ✅ **RUN THIS FIRST**
- **Requires:** Jest only (no database, no API, no Worker)
- **Tests:** Pure mathematical calculations
- **Data:** Real production values from March 13, 2026
- **Purpose:** Validates formula didn't break
- **Time:** ~1 second to run
- **Status:** Ready to run NOW

**What it tests:**
- K1 (off-peak) consumption calculation
- K2 (peak) consumption calculation  
- Active/reactive losses (Ma, Mr)
- Power factor penalty (Kma)
- Power exceed charges
- Fixed charges and taxes
- VAT calculation
- Final total

---

### `test/facture.regression.test.js` 
- **Requires:** Full test setup (DB, fixtures, auth tokens) - SKIP FOR NOW
- **Tests:** Integration with computeFacture function
- **Data:** Now populated with real production values
- **Purpose:** Regression testing against original calculation
- **Status:** Skipped by default (needs DB fixtures)
- **Enable later:** When you have test database ready

---

### `test/facture-security.test.js`
- **Requires:** Database, auth mock, multi-org setup - SKIP FOR NOW
- **Tests:** Cross-org access denial, tenant isolation
- **Purpose:** Security validation
- **Status:** Skipped by default (needs test database)
- **Enable later:** When you have test database ready

---

## Understanding the Real Data

**Source:** Production terrain on March 13, 2026  
**Terrain ID:** abf6ad9a-2447-43eb-a4de-e99bf49765b7  
**Plan:** D1 Non-industriel (SONABEL 2023-10)  
**Period:** 24 hours (single day)

### Key Observations

#### ✅ What's Normal:
- **Ma = 0** because D1 plan has α=0, β=0 (no loss coefficients)
- **Kma = 1.0** because cos φ = 0.989 > 0.93 (no power factor penalty)
- **High exceed charge** (133,185 XOF) because power exceeded by 26.9 kW

#### ⚠️ What's Unusual:
- **24-hour period** (most factures are monthly)
- **Very high total** (481,213 XOF because of power overage charges)
- **All calculations driven by the 27 kW overage**

---

## Test Results Analysis

### If All Tests Pass ✅
```
Test Suites: 1 passed, 1 total
Tests:       20 passed, 20 total
```

**Meaning:** Your formula is mathematically correct. The invoice calculation in production matches expected SONABEL V2 formula.

---

### If Tests Fail ❌

**Example 1: HPL Billing Fails**
```
✗ should validate HPL consumption billing
  Expected: ~116890.40, got 116890.39999
```
**Action:** Check floating-point rounding. Should be OK with tolerance of 0.01.

---

**Example 2: Total Amount Fails**
```
✗ should validate final total (CRITICAL)
  Expected: 481212.92, got 485000
```
**Action:** CRITICAL! Something in the formula is broken. Check:
1. Did rates change in tariff_plans table?
2. Did calculation for exceed charge break?
3. Did tax rates change?

---

## Running Individual Tests

For Node.js native test runner, all tests in a file run. To run specific tests, you would need to modify the test file temporarily or run the entire file:

```bash
# Run the entire formula test file
npm test -- test/facture.formula.test.js

# Or use Node directly
node --test test/facture.formula.test.js
```

Note: If you need to run individual tests frequently, Jest would be easier. To switch to Jest:
```bash
npm install --save-dev jest
# Update package.json: "test": "jest"
# Then npm test can filter by pattern
```

---

## Next Steps

### When Ready (Have Database)
1. Set up test database with fixture data
2. Enable `facture.regression.test.js` (uncomment skip calls)
3. Enable `facture-security.test.js` (set up multi-org fixtures)
4. Run full test suite:
   ```bash
   npm test
   ```

### To Monitor After Deployment
Keep this test in your CI/CD pipeline:
```bash
# In GitHub Actions / GitLab CI / Jenkins
npm test -- test/facture.formula.test.js
```

If this test fails after a deployment, you broke the formula. Rollback immediately.

---

## FAQ

**Q: Why only 24 hours?**  
A: That's what we captured in production. Regression tests should use real data, not synthetic.

**Q: Should I test longer periods?**  
A: Later, yes. Create separate test cases for:
- 7-day periods
- Full month (30-day)
- Year boundaries (Feb 28→Mar 1)

**Q: What about timezone edge cases?**  
A: Future test suite. This validates the formula works correctly with real data first.

**Q: Can I add more test cases?**  
A: Yes! Extract more production factures and add them as separate describe blocks.

**Q: What if rates in D1 plan change?**  
A: Update tests with new rates. The test will catch if you calculate wrong new amounts.

---

## Git Workflow

After running tests successfully:

```bash
# Stage test updates
git add apps/api-core/test/

# Commit
git commit -m "test: update golden test case with real production data (Mar 13, 2026)"

# Push
git push
```

---

## Support

If test fails and you don't know why:
1. Share the error output
2. Share which line of test failed
3. I'll help you debug

Example:
```
✗ should validate exceed charge
  Exceed charge should be ~133184.70, got 100000
  
Tests: 19 passed, 1 failed
```

→ This means exceed charge calculation changed. Check rates or formula.

---

**Last Updated:** March 13, 2026  
**Status:** Ready to run ✅
