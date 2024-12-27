require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const config = require('config');
const path = require('path');
const { setupWebSocketProxy } = require('./proxy');

// Check for required environment variable
if (!process.env.DEEPGRAM_API_KEY) {
    console.error('DEEPGRAM_API_KEY environment variable is required');
    process.exit(1);
}

const app = express();
const server = http.createServer(app);

// Serve static files for the test client
app.use(express.static(path.join(__dirname, '../client')));

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Set up the proxy
setupWebSocketProxy(wss);

// Start the server
const PORT = config.get('server.port') || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});