const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');
const WebSocket = require('ws');

const setupWebSocketProxy = (wss) => {
    console.log('WebSocket server initialized');
    
    
    wss.on('connection', (clientWs, req) => {
        console.log(`New client connected from ${req.socket.remoteAddress}`);
        let dgConnection = null;

        // Handle messages from client
        clientWs.on('message', async (data) => {
            try {
                // First try to parse as JSON for control messages
                const controlMessage = JSON.parse(data.toString());
                if (controlMessage.type === 'start') {
                    // Initialize Deepgram connection when recording starts
                    initializeDeepgramConnection();
                } else if (controlMessage.type === 'stop') {
                    // Close Deepgram connection when recording stops
                    if (dgConnection) {
                        dgConnection.finish();
                        dgConnection = null;
                    }
                }
            } catch (e) {
                // If not JSON, treat as audio data
                if (dgConnection) {
                    try {
                        dgConnection.send(data);
                        console.log(`Forwarded audio chunk: ${data.length} bytes`);
                    } catch (error) {
                        console.error('Error sending to Deepgram:', error);
                    }
                }
            }
        });

        function initializeDeepgramConnection() {
            try {
                console.log('Creating Deepgram client...');
                const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

                console.log('Initializing live transcription...');
                dgConnection = deepgram.listen.live({ 
                    language: 'en',
                    model: 'nova-2',
                    punctuate: true,
                    interim_results: true

                    
                });

                // Wait for connection to open
                dgConnection.on(LiveTranscriptionEvents.Open, () => {
                    console.log('Deepgram connection opened');
                    clientWs.send(JSON.stringify({ type: 'deepgramReady' }));

                    // Set up transcript handler after connection is open
                    dgConnection.on(LiveTranscriptionEvents.Transcript, (data) => {
                        console.log('Received transcript:', data);
                        if (clientWs.readyState === WebSocket.OPEN) {
                            try {
                                clientWs.send(JSON.stringify({
                                    type: 'Results',
                                    channel: {
                                        alternatives: [{
                                            transcript: data.channel?.alternatives?.[0]?.transcript || ''
                                        }]
                                    }
                                }));
                            } catch (error) {
                                console.error('Error sending transcript to client:', error);
                            }
                        }
                    });
                });

                // Handle errors
                dgConnection.on(LiveTranscriptionEvents.Error, (error) => {
                    console.error('Deepgram connection error:', error);
                });

                // Handle close
                dgConnection.on(LiveTranscriptionEvents.Close, () => {
                    console.log('Deepgram connection closed');
                    dgConnection = null;
                });

            } catch (error) {
                console.error('Error initializing Deepgram:', error);
                clientWs.send(JSON.stringify({
                    type: 'error',
                    message: 'Failed to initialize Deepgram connection'
                }));
            }
        }

        // Handle client disconnect
        clientWs.on('close', () => {
            console.log('Client disconnected');
            if (dgConnection) {
                dgConnection.finish();
                dgConnection = null;
            }
        });

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