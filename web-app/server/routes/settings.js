const express = require('express');
const config = require('../lib/config');
const db = require('../lib/db');

const router = express.Router();

// GET /api/settings - Get current settings
router.get('/', (req, res) => {
  try {
    const cfg = config.get();
    // Mask password for display (show last 4 chars only)
    const masked = { ...cfg };
    if (masked.pg_password && masked.pg_password.length > 4) {
      masked.pg_password_masked = '****' + masked.pg_password.slice(-4);
    } else if (masked.pg_password) {
      masked.pg_password_masked = '****';
    } else {
      masked.pg_password_masked = '';
    }
    res.json(masked);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get settings', message: err.message });
  }
});

// POST /api/settings - Update settings
router.post('/', (req, res) => {
  try {
    const updated = config.update(req.body);

    // Refresh DB pool if connection settings changed
    const dbFields = ['pg_host', 'pg_port', 'pg_database', 'pg_user', 'pg_password'];
    const hasDbChanges = dbFields.some(f => req.body[f] !== undefined);
    if (hasDbChanges) {
      db.refreshPool();
    }

    res.json({ message: 'Settings updated', settings: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update settings', message: err.message });
  }
});

// POST /api/settings/test-connection - Test PostgreSQL connection
router.post('/test-connection', async (req, res) => {
  try {
    const now = await db.testConnection();
    res.json({ success: true, message: 'Connection successful', server_time: now });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

module.exports = router;
