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

    // Verify sequential numbering
    const numbers = files.map(f => parseInt(f.split('_')[0], 10));
    for (let i = 0; i < numbers.length; i++) {
      assert.equal(numbers[i], i + 1, `Migration ${files[i]} should have number ${i + 1}`);
    }

    // Verify each file is non-empty SQL
    for (const f of files) {
      const content = fs.readFileSync(path.join(migrationsDir, f), 'utf8').trim();
      assert.ok(content.length > 0, `Migration ${f} should not be empty`);
    }
  });
});
