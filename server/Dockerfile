FROM node:18-alpine

RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY server/package*.json ./
RUN npm ci --only=production
COPY server/src/ ./src/
COPY skill/ /skill/

RUN mkdir -p /app/data
VOLUME /app/data

EXPOSE 3210
CMD ["node", "src/index.js"]
