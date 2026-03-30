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
  routes: [
    {
      type: 'GET',
      path: '/fleet',
      handler: async (req, res, runtime) => {
        const manager = getNosanaManager();
        const status = await manager.getFleetStatus();
        res.json(status);
      },
    },
    {
      type: 'GET',
      path: '/fleet/:id',
      handler: async (req, res, runtime) => {
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
    console.log('[plugin-nosana] Nosana plugin initialized', apiKey ? '(API key set)' : '(mock mode)');

    if (apiKey && apiKey !== 'YOUR_NOSANA_API_KEY') {
      try {
        const markets = await manager.getMarkets();
        console.log('[plugin-nosana] Available GPU markets:');
        markets.forEach(m => console.log(`  ${m.name} (${m.gpu}): ${m.address} — $${m.pricePerHour}/hr`));
      } catch {}
      try {
        const creds = await manager.getCreditsBalance();
        if (creds) console.log(`[plugin-nosana] Credits available: $${creds.balance.toFixed(2)}`);
      } catch {}
    }

    // Start standalone fleet API server (ElizaOS doesn't execute side-effect imports)
    const { default: express } = await import('express');
    const { default: cors } = await import('cors');
    const app = express();
    app.use(cors());
    app.use(express.json());
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
    app.post('/fleet/mission/execute', async (req: any, res: any) => {
      const { mission } = req.body || {};
      if (!mission) { res.status(400).json({ error: 'Missing mission in body' }); return; }
      const state = getPipelineState();
      if (state.status !== 'idle' && state.status !== 'complete' && state.status !== 'error') {
        res.status(409).json({ error: 'Mission already in progress', currentStatus: state.status });
        return;
      }
      resetPipelineState();
      res.json({ success: true, message: 'Mission started. Poll /fleet/mission for status.' });
      new MissionOrchestrator().execute(mission).catch((e: any) => console.error('[API] Mission failed:', e.message));
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

      const baseUrl = dep.url.startsWith('http') ? dep.url : `https://${dep.url}`;
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
              } catch {}
            }
          }
        } catch {}

        messages.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        res.json({
          status: 'active',
          agentName: workerAgent.name || dep.name,
          agentId: workerAgent.id,
          messages: messages.slice(0, 20),
          url: baseUrl,
        });
      } catch {
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
    app.listen(port, '127.0.0.1', () => {
      console.log(`[FleetAPI] Running on http://127.0.0.1:${port}`);
    });
  },
};

export default nosanaPlugin;
