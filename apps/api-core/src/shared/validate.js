const { ZodError } = require('zod');

/**
 * Express middleware factory: validates req.body against a Zod schema.
 * Returns 400 with structured error details on failure.
 */
function validate(schema) {
  return (req, res, next) => {
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
  };
}

module.exports = { validate };
