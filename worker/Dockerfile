FROM node:23-slim

RUN apt-get update && apt-get install -y \
    python3 make g++ git patch ffmpeg \
    && rm -rf /var/lib/apt/lists/*

ENV ELIZAOS_TELEMETRY_DISABLED=true
ENV DO_NOT_TRACK=1

WORKDIR /app

RUN npm install -g bun

COPY package.json bun.lock ./
COPY patches/ ./patches/

RUN bun install

# Apply patches using unix patch (patch-package format is standard unified diff)
RUN cd node_modules/@elizaos/plugin-openai && patch -p1 < /app/patches/@elizaos%2Fplugin-openai@1.6.0.patch || true
RUN cd node_modules/@ai-sdk/openai && patch -p1 < /app/patches/@ai-sdk%2Fopenai@2.0.101.patch || true

COPY tsconfig.json ./
COPY src/ ./src/

RUN bun run build || true

RUN mkdir -p /app/data

EXPOSE 3000

ENV NODE_ENV=production
ENV SERVER_PORT=3000

CMD ["bun", "run", "start"]
