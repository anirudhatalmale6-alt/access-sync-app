const { Pool } = require('pg');
const config = require('./config');

let pool = null;

function getPool() {
  const cfg = config.get();
  if (pool) {
    pool.end().catch(() => {});
  }
  pool = new Pool({
    host: cfg.pg_host,
    port: cfg.pg_port,
    database: cfg.pg_database,
    user: cfg.pg_user,
    password: cfg.pg_password,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });
  pool.on('error', (err) => {
    console.error('Unexpected pool error:', err.message);
  });
  return pool;
}

function ensurePool() {
  if (!pool) {
    getPool();
  }
  return pool;
}

async function query(text, params) {
  const p = ensurePool();
  return p.query(text, params);
}

async function testConnection() {
  const p = ensurePool();
  const res = await p.query('SELECT NOW() as now');
  return res.rows[0].now;
}

function refreshPool() {
  getPool();
}

module.exports = { query, testConnection, refreshPool, ensurePool };
