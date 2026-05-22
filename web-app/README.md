# Access Sync Web Dashboard

Web application for viewing and managing data synced from Microsoft Access to PostgreSQL.

## Requirements

- **Node.js** 18 or later (LTS recommended)
- **PostgreSQL** server with the synced database
- **Windows Server 2022** (or any OS with Node.js support)

## Quick Start (Windows Server)

### 1. Install Node.js

Download and install Node.js LTS from https://nodejs.org/

After installation, open a **new** Command Prompt and verify:

```cmd
node --version
npm --version
```

### 2. Install Dependencies & Build

Navigate to the web-app folder and run:

```cmd
cd C:\path\to\access-sync-app\web-app
npm run setup
```

This will:
- Install server dependencies
- Install client dependencies
- Build the React frontend
- Copy built files to server/public

### 3. Configure

Edit `config.json` in the parent directory (created automatically on first run) with your PostgreSQL connection details:

```json
{
  "access_db_path": "C:\\Data\\database.accdb",
  "pg_host": "localhost",
  "pg_port": 5432,
  "pg_database": "access_sync",
  "pg_user": "postgres",
  "pg_password": "your_password",
  "sync_interval_minutes": 30,
  "tables_to_exclude": [],
  "api_key": "auto-generated-uuid"
}
```

Or configure through the web UI at Settings page.

### 4. Start the Server

**Option A - Batch file (recommended):**

Double-click `start.bat` or run:

```cmd
start.bat
```

**Option B - Manual:**

```cmd
npm start
```

The app runs at **http://localhost:3500**

### 5. Change Port (optional)

```cmd
set PORT=8080
npm start
```

## Development

Run server and client separately for live reload:

Terminal 1 (server with auto-restart):
```cmd
npm run dev:server
```

Terminal 2 (client with hot reload):
```cmd
npm run dev:client
```

The Vite dev server runs on port 5173 and proxies API calls to port 3500.

## API Documentation

Swagger/OpenAPI docs available at: http://localhost:3500/api/docs

### API Key Authentication

For external API consumers, include the API key in the `X-API-Key` header:

```
GET /api/tables
X-API-Key: your-api-key-here
```

The API key is auto-generated on first run and shown on the Settings page.

## API Endpoints

| Method | Endpoint                      | Description                     |
|--------|-------------------------------|---------------------------------|
| GET    | /api/tables                   | List all tables with counts     |
| GET    | /api/tables/:name             | Paginated table data            |
| GET    | /api/tables/:name/schema      | Column definitions              |
| GET    | /api/tables/:name/export/csv  | Export table as CSV             |
| GET    | /api/sync/status              | Current sync status             |
| GET    | /api/sync/log                 | Sync history with pagination    |
| POST   | /api/sync/trigger             | Manually trigger sync           |
| GET    | /api/settings                 | Current settings                |
| POST   | /api/settings                 | Update settings                 |
| POST   | /api/settings/test-connection | Test PostgreSQL connection      |

### Query Parameters for Table Data

- `page` - Page number (default: 1)
- `limit` - Rows per page (default: 50, max: 500)
- `sort` - Column name to sort by
- `order` - Sort direction: `asc` or `desc`
- `search` - Global text search across all text columns
- `filters` - JSON object of column:value filters

Example:
```
GET /api/tables/F_CLI?page=1&limit=25&sort=NOM&order=asc&search=Madrid
```

## Run as Windows Service

To run as a background Windows service, use [NSSM](https://nssm.cc/):

```cmd
nssm install AccessSyncWeb "C:\Program Files\nodejs\node.exe" "C:\path\to\web-app\server\index.js"
nssm set AccessSyncWeb AppDirectory "C:\path\to\web-app"
nssm start AccessSyncWeb
```

## Project Structure

```
web-app/
  config.json          # Shared settings (auto-created)
  start.bat            # Windows launcher
  package.json         # Server dependencies
  server/
    index.js           # Express server entry point
    lib/
      config.js        # Config file management
      db.js            # PostgreSQL connection pool
      swagger.js       # OpenAPI spec
    middleware/
      auth.js          # API key authentication
    routes/
      api.js           # Route aggregator
      tables.js        # Table data endpoints
      sync.js          # Sync status/trigger endpoints
      settings.js      # Settings endpoints
    public/            # Built frontend (generated)
  client/
    src/
      main.jsx         # React entry
      App.jsx          # Router setup
      api.js           # API client
      components/      # Reusable UI components
      pages/           # Page components
```
