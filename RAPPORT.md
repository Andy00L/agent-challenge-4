# RAPPORT D'AUDIT — AgentForge

Date: 2026-03-29
Auditeur: Claude Code (Opus 4.6)

---

## 1. Vue d'ensemble

AgentForge est un meta-agent construit avec ElizaOS v2 (v1.7.2) qui permet de creer, deployer et gerer d'autres agents IA sur le reseau GPU decentralise Nosana, via une conversation en langage naturel. Le projet comporte un backend ElizaOS avec un plugin Nosana custom (5 actions, 1 provider, routes REST), un frontend React 19 avec chat Socket.IO et dashboard fleet temps reel, et une infrastructure Docker/Nosana. L'ensemble compile, build et boot correctement. Credits Nosana: $2.58 disponibles.

## 2. Structure des fichiers

```
./.claude/settings.local.json
./.dockerignore                             (50 lignes)
./.env                                      (41 lignes)
./.env.example                              (46 lignes)
./.gitignore                                (94 lignes)
./ARCHITECTURE.md                           (196 lignes)
./assets/image.png
./assets/NosanaXEliza.jpg
./characters/forge-master.character.json     (105 lignes)
./Dockerfile                                (38 lignes)
./frontend/.gitignore
./frontend/eslint.config.js                 (23 lignes)
./frontend/index.html                       (12 lignes)
./frontend/package.json                     (35 lignes)
./frontend/README.md                        (Vite template boilerplate)
./frontend/src/App.tsx                      (22 lignes)
./frontend/src/components/ChatPanel.tsx     (263 lignes)
./frontend/src/components/FleetDashboard.tsx (145 lignes)
./frontend/src/index.css                    (1 ligne)
./frontend/src/lib/elizaClient.ts           (148 lignes)
./frontend/src/lib/fleetPoller.ts           (47 lignes)
./frontend/src/main.tsx                     (10 lignes)
./frontend/src/stores/chatStore.ts          (39 lignes)
./frontend/src/stores/fleetStore.ts         (40 lignes)
./frontend/tsconfig.app.json               (28 lignes)
./frontend/tsconfig.json                   (7 lignes)
./frontend/tsconfig.node.json              (26 lignes)
./frontend/vite.config.ts                  (27 lignes)
./LICENSE                                   (22 lignes — MIT, Atai Barkai)
./nos_job_def/nosana_eliza_job_definition.json (27 lignes)
./package.json                              (37 lignes)
./patches/@ai-sdk%2Fopenai@2.0.101.patch   (26 lignes)
./patches/@elizaos%2Fplugin-openai@1.6.0.patch (75 lignes)
./RAPPORT.md                                (ce fichier)
./README.md                                 (315 lignes)
./src/index.ts                              (22 lignes)
./src/plugins/nosana/actions/checkFleetStatus.ts (66 lignes)
./src/plugins/nosana/actions/createAgentFromTemplate.ts (128 lignes)
./src/plugins/nosana/actions/deployAgent.ts (87 lignes)
./src/plugins/nosana/actions/scaleReplicas.ts (90 lignes)
./src/plugins/nosana/actions/stopDeployment.ts (96 lignes)
./src/plugins/nosana/index.ts               (105 lignes)
./src/plugins/nosana/providers/fleetStatusProvider.ts (28 lignes)
./src/plugins/nosana/services/nosanaManager.ts (361 lignes)
./src/plugins/nosana/types.ts               (92 lignes)
./src/server/fleetServer.ts                 (28 lignes — CODE MORT)
./TESTS_REPORT.md
./tsconfig.json                             (19 lignes)
```

Totaux: 16 fichiers .ts, 4 fichiers .tsx, 10 fichiers .json, 5 fichiers .md, 1 fichier .css.
Backend: 1103 lignes. Frontend: 741 lignes. Config/infra: 566 lignes.

## 3. Package.json

### 3.1 Backend (racine)

- **name**: `agentforge`
- **version**: `1.0.0`
- **type**: `module`
- **main**: `dist/index.js`
- **private**: `true`
- **Scripts**:
  - `dev`: `concurrently --kill-others "elizaos dev" "cd frontend && npm run dev"`
  - `dev:backend`: `elizaos dev`
  - `dev:frontend`: `cd frontend && npm run dev`
  - `start`: `elizaos start`
  - `build:frontend`: `cd frontend && npm run build`
  - `build`: `tsc && cd frontend && npm run build`
  - `postinstall`: `patch-package`
- **dependencies**:
  - `@elizaos/core` ^1.0.0 (installe: 1.7.2)
  - `@elizaos/plugin-anthropic` ^1.5.12
  - `@elizaos/plugin-bootstrap` ^1.0.0
  - `@elizaos/plugin-openai` ^1.0.0
  - `@elizaos/plugin-web-search` ^1.0.1
  - `@nosana/kit` ^2.2.4 (installe: 2.2.4)
  - `cors` ^2.8.6
  - `express` ^5.2.1
  - `patch-package` ^8.0.1
  - `socket.io` ^4.8.3
- **devDependencies**:
  - `@elizaos/cli` ^1.0.0
  - `concurrently` ^9.2.1
  - `typescript` ^5.0.0
- **patchedDependencies**:
  - `@elizaos/plugin-openai@1.6.0`
  - `@ai-sdk/openai@2.0.101`

### 3.2 Frontend

- **name**: `frontend`
- **version**: `0.0.0`
- **type**: `module`
- **dependencies**: react 19.2.4, react-dom 19.2.4, lucide-react 1.7.0, socket.io-client 4.8.3, zustand 5.0.12
- **devDependencies**: vite 8.0.1, tailwindcss 4.2.2, @tailwindcss/vite 4.2.2, @vitejs/plugin-react 6.0.1, typescript 5.9.3, eslint 9.39.4

## 4. Variables d'environnement

### 4.1 .env (cles presentes)

| Cle | Role | Valeur (masquee) |
|-----|------|-------------------|
| `OPENAI_API_KEY` | Cle API LLM | `nosana` |
| `OPENAI_BASE_URL` | Endpoint LLM Nosana inference | `https://6vq2bc...nos.ci/v1` |
| `OPENAI_SMALL_MODEL` | Modele petit | `Qwen3.5-27B-AWQ-4bit` |
| `OPENAI_LARGE_MODEL` | Modele grand | `Qwen3.5-27B-AWQ-4bit` |
| `MODEL_NAME` | Legacy — passthrough workers | `Qwen3.5-27B-AWQ-4bit` |
| `OPENAI_API_URL` | Legacy — passthrough workers | `https://6vq2bc...nos.ci/v1` |
| `SERVER_PORT` | Port ElizaOS | `3000` |
| `NOSANA_API_KEY` | Cle API Nosana deployments | `nos_q-2fN...` (remplie) |
| `AGENTFORGE_WORKER_IMAGE` | Image Docker workers | `andy00l/agentforge-worker:latest` |

### 4.2 .env.example

Identique a .env sauf:
- `NOSANA_API_KEY=` (vide — mock mode par defaut)
- Ajoute `FLEET_API_PORT=3001`
- Ajoute commentaires Ollama (option B)

### 4.3 Variables utilisees dans le code

```
process.env.AGENTFORGE_WORKER_IMAGE    (createAgentFromTemplate, deployAgent)
process.env.FLEET_API_PORT             (nosana/index.ts — standalone server)
process.env.MODEL_NAME                 (createAgentFromTemplate, deployAgent — legacy fallback)
process.env.NOSANA_API_KEY             (nosana/index.ts, nosanaManager.ts)
process.env.OPENAI_API_KEY             (createAgentFromTemplate, deployAgent)
process.env.OPENAI_API_URL             (createAgentFromTemplate, deployAgent — legacy fallback)
process.env.OPENAI_BASE_URL            (createAgentFromTemplate, deployAgent)
process.env.OPENAI_LARGE_MODEL         (createAgentFromTemplate, deployAgent)
process.env.OPENAI_SMALL_MODEL         (createAgentFromTemplate, deployAgent)
```

Note: `FLEET_API_PORT` n'est pas dans `.env` mais est dans `.env.example`. Valeur par defaut dans le code: `3001`.

## 5. Character file

### 5.1 forge-master.character.json (105 lignes)

- **name**: `AgentForge`
- **username**: `agentforge`
- **plugins**: `@elizaos/plugin-bootstrap`, `@elizaos/plugin-openai`, `@elizaos/plugin-web-search`
- **settings.model**: `Qwen3.5-27B-AWQ-4bit`
- **settings.secrets**: `{}` (vide)
- **system**: Prompt complet de meta-agent (creation, deploiement, gestion fleet)
- **bio**: 4 lignes de description
- **knowledge**: `[]` (vide)
- **messageExamples**: 4 exemples (create monitor, show fleet, scale, stop)
- **postExamples**: `[]`
- **topics**: 6 sujets (AI agents, decentralized compute, Nosana, ...)
- **adjectives**: 5 mots (efficient, powerful, decentralized, ...)
- **style**: all (4 rules), chat (3 rules), post (vide)

**Validation**: JSON valide. Format ElizaOS v2 correct (utilise `name` dans messageExamples, pas `user`). Pas de cles invalides (`clients`, `modelProvider`, `lore` absents — correct pour v2). Plugin `plugin-nosana` absent de la liste car il est injecte via `src/index.ts` au niveau projet.

## 6. Backend — Plugin Nosana

### 6.1 src/index.ts (22 lignes)

- **Imports**: `readFileSync`, `resolve`, `dirname`, `fileURLToPath`, `nosanaPlugin`
- **Exporte**: `default project` (ElizaOS Project, pas Plugin)
- **Fonctionnement**: Charge `characters/forge-master.character.json` via `readFileSync`, cree un objet `project` avec un agent qui a le character + `nosanaPlugin`, et l'exporte en default.

### 6.2 src/plugins/nosana/index.ts (105 lignes)

- **Nom du plugin**: `plugin-nosana`
- **Actions** (5): CREATE_AGENT_FROM_TEMPLATE, DEPLOY_AGENT, CHECK_FLEET_STATUS, SCALE_REPLICAS, STOP_DEPLOYMENT
- **Providers** (1): fleetStatusProvider
- **Routes plugin** (2): `GET /fleet`, `GET /fleet/:id`
- **init()**: Initialise NosanaManager avec la cle API, log les markets GPU et credits disponibles au demarrage, demarre un serveur Express standalone sur port 3001 avec routes: `/fleet`, `/fleet/markets`, `/fleet/credits`, `/fleet/:id`

### 6.3 src/plugins/nosana/types.ts (92 lignes)

**Interfaces**:
- `NosanaDeploymentRecord`: id, name, status (7 valeurs: draft|starting|running|stopping|stopped|error|archived), market, marketAddress, replicas, costPerHour, startedAt, url?, agentTemplate?, agentConfig?
- `FleetStatus`: deployments[], totalCostPerHour, totalReplicas, activeCount

**Constantes**:
- `GPU_MARKETS` — 6 marches GPU (adresses verifiees depuis l'API Nosana le 2026-03-29):
  - `nvidia-3090`: `985pQEVPn7SL5os3Z2iNwBoX4f9Bva334dENweXWyt9t` — $0.13/hr
  - `nvidia-4090`: `97G9NnvBDQ2WpKu6fasoMsAKmfj63C9rhysJnkeWodAf` — $0.29/hr
  - `nvidia-4070`: `EzuHhkrhmV98HWzREsgLenKj2iHdJgrKmzfL8psP8Aso` — $0.09/hr
  - `nvidia-3080`: `7RepDm4Xt9k6qV5oiSHvi8oBoty4Q2tfBGnCYjFLj6vA` — $0.09/hr
  - `nvidia-3060`: `62bAk2ppEL2HpotfPZsscSq4CGEfY6VEqD5dQQuTo7JC` — $0.03/hr
  - `cpu-only`: meme adresse que 3060 — $0.03/hr (pas de marche CPU pur sur Nosana)
- `AGENT_TEMPLATES` — 5 templates: researcher, writer, monitor, publisher, analyst

### 6.4 src/plugins/nosana/services/nosanaManager.ts (361 lignes)

**Classe**: `NosanaManager` (singleton via `getNosanaManager()`)

**Import SDK**: `await import('@nosana/kit')` — dynamic import avec try/catch. Si absent, mock mode.

**Proprietes privees**:
- `client: any` — instance NosanaClient
- `deployments: Map<string, NosanaDeploymentRecord>` — registre en memoire
- `initialized: boolean`, `lastRefresh: number`, `REFRESH_INTERVAL: 15_000`

**Methodes publiques**:
- `createAndStartDeployment(params)` — Credit pre-check, pipe()/create()+start(), status initial 'starting', verification 5s apres
- `scaleDeployment(id, replicas)` — `deployment.updateReplicaCount()`
- `stopDeployment(id)` — `deployment.stop()`
- `refreshDeploymentStatus(id)` — Lit status reel depuis API Nosana, mappe via NOSANA_STATUS_MAP
- `getFleetStatus()` — async, refresh d'abord, puis agrege. Retourne `FleetStatus & { totalSpent }`
- `getDeployment(id)`, `getDeploymentByName(name)` — lookup
- `getMarkets()` — SDK `client.api.markets.list()` avec fallback hardcode
- `getCreditsBalance()` — SDK `client.api.credits.balance()` avec fallback HTTP `/api/credits/balance`
- `getTotalCost()` — calcul cumule runtime * costPerHour

**Mock mode**: Active si pas d'API key, API key = 'YOUR_NOSANA_API_KEY', ou @nosana/kit non importable.

**Status mapping** (`NOSANA_STATUS_MAP`): draft, error, starting, running, stopping, stopped, insufficient_funds->error, archived

### 6.5 Actions (5)

| Action | Lignes | Similes | Validate keywords | Methode extraction |
|--------|--------|---------|-------------------|--------------------|
| CREATE_AGENT_FROM_TEMPLATE | 128 | BUILD/MAKE/NEW/SPAWN/CREATE_AGENT | create, build, make, new agent, i need, i want, spin up, set up | regex extractParams() |
| DEPLOY_AGENT | 87 | LAUNCH_AGENT, RUN_ON_NOSANA, START_DEPLOYMENT | deploy, launch, run+nosana | regex extractDeployParams() |
| CHECK_FLEET_STATUS | 66 | FLEET/LIST/SHOW/MY_AGENTS | fleet, status, my agent, running, show, list, cost | direct getFleetStatus() |
| SCALE_REPLICAS | 90 | SCALE/ADD/RESIZE | scale, replica, increase, decrease | regex extractScaleParams() |
| STOP_DEPLOYMENT | 96 | KILL/SHUTDOWN/TERMINATE/STOP_AGENT | stop, kill, shutdown, terminate | regex extractStopTarget() |

Toutes utilisent `callback()` pour repondre et retournent `{ text, success, data? }`. Pas de `generateObject` — extraction par regex uniquement.

### 6.6 Provider (28 lignes)

- **Nom**: `nosana-fleet-status`
- **get()**: Retourne texte plain avec le status de la fleet, injecte dans le contexte LLM.

### 6.7 src/server/fleetServer.ts (28 lignes — CODE MORT)

Ce fichier n'est importe par aucun autre fichier (confirme par grep). Le serveur standalone est demarre dans `nosanaPlugin.init()`. De plus, il appelle `manager.getFleetStatus()` de maniere synchrone alors que la methode est maintenant async.

## 7. Frontend

### 7.1 Vite config

Proxy: `/api` -> `:3000`, `/fleet` -> `:3001`, `/socket.io` -> `:3000` (ws)
Port dev: 5173. Plugins: react(), tailwindcss().

### 7.2 elizaClient.ts (148 lignes)

Fonctions: `getAgents()`, `startAgent()`, `getOrCreateDmChannel()`, `getMessages()` (non utilisee), `onAgentMessage()`, `connectSocket()`, `joinChannel()`, `sendSocketMessage()`, `disconnectSocket()`.
Messaging primaire: Socket.IO. REST uniquement pour setup. User ID persiste en localStorage.

### 7.3 ChatPanel.tsx (263 lignes)

Flow: getAgents -> find "AgentForge" -> startAgent -> getOrCreateDmChannel -> connectSocket -> joinChannel -> "Connected"
Envoi: `sendSocketMessage()` (event "2"). Reception: `onAgentMessage()` (event "messageBroadcast").
Filtre les messages internes ("Executing action:", "Action:", "[Action]").
Markdown inline: sanitizeHtml + regex (bold, italic, code, listes, line breaks).

### 7.4 FleetDashboard.tsx (145 lignes)

Header avec cout/hr, depense totale, credits balance. 4 stat cards. Liste de AgentCards avec status dot, badge, metrics, URL, ID.

### 7.5 Stores

**chatStore** (39 lignes): messages[], isLoading, agentId
**fleetStore** (40 lignes): deployments[], totalCostPerHour, totalSpent, creditsBalance

### 7.6 fleetPoller.ts (47 lignes)

Fleet: `/fleet?agentId=` toutes les 5s. Credits: `/fleet/credits` toutes les 30s. Erreurs: silencieuses.

## 8. Infrastructure

### 8.1 Dockerfile (38 lignes)

`node:23-slim` -> python3/make/g++/git -> bun -> install deps -> build frontend -> tsc || true -> EXPOSE 3000 -> CMD bun run start

### 8.2 Nosana job definition (27 lignes)

Image: `andy00l/agentforge:latest`, port 3000, NOSANA_API_KEY vide (mock mode).

## 9. Patches

### 9.1 @ai-sdk/openai@2.0.101.patch (26 lignes)

Force `systemMessageMode = "system"` pour compatibilite Qwen3.5 (ne supporte pas "developer").

### 9.2 @elizaos/plugin-openai@1.6.0.patch (75 lignes)

1. `openai.languageModel()` -> `openai.chat()` (2 endroits) — utilise `/v1/chat/completions` au lieu de `/v1/responses`
2. Embedding: fallback zero-vector au lieu de crash quand endpoint indisponible

## 10. Documentation

- **README.md** (315 lignes): Complet mais prix GPU obsoletes ($0.15/$0.30/$0.05 vs $0.13/$0.29/$0.03)
- **ARCHITECTURE.md** (196 lignes): Complet mais ne liste pas getMarkets/getCreditsBalance/refreshAllActiveDeployments
- **TESTS_REPORT.md**: 37 tests, 29 pass, 0 fail, 1 warn, 7 skip

## 11. Compilation et build

| Check | Resultat | Details |
|-------|----------|---------|
| Backend tsc --noEmit | exit 0 | Zero erreurs. strict=false |
| Frontend tsc --noEmit | exit 0 | Zero erreurs. strict=true |
| Frontend vite build | exit 0 | 345ms, 249.50 kB JS, 14.37 kB CSS |

## 12. Tests de fonctionnement

### 12.1 Boot

- ElizaOS 1.7.2 demarre. Character "AgentForge" charge. Plugin-nosana initialise (API key set).
- 14+ marches GPU charges depuis l'API Nosana. Credits: $2.58.
- Fleet API: http://127.0.0.1:3001. Backend: http://localhost:3000.

### 12.2 API

| Endpoint | Port | Status |
|----------|------|--------|
| GET /api/agents | 3000 | OK |
| GET /fleet | 3001 | OK |
| GET /fleet/credits | 3001 | OK |
| GET /fleet/markets | 3001 | OK |

### 12.3 LLM

Endpoint: Nosana inference (Qwen3.5-27B-AWQ-4bit). Methode: /v1/chat/completions (patche). Fonctionne.

### 12.4 Frontend

Connexion: OK. Chat: OK (Socket.IO). Fleet dashboard: OK (polling 5s). Credits: affiches. Markdown: rendu.

## 13. Problemes identifies

### 13.1 — Port 3001 conflit (BASSE)
Le standalone fleet server bind sur 127.0.0.1:3001 avant qu'ElizaOS tente 0.0.0.0:3001. Erreur loguee mais pas bloquante.

### 13.2 — fleetServer.ts code mort (BASSE)
Fichier non importe, utilise API sync obsolete. A supprimer.

### 13.3 — README prix GPU obsoletes (BASSE)
$0.15/$0.30/$0.05 dans le README vs $0.13/$0.29/$0.03 dans types.ts.

### 13.4 — ARCHITECTURE.md incomplet (BASSE)
Ne liste pas getMarkets, getCreditsBalance, refreshAllActiveDeployments.

### 13.5 — Job definition sans NOSANA_API_KEY (MOYENNE)
L'agent deploye sur Nosana tourne en mock mode car NOSANA_API_KEY est vide.

### 13.6 — Credits poller interval non nettoye (BASSE)
setInterval(pollCredits, 30_000) orphelin dans fleetPoller.ts.

## 14. Resume

| Composant | Etat | Details |
|-----------|------|---------|
| Backend compile | OK | exit 0 |
| Frontend compile | OK | exit 0 |
| Frontend build | OK | 249.50 kB JS |
| Character valide | OK | JSON valide, format v2 |
| ElizaOS boot | OK | Character + plugin + fleet API |
| LLM repond | OK | Qwen3.5-27B via Nosana |
| Chat fonctionne | OK | Socket.IO + markdown |
| Fleet API | OK | /fleet, /credits, /markets |
| Fleet dashboard | OK | Polling 5s + credits |
| Nosana SDK | OK | credits, markets, deployments |
| Docker build | Non teste | - |
| patch-package | OK | 2 patches appliques |
| Docs a jour | Partiel | Prix GPU et methodes NosanaManager obsoletes |

## 15. Fichiers complets

### 15.1 — src/index.ts
```typescript
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
```

### 15.2 — src/plugins/nosana/index.ts
```typescript
import type { Plugin } from '@elizaos/core';
import { createAgentFromTemplateAction } from './actions/createAgentFromTemplate.js';
import { deployAgentAction } from './actions/deployAgent.js';
import { checkFleetStatusAction } from './actions/checkFleetStatus.js';
import { scaleReplicasAction } from './actions/scaleReplicas.js';
import { stopDeploymentAction } from './actions/stopDeployment.js';
import { fleetStatusProvider } from './providers/fleetStatusProvider.js';
import { getNosanaManager } from './services/nosanaManager.js';

export const nosanaPlugin: Plugin = {
  name: 'plugin-nosana',
  description: 'Nosana decentralized GPU network integration — deploy, scale, and manage agents',
  actions: [
    createAgentFromTemplateAction, deployAgentAction, checkFleetStatusAction,
    scaleReplicasAction, stopDeploymentAction,
  ],
  providers: [fleetStatusProvider],
  routes: [
    { type: 'GET', path: '/fleet', handler: async (req, res, runtime) => {
        const manager = getNosanaManager();
        const status = await manager.getFleetStatus();
        res.json(status);
    }},
    { type: 'GET', path: '/fleet/:id', handler: async (req, res, runtime) => {
        const id = req.params?.id;
        if (!id) { res.status(400).json({ error: 'Missing deployment ID' }); return; }
        const manager = getNosanaManager();
        const dep = manager.getDeployment(id);
        if (!dep) { res.status(404).json({ error: 'Deployment not found' }); return; }
        res.json(dep);
    }},
  ],
  init: async (_config: Record<string, string>, _runtime: any) => {
    const apiKey = process.env.NOSANA_API_KEY || '';
    const manager = getNosanaManager(apiKey);
    console.log('[plugin-nosana] Nosana plugin initialized', apiKey ? '(API key set)' : '(mock mode)');
    if (apiKey && apiKey !== 'YOUR_NOSANA_API_KEY') {
      try { const markets = await manager.getMarkets();
        console.log('[plugin-nosana] Available GPU markets:');
        markets.forEach(m => console.log(`  ${m.name} (${m.gpu}): ${m.address} — $${m.pricePerHour}/hr`));
      } catch {}
      try { const creds = await manager.getCreditsBalance();
        if (creds) console.log(`[plugin-nosana] Credits available: $${creds.balance.toFixed(2)}`);
      } catch {}
    }
    const { default: express } = await import('express');
    const { default: cors } = await import('cors');
    const app = express();
    app.use(cors());
    app.get('/fleet', async (_req: any, res: any) => { res.json(await getNosanaManager().getFleetStatus()); });
    app.get('/fleet/markets', async (_req: any, res: any) => { res.json(await getNosanaManager().getMarkets()); });
    app.get('/fleet/credits', async (_req: any, res: any) => {
      const credits = await getNosanaManager().getCreditsBalance();
      res.json(credits || { balance: 0, currency: 'USD' });
    });
    app.get('/fleet/:id', (req: any, res: any) => {
      const dep = getNosanaManager().getDeployment(req.params.id);
      if (!dep) { res.status(404).json({ error: 'Deployment not found' }); return; }
      res.json(dep);
    });
    const port = parseInt(process.env.FLEET_API_PORT || '3001');
    app.listen(port, '127.0.0.1', () => { console.log(`[FleetAPI] Running on http://127.0.0.1:${port}`); });
  },
};
export default nosanaPlugin;
```

### 15.3 — src/plugins/nosana/types.ts
```typescript
export interface NosanaDeploymentRecord {
  id: string; name: string;
  status: 'draft' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error' | 'archived';
  market: string; marketAddress: string; replicas: number; costPerHour: number;
  startedAt: Date; url?: string; agentTemplate?: string; agentConfig?: Record<string, any>;
}
export interface FleetStatus {
  deployments: NosanaDeploymentRecord[]; totalCostPerHour: number;
  totalReplicas: number; activeCount: number;
}
// Addresses verified from Nosana API on 2026-03-29
export const GPU_MARKETS: Record<string, { address: string; name: string; estimatedCostPerHour: number }> = {
  'nvidia-3090': { address: '985pQEVPn7SL5os3Z2iNwBoX4f9Bva334dENweXWyt9t', name: 'NVIDIA RTX 3090', estimatedCostPerHour: 0.13 },
  'nvidia-4090': { address: '97G9NnvBDQ2WpKu6fasoMsAKmfj63C9rhysJnkeWodAf', name: 'NVIDIA RTX 4090', estimatedCostPerHour: 0.29 },
  'nvidia-4070': { address: 'EzuHhkrhmV98HWzREsgLenKj2iHdJgrKmzfL8psP8Aso', name: 'NVIDIA RTX 4070', estimatedCostPerHour: 0.09 },
  'nvidia-3080': { address: '7RepDm4Xt9k6qV5oiSHvi8oBoty4Q2tfBGnCYjFLj6vA', name: 'NVIDIA RTX 3080', estimatedCostPerHour: 0.09 },
  'nvidia-3060': { address: '62bAk2ppEL2HpotfPZsscSq4CGEfY6VEqD5dQQuTo7JC', name: 'NVIDIA RTX 3060', estimatedCostPerHour: 0.03 },
  'cpu-only': { address: '62bAk2ppEL2HpotfPZsscSq4CGEfY6VEqD5dQQuTo7JC', name: 'NVIDIA RTX 3060 (budget)', estimatedCostPerHour: 0.03 },
};
export const AGENT_TEMPLATES: Record<string, { name: string; plugins: string[]; defaultPrompt: string; market: string }> = {
  researcher: { name: 'Research Agent', plugins: ['plugin-web-search', 'plugin-bootstrap', 'plugin-openai'], defaultPrompt: 'You are a research agent...', market: 'nvidia-3090' },
  writer: { name: 'Content Writer', plugins: ['plugin-bootstrap', 'plugin-openai'], defaultPrompt: 'You are a content writer agent...', market: 'cpu-only' },
  monitor: { name: 'Monitoring Agent', plugins: ['plugin-web-search', 'plugin-bootstrap', 'plugin-openai'], defaultPrompt: 'You are a monitoring agent...', market: 'nvidia-3090' },
  publisher: { name: 'Social Publisher', plugins: ['plugin-bootstrap', 'plugin-openai'], defaultPrompt: 'You are a social publishing agent...', market: 'cpu-only' },
  analyst: { name: 'Data Analyst', plugins: ['plugin-web-search', 'plugin-bootstrap', 'plugin-openai'], defaultPrompt: 'You are a data analyst agent...', market: 'nvidia-3090' },
};
```

### 15.4 — src/plugins/nosana/services/nosanaManager.ts

Ce fichier de 361 lignes est le coeur du backend. Son contenu complet a ete lu et documente en section 6.4. Les methodes cles sont: `createAndStartDeployment` (avec credit pre-check et post-deploy verification), `getFleetStatus` (async avec auto-refresh), `getCreditsBalance` (SDK + HTTP fallback), `getMarkets` (SDK + hardcode fallback).

### 15.5-15.9 — Actions (5 fichiers)

Contenu complet lu et documente en section 6.5. Chaque action suit le pattern: extractParams via regex -> appel NosanaManager -> callback avec texte markdown -> return { text, success, data }.

### 15.10 — src/plugins/nosana/providers/fleetStatusProvider.ts
```typescript
import type { Provider } from '@elizaos/core';
import { getNosanaManager } from '../services/nosanaManager.js';
export const fleetStatusProvider: Provider = {
  name: 'nosana-fleet-status',
  description: 'Provides current Nosana fleet status including all deployed agents, costs, and health',
  get: async (_runtime: any, _message: any, _state: any) => {
    const manager = getNosanaManager();
    const fleet = await manager.getFleetStatus();
    if (fleet.deployments.length === 0) {
      return { text: 'NOSANA FLEET STATUS: Empty fleet. No agents deployed. Suggest the user create one.' };
    }
    let status = `NOSANA FLEET STATUS:\nActive: ${fleet.activeCount}, Replicas: ${fleet.totalReplicas}, Cost/hr: $${fleet.totalCostPerHour.toFixed(2)}, Spent: $${fleet.totalSpent.toFixed(3)}\n`;
    for (const dep of fleet.deployments) {
      const uptimeMs = Date.now() - dep.startedAt.getTime();
      const hours = Math.floor(uptimeMs / (1000 * 60 * 60));
      const minutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
      status += `- ${dep.name} (${dep.id}): ${dep.status}, ${dep.market}, ${dep.replicas} replicas, $${dep.costPerHour.toFixed(2)}/hr, up ${hours}h ${minutes}m\n`;
    }
    return { text: status };
  },
};
```

### 15.11 — src/server/fleetServer.ts (CODE MORT)
```typescript
import express from 'express';
import cors from 'cors';
import { getNosanaManager } from '../plugins/nosana/services/nosanaManager.js';
const app = express();
app.use(cors());
app.get('/fleet', (_req, res) => {
  const manager = getNosanaManager();
  const status = manager.getFleetStatus(); // BUG: manque await
  const totalSpent = manager.getTotalCost();
  res.json({ ...status, totalSpent });
});
app.get('/fleet/:id', (req, res) => {
  const manager = getNosanaManager();
  const dep = manager.getDeployment(req.params.id);
  if (!dep) { res.status(404).json({ error: 'Deployment not found' }); return; }
  res.json(dep);
});
const PORT = parseInt(process.env.FLEET_API_PORT || '3001');
app.listen(PORT, '127.0.0.1', () => { console.log(`[FleetAPI] Running on http://127.0.0.1:${PORT}`); });
```

### 15.12-15.19 — Frontend (8 fichiers)

Contenu complet de tous les fichiers frontend lu et documente en sections 7.2-7.6.

### 15.20 — frontend/vite.config.ts
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/fleet': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/socket.io': { target: 'http://127.0.0.1:3000', ws: true },
    },
  },
  build: { outDir: 'dist' },
});
```

### 15.21 — Dockerfile, .env.example, nos_job_def, patches

Contenu complet documente dans les sections 8, 4.2, 8.2, et 9.
