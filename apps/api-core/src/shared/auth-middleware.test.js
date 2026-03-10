const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

// Set env before requiring the module
const TEST_SECRET = 'test-secret-for-unit-tests';
process.env.JWT_SECRET = TEST_SECRET;

delete require.cache[require.resolve('../config/env')];
const { requireAuth, requireRole } = require('./auth-middleware');

function mockReqResNext(headers = {}) {
  const req = { headers };
  const res = {
    _status: null,
    _json: null,
    status(code) { res._status = code; return res; },
    json(data) { res._json = data; return res; },
  };
  let nextCalled = false;
  const next = () => { nextCalled = true; };
  return { req, res, next, wasNextCalled: () => nextCalled };
}

describe('requireAuth middleware', () => {
  it('rejects requests without Authorization header', () => {
    const { req, res, next, wasNextCalled } = mockReqResNext({});
    requireAuth(req, res, next);
    assert.equal(res._status, 401);
    assert.equal(res._json.ok, false);
    assert.equal(wasNextCalled(), false);
  });

  it('rejects requests with malformed Authorization header', () => {
    const { req, res, next, wasNextCalled } = mockReqResNext({ authorization: 'Basic abc' });
    requireAuth(req, res, next);
    assert.equal(res._status, 401);
    assert.equal(wasNextCalled(), false);
  });

  it('rejects invalid JWT tokens', () => {
    const { req, res, next, wasNextCalled } = mockReqResNext({ authorization: 'Bearer bad-token' });
    requireAuth(req, res, next);
    assert.equal(res._status, 401);
    assert.equal(res._json.error, 'Invalid token');
    assert.equal(wasNextCalled(), false);
  });

  it('passes and attaches userId + userRole for valid tokens', () => {
    const token = jwt.sign({ sub: 'user-123', role: 'manager' }, TEST_SECRET, { expiresIn: '1h' });
    const { req, res, next, wasNextCalled } = mockReqResNext({ authorization: `Bearer ${token}` });
    requireAuth(req, res, next);
    assert.equal(wasNextCalled(), true);
    assert.equal(req.userId, 'user-123');
    assert.equal(req.userRole, 'manager');
  });

  it('rejects expired tokens', () => {
    const token = jwt.sign({ sub: 'user-123', role: 'operator' }, TEST_SECRET, { expiresIn: '-1s' });
    const { req, res, next, wasNextCalled } = mockReqResNext({ authorization: `Bearer ${token}` });
    requireAuth(req, res, next);
    assert.equal(res._status, 401);
    assert.equal(wasNextCalled(), false);
  });

  it('rejects tokens signed with wrong secret', () => {
    const token = jwt.sign({ sub: 'user-123', role: 'operator' }, 'wrong-secret', { expiresIn: '1h' });
    const { req, res, next, wasNextCalled } = mockReqResNext({ authorization: `Bearer ${token}` });
    requireAuth(req, res, next);
    assert.equal(res._status, 401);
    assert.equal(wasNextCalled(), false);
  });
});

describe('requireRole middleware', () => {
  it('passes when user has required role', () => {
    const middleware = requireRole('manager', 'org_admin');
    const { req, res, next, wasNextCalled } = mockReqResNext();
    req.userRole = 'manager';
    middleware(req, res, next);
    assert.equal(wasNextCalled(), true);
  });

  it('rejects when user lacks required role', () => {
    const middleware = requireRole('platform_super_admin');
    const { req, res, next, wasNextCalled } = mockReqResNext();
    req.userRole = 'operator';
    middleware(req, res, next);
    assert.equal(res._status, 403);
    assert.equal(res._json.ok, false);
    assert.equal(wasNextCalled(), false);
  });

  it('rejects when no role is set on request', () => {
    const middleware = requireRole('operator');
    const { req, res, next, wasNextCalled } = mockReqResNext();
    middleware(req, res, next);
    assert.equal(res._status, 403);
    assert.equal(wasNextCalled(), false);
  });
});
