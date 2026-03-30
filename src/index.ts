import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { nosanaPlugin } from './plugins/nosana/index.js';

// Load character at runtime (file is outside src/, can't use static import)
const __dirname = dirname(fileURLToPath(import.meta.url));
const characterPath = resolve(__dirname, '..', 'characters', 'forge-master.character.json');
const character = JSON.parse(readFileSync(characterPath, 'utf-8'));

// Export as Project (not Plugin) so ElizaOS CLI loads the correct character
const project = {
  agents: [
    {
      character,
      plugins: [nosanaPlugin],
      init: async () => {},
    },
  ],
};

export default project;
