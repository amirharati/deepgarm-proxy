require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const admin = require('firebase-admin');
const config = require('config');
const { setupWebSocketProxy } = require('./proxy');
const CreditManager = require('./credit_manager');
const EventEmitter = require('events');

// Debug mode flag - can be set via environment variable
const DEBUG_MODE = process.env.DEBUG_MODE === 'true';
if (DEBUG_MODE) {
    console.warn('⚠️ Running in DEBUG MODE - Authentication and credit checks are bypassed');
}

// Event emitter for credit updates
const proxyEvents = new EventEmitter();

// Initialize Firebase Admin (only if not in debug mode)
let db;
if (!DEBUG_MODE) {
    const firebaseCredentials = JSON.parse(process.env.FIREBASE_CREDENTIALS);
    admin.initializeApp({
        credential: admin.credential.cert(firebaseCredentials)
    });
    db = admin.firestore();
}
const creditManager = new CreditManager(db);

// Send HTTP error response for pre-upgrade errors
function sendPreUpgradeError(socket, statusCode, message) {
    console.error(`Sending pre-upgrade error response: ${statusCode}`, message);
    socket.write(`HTTP/1.1 ${statusCode} ${message}\r\n`);
    socket.write('Connection: close\r\n');
    socket.write('Content-Type: application/json\r\n\r\n');
    socket.write(JSON.stringify({
        error: true,
        code: statusCode,
        message: message
    }));
    socket.end();
}

// Send WebSocket error for post-upgrade errors
function sendWebSocketError(ws, code, message) {
    console.error(`Sending WebSocket error response: ${code}`, message);
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'error',
            code: code,
            message: message
        }));
        ws.close(4000, message);
    }
}

const app = express();

app.get('/', (req, res) => {
  console.log('HTTP request received');
  res.setHeader('Content-Type', 'text/plain');
  res.status(200).send('Hello from Cloud Run!');
});

app.get('/health', (req, res) => {
  console.log('Health check received');
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString()
  });
});

const server = http.createServer((req, res) => {
  console.log('Raw HTTP request:', req.method, req.url);
  app(req, res);
});

const wss = new WebSocket.Server({ 
  noServer: true,
  clientTracking: true 
});

function getTokenFromRequest(request) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  return url.searchParams.get('auth_token');
}

// Handle credit updates from proxy
proxyEvents.on('credit_update', async ({userId, duration, isClosed, totalDuration}) => {
   if (DEBUG_MODE) {
       console.log(`Debug mode: Skipping credit update for user ${userId}`);
       return;
   }
   
   try {
       if (isClosed) {
           await creditManager.bufferCreditUpdate(userId, duration);
           await creditManager.flushCredits(userId);
           console.log(`Final credit update flushed for user ${userId}: ${duration} seconds, total session: ${totalDuration} seconds`);
       } else {
           await creditManager.bufferCreditUpdate(userId, duration);
           console.log(`Credit update buffered for user ${userId}: ${duration} seconds`);
       }
   } catch (error) {
       console.error('Failed to update credits:', error);
   }
});

server.on('upgrade', async (request, socket, head) => {
    console.log('WebSocket upgrade request received');
    
    socket.on('error', (err) => {
        console.error('Socket error during upgrade:', err);
        sendPreUpgradeError(socket, 500, 'Internal Server Error');
    });

    try {
        let userId = 'debug-user';
        let creditStatus = { canUseService: true, remainingCredits: 9999, credits: 9999 };

        if (!DEBUG_MODE) {
            // Normal authentication flow
            const token = getTokenFromRequest(request);
            if (!token) {
                console.error('No authentication token provided');
                sendPreUpgradeError(socket, 401, 'Authentication token required');
                return;
            }

            try {
                const decodedToken = await admin.auth().verifyIdToken(token);
                userId = decodedToken.uid;
                console.log('Token verified for user:', userId);

                creditStatus = await creditManager.checkUserCredits(userId);
                
                if (creditStatus.error) {
                    console.error('Credit check failed:', creditStatus.error);
                    sendPreUpgradeError(socket, 500, 'Failed to verify credits');
                    return;
                }

                if (!creditStatus.canUseService) {
                    console.error('Insufficient credits for user:', userId);
                    sendPreUpgradeError(socket, 403, 'Insufficient credits');
                    return;
                }
            } catch (error) {
                console.error('Token verification failed:', error);
                let errorMessage;
                
                switch(error.code) {
                    case 'auth/id-token-expired':
                        errorMessage = 'Token expired';
                        break;
                    case 'auth/id-token-revoked':
                        errorMessage = 'Token revoked';
                        break;
                    case 'auth/argument-error':
                        errorMessage = 'Invalid token format';
                        break;
                    default:
                        errorMessage = 'Authentication failed';
                }
                
                sendPreUpgradeError(socket, 401, errorMessage);
                return;
            }
        } else {
            console.log('Debug mode: Bypassing authentication and credit checks');
        }

        console.log(`User ${userId} session starting:`, {
            totalCredits: creditStatus.credits,
            usedCredits: creditStatus.usedCredits,
            remainingCredits: creditStatus.remainingCredits
        });
        
        const enhancedRequest = {
            ...request,
            userId: userId,
            url: request.url,
            headers: {
                ...request.headers,
                'X-Credits-Remaining': creditStatus.remainingCredits,
                'X-Credits-Total': creditStatus.credits
            }
        };
        
        wss.handleUpgrade(enhancedRequest, socket, head, (ws) => {
            console.log('WebSocket connection established for user:', userId);
            
            ws.on('error', (err) => {
                console.error('WebSocket error for user:', userId, err);
                sendWebSocketError(ws, 1011, 'WebSocket error occurred');
            });

            wss.emit('connection', ws, enhancedRequest);
        });

    } catch (err) {
        console.error('Error during upgrade handling:', err);
        sendPreUpgradeError(socket, 500, 'Server error occurred');
    }
});

// Setup proxy with error handling
try {
    setupWebSocketProxy(wss, config, proxyEvents);
    console.log('WebSocket proxy setup complete');
} catch (err) {
    console.error('Error setting up proxy:', err);
    process.exit(1);
}

// Cleanup on shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, cleaning up...');
    try {
        if (!DEBUG_MODE) {
            await creditManager.flushAllCredits();
            console.log('All credits flushed successfully');
        }
        
        // Close all WebSocket connections
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.close(1000, 'Server shutting down');
            }
        });
        
        server.close(() => {
            console.log('Server shutdown complete');
            process.exit(0);
        });
    } catch (err) {
        console.error('Error during shutdown:', err);
        process.exit(1);
    }
});

const port = process.env.PORT || 8080;
server.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on port ${port}`);
    if (DEBUG_MODE) {
        console.log('🔧 Debug mode is enabled - no authentication or credit checks will be performed');
    }
});

// Enhanced error handling
server.on('error', (err) => {
    console.error('Server error:', err);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection:', err);
});