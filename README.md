```markdown
# Deepgram WebSocket Proxy

A WebSocket proxy server that enables real-time speech-to-text transcription using Deepgram's API. This application includes both a client interface for audio recording and a server component that handles WebSocket connections and Deepgram integration.

## Features

- Real-time audio transcription using Deepgram
- WebSocket-based communication 
- Support for both local development and Cloud Run deployment
- Browser-based client interface
- Linear16 audio encoding support
- Connection state management and error handling
- Firebase Authentication integration
- Secure token-based access

## Prerequisites

- Node.js (v18 or later recommended)
- Docker (for Cloud Run deployment)
- Google Cloud CLI (for deployment)
- A Deepgram API key
- Firebase project and service account credentials

## Project Structure

```
├── src/
│   ├── client/           # Client application
│   │   ├── index.js      # Client server
│   │   ├── client.js     # WebSocket client
│   │   └── index.html    # Web interface
│   └── server/           # WebSocket server
│       ├── index.js      # Server entry point (with auth)
│       ├── index_old.js  # Server without auth (for testing)
│       └── proxy.js      # Deepgram proxy logic
├── config/               # Configuration files
├── Dockerfile           # For Cloud Run deployment
└── package.json
```

## Authentication Setup

1. Firebase Configuration:
   - Create a Firebase project
   - Generate service account key from Firebase Console
   - Save as service-account.json

2. Create Cloud Run Secrets:
   ```bash
   gcloud secrets create firebase-creds --project=YOUR_PROJECT_ID --data-file=service-account.json
   gcloud secrets create deepgram-key --data-file=<(echo -n "your_deepgram_api_key")
   ```

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file in the root directory:
   ```
   FIREBASE_CREDENTIALS=<content of service-account.json>
   DEEPGRAM_API_KEY=your_deepgram_api_key
   ```

3. Run both client and server in development mode:
   ```bash
   npm run dev
   ```

This will start:
- Client server on http://localhost:8000
- WebSocket server on port 8080

4. Testing Options:
   - With Authentication (index.js):
     - Requires valid Firebase token
     - Token passed as 'auth_token' query parameter
   - Without Authentication (index_old.js):
     - Quick testing without auth requirements
     - Modify server startup to use index_old.js

## Cloud Run Deployment

1. Build the Docker image:
   ```bash
   docker build --platform linux/amd64 -t gcr.io/YOUR_PROJECT_ID/deepgram-proxy .
   ```

2. Push to Google Container Registry:
   ```bash
   docker push gcr.io/YOUR_PROJECT_ID/deepgram-proxy
   ```

3. Deploy to Cloud Run with secrets:
   ```bash
   gcloud run deploy deepgram-proxy \
     --image gcr.io/YOUR_PROJECT_ID/deepgram-proxy \
     --platform managed \
     --region us-central1 \
     --allow-unauthenticated \
     --session-affinity \
     --set-secrets=FIREBASE_CREDENTIALS=firebase-creds:latest,DEEPGRAM_API_KEY=deepgram-key:latest
   ```

4. After deployment:
   - Copy the service URL provided by Cloud Run
   - Open the client application (http://localhost:8000)
   - Select "Cloud Run Server"
   - Enter the service URL (without 'https://')
   - Click "Connect" and test the transcription

## Testing

1. Local Testing:
   - Start the development servers: `npm run dev`
   - Open http://localhost:8000
   - Use the "Test Connection" button to verify WebSocket connectivity
   - Start recording to test audio transcription

2. Cloud Run Testing:
   - Deploy using the instructions above
   - Connect to the Cloud Run endpoint
   - Verify WebSocket connection
   - Test audio transcription

3. Authentication Testing:
   - Verify token generation in client
   - Check token validation logs in server
   - Test with invalid/expired tokens
   - Test with no token

## Configuration

The application can be configured through:
- Environment variables (`.env` file)
- `config/default.json` for server settings
- Client-side connection settings in the web interface
- Firebase configuration for authentication

## Security Notes

- All requests require valid Firebase authentication token
- Tokens expire after 1 hour and need refresh
- WebSocket connections maintain validity until disconnected
- Deepgram API key is secured in Cloud Run secrets

## Limitations

- Audio must be in LINEAR16 format (16-bit PCM)
- WebSocket connections require session affinity in Cloud Run
- Browser must support WebSocket and Audio APIs
- Tokens must be refreshed periodically

## Troubleshooting

1. Connection Issues:
   - Verify the WebSocket URL is correct
   - Check browser console for errors
   - Ensure Cloud Run service is deployed correctly
   - Verify token is valid and not expired

2. Audio Issues:
   - Grant microphone permissions in browser
   - Check audio input device
   - Verify audio format settings

3. Authentication Issues:
   - Check Firebase configuration
   - Verify token generation
   - Check server logs for auth errors
   - Try index_old.js to isolate auth problems

## License

ISC License
```