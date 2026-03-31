# syntax=docker/dockerfile:1

FROM node:23-slim AS base

RUN apt-get update && apt-get install -y \
  python3 \
  make \
  g++ \
  git \
  && rm -rf /var/lib/apt/lists/*

ENV ELIZAOS_TELEMETRY_DISABLED=true
ENV DO_NOT_TRACK=1

WORKDIR /app

RUN npm install -g bun

COPY package.json bun.lock ./
COPY patches/ patches/
RUN bun install --frozen-lockfile || bun install

COPY . .

# Build frontend
RUN cd frontend && npm install && npm run build

# Build TypeScript
RUN bun run node_modules/.bin/tsc

# Create data directory for SQLite
RUN mkdir -p /app/data

EXPOSE 3000 3001

ENV NODE_ENV=production
ENV SERVER_PORT=3000

CMD ["bun", "run", "start"]
