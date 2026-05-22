const express = require('express');
const db = require('../lib/db');

const router = express.Router();

// Validate table name to prevent SQL injection (only allow alphanumeric + underscore)
function isValidTableName(name) {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

// Escape identifier for safe use in SQL
function escapeId(name) {
  return '"' + name.replace(/"/g, '""') + '"';
}

// GET /api/tables - List all tables with row and column counts
router.get('/', async (req, res) => {
  try {
    // Get all user tables from information_schema
    const tablesResult = await db.query(`
      SELECT
        t.table_name,
        (SELECT count(*) FROM information_schema.columns c
         WHERE c.table_name = t.table_name AND c.table_schema = 'public') as column_count
      FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_name
    `);

    // Get row counts using pg_stat_user_tables (approximate but fast)
    const countsResult = await db.query(`
      SELECT relname as table_name, n_live_tup as row_count
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
    `);

    const countsMap = {};
    for (const row of countsResult.rows) {
      countsMap[row.table_name] = parseInt(row.row_count) || 0;
    }

    const tables = tablesResult.rows.map(t => ({
      name: t.table_name,
      row_count: countsMap[t.table_name] || 0,
      column_count: parseInt(t.column_count) || 0
    }));

    res.json({ tables, total: tables.length });
  } catch (err) {
    console.error('Error listing tables:', err.message);
    res.status(500).json({ error: 'Failed to list tables', message: err.message });
  }
});

// GET /api/tables/:name - Get paginated data from a table
router.get('/:name', async (req, res) => {
  const { name } = req.params;
  if (!isValidTableName(name)) {
    return res.status(400).json({ error: 'Invalid table name' });
  }

  try {
    // Check table exists
    const exists = await db.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
      [name]
    );
    if (exists.rows.length === 0) {
      return res.status(404).json({ error: 'Table not found' });
    }

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const sort = req.query.sort;
    const order = (req.query.order || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    const search = req.query.search || '';
    let filters = {};
    try {
      if (req.query.filters) filters = JSON.parse(req.query.filters);
    } catch (e) { /* ignore bad JSON */ }

    // Get columns for building queries
    const colsResult = await db.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
      [name]
    );
    const columns = colsResult.rows;
    const colNames = columns.map(c => c.column_name);

    // Build WHERE clause
    const whereClauses = [];
    const params = [];
    let paramIdx = 1;

    // Global search across all text-like columns
    if (search) {
      const textCols = columns.filter(c =>
        ['character varying', 'text', 'character', 'varchar', 'char', 'name'].includes(c.data_type)
      );
      if (textCols.length > 0) {
        const searchClauses = textCols.map(c => `${escapeId(c.column_name)}::text ILIKE $${paramIdx}`);
        whereClauses.push('(' + searchClauses.join(' OR ') + ')');
        params.push(`%${search}%`);
        paramIdx++;
      }
    }

    // Column filters
    for (const [col, value] of Object.entries(filters)) {
      if (colNames.includes(col) && value !== '' && value !== null && value !== undefined) {
        whereClauses.push(`${escapeId(col)}::text ILIKE $${paramIdx}`);
        params.push(`%${value}%`);
        paramIdx++;
      }
    }

    const whereSQL = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

    // Sort clause
    let orderSQL = '';
    if (sort && colNames.includes(sort)) {
      orderSQL = `ORDER BY ${escapeId(sort)} ${order} NULLS LAST`;
    }

    // Count query
    const countResult = await db.query(
      `SELECT count(*) as total FROM ${escapeId(name)} ${whereSQL}`,
      params
    );
    const total = parseInt(countResult.rows[0].total);

    // Data query
    const dataResult = await db.query(
      `SELECT * FROM ${escapeId(name)} ${whereSQL} ${orderSQL} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    );

    res.json({
      table: name,
      columns: colNames,
      rows: dataResult.rows,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error(`Error querying table ${name}:`, err.message);
    res.status(500).json({ error: 'Failed to query table', message: err.message });
  }
});

// GET /api/tables/:name/schema - Get column schema
router.get('/:name/schema', async (req, res) => {
  const { name } = req.params;
  if (!isValidTableName(name)) {
    return res.status(400).json({ error: 'Invalid table name' });
  }

  try {
    const result = await db.query(
      `SELECT column_name, data_type, is_nullable, character_maximum_length,
              column_default, ordinal_position
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1
       ORDER BY ordinal_position`,
      [name]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Table not found or has no columns' });
    }

    const columns = result.rows.map(c => ({
      name: c.column_name,
      type: c.data_type,
      nullable: c.is_nullable === 'YES',
      max_length: c.character_maximum_length,
      default_value: c.column_default,
      position: c.ordinal_position
    }));

    res.json({ table: name, columns });
  } catch (err) {
    console.error(`Error getting schema for ${name}:`, err.message);
    res.status(500).json({ error: 'Failed to get schema', message: err.message });
  }
});

// GET /api/tables/:name/export/csv - Export entire table as CSV
router.get('/:name/export/csv', async (req, res) => {
  const { name } = req.params;
  if (!isValidTableName(name)) {
    return res.status(400).json({ error: 'Invalid table name' });
  }

  try {
    const exists = await db.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
      [name]
    );
    if (exists.rows.length === 0) {
      return res.status(404).json({ error: 'Table not found' });
    }

    // Get columns
    const colsResult = await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
      [name]
    );
    const colNames = colsResult.rows.map(c => c.column_name);

    // Stream data
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);

    // Write BOM for Excel compatibility
    res.write('﻿');

    // Header row
    res.write(colNames.map(c => csvEscape(c)).join(',') + '\n');

    // Fetch in batches
    const batchSize = 1000;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const batch = await db.query(
        `SELECT * FROM ${escapeId(name)} LIMIT $1 OFFSET $2`,
        [batchSize, offset]
      );

      for (const row of batch.rows) {
        const values = colNames.map(col => csvEscape(row[col]));
        res.write(values.join(',') + '\n');
      }

      if (batch.rows.length < batchSize) {
        hasMore = false;
      }
      offset += batchSize;
    }

    res.end();
  } catch (err) {
    console.error(`Error exporting ${name}:`, err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to export table', message: err.message });
    }
  }
});

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

module.exports = router;
