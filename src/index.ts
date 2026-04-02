// LLM Variable Alias — map canonical vars to ElizaOS expected names
// ElizaOS reads OPENAI_BASE_URL, OPENAI_SMALL_MODEL, OPENAI_LARGE_MODEL internally.
// We use OPENAI_API_URL and MODEL_NAME only. This alias bridges the gap.
if (process.env.OPENAI_API_URL) {
  process.env.OPENAI_BASE_URL = process.env.OPENAI_API_URL;
}
if (process.env.MODEL_NAME) {
  process.env.OPENAI_SMALL_MODEL = process.env.MODEL_NAME;
  process.env.OPENAI_LARGE_MODEL = process.env.MODEL_NAME;
}

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { nosanaPlugin } from './plugins/nosana/index.js';

// Load character at runtime (file is outside src/, can't use static import)
const __dirname = dirname(fileURLToPath(import.meta.url));
const characterPath = resolve(__dirname, '..', 'characters', 'forge-master.character.json');
const character = JSON.parse(readFileSync(characterPath, 'utf-8'));

// Conditionally load Telegram plugin if TELEGRAM_BOT_TOKEN is set
let telegramPlugin: any = null;
if (process.env.TELEGRAM_BOT_TOKEN) {
  try {
    const mod = await (Function('return import("@elizaos/plugin-telegram")')() as Promise<any>);
    telegramPlugin = mod.telegramPlugin || mod.default;
    console.log('[AgentForge] Telegram plugin loaded');
  } catch (e) {
    console.warn('[AgentForge] Telegram plugin not available — install @elizaos/plugin-telegram to enable');
  }
}

// Export as Project (not Plugin) so ElizaOS CLI loads the correct character
const project = {
  agents: [
    {
      character,
      plugins: [nosanaPlugin, ...(telegramPlugin ? [telegramPlugin] : [])],
      init: async () => {},
    },
  ],
};

export default project;
