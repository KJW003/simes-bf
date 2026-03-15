const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const adminRoutesPath = path.join(__dirname, 'admin.routes.js');
const logsRoutesPath = path.join(__dirname, '..', 'logs', 'logs.routes.js');

const adminSrc = fs.readFileSync(adminRoutesPath, 'utf8');
const logsSrc = fs.readFileSync(logsRoutesPath, 'utf8');

function hasGuardedRoute(source, method, routePath) {
  const escapedPath = routePath
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `router\\.${method}\\(\\s*[\"']${escapedPath}[\"']\\s*,\\s*(?:requireAuth\\s*,\\s*)?requireRole\\(\\s*[\"']platform_super_admin[\"']\\s*\\)`,
    'm',
  );
  return pattern.test(source);
}

describe('Admin routes superadmin guard (static)', () => {
  const guardedAdminEndpoints = [
    ['put', '/admin/gateways/:gatewayId/map'],
    ['put', '/admin/devices/:deviceKey/map'],
    ['post', '/admin/incoming/:id/replay'],
    ['post', '/admin/devices/:terrain_id/:device_key/process-historical'],
    ['get', '/admin/gateways'],
    ['get', '/admin/gateways/:gatewayId/devices'],
    ['post', '/admin/gateways/:gatewayId/provision'],
    ['delete', '/admin/incoming/:id'],
    ['delete', '/admin/incoming'],
    ['delete', '/admin/gateways/:gatewayId'],
    ['post', '/admin/incoming/reconcile'],
    ['post', '/incoming/process-unmapped'],
    ['post', '/cleanup-unmapped-messages'],
    ['get', '/logs/cleanup'],
    ['get', '/logs/scheduler'],
    ['delete', '/admin/readings/:pointId'],
    ['post', '/admin/readings/batch-purge-preview'],
    ['post', '/admin/readings/batch-purge'],
    ['post', '/admin/readings/purge-range-preview'],
    ['post', '/admin/readings/purge-range'],
    ['get', '/admin/purge-batches'],
    ['post', '/admin/purge-batches/:batchId/restore'],
    ['delete', '/admin/purge-batches/:batchId'],
    ['post', '/admin/pipeline/repair-aggregations'],
    ['post', '/admin/pipeline/retry-failed-jobs'],
    ['post', '/admin/pipeline/flush-failed-jobs'],
    ['post', '/admin/pipeline/reprocess-unmapped'],
    ['get', '/admin/disk-stats'],
    ['post', '/admin/disk-recovery'],
  ];

  for (const [method, routePath] of guardedAdminEndpoints) {
    it(`${method.toUpperCase()} ${routePath} is guarded by superadmin role`, () => {
      assert.equal(
        hasGuardedRoute(adminSrc, method, routePath),
        true,
        `Missing requireRole(\"platform_super_admin\") on ${method.toUpperCase()} ${routePath}`,
      );
    });
  }
});

describe('Logs routes role policy (static)', () => {
  it('GET /logs is superadmin-guarded', () => {
    assert.equal(
      hasGuardedRoute(logsSrc, 'get', '/logs'),
      true,
      'Missing requireRole("platform_super_admin") on GET /logs',
    );
  });

  it('GET /logs/stats is superadmin-guarded', () => {
    assert.equal(
      hasGuardedRoute(logsSrc, 'get', '/logs/stats'),
      true,
      'Missing requireRole("platform_super_admin") on GET /logs/stats',
    );
  });

  it('POST /logs/ui stays available without superadmin role', () => {
    const hasUiSuperadminGuard = hasGuardedRoute(logsSrc, 'post', '/logs/ui');
    assert.equal(hasUiSuperadminGuard, false, 'POST /logs/ui should remain role-agnostic after requireAuth');
  });
});
