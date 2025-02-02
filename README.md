# Deepgram WebSocket Proxy

A WebSocket proxy server that enables real-time speech-to-text transcription using [Deepgram's API](https://deepgram.com/). This solution combines a production-grade server with Firebase authentication and credit management, alongside a testing client interface for audio recording and transcription. I have implemented this proxy in several projects, including [AI Study Buddy](https://www.idealabs.ai/products/ai-study-buddy).


**Note**: This documentation and codebase were developed with AI/LLM assistance. 

## Features

- Real-time audio transcription using Deepgram's API
- Firebase Authentication integration
- Credit tracking system per user
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

gcloud run services update deepgram-proxy --timeout=3600
```
The last command is to set the timeout to 3600. Currently when running on cloud run this is maximum connection time. The client has to reconnect for longer connections.

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



## Domain and Cloudflare Setup

### Prerequisites
- A registered domain configured with Cloudflare
- Cloud Run service already deployed
- gcloud CLI installed and configured

### Resources
- [Cloud Run Custom Domain Mapping Documentation](https://cloud.google.com/run/docs/mapping-custom-domains)
- [Cloudflare SSL/TLS Settings](https://developers.cloudflare.com/ssl/get-started)
- [Cloudflare WebSocket Documentation](https://developers.cloudflare.com/fundamentals/websockets)

### 1. Domain Verification and Mapping
First, verify domain ownership with Google Cloud:
```bash
# Verify domain ownership
gcloud domains verify your-subdomain.yourdomain.com

# Create domain mapping
gcloud beta run domain-mappings create \
  --service=$SERVICE_NAME \
  --region=$REGION \
  --domain=your-subdomain.yourdomain.com

# Check mapping status and get DNS instructions
gcloud beta run domain-mappings describe \
  --region=$REGION \
  --domain=your-subdomain.yourdomain.com
```

The mapping status will show:
```
resourceRecords:
  - name: your-subdomain
    rrdata: ghs.googlehosted.com
    type: CNAME
```

Wait for the mapping status to show certificate provisioning message.

### 2. DNS Configuration in Cloudflare
Configure DNS settings in Cloudflare dashboard:

1. Add DNS record:
   - Type: CNAME
   - Name: your-subdomain
   - Target: ghs.googlehosted.com
   - Proxy status: Initially OFF (gray cloud)
   - TTL: Auto

2. Wait for Google's SSL certificate provisioning
3. After verification completes, enable proxy (orange cloud)

### 3. Cloudflare Required Settings

#### SSL/TLS Settings
1. Navigate to SSL/TLS section
2. Set SSL mode to "Full"
3. Configure Edge Certificates:
   - Minimum TLS Version: 1.2 or 1.3
   - Enable Always Use HTTPS
   - Enable HTTP Strict Transport Security (HSTS)
   - Enable Include subdomains for HSTS

#### WebSocket Settings
1. Navigate to Network section
2. Enable WebSocket setting

### 4. Verify Setup
Test your domain setup:

1. HTTP/HTTPS access:
```bash
# Test HTTP endpoint
curl https://your-subdomain.yourdomain.com/health

# Expected response:
# {"status":"OK","timestamp":"..."}
```

2. WebSocket connection:
- Update client WebSocket URL to:
```
wss://your-subdomain.yourdomain.com
```

### Security Configuration
1. SSL/TLS encryption is end-to-end:
   - Client → Cloudflare (Full SSL)
   - Cloudflare → Cloud Run (Google managed SSL)

2. DDoS protection:
   - Provided by Cloudflare free tier
   - Additional protection from Google Cloud

3. Authentication flow:
   - Firebase Authentication tokens still required
   - Credit system remains active
   - Request validation unchanged

### Troubleshooting

1. Certificate Issues:
   - Verify domain mapping status in Cloud Run
   - Check SSL/TLS mode in Cloudflare
   - Ensure DNS propagation is complete

2. Connection Issues:
   - Verify WebSocket setting is enabled
   - Check SSL/TLS mode is set to Full
   - Confirm proxy status is enabled (orange cloud)

3. Common Error Messages:
   - "SSL handshake failed": Check SSL/TLS settings
   - "Domain not verified": Wait for DNS propagation
   - "Certificate pending": Wait for Google's certificate provisioning

### Notes
- Free tier Cloudflare is sufficient for WebSocket proxy
- Cloudflare proxy provides additional security layer
- Changes to DNS settings may take time to propagate



