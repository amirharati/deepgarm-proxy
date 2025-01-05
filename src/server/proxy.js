const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');
const WebSocket = require('ws');
const EVENTS_TO_SANITIZE = [
    LiveTranscriptionEvents.Open,
    LiveTranscriptionEvents.Close,
    LiveTranscriptionEvents.Warning,
    LiveTranscriptionEvents.Error,
    LiveTranscriptionEvents.Metadata,
    LiveTranscriptionEvents.Unhandled
];

/**
 * Returns ISO timestamp for consistent logging
 * @returns {string} ISO timestamp
 */
function timestamp() {
    return new Date().toISOString();
}

/**
 * Sanitizes event data by removing sensitive information
 * @param {Object} data - Data to sanitize
 * @returns {Object} Sanitized data object
 */
function sanitizeEventData(data) {
    const sanitized = JSON.parse(JSON.stringify(data));
    const ourApiKey = process.env.DEEPGRAM_API_KEY || config.deepgram.key;
    
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
        
        for (const field of sensitiveFields) {
            delete obj[field];
        }
        
        for (const [key, value] of Object.entries(obj)) {
            if (value === ourApiKey) {
                delete obj[key];
            }
        }
        
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
 * Sets up WebSocket proxy to Deepgram service with credit tracking
 * @param {WebSocket.Server} wss - WebSocket server instance
 * @param {Object} externalConfig - Configuration for the proxy
 * @param {EventEmitter} eventEmitter - Event emitter for credit updates
 * @returns {Object} Interface for managing the proxy
 */
const setupWebSocketProxy = (wss, externalConfig = {}, eventEmitter) => {
    const apiKey = getDeepgramKey(externalConfig);
    console.log(`[${timestamp()}] WebSocket server initialized`);
    
    // Track active connections for monitoring and cleanup
    const activeConnections = new Map();

    wss.on('connection', async (clientWs, req) => {
        const clientId = Math.random().toString(36).substring(7);
        const userId = req.userId;  // From enhanced request in index.js
        console.log(`[${timestamp()}] New client connected - ID: ${clientId}, User: ${userId}`);
        
        // Connection state tracking including credit measurement
        const connectionState = {
            dgConnection: null,
            isAlive: true,
            isClosing: false,
            startTime: Date.now(), // Track start time for duration calculation
            totalDuration: 0 // Accumulator for total connection duration
        };
        
        activeConnections.set(clientId, connectionState);

        /**
         * Emit credit usage event for user
         * @param {boolean} isClosed - Whether connection is being closed
         */
        function emitCreditUsage(isClosed = false) {
            const duration = (Date.now() - connectionState.startTime) / 1000; // Convert to seconds
            connectionState.totalDuration += duration;
            
            // Emit credit event for processing
            eventEmitter.emit('credit_update', {
                userId,
                duration,
                isClosed,
                totalDuration: connectionState.totalDuration
            });
            
            // Reset timer for next duration calculation
            connectionState.startTime = Date.now();
            console.log(`[${timestamp()}] Credit usage event - Duration: ${duration}s, Total: ${connectionState.totalDuration}s`);
        }

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
         * Emits final credit usage before cleanup
         */
        function terminateConnection() {
            // Emit final credit update if connection was active
            if (!connectionState.isClosing) {
                emitCreditUsage(true);
                connectionState.isClosing = true;
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
            
            activeConnections.delete(clientId);
            
            // Close client connection
            try {
                if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.close();
                }
            } catch (error) {
                console.error(`[${timestamp()}] [${clientId}] Error closing client connection:`, error);
            }
            
            console.log(`[${timestamp()}] [${clientId}] Connection terminated. Total duration: ${connectionState.totalDuration}s`);
        }

        /**
         * Initializes connection to Deepgram service
         * Sets up event handlers for transcription and credit tracking
         * @returns {Promise<Object>} Deepgram connection instance
         */
        async function initializeDeepgramConnection() {
            if (connectionState.isClosing) return null;

            return new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    reject(new Error('Deepgram connection timeout'));
                }, 10000);

                try {
                    console.log(`[${timestamp()}] [${clientId}] Creating Deepgram client...`);
                    const deepgram = createClient(apiKey);

                    console.log(`[${timestamp()}] [${clientId}] Using Deepgram parameters:`, externalConfig.server.deepgramParams);
                    const dgConn = deepgram.listen.live(externalConfig.server.deepgramParams);

                    // Handle transcription results and credit tracking
                    dgConn.on(LiveTranscriptionEvents.Transcript, (data) => {
                        if (!connectionState.isClosing) {
                            //emitCreditUsage(false);
                            //print(JSON.stringify(data));
                            //console.log(JSON.stringify(data));
                           sendToClient(data);
                        }
                    });

                    dgConn.on(LiveTranscriptionEvents.UtteranceEnd, (data) => {
                        if (!connectionState.isClosing) {
                            // Update credits when speech segment ends
                            emitCreditUsage(false);
                            //sendToClient(data);
                        }
                    });

                    // Setup handlers for all other events
                    [
                        LiveTranscriptionEvents.Open,
                        LiveTranscriptionEvents.Close,
                        LiveTranscriptionEvents.Error,
                        LiveTranscriptionEvents.Warning,
                        LiveTranscriptionEvents.Metadata,
                        LiveTranscriptionEvents.SpeechStarted,
                        LiveTranscriptionEvents.SpeechFinished,
                        LiveTranscriptionEvents.UtteranceEnd,
                        LiveTranscriptionEvents.Unhandled
                    ].forEach(eventName => {
                        dgConn.on(eventName, (data) => {
                            if (!connectionState.isClosing) {
                                const eventData = EVENTS_TO_SANITIZE.includes(eventName) 
                                    ? sanitizeEventData(data) : data;
                                sendToClient(eventData);  // Just send the sanitized data directly
                            }
                        });
                    });

                    clearTimeout(timeoutId);
                    resolve(dgConn);
                } catch (error) {
                    clearTimeout(timeoutId);
                    reject(error);
                }
            });
        }

        // Initialize Deepgram connection
        try {
            connectionState.dgConnection = await initializeDeepgramConnection();
            if (!connectionState.isClosing) {
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

            try {
                // Handle control messages
                const jsonMessage = JSON.parse(data.toString());
                if (jsonMessage.type === 'stop') {
                    console.log(`[${timestamp()}] [${clientId}] Received stop command`);
                    terminateConnection();
                    return;
                }
            } catch (e) {
                // Not JSON, assume it's audio data
                if (connectionState.dgConnection) {
                    connectionState.dgConnection.send(data);
                }
            }
        });

        // Handle client disconnection
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
