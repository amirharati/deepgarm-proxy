FROM node:18

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY src/server ./src/server
COPY config ./config

EXPOSE 8080

CMD ["node", "src/server/index.js"]


#FROM node:18

#WORKDIR /app

#COPY package*.json ./
#RUN npm install

#COPY server.js .

#ENV PORT=8080
#ENV NODE_ENV=production

# Explicitly set the protocol
#ENV HTTP_PROTOCOL=http1

#EXPOSE 8080

#CMD ["node", "server.js"]