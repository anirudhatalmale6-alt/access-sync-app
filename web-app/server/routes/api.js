const express = require('express');
const swaggerUi = require('swagger-ui-express');
const swaggerDoc = require('../lib/swagger');
const { apiKeyAuth } = require('../middleware/auth');
const tablesRouter = require('./tables');
const syncRouter = require('./sync');
const settingsRouter = require('./settings');
const endpointsRouter = require('./endpoints');

const router = express.Router();

// Swagger docs
router.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDoc, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Access Sync API Docs'
}));

// API key auth middleware
router.use(apiKeyAuth);

// Route modules
router.use('/tables', tablesRouter);
router.use('/sync', syncRouter);
router.use('/settings', settingsRouter);
router.use('/endpoints', endpointsRouter);

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;
