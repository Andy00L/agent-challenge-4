# AgentForge — Architecture

## System Overview

AgentForge is a meta-agent system with three layers:

1. **ElizaOS Runtime** — Hosts the AgentForge character with the Nosana plugin
2. **React Frontend** — Split-panel dashboard with chat and fleet monitoring
3. **Nosana GPU Network** — Decentralized compute for spawned agents

## Data Flow

### Agent Creation Flow

```
User types "Create a research agent"
  → ChatPanel sends message via Socket.IO (event "2" SEND_MESSAGE)
  → ElizaOS processes message, matches CREATE_AGENT_FROM_TEMPLATE action
  → Action handler:
      1. Extracts template type from natural language (regex)
      2. Maps template → plugins, system prompt, GPU market
      3. Calls NosanaManager.createAndStartDeployment()
      4. NosanaManager calls @nosana/kit SDK:
         - client.api.deployments.pipe(body, dep => dep.start())
      5. Returns deployment record (ID, URL, status, cost)
  → Response sent via callback to ElizaOS
  → ElizaOS formats response and emits "messageBroadcast" via Socket.IO
  → Frontend receives broadcast, displays response
  → Fleet poller hits GET /fleet (standalone server on port 3001), updates dashboard
```

### Fleet Polling Flow

```
Frontend setInterval(5000ms)
  → GET /fleet (standalone fleet server on port 3001)
  → Fleet server calls NosanaManager.getFleetStatus()
  → Returns: { deployments[], totalCostPerHour, totalReplicas, activeCount, totalSpent }
  → Zustand store updates
  → React re-renders FleetDashboard with new data
```

## Plugin Architecture

```
nosanaPlugin: Plugin
├── name: "plugin-nosana"
├── init(config, runtime)           → Initializes NosanaManager singleton
├── actions[]
│   ├── CREATE_AGENT_FROM_TEMPLATE  → Template selection + deploy
│   ├── DEPLOY_AGENT                → Direct deployment
│   ├── CHECK_FLEET_STATUS          → Fleet report
│   ├── SCALE_REPLICAS              → Adjust replica count
│   └── STOP_DEPLOYMENT             → Stop agent
├── providers[]
│   └── fleetStatusProvider         → Injects fleet context into LLM
└── routes[]
    ├── GET /fleet                  → Fleet JSON endpoint
    └── GET /fleet/:id              → Single deployment endpoint
```

### Action Handler Signature (ElizaOS v2)

```typescript
handler: (
  runtime: IAgentRuntime,
  message: Memory,
  state?: State,
  options?: HandlerOptions,
  callback?: HandlerCallback,
  responses?: Memory[]
) => Promise<ActionResult | void>
```

- `callback(content)` sends response text to the conversation
- `ActionResult.success` indicates operation outcome
- `ActionResult.data` carries structured deployment data

### Provider Interface

```typescript
get: (runtime, message, state) => Promise<{ text: string }>
```

The fleet provider returns current fleet status as plain text, which is injected into the LLM context for every message. This allows the agent to reference existing deployments when responding.

## Frontend Component Tree

```
App
├── ChatPanel (42% width, left)
│   ├── Header (avatar, connection status)
│   ├── MessageList (scrollable)
│   │   ├── WelcomeScreen (shown when empty)
│   │   │   └── ExamplePromptButtons
│   │   ├── UserMessage (purple, right-aligned)
│   │   ├── AssistantMessage (dark, left-aligned)
│   │   └── LoadingIndicator (spinner)
│   └── InputBar (text input + send button)
└── FleetDashboard (58% width, right)
    ├── Header (title, cost summary)
    ├── StatsBar (4 metric cards)
    │   ├── Agents count
    │   ├── Replicas count
    │   ├── GPUs count
    │   └── Cost/hr
    ├── AgentCardList (scrollable)
    │   └── AgentCard
    │       ├── Status dot + name
    │       ├── Status badge
    │       ├── Metrics grid (market, replicas, cost, uptime)
    │       ├── URL link
    │       └── Deployment ID
    └── EmptyState (shown when no agents)
```

## State Management

### Chat Store (Zustand)
- `messages[]` — chat history
- `isLoading` — request in flight
- `agentId` — connected ElizaOS agent ID

### Fleet Store (Zustand)
- `deployments[]` — all Nosana deployments
- `totalCostPerHour` — aggregate running cost
- `totalSpent` — cumulative spend

## NosanaManager Singleton

```
NosanaManager
├── client: NosanaClient (from @nosana/kit)
├── deployments: Map<string, NosanaDeploymentRecord>
├── createAndStartDeployment(params) → record
├── scaleDeployment(id, replicas) → record
├── stopDeployment(id) → record
├── refreshDeploymentStatus(id) → record
├── getFleetStatus() → FleetStatus
├── getDeployment(id) → record
├── getDeploymentByName(name) → record
└── getTotalCost() → number
```

Operates in two modes:
- **Live mode** — API key present, calls Nosana SDK
- **Mock mode** — No API key, simulates deployments in memory

## Docker Pipeline

```dockerfile
FROM node:23-slim
  → Install system deps (python3, build-essential, git)
  → Install bun
  → Copy package.json + bun.lock
  → bun install
  → Copy source
  → Build frontend (npm run build)
  → Build TypeScript (tsc)
  → EXPOSE 3000
  → CMD ["bun", "run", "start"]
```

## Nosana Job Definition

The `nosana_eliza_job_definition.json` defines how AgentForge itself runs on Nosana:
- Container image: `andy00l/agentforge:latest`
- Exposed port: 3000
- Environment: LLM endpoint, API keys
- Single container operation

## API Endpoints

### ElizaOS REST API
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agents` | List running agents |
| GET | `/api/agents/:id` | Agent details |
| POST | `/api/agents/:id/start` | Start an agent |
| GET | `/api/messaging/message-servers` | List message servers |
| GET | `/api/messaging/dm-channel` | Get or create DM channel |
| GET | `/api/messaging/channels/:id/messages` | Get messages |
| POST | `/api/messaging/channels/:id/messages` | Send message to channel |

### Socket.IO Events (Primary Messaging)
| Event | Direction | Description |
|-------|-----------|-------------|
| `"1"` (ROOM_JOINING) | Client → Server | Join a channel/room |
| `"2"` (SEND_MESSAGE) | Client → Server | Send a message |
| `"messageBroadcast"` | Server → Client | Agent response broadcast |

### Fleet API (Standalone Server, port 3001)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/fleet` | Fleet status + costs |
| GET | `/fleet/:id` | Single deployment |
