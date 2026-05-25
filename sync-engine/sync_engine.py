"""
Access to PostgreSQL Sync Engine
================================
Production-quality sync engine that reads a Microsoft Access (.accdb) database
and synchronizes all tables to PostgreSQL. Designed for Windows Server 2022.

Usage:
    python sync_engine.py                   # Run once using config.json
    python sync_engine.py --config path     # Run once with custom config
    python sync_engine.py --daemon          # Run continuously on schedule
    python sync_engine.py --mode full       # Force full sync (drop + recreate)
    python sync_engine.py --mode incremental # Incremental sync (upsert)
    python sync_engine.py --tables T1,T2    # Sync specific tables only
    python sync_engine.py --list-tables     # List all Access tables and exit
"""

import argparse
import datetime
import json
import logging
import logging.handlers
import os
import signal
import sys
import time
import traceback
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import pyodbc

# Must be set before importing psycopg2 so libpq negotiates UTF-8 during handshake
os.environ['PGCLIENTENCODING'] = 'UTF8'

import psycopg2
import psycopg2.extras
import psycopg2.pool


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

@dataclass
class Config:
    """Parsed configuration from config.json."""

    # Access
    access_connection_string: str = ""
    access_db_path: str = ""

    # PostgreSQL
    pg_host: str = "localhost"
    pg_port: int = 5432
    pg_database: str = "erp_sync"
    pg_user: str = "sync_user"
    pg_password: str = ""
    pg_schema: str = "public"
    pg_pool_min: int = 2
    pg_pool_max: int = 10

    # Sync
    sync_mode: str = "full"
    sync_interval_minutes: int = 60
    batch_size: int = 5000
    max_retries: int = 3
    retry_delay_seconds: int = 10
    tables_to_exclude: List[str] = field(default_factory=list)
    tables_to_include: List[str] = field(default_factory=list)
    parallel_tables: int = 4
    truncate_on_full_sync: bool = True

    # Logging
    log_level: str = "INFO"
    log_file: str = "logs/sync.log"
    log_max_bytes: int = 10 * 1024 * 1024
    log_backup_count: int = 5
    log_console: bool = True

    # Service
    service_name: str = "AccessPgSync"
    service_display_name: str = "Access to PostgreSQL Sync Service"
    service_description: str = "Synchronizes Microsoft Access database tables to PostgreSQL"

    @classmethod
    def from_file(cls, path: str) -> "Config":
        """Load configuration from a JSON file."""
        raw = open(path, "rb").read()
        # Strip UTF-8 BOM if present
        if raw.startswith(b"\xef\xbb\xbf"):
            raw = raw[3:]
        for enc in ("utf-8", "utf-8-sig", "latin-1", "cp1252"):
            try:
                text = raw.decode(enc)
                break
            except (UnicodeDecodeError, LookupError):
                continue
        else:
            text = raw.decode("utf-8", errors="replace")
        data = json.loads(text)

        cfg = cls()

        # Access section
        access = data.get("access", {})
        cfg.access_db_path = access.get("db_path", cfg.access_db_path)
        cfg.access_connection_string = access.get(
            "connection_string",
            f"DRIVER={{Microsoft Access Driver (*.mdb, *.accdb)}};DBQ={cfg.access_db_path};",
        )

        # PostgreSQL section
        pg = data.get("postgresql", {})
        cfg.pg_host = pg.get("host", cfg.pg_host)
        cfg.pg_port = pg.get("port", cfg.pg_port)
        cfg.pg_database = pg.get("database", cfg.pg_database)
        cfg.pg_user = pg.get("user", cfg.pg_user)
        cfg.pg_password = pg.get("password", cfg.pg_password)
        cfg.pg_schema = pg.get("schema", cfg.pg_schema)
        cfg.pg_pool_min = pg.get("pool_min_connections", cfg.pg_pool_min)
        cfg.pg_pool_max = pg.get("pool_max_connections", cfg.pg_pool_max)

        # Sync section
        sync = data.get("sync", {})
        cfg.sync_mode = sync.get("mode", cfg.sync_mode)
        cfg.sync_interval_minutes = sync.get("interval_minutes", cfg.sync_interval_minutes)
        cfg.batch_size = sync.get("batch_size", cfg.batch_size)
        cfg.max_retries = sync.get("max_retries", cfg.max_retries)
        cfg.retry_delay_seconds = sync.get("retry_delay_seconds", cfg.retry_delay_seconds)
        cfg.tables_to_exclude = [t.upper() for t in sync.get("tables_to_exclude", [])]
        cfg.tables_to_include = [t.upper() for t in sync.get("tables_to_include", [])]
        cfg.parallel_tables = sync.get("parallel_tables", cfg.parallel_tables)
        cfg.truncate_on_full_sync = sync.get("truncate_on_full_sync", cfg.truncate_on_full_sync)

        # Logging section
        log = data.get("logging", {})
        cfg.log_level = log.get("level", cfg.log_level)
        cfg.log_file = log.get("file", cfg.log_file)
        cfg.log_max_bytes = log.get("max_bytes", cfg.log_max_bytes)
        cfg.log_backup_count = log.get("backup_count", cfg.log_backup_count)
        cfg.log_console = log.get("console_output", cfg.log_console)

        # Service section
        svc = data.get("service", {})
        cfg.service_name = svc.get("name", cfg.service_name)
        cfg.service_display_name = svc.get("display_name", cfg.service_display_name)
        cfg.service_description = svc.get("description", cfg.service_description)

        cfg._sanitize_strings()
        return cfg

    def _sanitize_strings(self) -> None:
        """Ensure all string fields are valid UTF-8."""
        for attr in vars(self):
            val = getattr(self, attr)
            if isinstance(val, str):
                try:
                    val.encode("utf-8")
                except UnicodeEncodeError:
                    setattr(self, attr, val.encode("utf-8", errors="replace").decode("utf-8"))

    @property
    def pg_dsn(self) -> str:
        return (
            f"host={self.pg_host} port={self.pg_port} dbname={self.pg_database} "
            f"user={self.pg_user} password={self.pg_password}"
        )


# ---------------------------------------------------------------------------
# Logging setup
# ---------------------------------------------------------------------------

def setup_logging(cfg: Config) -> logging.Logger:
    """Configure logging to both file and console."""
    logger = logging.getLogger("access_pg_sync")
    logger.setLevel(getattr(logging, cfg.log_level.upper(), logging.INFO))
    logger.handlers.clear()

    formatter = logging.Formatter(
        "%(asctime)s [%(levelname)-8s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # File handler with rotation
    log_dir = os.path.dirname(cfg.log_file)
    if log_dir:
        os.makedirs(log_dir, exist_ok=True)
    file_handler = logging.handlers.RotatingFileHandler(
        cfg.log_file,
        maxBytes=cfg.log_max_bytes,
        backupCount=cfg.log_backup_count,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    # Console handler (use UTF-8 on Windows to avoid encoding errors)
    if cfg.log_console:
        if sys.platform == "win32":
            try:
                sys.stdout.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setFormatter(formatter)
        logger.addHandler(console_handler)

    return logger


# ---------------------------------------------------------------------------
# Data type mapping: Access -> PostgreSQL
# ---------------------------------------------------------------------------

# Maps Access type names (from pyodbc cursor.columns() type_name field)
# to PostgreSQL column definitions.
ACCESS_TO_PG_TYPE = {
    # Text types
    "VARCHAR": lambda size: f"VARCHAR({size})" if size and size <= 10485760 else "TEXT",
    "CHAR": lambda size: f"VARCHAR({size})" if size else "TEXT",
    "TEXT": lambda size: "TEXT",
    "LONGCHAR": lambda size: "TEXT",
    "MEMO": lambda size: "TEXT",

    # Numeric types
    "BYTE": lambda size: "SMALLINT",
    "SMALLINT": lambda size: "SMALLINT",
    "INTEGER": lambda size: "INTEGER",
    "SHORT": lambda size: "SMALLINT",
    "LONG": lambda size: "BIGINT",
    "COUNTER": lambda size: "BIGINT",
    "AUTOINCREMENT": lambda size: "BIGINT",
    "SINGLE": lambda size: "REAL",
    "FLOAT": lambda size: "REAL",
    "DOUBLE": lambda size: "DOUBLE PRECISION",
    "REAL": lambda size: "DOUBLE PRECISION",
    "CURRENCY": lambda size: "NUMERIC(19,4)",
    "DECIMAL": lambda size: "NUMERIC(19,4)",
    "NUMERIC": lambda size: "NUMERIC(19,4)",

    # Date/time types
    "DATETIME": lambda size: "TIMESTAMP",
    "DATE": lambda size: "TIMESTAMP",
    "TIME": lambda size: "TIME",

    # Boolean
    "BIT": lambda size: "BOOLEAN",
    "YESNO": lambda size: "BOOLEAN",
    "BOOLEAN": lambda size: "BOOLEAN",

    # Binary types
    "BINARY": lambda size: "BYTEA",
    "VARBINARY": lambda size: "BYTEA",
    "LONGBINARY": lambda size: "BYTEA",
    "IMAGE": lambda size: "BYTEA",
    "OLE": lambda size: "BYTEA",
    "OLEOBJECT": lambda size: "BYTEA",
    "GENERAL": lambda size: "BYTEA",

    # GUID
    "GUID": lambda size: "UUID",
    "UNIQUEIDENTIFIER": lambda size: "UUID",
}


def map_access_type_to_pg(type_name: str, column_size: Optional[int]) -> str:
    """Convert an Access column type to PostgreSQL type.

    Falls back to TEXT if the type is not recognized.
    """
    key = type_name.upper().strip()

    # Direct match
    if key in ACCESS_TO_PG_TYPE:
        return ACCESS_TO_PG_TYPE[key](column_size)

    # Partial match (e.g. "Long Integer" -> "LONG")
    for access_key in ACCESS_TO_PG_TYPE:
        if access_key in key:
            return ACCESS_TO_PG_TYPE[access_key](column_size)

    # Check for common patterns
    if "INT" in key:
        if "LONG" in key or "BIG" in key:
            return "BIGINT"
        if "SMALL" in key or "SHORT" in key:
            return "SMALLINT"
        return "INTEGER"
    if "CHAR" in key or "TEXT" in key or "MEMO" in key or "HYPERLINK" in key:
        if column_size and column_size <= 10485760:
            return f"VARCHAR({column_size})"
        return "TEXT"
    if "FLOAT" in key or "SINGLE" in key:
        return "REAL"
    if "DOUBLE" in key or "REAL" in key:
        return "DOUBLE PRECISION"
    if "CURR" in key or "MONEY" in key:
        return "NUMERIC(19,4)"
    if "DATE" in key or "TIME" in key:
        return "TIMESTAMP"
    if "BOOL" in key or "BIT" in key or "YES" in key:
        return "BOOLEAN"
    if "BIN" in key or "OLE" in key or "IMAGE" in key:
        return "BYTEA"
    if "GUID" in key:
        return "UUID"

    # Ultimate fallback
    return "TEXT"


# ---------------------------------------------------------------------------
# PostgreSQL value conversion
# ---------------------------------------------------------------------------

def convert_value(value: Any, pg_type: str) -> Any:
    """Convert a Python value from Access to a PostgreSQL-compatible value."""
    if value is None:
        return None

    pg_upper = pg_type.upper()

    if "BOOLEAN" in pg_upper:
        if isinstance(value, (int, float)):
            return bool(value)
        if isinstance(value, str):
            return value.lower() in ("true", "1", "yes", "-1")
        return bool(value)

    if "BYTEA" in pg_upper:
        if isinstance(value, (bytes, bytearray, memoryview)):
            return psycopg2.Binary(bytes(value))
        return None

    if "TIMESTAMP" in pg_upper or "DATE" in pg_upper or "TIME" in pg_upper:
        if isinstance(value, str):
            try:
                return datetime.datetime.fromisoformat(value)
            except ValueError:
                return value
        return value

    if "NUMERIC" in pg_upper or "DECIMAL" in pg_upper:
        if isinstance(value, str):
            try:
                from decimal import Decimal
                return Decimal(value)
            except Exception:
                return value
        return value

    if isinstance(value, bytes):
        try:
            return value.decode("utf-8")
        except UnicodeDecodeError:
            return value.decode("latin-1", errors="replace")

    if isinstance(value, str):
        try:
            value.encode("utf-8")
        except UnicodeEncodeError:
            value = value.encode("latin-1", errors="replace").decode("utf-8", errors="replace")
        return value

    return value


# ---------------------------------------------------------------------------
# Access database reader
# ---------------------------------------------------------------------------

class AccessReader:
    """Reads tables and schema from a Microsoft Access database via ODBC."""

    def __init__(self, connection_string: str, logger: logging.Logger):
        self.connection_string = connection_string
        self.logger = logger
        self._conn: Optional[pyodbc.Connection] = None

    def connect(self) -> None:
        """Open connection to Access database."""
        self.logger.info("Connecting to Access database...")
        self._conn = pyodbc.connect(self.connection_string, readonly=True)
        self._conn.setdecoding(pyodbc.SQL_CHAR, encoding="latin-1")
        self._conn.setdecoding(pyodbc.SQL_WCHAR, encoding="latin-1")
        self._conn.setencoding(encoding="latin-1")
        self.logger.info("Connected to Access database successfully.")

    def disconnect(self) -> None:
        """Close Access connection."""
        if self._conn:
            try:
                self._conn.close()
            except Exception:
                pass
            self._conn = None
            self.logger.info("Disconnected from Access database.")

    @property
    def conn(self) -> pyodbc.Connection:
        if self._conn is None:
            raise RuntimeError("Not connected to Access database. Call connect() first.")
        return self._conn

    def get_tables(self) -> List[str]:
        """Return a list of all user table names in the Access database."""
        cursor = self.conn.cursor()
        tables = []
        for row in cursor.tables(tableType="TABLE"):
            tables.append(row.table_name)
        cursor.close()
        return sorted(tables)

    def get_columns(self, table_name: str) -> List[Dict[str, Any]]:
        """Return column metadata for a table.

        Each dict contains: name, type_name, column_size, nullable, ordinal.
        """
        cursor = self.conn.cursor()
        columns = []
        for row in cursor.columns(table=table_name):
            columns.append({
                "name": row.column_name,
                "type_name": row.type_name,
                "column_size": row.column_size,
                "nullable": row.nullable,
                "ordinal": row.ordinal_position,
            })
        cursor.close()
        # Sort by ordinal position to preserve column order
        columns.sort(key=lambda c: c["ordinal"])
        return columns

    def get_primary_keys(self, table_name: str) -> List[str]:
        """Return primary key column names for a table."""
        cursor = self.conn.cursor()
        pk_cols = []
        try:
            for row in cursor.primaryKeys(table=table_name):
                pk_cols.append(row.column_name)
        except Exception:
            pass
        cursor.close()
        return pk_cols

    def count_rows(self, table_name: str) -> int:
        """Return the row count for a table."""
        cursor = self.conn.cursor()
        cursor.execute(f"SELECT COUNT(*) FROM [{table_name}]")
        count = cursor.fetchone()[0]
        cursor.close()
        return count

    def read_rows(self, table_name: str, batch_size: int = 5000):
        """Yield rows in batches from the specified table.

        Yields: (batch_number, list_of_tuples)
        """
        cursor = self.conn.cursor()
        cursor.execute(f"SELECT * FROM [{table_name}]")

        batch_num = 0
        while True:
            rows = cursor.fetchmany(batch_size)
            if not rows:
                break
            batch_num += 1
            yield batch_num, rows

        cursor.close()


# ---------------------------------------------------------------------------
# PostgreSQL writer
# ---------------------------------------------------------------------------

class PgWriter:
    """Manages PostgreSQL connections and table operations."""

    def __init__(self, cfg: Config, logger: logging.Logger):
        self.cfg = cfg
        self.logger = logger
        self._pool: Optional[psycopg2.pool.ThreadedConnectionPool] = None

    def connect(self) -> None:
        """Initialize PostgreSQL connection pool."""
        self.logger.info(
            "Connecting to PostgreSQL %s:%s/%s ...",
            self.cfg.pg_host, self.cfg.pg_port, self.cfg.pg_database,
        )
        # Use DSN string so client_encoding is negotiated during libpq handshake
        dsn = (
            f"host={self.cfg.pg_host} port={self.cfg.pg_port} "
            f"dbname={self.cfg.pg_database} user={self.cfg.pg_user} "
            f"password={self.cfg.pg_password} client_encoding=utf8"
        )
        try:
            self._pool = psycopg2.pool.ThreadedConnectionPool(
                minconn=self.cfg.pg_pool_min,
                maxconn=self.cfg.pg_pool_max,
                dsn=dsn,
            )
        except UnicodeDecodeError as ude:
            self.logger.warning(
                "UTF-8 encoding issue during PostgreSQL connection: %s. "
                "Retrying with LATIN1 client encoding...", ude,
            )
            dsn_latin = (
                f"host={self.cfg.pg_host} port={self.cfg.pg_port} "
                f"dbname={self.cfg.pg_database} user={self.cfg.pg_user} "
                f"password={self.cfg.pg_password} client_encoding=latin1"
            )
            self._pool = psycopg2.pool.ThreadedConnectionPool(
                minconn=self.cfg.pg_pool_min,
                maxconn=self.cfg.pg_pool_max,
                dsn=dsn_latin,
            )
        self.logger.info("PostgreSQL connection pool created (%d-%d connections).",
                         self.cfg.pg_pool_min, self.cfg.pg_pool_max)

    def disconnect(self) -> None:
        """Close all PostgreSQL connections."""
        if self._pool:
            self._pool.closeall()
            self._pool = None
            self.logger.info("PostgreSQL connection pool closed.")

    @contextmanager
    def get_conn(self):
        """Context manager that checks out a connection from the pool.

        Automatically rolls back failed transactions and resets the connection
        before returning it to the pool.
        """
        conn = self._pool.getconn()
        try:
            yield conn
        except Exception:
            # Roll back any failed transaction so the connection is reusable
            try:
                conn.rollback()
            except Exception:
                pass
            raise
        finally:
            self._pool.putconn(conn)

    def ensure_sync_log_table(self) -> None:
        """Create the sync_log table if it doesn't exist."""
        with self.get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS sync_log (
                        id              SERIAL PRIMARY KEY,
                        sync_run_id     VARCHAR(64) NOT NULL,
                        started_at      TIMESTAMP NOT NULL,
                        finished_at     TIMESTAMP,
                        sync_mode       VARCHAR(20) NOT NULL,
                        table_name      VARCHAR(255),
                        rows_synced     BIGINT DEFAULT 0,
                        status          VARCHAR(20) NOT NULL DEFAULT 'running',
                        error_message   TEXT,
                        duration_secs   DOUBLE PRECISION
                    );
                    CREATE INDEX IF NOT EXISTS idx_sync_log_run ON sync_log(sync_run_id);
                    CREATE INDEX IF NOT EXISTS idx_sync_log_table ON sync_log(table_name);
                    CREATE INDEX IF NOT EXISTS idx_sync_log_started ON sync_log(started_at);
                """)
            conn.commit()
        self.logger.info("sync_log table verified.")

    def table_exists(self, table_name: str) -> bool:
        """Check if a table exists in PostgreSQL."""
        with self.get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT EXISTS (
                        SELECT 1 FROM information_schema.tables
                        WHERE table_schema = %s AND table_name = %s
                    )
                """, (self.cfg.pg_schema, table_name))
                return cur.fetchone()[0]

    def get_column_count(self, table_name: str) -> int:
        """Return the number of columns in a PostgreSQL table."""
        with self.get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT COUNT(*) FROM information_schema.columns
                    WHERE table_schema = %s AND table_name = %s
                """, (self.cfg.pg_schema, table_name))
                return cur.fetchone()[0]

    def drop_table(self, table_name: str) -> None:
        """Drop a table if it exists."""
        quoted = self._quote_ident(table_name)
        with self.get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(f"DROP TABLE IF EXISTS {quoted} CASCADE")
            conn.commit()

    def truncate_table(self, table_name: str) -> None:
        """Truncate a table."""
        quoted = self._quote_ident(table_name)
        with self.get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(f"TRUNCATE TABLE {quoted}")
            conn.commit()

    def create_table(
        self,
        table_name: str,
        columns: List[Dict[str, Any]],
        primary_keys: List[str],
    ) -> None:
        """Create a PostgreSQL table matching the Access schema."""
        quoted_table = self._quote_ident(table_name)
        col_defs = []

        for col in columns:
            col_name = self._quote_ident(col["name"])
            pg_type = map_access_type_to_pg(col["type_name"], col["column_size"])
            nullable = "" if col.get("nullable", 1) else " NOT NULL"
            col_defs.append(f"    {col_name} {pg_type}{nullable}")

        # Add primary key constraint if available
        if primary_keys:
            pk_cols = ", ".join(self._quote_ident(pk) for pk in primary_keys)
            col_defs.append(f"    PRIMARY KEY ({pk_cols})")

        ddl = f"CREATE TABLE {quoted_table} (\n" + ",\n".join(col_defs) + "\n)"

        with self.get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(ddl)
            conn.commit()

    def insert_batch(
        self,
        table_name: str,
        columns: List[Dict[str, Any]],
        rows: list,
    ) -> int:
        """Insert a batch of rows into PostgreSQL. Returns rows inserted."""
        if not rows:
            return 0

        quoted_table = self._quote_ident(table_name)
        col_names = ", ".join(self._quote_ident(c["name"]) for c in columns)
        pg_types = [map_access_type_to_pg(c["type_name"], c["column_size"]) for c in columns]
        placeholders = ", ".join(["%s"] * len(columns))

        sql = f"INSERT INTO {quoted_table} ({col_names}) VALUES ({placeholders})"

        # Convert values
        converted_rows = []
        for row in rows:
            converted = []
            for i, val in enumerate(row):
                converted.append(convert_value(val, pg_types[i]))
            converted_rows.append(tuple(converted))

        with self.get_conn() as conn:
            with conn.cursor() as cur:
                psycopg2.extras.execute_batch(cur, sql, converted_rows, page_size=1000)
            conn.commit()

        return len(converted_rows)

    def upsert_batch(
        self,
        table_name: str,
        columns: List[Dict[str, Any]],
        primary_keys: List[str],
        rows: list,
    ) -> int:
        """Upsert (INSERT ... ON CONFLICT UPDATE) a batch of rows. Returns rows processed."""
        if not rows or not primary_keys:
            # Fall back to truncate + insert if no PK
            return self.insert_batch(table_name, columns, rows)

        quoted_table = self._quote_ident(table_name)
        col_names_list = [self._quote_ident(c["name"]) for c in columns]
        col_names = ", ".join(col_names_list)
        pg_types = [map_access_type_to_pg(c["type_name"], c["column_size"]) for c in columns]
        placeholders = ", ".join(["%s"] * len(columns))

        pk_cols = ", ".join(self._quote_ident(pk) for pk in primary_keys)
        update_cols = [
            f"{cn} = EXCLUDED.{cn}"
            for cn, col in zip(col_names_list, columns)
            if col["name"] not in primary_keys
        ]

        if update_cols:
            update_clause = ", ".join(update_cols)
            sql = (
                f"INSERT INTO {quoted_table} ({col_names}) VALUES ({placeholders}) "
                f"ON CONFLICT ({pk_cols}) DO UPDATE SET {update_clause}"
            )
        else:
            sql = (
                f"INSERT INTO {quoted_table} ({col_names}) VALUES ({placeholders}) "
                f"ON CONFLICT ({pk_cols}) DO NOTHING"
            )

        converted_rows = []
        for row in rows:
            converted = []
            for i, val in enumerate(row):
                converted.append(convert_value(val, pg_types[i]))
            converted_rows.append(tuple(converted))

        with self.get_conn() as conn:
            with conn.cursor() as cur:
                psycopg2.extras.execute_batch(cur, sql, converted_rows, page_size=1000)
            conn.commit()

        return len(converted_rows)

    def log_sync_start(self, sync_run_id: str, sync_mode: str, table_name: Optional[str] = None) -> int:
        """Insert a sync_log record for a table sync start. Returns the log ID."""
        with self.get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO sync_log (sync_run_id, started_at, sync_mode, table_name, status)
                    VALUES (%s, %s, %s, %s, 'running')
                    RETURNING id
                """, (sync_run_id, datetime.datetime.now(), sync_mode, table_name))
                log_id = cur.fetchone()[0]
            conn.commit()
        return log_id

    def log_sync_finish(
        self, log_id: int, rows: int, status: str, error: Optional[str] = None
    ) -> None:
        """Update a sync_log record when a table sync completes."""
        now = datetime.datetime.now()
        with self.get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE sync_log
                    SET finished_at = %s,
                        rows_synced = %s,
                        status = %s,
                        error_message = %s,
                        duration_secs = EXTRACT(EPOCH FROM (%s::timestamp - started_at))
                    WHERE id = %s
                """, (now, rows, status, error, now, log_id))
            conn.commit()

    @staticmethod
    def _quote_ident(name: str) -> str:
        """Quote a PostgreSQL identifier. Escapes double quotes inside the name."""
        safe = name.replace('"', '""')
        return f'"{safe}"'


# ---------------------------------------------------------------------------
# Sync orchestrator
# ---------------------------------------------------------------------------

class SyncEngine:
    """Orchestrates the Access -> PostgreSQL synchronization."""

    def __init__(self, cfg: Config, logger: logging.Logger):
        self.cfg = cfg
        self.logger = logger
        self.access = AccessReader(cfg.access_connection_string, logger)
        self.pg = PgWriter(cfg, logger)
        self._shutdown = False

    def setup(self) -> None:
        """Connect to both databases and prepare sync_log table."""
        self.access.connect()
        self.pg.connect()
        self.pg.ensure_sync_log_table()

    def teardown(self) -> None:
        """Disconnect from both databases."""
        self.access.disconnect()
        self.pg.disconnect()

    def request_shutdown(self) -> None:
        """Signal the engine to stop after the current operation."""
        self._shutdown = True
        self.logger.info("Shutdown requested. Will stop after current table completes.")

    def list_tables(self) -> List[str]:
        """Return the filtered list of tables to sync."""
        all_tables = self.access.get_tables()
        self.logger.info("Access database contains %d tables.", len(all_tables))

        # Apply include filter
        if self.cfg.tables_to_include:
            filtered = [t for t in all_tables if t.upper() in self.cfg.tables_to_include]
        else:
            filtered = all_tables

        # Apply exclude filter
        if self.cfg.tables_to_exclude:
            filtered = [t for t in filtered if t.upper() not in self.cfg.tables_to_exclude]

        self.logger.info("After filters: %d tables to sync.", len(filtered))
        return filtered

    def run_sync(self, mode: Optional[str] = None, tables: Optional[List[str]] = None) -> Dict:
        """Execute a full sync run.

        Args:
            mode: Override sync mode ('full' or 'incremental'). Uses config if None.
            tables: Override table list. Uses filtered Access tables if None.

        Returns:
            Summary dict with sync results.
        """
        sync_mode = mode or self.cfg.sync_mode
        sync_run_id = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        run_start = datetime.datetime.now()

        self.logger.info("=" * 70)
        self.logger.info("SYNC RUN %s  |  Mode: %s", sync_run_id, sync_mode.upper())
        self.logger.info("=" * 70)

        # Log run-level start
        run_log_id = self.pg.log_sync_start(sync_run_id, sync_mode, table_name=None)

        # Get tables
        if tables:
            sync_tables = tables
        else:
            sync_tables = self.list_tables()

        summary = {
            "sync_run_id": sync_run_id,
            "mode": sync_mode,
            "started_at": run_start.isoformat(),
            "tables_total": len(sync_tables),
            "tables_synced": 0,
            "tables_failed": 0,
            "tables_skipped": 0,
            "total_rows": 0,
            "errors": [],
            "table_details": [],
        }

        for i, table_name in enumerate(sync_tables, 1):
            if self._shutdown:
                self.logger.warning("Shutdown requested. Skipping remaining tables.")
                summary["tables_skipped"] = len(sync_tables) - i + 1
                break

            self.logger.info(
                "[%d/%d] Syncing table: %s ...", i, len(sync_tables), table_name
            )

            result = self._sync_table(table_name, sync_mode, sync_run_id)
            summary["table_details"].append(result)

            if result["status"] == "success":
                summary["tables_synced"] += 1
                summary["total_rows"] += result["rows"]
            else:
                summary["tables_failed"] += 1
                summary["errors"].append({
                    "table": table_name,
                    "error": result.get("error", "unknown"),
                })

        # Finalize run log
        run_end = datetime.datetime.now()
        duration = (run_end - run_start).total_seconds()
        summary["finished_at"] = run_end.isoformat()
        summary["duration_seconds"] = round(duration, 2)

        run_status = "success" if summary["tables_failed"] == 0 else "partial"
        run_error = None
        if summary["errors"]:
            run_error = f"{summary['tables_failed']} table(s) failed: " + "; ".join(
                f"{e['table']}: {e['error'][:100]}" for e in summary["errors"][:5]
            )

        self.pg.log_sync_finish(run_log_id, summary["total_rows"], run_status, run_error)

        self.logger.info("=" * 70)
        self.logger.info(
            "SYNC COMPLETE  |  Tables: %d synced, %d failed, %d skipped  |  "
            "Rows: %s  |  Duration: %.1fs",
            summary["tables_synced"],
            summary["tables_failed"],
            summary["tables_skipped"],
            f"{summary['total_rows']:,}",
            duration,
        )
        self.logger.info("=" * 70)

        return summary

    def _sync_table(self, table_name: str, sync_mode: str, sync_run_id: str) -> Dict:
        """Sync a single table with retry logic. Returns a result dict."""
        table_start = datetime.datetime.now()
        log_id = self.pg.log_sync_start(sync_run_id, sync_mode, table_name)
        total_rows = 0
        last_error = None

        for attempt in range(1, self.cfg.max_retries + 1):
            try:
                if attempt > 1:
                    self.logger.info(
                        "  Retry %d/%d for table %s ...",
                        attempt, self.cfg.max_retries, table_name,
                    )
                    time.sleep(self.cfg.retry_delay_seconds)

                # Get Access schema
                columns = self.access.get_columns(table_name)
                if not columns:
                    self.logger.warning("  Table %s has no columns. Skipping.", table_name)
                    self.pg.log_sync_finish(log_id, 0, "skipped", "No columns found")
                    return {
                        "table": table_name,
                        "status": "skipped",
                        "rows": 0,
                        "error": "No columns found",
                    }

                primary_keys = self.access.get_primary_keys(table_name)
                access_row_count = self.access.count_rows(table_name)

                self.logger.info(
                    "  Schema: %d columns, %d PKs, %s rows in Access",
                    len(columns),
                    len(primary_keys),
                    f"{access_row_count:,}",
                )

                if sync_mode == "full":
                    total_rows = self._full_sync_table(
                        table_name, columns, primary_keys, access_row_count
                    )
                elif sync_mode == "incremental":
                    total_rows = self._incremental_sync_table(
                        table_name, columns, primary_keys, access_row_count
                    )
                else:
                    raise ValueError(f"Unknown sync mode: {sync_mode}")

                duration = (datetime.datetime.now() - table_start).total_seconds()
                rate = total_rows / duration if duration > 0 else 0

                self.logger.info(
                    "  Done: %s rows in %.1fs (%.0f rows/sec)",
                    f"{total_rows:,}", duration, rate,
                )

                self.pg.log_sync_finish(log_id, total_rows, "success")
                return {
                    "table": table_name,
                    "status": "success",
                    "rows": total_rows,
                    "duration_secs": round(duration, 2),
                }

            except Exception as exc:
                last_error = exc
                error_msg = f"{type(exc).__name__}: {exc}"
                if attempt < self.cfg.max_retries:
                    self.logger.warning(
                        "  Attempt %d failed: %s  (will retry in %ds)",
                        attempt, error_msg, self.cfg.retry_delay_seconds,
                    )
                else:
                    self.logger.error("  FAILED after %d attempts: %s", attempt, error_msg)
                    self.logger.debug("  Traceback: %s", traceback.format_exc())

        # All retries exhausted
        duration = (datetime.datetime.now() - table_start).total_seconds()
        error_msg = f"{type(last_error).__name__}: {last_error}"
        self.pg.log_sync_finish(log_id, total_rows, "failed", error_msg[:2000])
        return {
            "table": table_name,
            "status": "failed",
            "rows": total_rows,
            "error": error_msg,
            "duration_secs": round(duration, 2),
        }

    def _full_sync_table(
        self,
        table_name: str,
        columns: List[Dict],
        primary_keys: List[str],
        access_row_count: int,
    ) -> int:
        """Full sync: drop/truncate table and reload all rows."""
        table_exists = self.pg.table_exists(table_name)

        if self.cfg.truncate_on_full_sync and table_exists:
            # Verify schema matches before truncating; if column count differs,
            # the Access schema has changed and we need to recreate
            pg_col_count = self.pg.get_column_count(table_name)
            if pg_col_count == len(columns):
                self.logger.info("  Truncating existing table...")
                self.pg.truncate_table(table_name)
            else:
                self.logger.info(
                    "  Schema changed (%d PG cols vs %d Access cols). Dropping and recreating...",
                    pg_col_count, len(columns),
                )
                self.pg.drop_table(table_name)
                self.pg.create_table(table_name, columns, primary_keys)
        else:
            self.logger.info("  Dropping and recreating table...")
            self.pg.drop_table(table_name)
            self.pg.create_table(table_name, columns, primary_keys)

        if access_row_count == 0:
            self.logger.info("  Table is empty in Access. Nothing to insert.")
            return 0

        total_rows = 0
        for batch_num, rows in self.access.read_rows(table_name, self.cfg.batch_size):
            inserted = self.pg.insert_batch(table_name, columns, rows)
            total_rows += inserted
            if access_row_count > self.cfg.batch_size:
                pct = min(100.0, total_rows / access_row_count * 100)
                self.logger.info(
                    "    Batch %d: %s/%s rows (%.1f%%)",
                    batch_num, f"{total_rows:,}", f"{access_row_count:,}", pct,
                )

        return total_rows

    def _incremental_sync_table(
        self,
        table_name: str,
        columns: List[Dict],
        primary_keys: List[str],
        access_row_count: int,
    ) -> int:
        """Incremental sync: create table if needed, then upsert rows."""
        if not self.pg.table_exists(table_name):
            self.logger.info("  Table does not exist in PG. Creating...")
            self.pg.create_table(table_name, columns, primary_keys)

        if access_row_count == 0:
            self.logger.info("  Table is empty in Access. Nothing to upsert.")
            return 0

        if not primary_keys:
            self.logger.warning(
                "  No primary key found. Falling back to truncate + insert."
            )
            self.pg.truncate_table(table_name)

        total_rows = 0
        for batch_num, rows in self.access.read_rows(table_name, self.cfg.batch_size):
            if primary_keys:
                processed = self.pg.upsert_batch(table_name, columns, primary_keys, rows)
            else:
                processed = self.pg.insert_batch(table_name, columns, rows)
            total_rows += processed
            if access_row_count > self.cfg.batch_size:
                pct = min(100.0, total_rows / access_row_count * 100)
                self.logger.info(
                    "    Batch %d: %s/%s rows (%.1f%%)",
                    batch_num, f"{total_rows:,}", f"{access_row_count:,}", pct,
                )

        return total_rows


# ---------------------------------------------------------------------------
# Daemon / scheduler mode
# ---------------------------------------------------------------------------

def run_daemon(cfg: Config, logger: logging.Logger, mode: Optional[str] = None) -> None:
    """Run the sync engine continuously on a schedule."""
    import schedule as sched_lib

    engine = SyncEngine(cfg, logger)

    def _shutdown_handler(signum, frame):
        logger.info("Received signal %d. Shutting down gracefully...", signum)
        engine.request_shutdown()

    signal.signal(signal.SIGINT, _shutdown_handler)
    signal.signal(signal.SIGTERM, _shutdown_handler)

    def _run_job():
        try:
            engine.setup()
            engine.run_sync(mode=mode)
        except Exception as exc:
            logger.error("Sync run failed: %s", exc)
            logger.debug(traceback.format_exc())
        finally:
            engine.teardown()

    interval = cfg.sync_interval_minutes
    logger.info("Daemon mode: scheduling sync every %d minutes.", interval)

    # Run immediately on startup
    _run_job()

    sched_lib.every(interval).minutes.do(_run_job)

    while not engine._shutdown:
        sched_lib.run_pending()
        time.sleep(1)

    logger.info("Daemon stopped.")


# ---------------------------------------------------------------------------
# Windows service support
# ---------------------------------------------------------------------------

def create_windows_service():
    """Create a Windows service class. Only import win32 modules when needed."""
    try:
        import win32serviceutil
        import win32service
        import win32event
        import servicemanager
    except ImportError:
        print("ERROR: pywin32 is required to run as a Windows service.")
        print("Install it with: pip install pywin32")
        sys.exit(1)

    class AccessSyncService(win32serviceutil.ServiceFramework):
        _svc_name_ = "AccessPgSync"
        _svc_display_name_ = "Access to PostgreSQL Sync Service"
        _svc_description_ = "Synchronizes Microsoft Access database tables to PostgreSQL"

        def __init__(self, args):
            win32serviceutil.ServiceFramework.__init__(self, args)
            self.stop_event = win32event.CreateEvent(None, 0, 0, None)
            self.engine = None

        def SvcStop(self):
            self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING)
            win32event.SetEvent(self.stop_event)
            if self.engine:
                self.engine.request_shutdown()

        def SvcDoRun(self):
            servicemanager.LogMsg(
                servicemanager.EVENTLOG_INFORMATION_TYPE,
                servicemanager.PYS_SERVICE_STARTED,
                (self._svc_name_, ""),
            )

            # Find config.json next to the script
            script_dir = os.path.dirname(os.path.abspath(__file__))
            config_path = os.path.join(script_dir, "config.json")

            cfg = Config.from_file(config_path)
            logger = setup_logging(cfg)

            try:
                run_daemon(cfg, logger)
            except Exception as exc:
                logger.error("Service failed: %s", exc)
                logger.debug(traceback.format_exc())

    return AccessSyncService


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Access to PostgreSQL Sync Engine",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python sync_engine.py                          Run once (full sync)
  python sync_engine.py --mode incremental       Run once (incremental)
  python sync_engine.py --daemon                 Run continuously
  python sync_engine.py --tables F_ART,F_FAC     Sync specific tables
  python sync_engine.py --list-tables            List Access tables
  python sync_engine.py install                  Install as Windows service
  python sync_engine.py start                    Start the Windows service
  python sync_engine.py stop                     Stop the Windows service
  python sync_engine.py remove                   Remove the Windows service
        """,
    )
    parser.add_argument(
        "--config", default="config.json",
        help="Path to config.json (default: config.json in current directory)",
    )
    parser.add_argument(
        "--mode", choices=["full", "incremental"],
        help="Override sync mode from config",
    )
    parser.add_argument(
        "--daemon", action="store_true",
        help="Run continuously on the configured schedule",
    )
    parser.add_argument(
        "--tables",
        help="Comma-separated list of specific tables to sync",
    )
    parser.add_argument(
        "--list-tables", action="store_true",
        help="List all Access tables and exit",
    )

    # Check for Windows service commands (install, start, stop, remove)
    if len(sys.argv) > 1 and sys.argv[1] in ("install", "start", "stop", "remove", "update", "debug"):
        ServiceClass = create_windows_service()
        import win32serviceutil
        win32serviceutil.HandleCommandLine(ServiceClass)
        return

    args = parser.parse_args()

    # Resolve config path
    config_path = args.config
    if not os.path.isabs(config_path):
        config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), config_path)

    if not os.path.exists(config_path):
        print(f"ERROR: Config file not found: {config_path}")
        sys.exit(1)

    # Force UTF-8 for Python I/O on Windows
    if sys.platform == "win32":
        os.environ.setdefault("PYTHONUTF8", "1")
        os.environ.setdefault("PYTHONIOENCODING", "utf-8")

    cfg = Config.from_file(config_path)
    logger = setup_logging(cfg)

    logger.info("Configuration loaded from: %s", config_path)
    logger.info("Access DB: %s", cfg.access_db_path)
    logger.info("PostgreSQL: %s:%s/%s", cfg.pg_host, cfg.pg_port, cfg.pg_database)

    if args.daemon:
        run_daemon(cfg, logger, mode=args.mode)
        return

    # Single-run mode
    engine = SyncEngine(cfg, logger)

    # Handle graceful shutdown
    def _shutdown_handler(signum, frame):
        engine.request_shutdown()

    signal.signal(signal.SIGINT, _shutdown_handler)
    signal.signal(signal.SIGTERM, _shutdown_handler)

    try:
        engine.setup()

        if args.list_tables:
            tables = engine.list_tables()
            print(f"\nAccess database tables ({len(tables)}):")
            print("-" * 50)
            for t in tables:
                try:
                    count = engine.access.count_rows(t)
                    print(f"  {t:<30s} {count:>10,} rows")
                except Exception:
                    print(f"  {t:<30s} (error reading)")
            return

        # Parse specific tables if provided
        specific_tables = None
        if args.tables:
            specific_tables = [t.strip() for t in args.tables.split(",") if t.strip()]
            logger.info("Syncing specific tables: %s", specific_tables)

        summary = engine.run_sync(mode=args.mode, tables=specific_tables)

        # Exit code based on results
        if summary["tables_failed"] > 0:
            sys.exit(2)

    except KeyboardInterrupt:
        logger.info("Interrupted by user.")
    except Exception as exc:
        logger.error("Fatal error: %s", exc)
        logger.error(traceback.format_exc())
        sys.exit(1)
    finally:
        engine.teardown()


if __name__ == "__main__":
    main()
