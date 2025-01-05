require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const config = require('config');
const { setupWebSocketProxy } = require('./proxy');

// Create express app
const app = express();

// HTTP handlers first
app.get('/', (req, res) => {
    console.log('HTTP request received');
    res.setHeader('Content-Type', 'text/plain');
    res.status(200).send('Hello from Cloud Run!');
});

app.get('/health', (req, res) => {
    console.log('Health check received');
    res.status(200).send('OK');
});

// Create http server
const server = http.createServer((req, res) => {
    console.log('Raw HTTP request:', req.method, req.url);
    app(req, res);
});

// Create WebSocket server
const wss = new WebSocket.Server({ 
    noServer: true,
    clientTracking: true 
});

// Handle upgrade manually
server.on('upgrade', (request, socket, head) => {
    console.log('Upgrade request received');
    
    // Add explicit error handling for upgrade
    socket.on('error', (err) => {
        console.error('Socket error during upgrade:', err);
    });

    try {
        wss.handleUpgrade(request, socket, head, (ws) => {
            console.log('WebSocket connection established');
            wss.emit('connection', ws, request);
        });
    } catch (err) {
        console.error('Error during upgrade handling:', err);
        socket.end();
    }
});

// Setup proxy with error handling
try {
    setupWebSocketProxy(wss, config);
    console.log('Proxy setup complete');
} catch (err) {
    console.error('Error setting up proxy:', err);
}

// Start server with explicit error handling
const port = process.env.PORT || 8080;
server.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on port ${port}`);
});

// Global error handlers
server.on('error', (err) => {
    console.error('Server error:', err);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection:', err);
});