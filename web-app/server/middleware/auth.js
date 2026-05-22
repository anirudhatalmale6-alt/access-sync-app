const config = require('../lib/config');

/**
 * API key authentication middleware.
 * Checks X-API-Key header against stored api_key.
 * Skips auth for browser requests (no X-API-Key header and has Accept: text/html).
 * Allows docs endpoint without auth.
 */
function apiKeyAuth(req, res, next) {
  // Always allow Swagger docs
  if (req.path === '/docs' || req.path.startsWith('/docs/')) {
    return next();
  }

  const apiKey = req.headers['x-api-key'];

  // If no API key header present, allow (browser/internal use)
  // External consumers must provide the key
  if (!apiKey) {
    return next();
  }

  const cfg = config.get();
  if (apiKey !== cfg.api_key) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  next();
}

/**
 * Strict API key auth - requires key for all requests.
 * Use this for endpoints that must be protected.
 */
function requireApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  const cfg = config.get();

  if (!apiKey || apiKey !== cfg.api_key) {
    return res.status(401).json({ error: 'API key required. Provide X-API-Key header.' });
  }

  next();
}

module.exports = { apiKeyAuth, requireApiKey };
