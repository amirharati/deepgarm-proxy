require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const config = require('config');
const { setupWebSocketProxy } = require('./proxy');

if (!process.env.DEEPGRAM_API_KEY) {
    console.error('DEEPGRAM_API_KEY environment variable is required');
    process.exit(1);
}

function setupServer() {
    const app = express();
    const server = http.createServer(app);
    
    // Basic health check endpoint for Cloud Run
    app.get('/', (req, res) => {
        res.status(200).send('WebSocket server is running');
    });

    const wss = new WebSocket.Server({ server });
    setupWebSocketProxy(wss, config);

    // Get port from environment (for Cloud Run) or config
    const PORT = process.env.PORT || config.get('server.port') || 8080;
    
    server.listen(PORT, () => {
        console.log(`WebSocket server running on port ${PORT}`);
    });

    return server;
}

// Start server if running directly (not imported as module)
if (require.main === module) {
    setupServer();
}

module.exports = { setupServer };