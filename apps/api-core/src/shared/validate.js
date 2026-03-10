const { ZodError } = require('zod');

/**
 * Express middleware factory: validates req.body against a Zod schema.
 * Returns 400 with structured error details on failure.
 */
function validate(schema) {
  if (!schema || !schema.safeParse) {
    throw new Error(`validate() middleware requires a valid Zod schema. Received: ${typeof schema}`);
  }
  return (req, res, next) => {
    try {
      const body = req.body || {};
      const result = schema.safeParse(body);
      if (!result.success) {
        const errors = result.error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        return res.status(400).json({ ok: false, error: 'Validation failed', details: errors });
      }
      req.body = result.data;
      next();
    } catch (err) {
      const log = require('../config/logger');
      log.error({ err: err.message, stack: err.stack }, '[validate middleware error]');
      return res.status(500).json({ ok: false, error: 'Internal validation error' });
    }
  };
}

module.exports = { validate };
