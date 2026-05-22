const swaggerDoc = {
  openapi: '3.0.3',
  info: {
    title: 'Access Sync Web App API',
    version: '1.0.0',
    description: 'REST API for viewing and managing data synced from Microsoft Access to PostgreSQL.'
  },
  servers: [
    { url: '/api', description: 'API base path' }
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key'
      }
    }
  },
  security: [{ ApiKeyAuth: [] }],
  paths: {
    '/tables': {
      get: {
        summary: 'List all synced tables',
        tags: ['Tables'],
        responses: {
          200: {
            description: 'Array of table info',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    tables: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string' },
                          row_count: { type: 'integer' },
                          column_count: { type: 'integer' }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/tables/{name}': {
      get: {
        summary: 'Get paginated table data',
        tags: ['Tables'],
        parameters: [
          { name: 'name', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'sort', in: 'query', schema: { type: 'string' } },
          { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'asc' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'filters', in: 'query', schema: { type: 'string', description: 'JSON object of column:value filters' } }
        ],
        responses: {
          200: { description: 'Paginated rows with metadata' },
          404: { description: 'Table not found' }
        }
      }
    },
    '/tables/{name}/schema': {
      get: {
        summary: 'Get table schema (columns, types, nullable)',
        tags: ['Tables'],
        parameters: [
          { name: 'name', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: {
          200: { description: 'Array of column definitions' },
          404: { description: 'Table not found' }
        }
      }
    },
    '/tables/{name}/export/csv': {
      get: {
        summary: 'Export table as CSV',
        tags: ['Tables'],
        parameters: [
          { name: 'name', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: {
          200: { description: 'CSV file download' }
        }
      }
    },
    '/sync/status': {
      get: {
        summary: 'Get current sync status',
        tags: ['Sync'],
        responses: {
          200: { description: 'Sync status info' }
        }
      }
    },
    '/sync/log': {
      get: {
        summary: 'Get sync history log',
        tags: ['Sync'],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } }
        ],
        responses: {
          200: { description: 'Paginated sync log entries' }
        }
      }
    },
    '/sync/trigger': {
      post: {
        summary: 'Manually trigger a sync',
        tags: ['Sync'],
        responses: {
          200: { description: 'Sync triggered' },
          409: { description: 'Sync already running' }
        }
      }
    },
    '/settings': {
      get: {
        summary: 'Get current settings',
        tags: ['Settings'],
        responses: {
          200: { description: 'Current configuration' }
        }
      },
      post: {
        summary: 'Update settings',
        tags: ['Settings'],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  access_db_path: { type: 'string' },
                  pg_host: { type: 'string' },
                  pg_port: { type: 'integer' },
                  pg_database: { type: 'string' },
                  pg_user: { type: 'string' },
                  pg_password: { type: 'string' },
                  sync_interval_minutes: { type: 'integer' },
                  tables_to_exclude: { type: 'array', items: { type: 'string' } }
                }
              }
            }
          }
        },
        responses: {
          200: { description: 'Updated settings' }
        }
      }
    }
  }
};

module.exports = swaggerDoc;
