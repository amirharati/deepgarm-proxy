# Use Node.js LTS version
FROM node:18

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY src/server ./src/server
COPY config ./config

# Set environment variable for the port
ENV PORT=8080

# Expose the port
EXPOSE 8080

# Start the server
CMD ["node", "src/server/index.js"]