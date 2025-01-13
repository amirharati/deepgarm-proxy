# Deepgram WebSocket Proxy

A WebSocket proxy server that enables real-time speech-to-text transcription using Deepgram's API. This application includes a production-ready server component with Firebase authentication and credit management, plus a testing client interface for audio recording and transcription.

## Features

- Real-time audio transcription using Deepgram's API
- Firebase Authentication integration
- Sophisticated credit tracking system
- Multi-device support with independent session tracking
- Browser-based test client
- Debug mode for development
- Cloud Run deployment ready
- LINEAR16 audio encoding
- Comprehensive error handling
- WebSocket connection management

## Project Structure

```
├── src/
│   ├── client/              # Test client application
│   │   ├── index.js         # Client server
│   │   ├── client.js        # WebSocket client implementation
│   │   └── index.html       # Web interface
│   └── server/              # WebSocket proxy server
│       ├── index.js         # Main server (with auth/credits)
│       ├── proxy.js         # Deepgram WebSocket proxy
│       └── credit_manager.js # Credit management system
├── config/                  # Configuration files
├── Dockerfile              # For Cloud Run deployment
└── package.json
```

## Prerequisites

- Node.js (v18 or later recommended)
- Google Cloud CLI
- Docker Desktop
- Firebase project
- Deepgram API key

## Environment Variables

Required variables:
- `FIREBASE_CREDENTIALS`: Firebase service account JSON
- `DEEPGRAM_API_KEY`: Your Deepgram API key

Optional variables:
- `DEBUG_MODE`: Set to 'true' to bypass authentication and credit checks (default: false)
- `PORT`: Server port (default: 8080)

## Debug Mode

Debug mode provides simplified testing by:
- Bypassing authentication checks
- Disabling credit verification/tracking
- Using "debug-user" for all connections
- Enabling additional logging

Enable debug mode by setting `DEBUG_MODE=true` in your environment.

## Authentication System

### Token Verification
- Requires Firebase ID token via 'auth_token' query parameter
- Automatic token validation and expiration checking
- Supports multiple concurrent device connections
- Independent session management per device

### Error States
```
401: Missing authentication token
401: Token expired
401: Token revoked
401: Invalid token format
403: Insufficient credits
500: Server/validation errors
```

## Credit Management System

### Credit Tracking Architecture
- Per-user credit pool shared across devices
- Independent session tracking per device
- Credit consumption based on actual transcription events
- Supports concurrent device connections

### Credit Update Process
- Buffers updates to optimize database writes
- Configurable batch size (default: 100 updates)
- Automatic flushing on connection close
- Transaction-based updates prevent race conditions

### Credit Verification
- Initial verification during connection
- Real-time monitoring during transcription
- Shared credit pool across user's devices
- Automatic session termination on credit exhaustion

## Local Development

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file:
```
FIREBASE_CREDENTIALS=<service-account-json>
DEEPGRAM_API_KEY=your_deepgram_api_key
DEBUG_MODE=true  # For testing
```

3. Start development servers:
```bash
# Start test client
npm run start:client # Runs on http://localhost:8000

# Start WebSocket server
npm run start:server # Runs on port 8080

#  Start both test client and Websocket server
npm run dev
```

## Deployment

### 1. Initial Setup

```bash
# Set environment variables for deployment
export PROJECT_ID=$(gcloud config get-value project)
export SERVICE_NAME="deepgram-proxy"
export REGION="us-central1"
export MEMORY="256Mi"  # Optimized for cost and free tier

# Verify your active project
gcloud config get-value project
```

### 2. Firebase Setup

1. Create Firebase project
2. Enable Authentication and Firestore
3. Generate service account key:
   - Project Settings → Service accounts
   - Generate New Private Key
   - Save JSON file

4. Set up Firestore structure:
```
app_data/
  {userId}/
    profile/
      profile_doc/
        content:
          services:
            asr:
              credits: <number>
              usedCredits: <number>
```

### 3. Create Google Cloud Secrets

```bash
# Create Firebase credentials secret
gcloud secrets create firebase-credentials \
  --data-file="$FIREBASE_SA_PATH"

# Create Deepgram API key secret
gcloud secrets create deepgram-key \
  --data-file=<(echo -n "$DEEPGRAM_API_KEY")

# Get the Cloud Run service account email
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format="value(projectNumber)")
SERVICE_ACCOUNT="$PROJECT_NUMBER-compute@developer.gserviceaccount.com"

# Grant access to secrets
gcloud secrets add-iam-policy-binding firebase-credentials \
  --member="serviceAccount:$SERVICE_ACCOUNT" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding deepgram-key \
  --member="serviceAccount:$SERVICE_ACCOUNT" \
  --role="roles/secretmanager.secretAccessor"
```

### 4. Build and Deploy to Cloud Run

```bash
# Authenticate Docker to Google Container Registry
gcloud auth configure-docker

# Build Docker image
docker build --platform linux/amd64 \
  -t gcr.io/$PROJECT_ID/$SERVICE_NAME .

# Push to Container Registry
docker push gcr.io/$PROJECT_ID/$SERVICE_NAME

# Deploy to Cloud Run
gcloud run deploy $SERVICE_NAME \
  --image gcr.io/$PROJECT_ID/$SERVICE_NAME \
  --platform managed \
  --region $REGION \
  --allow-unauthenticated \
  --session-affinity \
  --memory $MEMORY \
  --set-secrets=FIREBASE_CREDENTIALS=firebase-credentials:latest,DEEPGRAM_API_KEY=deepgram-key:latest
```

### Cloud Run Resource Usage and Free Tier

The service is optimized to use 256Mi memory instead of 512Mi to maximize free tier usage:

- Free tier monthly limits:
  - 2 million requests
  - 360,000 vCPU-seconds
  - 780,000 GB-seconds
  - 100,000 container instance hours

For WebSocket connections with 256Mi container:
- 1-minute connections: ~6,000 free/month
- 5-minute connections: ~1,200 free/month
- 10-minute connections: ~600 free/month
- 15-minute connections: ~400 free/month

After free tier, costs per 10-minute connection: ~$0.001

## Testing

### Local Testing (Debug Mode)
1. Enable debug mode in `.env`
2. Start servers: `npm run dev`
3. Open http://localhost:8000
4. Use test client interface:
   - Select "Local Server"
   - Click "Test Connection"
   - Start recording to test transcription

### Production Testing
1. Deploy to Cloud Run
2. Configure test client:
   - Select "Cloud Run Server"
   - Enter service URL
   - Connect with valid Firebase token
   - Test audio transcription

### Multi-Device Testing
1. Connect multiple devices using same user token
2. Verify independent session handling
3. Monitor credit usage across devices
4. Test concurrent transcription

## Troubleshooting

### Common Issues

1. Connection Failures
   - Verify WebSocket URL format
   - Check authentication token
   - Confirm session affinity enabled
   - Verify service is running

2. Authentication Issues
   - Check Firebase configuration
   - Verify token generation
   - Check token expiration
   - Monitor server logs

3. Credit System Issues
   - Verify Firestore structure
   - Check credit allocation
   - Monitor credit updates
   - Check transaction logs

### Debug Mode
Enable debug mode for troubleshooting:
```bash
# Local
DEBUG_MODE=true npm run server

# Cloud Run
gcloud run services update deepgram-proxy \
  --set-env-vars=DEBUG_MODE=true
```

## Security Notes

1. Authentication
   - Use HTTPS/WSS for all connections
   - Regularly rotate service accounts
   - Monitor authentication failures

2. Credit System
   - Use transactions for updates
   - Monitor usage patterns
   - Set up alerts for anomalies

3. Deployment
   - Use secret management
   - Enable audit logging
   - Configure appropriate IAM roles

## License

ISC License