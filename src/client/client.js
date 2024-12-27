// DOM elements references
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const statusText = document.getElementById('statusText');
const transcriptionText = document.getElementById('transcriptionText');
const testButton = document.getElementById('testButton');

// WebSocket and MediaRecorder instances
let websocket = null;
let mediaRecorder = null;

// Helper function to update status
function updateStatus(message) {
    if (statusText) {
        statusText.textContent = message;
        console.log('Status updated:', message);
    } else {
        console.error('Status element not found');
    }
}

// Logging utility
const log = {
    info: (message, data) => {
        console.log(`[INFO] ${message}`, data || '');
        updateStatus(message);
    },
    error: (message, error) => {
        console.error(`[ERROR] ${message}`, error);
        updateStatus(`Error: ${message}`);
    },
    debug: (message, data) => {
        console.debug(`[DEBUG] ${message}`, data || '');
    }
};

// WebSocket initialization
function initializeWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    //const wsUrl = `${protocol}//${window.location.host}`;

    const wsUrl = 'wss://16b8-66-23-60-198.ngrok-free.app';
    log.debug(`Initializing WebSocket connection to ${wsUrl}`);
    
    try {
        const ws = new WebSocket(wsUrl);
        log.debug('WebSocket instance created');

        ws.onopen = () => {
            log.info('WebSocket connection opened successfully');
            startButton.disabled = false;
            updateStatus('Connected to server');
        };

        ws.onclose = (event) => {
            log.info(`WebSocket closed. Code: ${event.code}, Reason: ${event.reason}`);
            startButton.disabled = true;
            stopButton.disabled = true;
            updateStatus('Disconnected from server');
        };

        ws.onerror = (error) => {
            log.error('WebSocket error:', error);
            updateStatus('Connection error');
        };

        ws.onmessage = (event) => {
            try {
                const result = JSON.parse(event.data);
                log.debug('Received message:', result);
                
                if (result.type === 'Results') {
                    const transcript = result.channel?.alternatives?.[0]?.transcript;
                    if (transcript && transcript.trim()) {
                        log.info('Transcription:', transcript);
                        const p = document.createElement('p');
                        p.textContent = transcript;
                        transcriptionText.appendChild(p);
                        transcriptionText.scrollTop = transcriptionText.scrollHeight;
                    }
                }
            } catch (error) {
                log.error('Error parsing message:', error);
            }
        };

        return ws;
    } catch (error) {
        log.error('Failed to create WebSocket:', error);
        updateStatus('Failed to connect to server');
        return null;
    }
}

// Recording functions
async function startRecording() {
    log.info('Starting recording...');
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                sampleRate: 16000,
                echoCancellation: true,
                noiseSuppression: true
            }
        });
        
        log.info('Microphone access granted');

        // Send start signal to server
        websocket.send(JSON.stringify({ type: 'start' }));

        mediaRecorder = new MediaRecorder(stream, {
            mimeType: 'audio/webm',
            audioBitsPerSecond: 16000
        });

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0 && websocket?.readyState === WebSocket.OPEN) {
                websocket.send(event.data);
                log.debug(`Sent audio chunk: ${event.data.size} bytes`);
            }
        };

        mediaRecorder.onstart = () => {
            log.info('MediaRecorder started');
            startButton.disabled = true;
            stopButton.disabled = false;
            updateStatus('Recording...');
        };

        mediaRecorder.onstop = () => {
            log.info('MediaRecorder stopped');
            stream.getTracks().forEach(track => track.stop());
            websocket.send(JSON.stringify({ type: 'stop' }));
            startButton.disabled = false;
            stopButton.disabled = true;
            updateStatus('Recording stopped');
        };

        // Start recording with small timeslices for real-time transcription
        mediaRecorder.start(250);
        
    } catch (error) {
        log.error('Failed to start recording:', error);
        updateStatus('Error: Could not start recording');
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    log.debug('Page loaded, initializing...');
    if (startButton && stopButton && statusText && transcriptionText) {
        log.debug('All DOM elements found');
        websocket = initializeWebSocket();
    } else {
        log.error('Required DOM elements not found');
    }
});

startButton?.addEventListener('click', startRecording);
stopButton?.addEventListener('click', stopRecording);
testButton?.addEventListener('click', async () => {
    log.info('Testing connection and permissions...');
    
    if (websocket) {
        log.info(`WebSocket state: ${websocket.readyState}`);
    } else {
        log.error('No WebSocket connection');
    }
    
    try {
        const permission = await navigator.permissions.query({ name: 'microphone' });
        log.info(`Microphone permission: ${permission.state}`);
    } catch (error) {
        log.error('Failed to query microphone permission:', error);
    }
});

// Cleanup
window.addEventListener('beforeunload', () => {
    if (mediaRecorder) {
        stopRecording();
    }
    if (websocket) {
        websocket.close();
    }
});