const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const config = require('./lib/config');
const db = require('./lib/db');
const apiRouter = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3500;

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

// API routes
app.use('/api', apiRouter);

// Serve static frontend in production
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// SPA fallback - serve index.html for all non-API routes
app.get('*', (req, res) => {
  const indexPath = path.join(publicDir, 'index.html');
  const fs = require('fs');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(200).json({
      message: 'Access Sync Web App API is running.',
      hint: 'Frontend not built yet. Run: npm run build',
      docs: '/api/docs'
    });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// Start server
async function start() {
  // Ensure config is initialized (generates API key on first run)
  config.load();

  // Test database connection
  try {
    await db.testConnection();
    console.log('PostgreSQL connection successful.');
  } catch (err) {
    console.warn('PostgreSQL connection failed:', err.message);
    console.warn('Configure the database in Settings or config.json');
  }

  app.listen(PORT, () => {
    console.log(`Access Sync Web App running on http://localhost:${PORT}`);
    console.log(`API docs: http://localhost:${PORT}/api/docs`);
  });
}

start();
