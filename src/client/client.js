// DOM elements references (unchanged)

// WebSocket and MediaRecorder instances
let websocket = null;
let mediaRecorder = null;
const USE_LINEAR16 = true;

// Configuration state
let currentEndpoint = null;

// Enhanced logging utility
const log = {
    info: (phase, message, data) => {
        const logMessage = `[Phase:${phase}] ${message}`;
        console.log(logMessage, data || '');
        updateStatus(message);
    },
    error: (phase, message, error) => {
        const logMessage = `[Phase:${phase}] Error: ${message}`;
        console.error(logMessage, error);
        updateStatus(`Error: ${message}`);
    },
    debug: (phase, message, data) => {
        const logMessage = `[Phase:${phase}] ${message}`;
        console.debug(logMessage, data || '');
    }
};

// Helper function to update status
function updateStatus(message) {
    if (statusText) {
        statusText.textContent = message;
    }
}

function getWebSocketUrl() {
    log.debug('Setup', 'Getting WebSocket URL');
    switch (connectionType.value) {
        case 'local':
            return 'ws://localhost:3000';  // WebSocket server port
        case 'custom':
            return currentEndpoint || wsEndpoint.value;
        default:
            return 'ws://localhost:3000';
    }
}

function initializeWebSocket() {
    if (websocket) {
        log.info('Cleanup', 'Closing existing WebSocket connection');
        websocket.close();
        websocket = null;
    }
    
    const wsUrl = getWebSocketUrl();
    log.debug('Init', 'Initializing WebSocket connection to', wsUrl);
    
    try {
        log.info('Connection', 'Attempting WebSocket connection');
        const ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
            log.info('Connection', 'WebSocket connection opened');
            startButton.disabled = false;
            stopButton.disabled = true;
            updateStatus('Connected');
            
            // Send a ping every 30 seconds to keep the connection alive
            setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    log.debug('Heartbeat', 'Sending ping');
                    ws.send('ping');
                }
            }, 30000);
        };

        ws.onclose = () => {
            log.info('Connection', 'WebSocket connection closed');
            startButton.disabled = true;
            stopButton.disabled = true;
            updateStatus('Disconnected');
            // Try to reconnect for local server
            if (connectionType.value === 'local') {
                setTimeout(initializeWebSocket, 2000);
            }
        };

        ws.onerror = (error) => {
            log.error('Connection', 'WebSocket error occurred', error);
            startButton.disabled = true;
            stopButton.disabled = true;
            updateStatus('Connection error');
        };

        ws.onmessage = (event) => {
            log.debug('Message', 'Received message from server');
            try {
                const result = JSON.parse(event.data);
                if (result.type === 'Results') {
                    const transcript = result.channel?.alternatives?.[0]?.transcript;
                    if (transcript?.trim()) {
                        const p = document.createElement('p');
                        p.textContent = transcript;
                        transcriptionText.appendChild(p);
                        transcriptionText.scrollTop = transcriptionText.scrollHeight;
                    }
                }
            } catch (error) {
                log.error('Message', 'Error parsing message:', error);
            }
        };

        return ws;
    } catch (error) {
        log.error('Init', 'Failed to create WebSocket:', error);
        return null;
    }
}

async function startRecording() {
    try {
        log.info('Recording', 'Requesting audio permissions');
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                sampleRate: 16000,
                echoCancellation: true,
                noiseSuppression: true
            }
        });
        
        log.info('Recording', 'Audio permissions granted');
        
        if (USE_LINEAR16) {
            log.debug('Audio', 'Setting up LINEAR16 audio processing');
            const audioContext = new AudioContext({ sampleRate: 16000 });
            const source = audioContext.createMediaStreamSource(stream);
            const processor = audioContext.createScriptProcessor(4096, 1, 1);

            log.debug('Audio', 'Connecting audio nodes');
            source.connect(processor);
            processor.connect(audioContext.destination);

            processor.onaudioprocess = (e) => {
                if (websocket?.readyState === WebSocket.OPEN) {
                    const inputData = e.inputBuffer.getChannelData(0);
                    const pcmData = new Int16Array(inputData.length);
                    for (let i = 0; i < inputData.length; i++) {
                        pcmData[i] = Math.min(1, Math.max(-1, inputData[i])) * 0x7FFF;
                    }
                    log.debug('Audio', `Sending audio chunk: ${pcmData.length} samples`);
                    websocket.send(pcmData.buffer);
                }
            };

            mediaRecorder = {
                state: 'recording',
                stop: () => {
                    log.info('Recording', 'Stopping audio processing');
                    processor.disconnect();
                    source.disconnect();
                    stream.getTracks().forEach(track => track.stop());
                    audioContext.close();
                    mediaRecorder.state = 'inactive';
                    startButton.disabled = false;
                    stopButton.disabled = true;
                    updateStatus('Recording stopped');
                }
            };
        }

        startButton.disabled = true;
        stopButton.disabled = false;
        updateStatus('Recording...');
        
    } catch (error) {
        log.error('Recording', 'Failed to start recording:', error);
        updateStatus('Could not start recording');
    }
}

function stopRecording() {
    log.info('Recording', 'Stop recording requested');
    if (mediaRecorder?.state !== 'inactive') {
        mediaRecorder.stop();
        if (websocket?.readyState === WebSocket.OPEN) {
            log.debug('Connection', 'Sending stop command to server');
            websocket.send(JSON.stringify({ type: 'stop' }));
        }
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    log.info('Setup', 'Initializing application');
    if (startButton && stopButton && statusText && transcriptionText) {
        websocket = initializeWebSocket();
    }
});

connectionType.addEventListener('change', () => {
    log.info('Setup', 'Connection type changed');
    customEndpoint.style.display = 
        connectionType.value === 'custom' ? 'block' : 'none';
    websocket = initializeWebSocket();
});

applyEndpoint.addEventListener('click', () => {
    if (wsEndpoint.value) {
        log.info('Setup', 'Applying custom endpoint');
        currentEndpoint = wsEndpoint.value;
        websocket = initializeWebSocket();
        startButton.disabled = false; 
    }
});

startButton?.addEventListener('click', startRecording);
stopButton?.addEventListener('click', stopRecording);
testButton?.addEventListener('click', async () => {
    log.info('Test', 'Running connection test');
    if (websocket) {
        log.info('Test', `WebSocket state: ${websocket.readyState}`);
    }
    try {
        const permission = await navigator.permissions.query({ name: 'microphone' });
        log.info('Test', `Microphone permission: ${permission.state}`);
    } catch (error) {
        log.error('Test', 'Permission query failed:', error);
    }
});

window.addEventListener('beforeunload', () => {
    log.info('Cleanup', 'Page unloading, cleaning up connections');
    if (mediaRecorder?.state !== 'inactive') {
        stopRecording();
    }
    if (websocket) {
        websocket.close();
    }
});