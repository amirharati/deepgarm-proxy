const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');
const WebSocket = require('ws');
const config = require('config');

const setupWebSocketProxy = (wss) => {
    console.log('WebSocket server initialized');
    
    wss.on('connection', (clientWs, req) => {
        console.log(`New client connected from ${req.socket.remoteAddress}`);
        let dgConnection = null;

        function initializeDeepgramConnection() {
            try {
                console.log('Creating Deepgram client...');
                const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

                console.log('Initializing live transcription...');
                dgConnection = deepgram.listen.live(config.get('server.deepgramParams'));

                dgConnection.on(LiveTranscriptionEvents.Open, () => {
                    console.log('Deepgram connection opened');
                    clientWs.send(JSON.stringify({ type: 'deepgramReady' }));
                });

                dgConnection.on(LiveTranscriptionEvents.Transcript, (data) => {
                    if (clientWs.readyState === WebSocket.OPEN) {
                        try {
                            // Fix zero values
                            if (data.start === 0) data.start = 0.0;
                            
                            clientWs.send(JSON.stringify(data));
                        } catch (error) {
                            console.error('Error sending transcript:', error);
                        }
                    }
                });

                dgConnection.on(LiveTranscriptionEvents.Error, (error) => {
                    console.error('Deepgram connection error:', error);
                    if (clientWs.readyState === WebSocket.OPEN) {
                        clientWs.send(JSON.stringify({
                            type: 'error',
                            message: 'Deepgram transcription error'
                        }));
                    }
                });

                dgConnection.on(LiveTranscriptionEvents.Close, () => {
                    console.log('Deepgram connection closed');
                    dgConnection = null;
                });

                dgConnection.on(LiveTranscriptionEvents.UtteranceEnd, (data) => {
                    if (clientWs.readyState === WebSocket.OPEN) {
                        // Fix zero values in UtteranceEnd too
                        if (data.last_word_end === 0) data.last_word_end = 0.0;
                        clientWs.send(JSON.stringify(data));
                    }
                });

            } catch (error) {
                console.error('Error initializing Deepgram:', error);
                if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({
                        type: 'error',
                        message: 'Failed to initialize Deepgram connection'
                    }));
                }
            }
        }

        // Initialize connection when client connects
        initializeDeepgramConnection();

        // Handle messages from client
        clientWs.on('message', (data) => {
            if (!dgConnection) {
                console.log('No active Deepgram connection, reinitializing...');
                initializeDeepgramConnection();
                return;
            }

            try {
                // Try to parse as JSON first
                const jsonMessage = JSON.parse(data.toString());
                if (jsonMessage.type === 'stop') {
                    console.log('Received stop command');
                    if (dgConnection) {
                        dgConnection.finish();
                        dgConnection = null;
                    }
                }
            } catch (e) {
                // Not JSON, treat as binary audio data
                try {
                    dgConnection.send(data);
                    console.log(`Forwarded audio chunk: ${data.length} bytes`);
                } catch (error) {
                    console.error('Error sending to Deepgram:', error);
                }
            }
        });

        // Handle client disconnect
        clientWs.on('close', () => {
            console.log('Client disconnected');
            if (dgConnection) {
                dgConnection.finish();
                dgConnection = null;
            }
        });

        // Handle client errors
        clientWs.on('error', (error) => {
            console.error('Client WebSocket error:', error);
            if (dgConnection) {
                dgConnection.finish();
                dgConnection = null;
            }
        });
    });
};

module.exports = { setupWebSocketProxy };