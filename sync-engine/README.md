# Access to PostgreSQL Sync Engine

Production-quality Python sync engine that reads a Microsoft Access (.accdb) database via ODBC and synchronizes all tables to PostgreSQL. Designed for Windows Server 2022 deployment.

## Features

- Syncs all tables (or a filtered subset) from Access to PostgreSQL
- Full sync mode: drop/truncate + recreate tables with fresh data
- Incremental sync mode: upsert (INSERT ON CONFLICT UPDATE) using primary keys
- Preserves original table and column names exactly
- Correct Access-to-PostgreSQL data type mapping
- Batched inserts (configurable batch size) for memory-efficient handling of large tables
- Connection pooling for PostgreSQL
- Comprehensive logging to both console and rotating log files
- Sync status tracking in a `sync_log` PostgreSQL table
- Configurable via `config.json`
- Runs as a one-shot command, continuous daemon, or Windows service
- Graceful shutdown on SIGINT/SIGTERM

## Prerequisites

### 1. Python 3.10+

Download from https://www.python.org/downloads/ and install. Ensure "Add Python to PATH" is checked during installation.

### 2. Microsoft Access Database Engine (ODBC Driver)

The sync engine connects to Access via ODBC. Install the appropriate driver:

- **If Microsoft Office (32-bit) is installed:** Install the 32-bit Access Database Engine
- **If Microsoft Office (64-bit) is installed or no Office:** Install the 64-bit Access Database Engine

Download: https://www.microsoft.com/en-us/download/details.aspx?id=54920

> **Important:** The Python architecture (32-bit or 64-bit) must match the Access Database Engine architecture. Use `python -c "import struct; print(struct.calcsize('P')*8)"` to check.

### 3. PostgreSQL Server

Ensure PostgreSQL is accessible from the Windows server. Create the target database and user:

```sql
CREATE DATABASE erp_sync;
CREATE USER sync_user WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE erp_sync TO sync_user;

-- After connecting to erp_sync:
GRANT ALL ON SCHEMA public TO sync_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO sync_user;
```

## Installation

```powershell
# Clone or copy the sync-engine folder to your server
cd C:\sync-engine

# Create a virtual environment
python -m venv venv
.\venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

## Configuration

Edit `config.json` with your settings:

```json
{
    "access": {
        "connection_string": "DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};DBQ=C:\\ERP\\Datos\\CAM2026.accdb;",
        "db_path": "C:\\ERP\\Datos\\CAM2026.accdb"
    },
    "postgresql": {
        "host": "localhost",
        "port": 5432,
        "database": "erp_sync",
        "user": "sync_user",
        "password": "your_secure_password",
        "schema": "public",
        "pool_min_connections": 2,
        "pool_max_connections": 10
    },
    "sync": {
        "mode": "full",
        "interval_minutes": 60,
        "batch_size": 5000,
        "max_retries": 3,
        "retry_delay_seconds": 10,
        "tables_to_exclude": [],
        "tables_to_include": [],
        "parallel_tables": 4,
        "truncate_on_full_sync": true
    },
    "logging": {
        "level": "INFO",
        "file": "logs/sync.log",
        "max_bytes": 10485760,
        "backup_count": 5,
        "console_output": true
    },
    "service": {
        "name": "AccessPgSync",
        "display_name": "Access to PostgreSQL Sync Service",
        "description": "Synchronizes Microsoft Access database tables to PostgreSQL"
    }
}
```

### Configuration Reference

| Section | Key | Description | Default |
|---------|-----|-------------|---------|
| `access` | `db_path` | Path to the .accdb file | Required |
| `access` | `connection_string` | Full ODBC connection string (overrides db_path) | Auto-generated |
| `postgresql` | `host` | PostgreSQL server hostname | `localhost` |
| `postgresql` | `port` | PostgreSQL server port | `5432` |
| `postgresql` | `database` | Target database name | `erp_sync` |
| `postgresql` | `user` | PostgreSQL username | `sync_user` |
| `postgresql` | `password` | PostgreSQL password | Required |
| `postgresql` | `schema` | Target schema | `public` |
| `postgresql` | `pool_min_connections` | Minimum pool connections | `2` |
| `postgresql` | `pool_max_connections` | Maximum pool connections | `10` |
| `sync` | `mode` | `full` (drop+recreate) or `incremental` (upsert) | `full` |
| `sync` | `interval_minutes` | Minutes between syncs in daemon mode | `60` |
| `sync` | `batch_size` | Rows per INSERT batch | `5000` |
| `sync` | `max_retries` | Retry count on failure | `3` |
| `sync` | `tables_to_exclude` | Tables to skip (array of names) | `[]` |
| `sync` | `tables_to_include` | Only sync these tables (empty = all) | `[]` |
| `sync` | `truncate_on_full_sync` | Truncate instead of drop+recreate | `true` |
| `logging` | `level` | Log level: DEBUG, INFO, WARNING, ERROR | `INFO` |
| `logging` | `file` | Log file path (relative to script) | `logs/sync.log` |

## Usage

### One-time Full Sync

```powershell
python sync_engine.py
```

### One-time Incremental Sync

```powershell
python sync_engine.py --mode incremental
```

### Sync Specific Tables

```powershell
python sync_engine.py --tables F_ART,F_FAC,F_LAL
```

### List All Access Tables

```powershell
python sync_engine.py --list-tables
```

### Continuous Daemon Mode

Runs syncs on the configured interval (e.g., every 60 minutes):

```powershell
python sync_engine.py --daemon
```

### Custom Config Path

```powershell
python sync_engine.py --config C:\configs\production.json
```

## Running as a Windows Service

The engine can run as a native Windows service using pywin32.

### Install the Service

```powershell
# Run PowerShell as Administrator
cd C:\sync-engine
.\venv\Scripts\activate
python sync_engine.py install
```

### Start / Stop / Remove

```powershell
python sync_engine.py start
python sync_engine.py stop
python sync_engine.py remove
```

You can also manage it from the Windows Services console (`services.msc`).

### Service Tips

- The service looks for `config.json` in the same directory as `sync_engine.py`
- Logs are written to the path specified in `config.json` (default: `logs/sync.log`)
- The service runs the daemon mode internally (continuous sync on schedule)
- Set the service to "Automatic" startup type if you want it to start on boot

## Running as a Scheduled Task (Alternative)

If you prefer Windows Task Scheduler over a service:

1. Open Task Scheduler (`taskschd.msc`)
2. Create a new task:
   - **General tab:** Name it "Access PG Sync", check "Run whether user is logged on or not"
   - **Triggers tab:** Set your schedule (e.g., every 1 hour, repeat indefinitely)
   - **Actions tab:**
     - Program: `C:\sync-engine\venv\Scripts\python.exe`
     - Arguments: `sync_engine.py`
     - Start in: `C:\sync-engine`
   - **Settings tab:** Check "Allow task to be run on demand", uncheck "Stop the task if it runs longer than"

## Data Type Mapping

| Access Type | PostgreSQL Type |
|-------------|----------------|
| Text(n) | VARCHAR(n) |
| Memo / Hyperlink | TEXT |
| Byte | SMALLINT |
| Integer / Short | SMALLINT |
| Long Integer | BIGINT |
| AutoNumber / Counter | BIGINT |
| Single / Float | REAL |
| Double | DOUBLE PRECISION |
| Currency | NUMERIC(19,4) |
| DateTime | TIMESTAMP |
| Yes/No (Boolean) | BOOLEAN |
| OLE Object / Binary | BYTEA |
| GUID | UUID |

## Sync Log

Every sync run is recorded in the `sync_log` PostgreSQL table:

```sql
SELECT * FROM sync_log ORDER BY started_at DESC LIMIT 20;
```

Columns:
- `id` - Auto-increment primary key
- `sync_run_id` - Groups all tables from the same run (format: YYYYMMDD_HHMMSS)
- `started_at` - When this table sync started
- `finished_at` - When it completed
- `sync_mode` - "full" or "incremental"
- `table_name` - The Access table name (NULL for run-level record)
- `rows_synced` - Number of rows transferred
- `status` - "running", "success", "failed", "partial", "skipped"
- `error_message` - Error details if failed
- `duration_secs` - Time taken in seconds

### Useful Queries

```sql
-- Last sync summary
SELECT sync_run_id, sync_mode, MIN(started_at) AS started,
       MAX(finished_at) AS finished, SUM(rows_synced) AS total_rows,
       COUNT(*) FILTER (WHERE status = 'success') AS ok,
       COUNT(*) FILTER (WHERE status = 'failed') AS failed
FROM sync_log
WHERE sync_run_id = (SELECT MAX(sync_run_id) FROM sync_log)
GROUP BY sync_run_id, sync_mode;

-- Tables that failed in the last 24 hours
SELECT table_name, error_message, started_at
FROM sync_log
WHERE status = 'failed' AND started_at > NOW() - INTERVAL '24 hours'
ORDER BY started_at DESC;

-- Average sync duration per table
SELECT table_name, ROUND(AVG(duration_secs)::numeric, 1) AS avg_secs,
       ROUND(AVG(rows_synced)::numeric, 0) AS avg_rows
FROM sync_log
WHERE status = 'success' AND table_name IS NOT NULL
GROUP BY table_name
ORDER BY avg_secs DESC;
```

## Troubleshooting

### "Driver not found" error

Ensure the Microsoft Access Database Engine ODBC driver is installed and matches your Python architecture (32-bit or 64-bit).

```python
import pyodbc
print(pyodbc.drivers())
# Should include: 'Microsoft Access Driver (*.mdb, *.accdb)'
```

### Connection timeout to PostgreSQL

- Verify the PostgreSQL server is running and accessible from the Windows server
- Check firewall rules (port 5432 by default)
- Test with: `psql -h <host> -U <user> -d <database>`

### Large table sync is slow

- Increase `batch_size` to 10000 or 20000
- Ensure PostgreSQL has adequate `shared_buffers` and `work_mem`
- Consider running full sync during off-hours

### Service won't start

- Check the Windows Event Viewer (Application log) for errors
- Verify `config.json` is in the same directory as `sync_engine.py`
- Ensure the service account has read access to the Access file and network access to PostgreSQL

## License

Proprietary. Built for Brindes Perfeitos ERP synchronization.
