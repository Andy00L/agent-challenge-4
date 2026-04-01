import type { Plugin } from '@elizaos/core';
import { executeMissionAction } from './actions/executeMission.js';
import { createAgentFromTemplateAction } from './actions/createAgentFromTemplate.js';
import { deployAgentAction } from './actions/deployAgent.js';
import { checkFleetStatusAction } from './actions/checkFleetStatus.js';
import { scaleReplicasAction } from './actions/scaleReplicas.js';
import { stopDeploymentAction } from './actions/stopDeployment.js';
import { fleetStatusProvider } from './providers/fleetStatusProvider.js';
import { getNosanaManager } from './services/nosanaManager.js';
import { getPipelineState, resetPipelineState, getMissionHistory, MissionOrchestrator } from './services/missionOrchestrator.js';
import { missionQualityEvaluator } from './evaluators/missionQualityEvaluator.js';
import { actionEventHandlers, getActionMetrics } from './events/actionMetrics.js';
import { nosanaPluginTests } from './tests/pluginTests.js';

export const nosanaPlugin: Plugin = {
  name: 'plugin-nosana',
  description: 'Nosana decentralized GPU network integration — deploy, scale, and manage agents',
  actions: [
    executeMissionAction,
    createAgentFromTemplateAction,
    deployAgentAction,
    checkFleetStatusAction,
    scaleReplicasAction,
    stopDeploymentAction,
  ],
  providers: [
    fleetStatusProvider,
  ],
  evaluators: [missionQualityEvaluator],
  events: actionEventHandlers,
  tests: [nosanaPluginTests],
  routes: [
    {
      type: 'GET',
      path: '/fleet',
      handler: async (_req, res, _runtime) => {
        const manager = getNosanaManager();
        const status = await manager.getFleetStatus();
        res.json(status);
      },
    },
    {
      type: 'GET',
      path: '/fleet/:id',
      handler: async (req, res, _runtime) => {
        const id = req.params?.id;
        if (!id) {
          res.status(400).json({ error: 'Missing deployment ID' });
          return;
        }
        const manager = getNosanaManager();
        const dep = manager.getDeployment(id);
        if (!dep) {
          res.status(404).json({ error: 'Deployment not found' });
          return;
        }
        res.json(dep);
      },
    },
  ],
  init: async (_config: Record<string, string>, _runtime: any) => {
    const apiKey = process.env.NOSANA_API_KEY || '';
    const manager = getNosanaManager(apiKey);
    console.log('[AgentForge:Plugin] Nosana plugin initialized', apiKey ? '(API key set)' : '(mock mode)');

    if (apiKey && apiKey !== 'YOUR_NOSANA_API_KEY') {
      try {
        const markets = await manager.getMarkets();
        console.log('[AgentForge:Plugin] Available GPU markets:');
        markets.forEach(m => console.log(`[AgentForge:Plugin]   ${m.name} (${m.gpu}): ${m.address} — $${m.pricePerHour}/hr`));
      } catch (e) {
        console.warn('[AgentForge:Plugin] Failed to fetch markets:', e);
      }
      try {
        const creds = await manager.getCreditsBalance();
        if (creds) console.log(`[AgentForge:Plugin] Credits available: $${creds.balance.toFixed(2)}`);
      } catch (e) {
        console.warn('[AgentForge:Plugin] Failed to fetch credits:', e);
      }
    }

    // Start standalone fleet API server (ElizaOS doesn't execute side-effect imports)
    const { default: express } = await import('express');
    const { default: cors } = await import('cors');
    const app = express();
    app.use(cors({
      origin: process.env.CORS_ORIGIN || true, // restrict in production via CORS_ORIGIN env var
    }));
    app.use(express.json({ limit: '1mb' }));
    app.get('/fleet', async (_req: any, res: any) => {
      const manager = getNosanaManager();
      const status = await manager.getFleetStatus();
      res.json(status);
    });
    app.get('/fleet/markets', async (_req: any, res: any) => {
      const manager = getNosanaManager();
      const markets = await manager.getMarkets();
      res.json(markets);
    });
    app.get('/fleet/credits', async (_req: any, res: any) => {
      const manager = getNosanaManager();
      const credits = await manager.getCreditsBalance();
      res.json(credits || { balance: 0, currency: 'USD' });
    });
    app.get('/fleet/mission', (_req: any, res: any) => {
      res.json(getPipelineState());
    });
    app.post('/fleet/mission/reset', (_req: any, res: any) => {
      resetPipelineState();
      res.json({ success: true });
    });
    app.get('/fleet/mission/history', (_req: any, res: any) => {
      res.json(getMissionHistory());
    });
    app.get('/fleet/mission/export', (_req: any, res: any) => {
      const state = getPipelineState();
      if (!state || state.status === 'idle') {
        res.status(404).json({ error: 'No active or completed mission to export' });
        return;
      }
      const stepsArr = state.steps || [];
      res.json({
        _format: 'agentforge-pipeline-v1',
        _exported: new Date().toISOString(),
        _description: 'AgentForge pipeline configuration. Re-run via POST /fleet/mission/execute.',
        mission: state.mission,
        pipeline: {
          id: state.id,
          status: state.status,
          startedAt: state.startedAt,
          completedAt: state.completedAt,
          steps: stepsArr.map((s: any) => ({
            id: s.id, template: s.template, name: s.name, task: s.task,
            dependsOn: s.dependsOn, status: s.status,
            market: s.market, costPerHour: s.costPerHour,
            outputPreview: s.output?.slice(0, 200),
          })),
        },
        dag: {
          totalSteps: stepsArr.length,
          depthLevels: stepsArr.length > 0 ? Math.max(...stepsArr.map((s: any) => (s.depth ?? 0)), 0) + 1 : 0,
          maxParallel: stepsArr.length > 0 ? Math.max(...stepsArr.map((s: any) => (s.parallelCount ?? 1)), 1) : 0,
        },
        nosana: {
          gpuMarketsUsed: [...new Set(stepsArr.map((s: any) => s.market).filter(Boolean))],
          estimatedCostPerRun: stepsArr.reduce((sum: number, s: any) => sum + ((s.costPerHour || 0) * 0.1), 0),
        },
      });
    });
    app.post('/fleet/mission/execute', async (req: any, res: any) => {
      const { mission } = req.body || {};
      if (!mission || typeof mission !== 'string') { res.status(400).json({ error: 'Missing or invalid mission in body' }); return; }
      if (mission.length > 10_000) { res.status(400).json({ error: 'Mission text too long (max 10,000 characters)' }); return; }
      const state = getPipelineState();
      if (state.status !== 'idle' && state.status !== 'complete' && state.status !== 'error') {
        res.status(409).json({ error: 'Mission already in progress', currentStatus: state.status });
        return;
      }
      resetPipelineState();
      res.json({ success: true, message: 'Mission started. Poll /fleet/mission for status.' });
      new MissionOrchestrator().execute(mission).catch((e: any) => console.error('[AgentForge:FleetAPI] Mission failed:', e.message));
    });
    app.get('/fleet/metrics', (_req: any, res: any) => {
      res.json(getActionMetrics());
    });
    app.get('/fleet/api-docs', (_req: any, res: any) => {
      res.json({
        name: 'AgentForge API', version: '1.0.0',
        endpoints: [
          { method: 'POST', path: '/fleet/mission/execute', description: 'Start a mission', body: { mission: 'string' } },
          { method: 'GET', path: '/fleet/mission', description: 'Get pipeline state' },
          { method: 'POST', path: '/fleet/mission/reset', description: 'Reset pipeline' },
          { method: 'GET', path: '/fleet/mission/history', description: 'Get mission history' },
          { method: 'GET', path: '/fleet', description: 'Get fleet status' },
          { method: 'GET', path: '/fleet/credits', description: 'Get credit balance' },
        ],
      });
    });
    app.get('/fleet/:id/activity', async (req: any, res: any) => {
      const manager = getNosanaManager();
      const dep = manager.getDeployment(req.params.id);
      if (!dep) { res.status(404).json({ error: 'Deployment not found' }); return; }
      if (!dep.url) { res.json({ status: 'no_url', messages: [], agentName: dep.name }); return; }

      const baseUrl = (dep.url.startsWith('https://') || dep.url.startsWith('http://')) ? dep.url : `https://${dep.url}`;
      try {
        const agentsRes = await fetch(`${baseUrl}/api/agents`, { signal: AbortSignal.timeout(5000) });
        if (!agentsRes.ok) { res.json({ status: 'unreachable', messages: [], agentName: dep.name }); return; }
        const agentsData = await agentsRes.json() as any;
        const agents = agentsData?.agents || agentsData?.data?.agents || [];
        const workerAgent = agents[0];
        if (!workerAgent) { res.json({ status: 'no_agent', messages: [], agentName: dep.name }); return; }

        let messages: any[] = [];
        try {
          const roomsRes = await fetch(`${baseUrl}/api/agents/${workerAgent.id}/rooms`, { signal: AbortSignal.timeout(5000) });
          if (roomsRes.ok) {
            const roomsData = await roomsRes.json() as any;
            const rooms = roomsData?.rooms || roomsData?.data?.rooms || [];
            for (const room of rooms.slice(0, 3)) {
              try {
                const msgsRes = await fetch(`${baseUrl}/api/agents/${workerAgent.id}/rooms/${room.id}/messages?limit=10`, { signal: AbortSignal.timeout(5000) });
                if (msgsRes.ok) {
                  const msgsData = await msgsRes.json() as any;
                  const roomMsgs = msgsData?.messages || msgsData?.data?.messages || [];
                  messages.push(...roomMsgs.map((m: any) => ({
                    text: m.content?.text || m.text || '',
                    sender: m.name || m.entityId || 'unknown',
                    timestamp: m.createdAt || new Date().toISOString(),
                  })));
                }
              } catch (e) {
                console.warn(`[AgentForge:FleetAPI] Failed to fetch room messages:`, e);
              }
            }
          }
        } catch (e) {
          console.warn(`[AgentForge:FleetAPI] Failed to fetch rooms:`, e);
        }

        messages.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        res.json({
          status: 'active',
          agentName: workerAgent.name || dep.name,
          agentId: workerAgent.id,
          messages: messages.slice(0, 20),
          url: baseUrl,
        });
      } catch (e) {
        console.warn(`[AgentForge:FleetAPI] Activity fetch failed for ${dep.name}:`, e);
        res.json({ status: 'unreachable', messages: [], agentName: dep.name, url: baseUrl });
      }
    });
    app.get('/fleet/:id', (req: any, res: any) => {
      const manager = getNosanaManager();
      const dep = manager.getDeployment(req.params.id);
      if (!dep) {
        res.status(404).json({ error: 'Deployment not found' });
        return;
      }
      res.json(dep);
    });
    const port = parseInt(process.env.FLEET_API_PORT || '3001');
    const server = app.listen(port, '0.0.0.0', () => {
      console.log(`[AgentForge:FleetAPI] Fleet API running on http://0.0.0.0:${port}`);
    });
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`[AgentForge:FleetAPI] Port ${port} already in use — Fleet API will use ElizaOS plugin routes instead`);
      } else {
        console.error(`[AgentForge:FleetAPI] Failed to start Fleet API:`, err.message);
      }
    });

    // Test embedding availability at boot (log once)
    try {
      const baseUrl = process.env.OPENAI_API_URL || '';
      if (baseUrl) {
        const res = await fetch(`${baseUrl}/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY || 'nosana'}` },
          body: JSON.stringify({ input: 'test', model: process.env.MODEL_NAME || 'Qwen3.5-27B-AWQ-4bit' }),
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) {
          console.warn(`[AgentForge:Embedding] Embedding endpoint returned ${res.status} — semantic memory disabled, using zero-vector fallback`);
        }
      }
    } catch {
      console.warn('[AgentForge:Embedding] Embedding endpoint unreachable — semantic memory disabled');
    }
  },
};

export default nosanaPlugin;
