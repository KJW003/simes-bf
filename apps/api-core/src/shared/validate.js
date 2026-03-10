const { ZodError } = require('zod');

/**
 * Express middleware factory: validates req.body against a Zod schema.
 * Returns 400 with structured error details on failure.
 */
function validate(schema) {
  if (!schema) {
    throw new Error('validate() middleware requires a Zod schema argument');
  }
  return (req, res, next) => {
    try {
      const result = schema.safeParse(req.body);
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
      log.error({ err: err.message }, '[validate middleware error]');
      return res.status(500).json({ ok: false, error: 'Internal validation error' });
    }
  };
}

module.exports = { validate };
