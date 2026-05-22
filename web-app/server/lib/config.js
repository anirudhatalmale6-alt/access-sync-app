const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'config.json');

const DEFAULTS = {
  access_db_path: 'C:\\Data\\database.accdb',
  pg_host: 'localhost',
  pg_port: 5432,
  pg_database: 'access_sync',
  pg_user: 'postgres',
  pg_password: '',
  sync_interval_minutes: 30,
  tables_to_exclude: [],
  api_key: '',
  last_sync_time: null,
  next_sync_time: null,
  sync_status: 'idle',
  sync_error_count: 0
};

let _config = null;

function load() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      _config = { ...DEFAULTS, ...JSON.parse(raw) };
    } else {
      _config = { ...DEFAULTS };
    }
  } catch (err) {
    console.error('Error reading config.json:', err.message);
    _config = { ...DEFAULTS };
  }

  // Generate API key on first run
  if (!_config.api_key) {
    _config.api_key = uuidv4();
    save();
  }

  return _config;
}

function save() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(_config, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing config.json:', err.message);
    throw err;
  }
}

function get() {
  if (!_config) load();
  return { ..._config };
}

function update(newSettings) {
  if (!_config) load();

  const allowed = [
    'access_db_path', 'pg_host', 'pg_port', 'pg_database',
    'pg_user', 'pg_password', 'sync_interval_minutes',
    'tables_to_exclude'
  ];

  for (const key of allowed) {
    if (newSettings[key] !== undefined) {
      _config[key] = newSettings[key];
    }
  }

  save();
  return get();
}

function updateSyncStatus(status) {
  if (!_config) load();
  Object.assign(_config, status);
  save();
}

module.exports = { load, get, update, save, updateSyncStatus, CONFIG_PATH };
