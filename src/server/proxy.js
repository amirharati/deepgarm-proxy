const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');
const WebSocket = require('ws');

/**
 * Returns ISO timestamp for consistent logging
 * @returns {string} ISO timestamp
 */
function timestamp() {
    return new Date().toISOString();
}

function sanitizeEventData(data) {
    const sanitized = JSON.parse(JSON.stringify(data));
    const ourApiKey = process.env.DEEPGRAM_API_KEY || config.deepgram.key;
    
    // Known sensitive field names
    const sensitiveFields = [
        'key',
        'Authorization',
        'headers',
        '_tlsOptions',
        'secureContext',
        'ssl',
        '_socket',
        'request_id',
        '_readableState',
        '_writableState',
        'baseUrl'
    ];
    
    function removeSensitiveInfo(obj) {
        if (typeof obj !== 'object' || obj === null) return;
        
        // Remove known sensitive fields
        for (const field of sensitiveFields) {
            delete obj[field];
        }
        
        // Remove any instance of our API key
        for (const [key, value] of Object.entries(obj)) {
            if (value === ourApiKey) {
                delete obj[key];
            }
        }
        
        // Recurse through nested objects
        for (const value of Object.values(obj)) {
            removeSensitiveInfo(value);
        }
    }
    
    removeSensitiveInfo(sanitized);
    return sanitized;
}

/**
 * Retrieves Deepgram API key from config or environment
 * @param {Object} externalConfig - Configuration object
 * @returns {string} Deepgram API key
 * @throws {Error} If no API key is found
 */
function getDeepgramKey(externalConfig) {
    console.log(`[${timestamp()}] Checking for Deepgram API key...`);
    
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
    const activeConnections = new Map();

    wss.on('connection', async (clientWs, req) => {
        const clientId = Math.random().toString(36).substring(7);
        console.log(`[${timestamp()}] New client connected - ID: ${clientId}, IP: ${req.socket.remoteAddress}`);
        
        const connectionState = {
            dgConnection: null,
            isAlive: true,
            isClosing: false
        };
        
        activeConnections.set(clientId, connectionState);
        console.log(`[${timestamp()}] Active connections: ${activeConnections.size}`);

        /**
         * Sends data to the connected client
         * @param {Object} data - Data to send to client
         */
        function sendToClient(data) {
            if (clientWs.readyState === WebSocket.OPEN && !connectionState.isClosing) {
                try {
             
                    clientWs.send(JSON.stringify(data));
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
            
            if (pingInterval) {
                clearInterval(pingInterval);
            }
            
            if (connectionState.dgConnection) {
                try {
                    connectionState.dgConnection.finish();
                } catch (error) {
                    console.error(`[${timestamp()}] [${clientId}] Error closing Deepgram connection:`, error);
                }
                connectionState.dgConnection = null;
            }
            
            activeConnections.delete(clientId);
            
            try {
                if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.close();
                }
            } catch (error) {
                console.error(`[${timestamp()}] [${clientId}] Error closing client connection:`, error);
            }
            
            console.log(`[${timestamp()}] [${clientId}] Connection terminated. Active connections: ${activeConnections.size}`);
        }

        /**
         * Initializes connection to Deepgram service
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
                }, 10000);

                try {
                    console.log(`[${timestamp()}] [${clientId}] Creating Deepgram client...`);
                    const deepgram = createClient(apiKey);

                    console.log(`[${timestamp()}] [${clientId}] Using Deepgram parameters:`, externalConfig.server.deepgramParams);
                    const dgConn = deepgram.listen.live(externalConfig.server.deepgramParams);

                    // Handle Open event - needs special handling for connection state
                    dgConn.on(LiveTranscriptionEvents.Open, (data) => {
                        try {
                            data = sanitizeEventData(data);
                            // Handle connection state first
                            clearTimeout(timeoutId);
                            console.log(`[${timestamp()}] [${clientId}] Deepgram connection opened`);
                            connectionState.dgConnection = dgConn;
                            
                            // Forward the event if not closing
                            if (!connectionState.isClosing) {
                                console.log(`[${timestamp()}] [${clientId}] Forwarding Open event:`, JSON.stringify(data));
                                sendToClient(data);
                            }
                            
                            resolve(dgConn);
                        } catch (error) {
                            console.error(`[${timestamp()}] [${clientId}] Error handling Open event:`, error);
                            reject(error);
                        }
                    });

                    // Handle Close event - needs special handling for connection cleanup
                    dgConn.on(LiveTranscriptionEvents.Close, (data) => {
                        try {
                            data = sanitizeEventData(data);
                            // Forward the event if not closing
                            if (!connectionState.isClosing) {
                                console.log(`[${timestamp()}] [${clientId}] Forwarding Close event:`, JSON.stringify(data));
                                sendToClient(data);
                            }
                            
                            // Clean up connection state
                            if (connectionState.dgConnection === dgConn) {
                                console.log(`[${timestamp()}] [${clientId}] Clearing Deepgram connection reference`);
                                connectionState.dgConnection = null;
                            }
                        } catch (error) {
                            console.error(`[${timestamp()}] [${clientId}] Error handling Close event:`, error);
                        }
                    });

                    // Handle Error event - needs special handling for connection errors
                    dgConn.on(LiveTranscriptionEvents.Error, (data) => {
                        try {
                            data = sanitizeEventData(data);
                            console.error(`[${timestamp()}] [${clientId}] Deepgram connection error:`, data);
                            
                            // Forward the error if not closing
                            if (!connectionState.isClosing) {
                                console.log(`[${timestamp()}] [${clientId}] Forwarding Error event:`, JSON.stringify(data));
                                sendToClient(data);
                            }
                            
                            // Handle initialization errors
                            if (!connectionState.dgConnection) {
                                clearTimeout(timeoutId);
                                reject(data);
                            }
                        } catch (error) {
                            console.error(`[${timestamp()}] [${clientId}] Error handling Error event:`, error);
                        }
                    });

                    // Setup handlers for remaining events
                    [
                        LiveTranscriptionEvents.Warning,
                        LiveTranscriptionEvents.Transcript,
                        LiveTranscriptionEvents.Metadata,
                        LiveTranscriptionEvents.SpeechStarted,
                        LiveTranscriptionEvents.SpeechFinished,
                        LiveTranscriptionEvents.UtteranceEnd,
                        LiveTranscriptionEvents.Unhandled
                    ].forEach(eventName => {
                        dgConn.on(eventName, (data) => {
                            if (!connectionState.isClosing) {
                                try {
                                    // Only sanitize Warning and Metadata events
                                    const eventData = (eventName === LiveTranscriptionEvents.Warning || 
                                                     eventName === LiveTranscriptionEvents.Metadata || LiveTranscriptionEvents.Unhandled) 
                                        ? sanitizeEventData(data) 
                                        : data;
                                    
                                    console.log(`[${timestamp()}] [${clientId}] Forwarding ${eventName} event:`, 
                                        JSON.stringify(eventData));
                                    sendToClient(eventData);
                                } catch (error) {
                                    console.error(`[${timestamp()}] [${clientId}] Error forwarding ${eventName} event:`, 
                                        error);
                                }
                            }
                        });
                    });

                } catch (error) {
                    clearTimeout(timeoutId);
                    reject(error);
                }
            });
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

            //console.log(`[${timestamp()}] [${clientId}] Received message, length: ${data?.length || 0}`);

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
                        //console.log(`[${timestamp()}] [${clientId}] Forwarded audio chunk: ${data.length} bytes`);
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