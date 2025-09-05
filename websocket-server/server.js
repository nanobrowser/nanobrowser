import { WebSocketServer } from 'ws';
import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { createServer } from 'http';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Enable CORS for all routes
app.use(cors());
app.use(express.json());

// Store connected clients
const clients = new Map();
const executionResults = new Map();

// API endpoints for external integration
app.get('/api/status', (req, res) => {
  res.json({
    status: 'running',
    connectedClients: clients.size,
    timestamp: new Date().toISOString()
  });
});

// Execute task endpoint
app.post('/api/execute', (req, res) => {
  const { task, options = {} } = req.body;
  
  if (!task) {
    return res.status(400).json({ error: 'Task is required' });
  }

  if (clients.size === 0) {
    return res.status(503).json({ error: 'No Nanobrowser clients connected' });
  }

  const taskId = uuidv4();
  const timestamp = new Date().toISOString();
  
  // Find the first available client (you can implement load balancing here)
  const client = clients.values().next().value;
  
  if (!client || client.readyState !== 1) {
    return res.status(503).json({ error: 'No active Nanobrowser clients available' });
  }

  // Send task to the extension
  const message = {
    type: 'execute_task',
    taskId,
    task,
    options,
    timestamp
  };

  try {
    client.send(JSON.stringify(message));
    console.log(`Task sent to extension: ${taskId} - ${task}`);
    
    res.json({
      success: true,
      taskId,
      message: 'Task sent to Nanobrowser extension',
      timestamp
    });
  } catch (error) {
    console.error('Error sending task to extension:', error);
    res.status(500).json({ error: 'Failed to send task to extension' });
  }
});

// Get task result endpoint
app.get('/api/result/:taskId', (req, res) => {
  const { taskId } = req.params;
  const result = executionResults.get(taskId);
  
  if (!result) {
    return res.status(404).json({ error: 'Task result not found' });
  }
  
  res.json(result);
});

// WebSocket connection handling
wss.on('connection', (ws, request) => {
  const clientId = uuidv4();
  const clientInfo = {
    id: clientId,
    socket: ws,
    connectedAt: new Date().toISOString(),
    userAgent: request.headers['user-agent'] || 'Unknown'
  };
  
  clients.set(clientId, ws);
  console.log(`Nanobrowser extension connected: ${clientId}`);
  console.log(`Total connected clients: ${clients.size}`);

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'connection_established',
    clientId,
    serverTime: new Date().toISOString()
  }));

  // Handle messages from extension
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log(`Message from extension ${clientId}:`, message);

      switch (message.type) {
        case 'task_started':
          console.log(`Task started: ${message.taskId}`);
          break;
          
        case 'task_progress':
          console.log(`Task progress: ${message.taskId} - ${message.step}`);
          break;
          
        case 'task_completed':
          console.log(`Task completed: ${message.taskId}`);
          executionResults.set(message.taskId, {
            taskId: message.taskId,
            status: 'completed',
            result: message.result,
            completedAt: new Date().toISOString()
          });
          break;
          
        case 'task_failed':
          console.log(`Task failed: ${message.taskId} - ${message.error}`);
          executionResults.set(message.taskId, {
            taskId: message.taskId,
            status: 'failed',
            error: message.error,
            failedAt: new Date().toISOString()
          });
          break;
          
        case 'heartbeat':
          // Respond to heartbeat
          ws.send(JSON.stringify({ type: 'heartbeat_response' }));
          break;
          
        default:
          console.log(`Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error('Error parsing message from extension:', error);
    }
  });

  // Handle connection close
  ws.on('close', (code, reason) => {
    clients.delete(clientId);
    console.log(`Extension disconnected: ${clientId} (${code}: ${reason})`);
    console.log(`Total connected clients: ${clients.size}`);
  });

  // Handle errors
  ws.on('error', (error) => {
    console.error(`WebSocket error for client ${clientId}:`, error);
    clients.delete(clientId);
  });
});

// Start server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Nanobrowser WebSocket server running on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
  console.log(`HTTP API endpoint: http://localhost:${PORT}/api`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  wss.close(() => {
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });
});