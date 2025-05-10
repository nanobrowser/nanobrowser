/**
 * Server entry point for running the MCP host outside of Vite
 * This file is used when running `npm start` after building
 */

import app from './index';

// Define the port to listen on
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8765;

// Start HTTP server
const server = app.listen(PORT, () => {
  console.error(`[server] HTTP server listening on port ${PORT}`);
  console.error('[server] Press Ctrl+C to stop the server');
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.error('[server] Received SIGINT, shutting down HTTP server...');
  server.close(() => {
    console.error('[server] HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.error('[server] Received SIGTERM, shutting down HTTP server...');
  server.close(() => {
    console.error('[server] HTTP server closed');
    process.exit(0);
  });
});
