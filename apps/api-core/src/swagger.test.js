const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('OpenAPI spec', () => {
  it('exports a valid OpenAPI 3.0 object', () => {
    const spec = require('./config/swagger');
    assert.equal(spec.openapi, '3.0.3');
    assert.ok(spec.info, 'spec.info is required');
    assert.ok(spec.info.title, 'spec.info.title is required');
    assert.ok(spec.paths, 'spec.paths is required');
    assert.ok(Object.keys(spec.paths).length > 10, 'Spec should document at least 10 paths');
  });

  it('all paths have at least one method', () => {
    const spec = require('./config/swagger');
    for (const [path, methods] of Object.entries(spec.paths)) {
      const httpMethods = Object.keys(methods).filter(m =>
        ['get', 'post', 'put', 'patch', 'delete'].includes(m)
      );
      assert.ok(httpMethods.length > 0, `Path ${path} must have at least one HTTP method`);
    }
  });

  it('all endpoints have tags and summary', () => {
    const spec = require('./config/swagger');
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [method, def] of Object.entries(methods)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
        assert.ok(def.tags && def.tags.length > 0, `${method.toUpperCase()} ${path} must have tags`);
        assert.ok(def.summary, `${method.toUpperCase()} ${path} must have a summary`);
      }
    }
  });
});
