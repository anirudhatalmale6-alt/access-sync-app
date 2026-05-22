const express = require('express');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('../lib/config');
const db = require('../lib/db');

const router = express.Router();

// GET /api/sync/status - Current sync status
router.get('/status', (req, res) => {
  try {
    const cfg = config.get();
    res.json({
      last_sync_time: cfg.last_sync_time,
      next_sync_time: cfg.next_sync_time,
      sync_status: cfg.sync_status || 'idle',
      sync_error_count: cfg.sync_error_count || 0,
      sync_interval_minutes: cfg.sync_interval_minutes
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get sync status', message: err.message });
  }
});

// GET /api/sync/log - Sync history log
router.get('/log', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    // Check if sync_log table exists
    const tableExists = await db.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema='public' AND table_name='sync_log'`
    );

    if (tableExists.rows.length === 0) {
      // Create sync_log table if it doesn't exist
      await db.query(`
        CREATE TABLE IF NOT EXISTS sync_log (
          id SERIAL PRIMARY KEY,
          started_at TIMESTAMP DEFAULT NOW(),
          completed_at TIMESTAMP,
          status VARCHAR(20) DEFAULT 'running',
          tables_synced INTEGER DEFAULT 0,
          rows_synced INTEGER DEFAULT 0,
          errors TEXT,
          duration_seconds NUMERIC(10,2)
        )
      `);
      return res.json({ logs: [], pagination: { page, limit, total: 0, total_pages: 0 } });
    }

    const countResult = await db.query('SELECT count(*) as total FROM sync_log');
    const total = parseInt(countResult.rows[0].total);

    const logsResult = await db.query(
      `SELECT * FROM sync_log ORDER BY started_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.json({
      logs: logsResult.rows,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error('Error getting sync log:', err.message);
    // If table doesn't exist, return empty
    if (err.message.includes('does not exist')) {
      return res.json({ logs: [], pagination: { page: 1, limit: 50, total: 0, total_pages: 0 } });
    }
    res.status(500).json({ error: 'Failed to get sync log', message: err.message });
  }
});

// POST /api/sync/trigger - Manually trigger sync
router.post('/trigger', (req, res) => {
  try {
    const cfg = config.get();

    if (cfg.sync_status === 'running') {
      return res.status(409).json({ error: 'Sync is already running' });
    }

    // Update status
    config.updateSyncStatus({ sync_status: 'running' });

    // Look for sync script
    const syncScript = path.join(__dirname, '..', '..', '..', 'sync_engine.py');
    const syncScriptAlt = path.join(__dirname, '..', '..', 'sync_engine.py');

    let scriptPath = null;
    if (fs.existsSync(syncScript)) scriptPath = syncScript;
    else if (fs.existsSync(syncScriptAlt)) scriptPath = syncScriptAlt;

    if (scriptPath) {
      // Run Python sync script
      const child = execFile('python', [scriptPath], { timeout: 600000 }, (err, stdout, stderr) => {
        if (err) {
          console.error('Sync error:', err.message);
          config.updateSyncStatus({
            sync_status: 'error',
            sync_error_count: (cfg.sync_error_count || 0) + 1,
            last_sync_time: new Date().toISOString()
          });
        } else {
          const nextSync = new Date(Date.now() + cfg.sync_interval_minutes * 60000).toISOString();
          config.updateSyncStatus({
            sync_status: 'idle',
            last_sync_time: new Date().toISOString(),
            next_sync_time: nextSync,
            sync_error_count: 0
          });
        }
      });

      res.json({
        message: 'Sync triggered successfully',
        status: 'running',
        pid: child.pid
      });
    } else {
      // No sync script found - simulate for demo
      config.updateSyncStatus({
        sync_status: 'idle',
        last_sync_time: new Date().toISOString(),
        next_sync_time: new Date(Date.now() + cfg.sync_interval_minutes * 60000).toISOString()
      });

      res.json({
        message: 'Sync status updated (sync engine script not found)',
        hint: 'Place sync_engine.py in the access-sync-app directory'
      });
    }
  } catch (err) {
    config.updateSyncStatus({ sync_status: 'error' });
    res.status(500).json({ error: 'Failed to trigger sync', message: err.message });
  }
});

module.exports = router;
