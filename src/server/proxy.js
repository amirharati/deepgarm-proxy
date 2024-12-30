const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');
const WebSocket = require('ws');

/**
 * Returns ISO timestamp for consistent logging
 * @returns {string} ISO timestamp
 */
function timestamp() {
    return new Date().toISOString();
}

/**
 * Retrieves Deepgram API key from config or environment
 * @param {Object} externalConfig - Configuration object
 * @returns {string} Deepgram API key
 * @throws {Error} If no API key is found
 */
function getDeepgramKey(externalConfig) {
    console.log(`[${timestamp()}] Checking for Deepgram API key...`);
    console.log(`[${timestamp()}] External config:`, externalConfig);
    
    // Don't log actual API key in production
    console.log(`[${timestamp()}] Environment variable DEEPGRAM_API_KEY presence:`, 
        !!process.env.DEEPGRAM_API_KEY);

    if (externalConfig?.deepgram?.key) {
        console.log(`[${timestamp()}] Using Deepgram API key from external config`);
        return externalConfig.deepgram.key;
    }
    if (process.env.DEEPGRAM_API_KEY) {
        console.log(`[${timestamp()}] Using Deepgram API key from environment variable`);
        return process.env.DEEPGRAM_API_KEY;
    }
    throw new Error('Missing Deepgram API key');
}

/**
 * Sets up WebSocket proxy to Deepgram service
 * @param {WebSocket.Server} wss - WebSocket server instance
 * @param {Object} externalConfig - Configuration for the proxy
 * @returns {Object} Interface for managing the proxy
 */
const setupWebSocketProxy = (wss, externalConfig = {}) => {
    const apiKey = getDeepgramKey(externalConfig);
    console.log(`[${timestamp()}] WebSocket server initialized`);
    
    // Track active connections for monitoring and cleanup
    const activeConnections = new Map(); // Changed to Map to store connection state

    wss.on('connection', async (clientWs, req) => {
        const clientId = Math.random().toString(36).substring(7);
        console.log(`[${timestamp()}] New client connected - ID: ${clientId}, IP: ${req.socket.remoteAddress}`);
        
        // Connection state object to manage the lifecycle
        const connectionState = {
            dgConnection: null,
            isAlive: true,
            isClosing: false
        };
        
        activeConnections.set(clientId, connectionState);
        console.log(`[${timestamp()}] Active connections: ${activeConnections.size}`);

        /**
         * Initializes connection to Deepgram service
         * Returns a promise that resolves when the connection is fully established
         * @returns {Promise<Object>} Deepgram connection instance
         */
        async function initializeDeepgramConnection() {
            if (connectionState.isClosing) {
                console.log(`[${timestamp()}] [${clientId}] Connection is closing, skipping initialization`);
                return null;
            }

            return new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    reject(new Error('Deepgram connection timeout'));
                }, 10000); // 10 second timeout

                try {
                    console.log(`[${timestamp()}] [${clientId}] Creating Deepgram client...`);
                    const deepgram = createClient(apiKey);

                    console.log(`[${timestamp()}] [${clientId}] Using Deepgram parameters:`, externalConfig.server.deepgramParams);
                    
                    const dgConn = deepgram.listen.live(externalConfig.server.deepgramParams);

                    // Setup event handlers
                   // Add listener for each specific Deepgram event
                    dgConn.on(LiveTranscriptionEvents.Open, (data) => {
                        if (!connectionState.isClosing) {
                            try {
                                //console.log(`[${timestamp()}] [${clientId}] Forwarding Open event:`, JSON.stringify(data));
                                sendToClient(data);

                                clearTimeout(timeoutId);
                                console.log(`[${timestamp()}] [${clientId}] Deepgram connection opened`);
                                connectionState.dgConnection = dgConn;
                                resolve(dgConn);
                            } catch (error) {
                                console.error(`[${timestamp()}] [${clientId}] Error forwarding Open event:`, error);
                            }
                        }
                    });

                    dgConn.on(LiveTranscriptionEvents.Close, (data) => {

                        if (connectionState.dgConnection === dgConn) {
                            connectionState.dgConnection = null;
                        }
                        if (!connectionState.isClosing) {
                            try {
                                console.log(`[${timestamp()}] [${clientId}] Forwarding Close event:`, JSON.stringify(data));
                                sendToClient(data);
                            } catch (error) {
                                console.error(`[${timestamp()}] [${clientId}] Error forwarding Close event:`, error);
                            }
                        }
                    });

                    dgConn.on(LiveTranscriptionEvents.Error, (data) => {
                        console.error(`[${timestamp()}] [${clientId}] Deepgram connection error:`, error);
                        if (!connectionState.dgConnection) {
                            clearTimeout(timeoutId);
                            reject(error);
                        }
                        if (!connectionState.isClosing) {
                            try {
                                console.log(`[${timestamp()}] [${clientId}] Forwarding Error event:`, JSON.stringify(data));
                                sendToClient(data);
                            } catch (error) {
                                console.error(`[${timestamp()}] [${clientId}] Error forwarding Error event:`, error);
                            }
                        }
                    });

                    dgConn.on(LiveTranscriptionEvents.Warning, (data) => {
                        if (!connectionState.isClosing) {
                            try {
                                console.log(`[${timestamp()}] [${clientId}] Forwarding Warning event:`, JSON.stringify(data));
                                sendToClient(data);
                            } catch (error) {
                                console.error(`[${timestamp()}] [${clientId}] Error forwarding Warning event:`, error);
                            }
                        }
                    });

                    dgConn.on(LiveTranscriptionEvents.Transcript, (data) => {
                        if (!connectionState.isClosing) {
                            try {
                                console.log(`[${timestamp()}] [${clientId}] Forwarding Transcript event:`, JSON.stringify(data));
                                sendToClient(data);
                            } catch (error) {
                                console.error(`[${timestamp()}] [${clientId}] Error forwarding Transcript event:`, error);
                            }
                        }
                    });

                    dgConn.on(LiveTranscriptionEvents.Metadata, (data) => {
                        if (!connectionState.isClosing) {
                            try {
                                console.log(`[${timestamp()}] [${clientId}] Forwarding Metadata event:`, JSON.stringify(data));
                                sendToClient(data);
                            } catch (error) {
                                console.error(`[${timestamp()}] [${clientId}] Error forwarding Metadata event:`, error);
                            }
                        }
                    });

                    dgConn.on(LiveTranscriptionEvents.SpeechStarted, (data) => {
                        if (!connectionState.isClosing) {
                            try {
                                console.log(`[${timestamp()}] [${clientId}] Forwarding SpeechStarted event:`, JSON.stringify(data));
                                sendToClient(data);
                            } catch (error) {
                                console.error(`[${timestamp()}] [${clientId}] Error forwarding SpeechStarted event:`, error);
                            }
                        }
                    });

                    dgConn.on(LiveTranscriptionEvents.SpeechFinished, (data) => {
                        if (!connectionState.isClosing) {
                            try {
                                console.log(`[${timestamp()}] [${clientId}] Forwarding SpeechFinished event:`, JSON.stringify(data));
                                sendToClient(data);
                            } catch (error) {
                                console.error(`[${timestamp()}] [${clientId}] Error forwarding SpeechFinished event:`, error);
                            }
                        }
                    });

                    dgConn.on(LiveTranscriptionEvents.UtteranceEnd, (data) => {
                        if (!connectionState.isClosing) {
                            try {
                                console.log(`[${timestamp()}] [${clientId}] Forwarding UtteranceEnd event:`, JSON.stringify(data));
                                sendToClient(data);
                            } catch (error) {
                                console.error(`[${timestamp()}] [${clientId}] Error forwarding UtteranceEnd event:`, error);
                            }
                        }
                    });
                    
                    dgConn.on(LiveTranscriptionEvents.Unhandled, (data) => {
                        if (!connectionState.isClosing) {
                            try {
                                console.log(`[${timestamp()}] [${clientId}] Forwarding Unhandled event:`, JSON.stringify(data));
                                sendToClient(data);
                            } catch (error) {
                                console.error(`[${timestamp()}] [${clientId}] Error forwarding Unhandled event:`, error);
                            }
                        }
                    });

dgConn.on(LiveTranscriptionEvents.SpeechFinished, (data) => {
    if (!connectionState.isClosing) {
        try {
            console.log(`[${timestamp()}] [${clientId}] Forwarding SpeechFinished event:`, JSON.stringify(data));
            sendToClient(data);
        } catch (error) {
            console.error(`[${timestamp()}] [${clientId}] Error forwarding SpeechFinished event:`, error);
        }
    }
});
                } catch (error) {
                    clearTimeout(timeoutId);
                    reject(error);
                }
            });
        }

        /**
         * Sends data to the connected client
         * @param {Object} data - Data to send to client
         */
        function sendToClient(data) {
            if (clientWs.readyState === WebSocket.OPEN && !connectionState.isClosing) {
                try {
                    clientWs.send(JSON.stringify(data));
                    console.log(`[${timestamp()}] [${clientId}] Sent message to client`);
                } catch (error) {
                    console.error(`[${timestamp()}] [${clientId}] Error sending to client:`, error);
                }
            }
        }

        /**
         * Cleans up all connections and resources
         */
        function terminateConnection() {
            connectionState.isClosing = true;
            
            // Clear ping interval
            if (pingInterval) {
                clearInterval(pingInterval);
            }
            
            // Cleanup Deepgram connection
            if (connectionState.dgConnection) {
                try {
                    connectionState.dgConnection.finish();
                } catch (error) {
                    console.error(`[${timestamp()}] [${clientId}] Error closing Deepgram connection:`, error);
                }
                connectionState.dgConnection = null;
            }
            
            // Remove from active connections
            activeConnections.delete(clientId);
            
            // Close WebSocket connection
            try {
                if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.close();
                }
            } catch (error) {
                console.error(`[${timestamp()}] [${clientId}] Error closing client connection:`, error);
            }
            
            console.log(`[${timestamp()}] [${clientId}] Connection terminated. Active connections: ${activeConnections.size}`);
        }

        // Setup keepalive ping
        const pingInterval = setInterval(() => {
            if (!connectionState.isAlive && !connectionState.isClosing) {
                console.log(`[${timestamp()}] Client ${clientId} unresponsive, terminating connection`);
                terminateConnection();
                return;
            }
            connectionState.isAlive = false;
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.ping();
            }
        }, 30000);

        // Handle pong responses
        clientWs.on('pong', () => {
            connectionState.isAlive = true;
        });

        // Initialize Deepgram connection
        try {
            const dgConn = await initializeDeepgramConnection();
            if (!connectionState.isClosing && dgConn) {
                console.log(`[${timestamp()}] [${clientId}] Connection initialized successfully`);
                sendToClient({ type: 'ready' });
            }
        } catch (error) {
            console.error(`[${timestamp()}] [${clientId}] Failed to initialize connection:`, error);
            terminateConnection();
            return;
        }

        // Handle incoming messages
        clientWs.on('message', async (data) => {
            if (connectionState.isClosing) return;

            console.log(`[${timestamp()}] [${clientId}] Received message, length: ${data?.length || 0}`);

            try {
                // Try to parse as JSON first
                const jsonMessage = JSON.parse(data.toString());
                if (jsonMessage.type === 'stop') {
                    console.log(`[${timestamp()}] [${clientId}] Received stop command`);
                    if (connectionState.dgConnection) {
                        connectionState.dgConnection.finish();
                        connectionState.dgConnection = null;
                    }
                }
            } catch (e) {
                // Not JSON, assume it's audio data
                if (!connectionState.dgConnection) {
                    console.log(`[${timestamp()}] [${clientId}] No active Deepgram connection, reinitializing...`);
                    try {
                        connectionState.dgConnection = await initializeDeepgramConnection();
                    } catch (error) {
                        console.error(`[${timestamp()}] [${clientId}] Reinitialization failed:`, error);
                        return;
                    }
                }

                try {
                    if (connectionState.dgConnection) {
                        connectionState.dgConnection.send(data);
                        console.log(`[${timestamp()}] [${clientId}] Forwarded audio chunk: ${data.length} bytes`);
                    }
                } catch (error) {
                    console.error(`[${timestamp()}] [${clientId}] Error sending to Deepgram:`, error);
                    sendToClient({
                        type: 'error',
                        message: 'Failed to process audio'
                    });
                }
            }
        });

        // Handle client disconnect
        clientWs.on('close', () => {
            console.log(`[${timestamp()}] [${clientId}] Client disconnected`);
            terminateConnection();
        });

        // Handle errors
        clientWs.on('error', (error) => {
            console.error(`[${timestamp()}] [${clientId}] Client WebSocket error:`, error);
            terminateConnection();
        });
    });

    return {
        getConnectionCount: () => activeConnections.size
    };
};

module.exports = { setupWebSocketProxy };