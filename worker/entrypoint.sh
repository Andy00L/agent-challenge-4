#!/bin/sh
set -e

# Apply trust proxy fix at runtime (ensures it works even on cached images)
PATCH_FILE="/app/patches/@elizaos%2Fserver@1.7.2.patch"
SERVER_INDEX="/app/node_modules/@elizaos/server/dist/index.js"

if [ -f "$PATCH_FILE" ] && [ -f "$SERVER_INDEX" ]; then
  # Check if patch is already applied
  if ! grep -q "trust proxy" "$SERVER_INDEX" 2>/dev/null || grep -q "trust proxy.*false" "$SERVER_INDEX" 2>/dev/null; then
    echo "[AgentForge:Worker] Applying trust proxy patch..."
    cd /app/node_modules/@elizaos/server
    patch -p1 < "$PATCH_FILE" 2>/dev/null || true
    cd /app
  fi
fi

# Fallback: if patch didn't apply, inject trust proxy directly
if ! grep -q "trust proxy.*1" "$SERVER_INDEX" 2>/dev/null; then
  echo "[AgentForge:Worker] Injecting trust proxy setting..."
  sed -i 's/this\.app = express35()/this.app = express35(); this.app.set("trust proxy", 1)/' "$SERVER_INDEX" 2>/dev/null || true
fi

echo "[AgentForge:Worker] Starting ElizaOS..."
exec bun run start
