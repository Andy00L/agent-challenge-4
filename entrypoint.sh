#!/bin/sh
set -e

# Override ElizaOS port to 3002 (nginx will proxy to it on 3000)
export SERVER_PORT=3002

# Allow CORS from any origin (nginx handles routing, API token handles auth)
export CORS_ORIGIN="*"

# Start ElizaOS in background
bun run start &
ELIZA_PID=$!

# Wait for Fleet API to be ready (last thing to start during plugin init)
echo "[AgentForge:Docker] Waiting for ElizaOS + Fleet API..."
for i in $(seq 1 90); do
    if curl -sf http://127.0.0.1:3001/fleet/auth/token > /dev/null 2>&1; then
        echo "[AgentForge:Docker] Fleet API ready on port 3001"
        break
    fi
    if [ "$i" -eq 90 ]; then
        echo "[AgentForge:Docker] Warning: Fleet API not responding after 90s, starting nginx anyway"
    fi
    sleep 1
done

# Start nginx on port 3000 (externally exposed port)
echo "[AgentForge:Docker] Starting nginx reverse proxy on port 3000"
nginx -c /app/nginx.conf &
NGINX_PID=$!

echo "[AgentForge:Docker] AgentForge running — nginx:3000 -> ElizaOS:3002 + Fleet:3001"

# Wait for either process to exit
wait $ELIZA_PID $NGINX_PID
