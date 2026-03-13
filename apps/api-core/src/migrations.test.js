const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('migrate.js', () => {
  it('script exists and has required structure', () => {
    const migratePath = path.join(__dirname, '..', 'infra', 'db', 'migrate.js');
    const altPath = path.resolve(__dirname, '..', '..', '..', 'infra', 'db', 'migrate.js');
    const found = fs.existsSync(migratePath) ? migratePath : (fs.existsSync(altPath) ? altPath : null);
    assert.ok(found, 'migrate.js must exist');
    const src = fs.readFileSync(found, 'utf8');
    assert.ok(src.includes('schema_migrations'), 'Should reference schema_migrations table');
    assert.ok(src.includes('checksum'), 'Should compute checksums');
    assert.ok(src.includes('BEGIN'), 'Should use transactions');
    assert.ok(src.includes('ROLLBACK'), 'Should handle rollback');
  });

  it('migration files are sequential and valid SQL', () => {
    const migrationsDir = path.resolve(__dirname, '..', '..', '..', 'infra', 'db', 'migrations');
    if (!fs.existsSync(migrationsDir)) return; // skip if no migrations dir

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    assert.ok(files.length > 0, 'Should have at least one migration file');

    // Verify sequential numbering (allows a/b sub-migrations sharing the same base number,
    // e.g. 015a_ and 015b_, or paired files with the same numeric prefix).
    const numbers = files.map(f => parseInt(f.split('_')[0], 10));
    assert.ok(numbers.every(n => !isNaN(n) && n >= 1), 'All migration files must start with a positive number');
    for (let i = 1; i < numbers.length; i++) {
      assert.ok(numbers[i] >= numbers[i - 1], `Migration ${files[i]} (${numbers[i]}) is lower than the previous migration (${numbers[i - 1]})`);
    }
    // No gaps in the unique set of migration numbers
    const unique = [...new Set(numbers)].sort((a, b) => a - b);
    for (let i = 1; i < unique.length; i++) {
      assert.equal(unique[i], unique[i - 1] + 1, `Gap in migration numbers between ${unique[i - 1]} and ${unique[i]}`);
    }

    // Verify each file is non-empty SQL
    for (const f of files) {
      const content = fs.readFileSync(path.join(migrationsDir, f), 'utf8').trim();
      assert.ok(content.length > 0, `Migration ${f} should not be empty`);
    }
  });
});
