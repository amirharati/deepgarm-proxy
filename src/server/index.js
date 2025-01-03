require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const admin = require('firebase-admin');
const config = require('config');
const { setupWebSocketProxy } = require('./proxy');

// Initialize Firebase Admin
const firebaseCredentials = JSON.parse(process.env.FIREBASE_CREDENTIALS);
admin.initializeApp({
  credential: admin.credential.cert(firebaseCredentials)
});

// Create express app
const app = express();

app.get('/', (req, res) => {
    console.log('HTTP request received');
    res.setHeader('Content-Type', 'text/plain');
    res.status(200).send('Hello from Cloud Run!');
});

app.get('/health', (req, res) => {
    console.log('Health check received');
    res.status(200).send('OK');
});

const server = http.createServer((req, res) => {
    console.log('Raw HTTP request:', req.method, req.url);
    app(req, res);
});

const wss = new WebSocket.Server({ 
    noServer: true,
    clientTracking: true 
});

// Extract token from WebSocket request
function getTokenFromRequest(request) {
    const url = new URL(request.url, `http://${request.headers.host}`);
    return url.searchParams.get('auth_token');
}

// Handle upgrade with authentication
server.on('upgrade', async (request, socket, head) => {
    console.log('Upgrade request received');
    
    socket.on('error', (err) => {
        console.error('Socket error during upgrade:', err);
        socket.destroy();
    });

    try {
        // Get and verify token
        const token = getTokenFromRequest(request);
        if (!token) {
            console.error('No token provided');
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }

        try {
            // Verify token with Firebase
            const decodedToken = await admin.auth().verifyIdToken(token);
            console.log('Token verified for user:', decodedToken.uid);
            
            // Create a clean request object without exposing internal details
            const cleanRequest = {
                ...request,
                userId: decodedToken.uid,  // Add user ID for proxy to use
                url: request.url,
                headers: {
                    ...request.headers,
                    // Remove any sensitive headers if needed
                }
            };
            
            wss.handleUpgrade(request, socket, head, (ws) => {
                console.log('WebSocket connection established');
                wss.emit('connection', ws, cleanRequest);
            });
        } catch (error) {
            console.error('Token verification failed:', error);
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }
    } catch (err) {
        console.error('Error during upgrade handling:', err);
        socket.destroy();
    }
});

// Setup proxy with error handling
try {
    setupWebSocketProxy(wss, config);
    console.log('Proxy setup complete');
} catch (err) {
    console.error('Error setting up proxy:', err);
}

// Start server
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