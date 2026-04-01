import { NosanaDeploymentRecord, FleetStatus, GPU_MARKETS, type GpuMarket } from '../types.js';

let createNosanaClient: any;
try {
  const kit = await import('@nosana/kit');
  createNosanaClient = kit.createNosanaClient;
} catch (e) {
  console.warn('[AgentForge:Manager] Could not import @nosana/kit:', e);
}

const NOSANA_STATUS_MAP: Record<string, NosanaDeploymentRecord['status']> = {
  draft: 'draft',
  queued: 'queued',
  error: 'error',
  starting: 'starting',
  running: 'running',
  stopping: 'stopping',
  stopped: 'stopped',
  insufficient_funds: 'error',
  archived: 'archived',
};

export class NosanaManager {
  private client: any;
  private deployments: Map<string, NosanaDeploymentRecord> = new Map();
  private initialized = false;
  private lastRefresh = 0;
  private readonly REFRESH_INTERVAL = 15_000;
  private cachedMarkets: GpuMarket[] = [];
  private lastMarketFetch = 0;

  constructor(private apiKey: string) {}

  private ensureClient(): boolean {
    if (!this.initialized) {
      if (!this.apiKey || this.apiKey === 'YOUR_NOSANA_API_KEY' || !createNosanaClient) {
        console.warn('[AgentForge:Manager] No API key or SDK unavailable. Using mock mode.');
        return false;
      }
      try {
        this.client = createNosanaClient('mainnet', {
          api: { apiKey: this.apiKey },
        });
        this.initialized = true;
      } catch (error) {
        console.error('[AgentForge:Manager] Failed to initialize Nosana client:', error);
        return false;
      }
    }
    return true;
  }

  /**
   * Create and deploy a new agent container on the Nosana GPU network.
   * Performs credit pre-check, selects the cheapest available GPU market,
   * and polls for RUNNING status with automatic QUEUED fallback.
   *
   * @param params - Deployment configuration (image, ports, env vars, market)
   * @returns Deployment record with id, url, status, and cost info
   * @throws If insufficient credits or all GPU markets are full
   */
  async createAndStartDeployment(params: {
    name: string;
    dockerImage: string;
    env: Record<string, string>;
    market?: string;
    resolvedMarket?: GpuMarket;
    replicas?: number;
    timeout?: number;
  }): Promise<NosanaDeploymentRecord> {
    // Resolve market: prefer pre-resolved, fallback to old GPU_MARKETS lookup
    const fallback = GPU_MARKETS[params.market || 'nvidia-3090'] || GPU_MARKETS['nvidia-3090'];
    const marketAddress = params.resolvedMarket?.address || fallback.address;
    const marketName = params.resolvedMarket?.name || fallback.name;
    const costPerHour = params.resolvedMarket?.pricePerHour || fallback.estimatedCostPerHour;

    if (!this.ensureClient()) {
      const mockId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const record: NosanaDeploymentRecord = {
        id: mockId,
        name: params.name,
        status: 'running',
        market: marketName,
        marketAddress,
        replicas: params.replicas || 1,
        costPerHour: costPerHour * (params.replicas || 1),
        startedAt: new Date(),
        url: `https://${mockId.slice(0, 12)}.node.k8s.prd.nos.ci`,
        agentTemplate: params.env.AGENT_TEMPLATE || 'custom',
      };
      this.deployments.set(mockId, record);
      console.log(`[AgentForge:Manager] Mock deployment created: ${params.name} (${mockId})`);
      return record;
    }

    // Validate market is premium (community markets reject credit payments)
    const resolvedType = params.resolvedMarket?.type;
    if (resolvedType && resolvedType !== 'PREMIUM') {
      throw new Error(
        `Market "${marketName}" is a ${resolvedType} market. ` +
        `Credit payments only work on PREMIUM markets. ` +
        `Try again without specifying a GPU to auto-select a premium market.`
      );
    }

    // Pre-deploy credit check: can user afford at least 1 hour?
    const hourlyCost = costPerHour * (params.replicas || 1);
    const credits = await this.getCreditsBalance();
    if (credits && credits.balance < hourlyCost) {
      throw new Error(
        `Insufficient Nosana credits. ` +
        `Available: $${credits.balance.toFixed(2)}, ` +
        `need $${hourlyCost.toFixed(3)}/hr for ${marketName}. ` +
        `Max runtime: ${credits.balance > 0 ? Math.floor(credits.balance / hourlyCost) : 0}h. ` +
        `Top up at https://deploy.nosana.com`
      );
    }

    console.log(`[AgentForge:Manager] Deploying ${params.name}: market=${marketName} address=${marketAddress} cost=$${costPerHour.toFixed(3)}/hr`);

    try {
      const safeName = params.name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

      const jobDefinition = {
        version: '0.1',
        type: 'container',
        meta: { trigger: 'api' },
        ops: [
          {
            type: 'container/run',
            id: safeName,
            args: {
              image: params.dockerImage,
              expose: 3000,
              env: params.env,
            },
          },
        ],
      };

      const deploymentBody = {
        name: params.name,
        market: marketAddress,
        timeout: params.timeout || 60,
        replicas: params.replicas || 1,
        strategy: 'SIMPLE',
        job_definition: jobDefinition,
      };

      let deployment: any;

      if (this.client.api?.deployments?.pipe) {
        deployment = await this.client.api.deployments.pipe(
          deploymentBody,
          async (dep: any) => {
            console.log(`[AgentForge:Manager] Starting deployment: ${params.name}`);
            await dep.start();
          }
        );
      } else if (this.client.api?.deployments?.create) {
        const created = await this.client.api.deployments.create(deploymentBody);
        deployment = await this.client.api.deployments.get(created.id || created._id);
        await deployment.start();
      } else {
        throw new Error('No supported deployment method found in @nosana/kit SDK');
      }

      const endpointUrl = deployment.endpoints?.[0]?.url || deployment.url || undefined;
      const record: NosanaDeploymentRecord = {
        id: deployment.id || deployment._id || `dep-${Date.now()}`,
        name: params.name,
        status: 'starting',
        market: marketName,
        marketAddress,
        replicas: params.replicas || 1,
        costPerHour: costPerHour * (params.replicas || 1),
        startedAt: new Date(),
        url: endpointUrl,
        agentTemplate: params.env.AGENT_TEMPLATE || 'custom',
      };

      this.deployments.set(record.id, record);
      console.log(`[AgentForge:Manager] Deployment started: ${params.name} (${record.id})`);

      // Verify deployment actually started on Nosana
      await new Promise(resolve => setTimeout(resolve, 5000));
      try {
        const refreshed = await this.refreshDeploymentStatus(record.id);
        if (refreshed) {
          console.log(`[AgentForge:Manager] Verified ${params.name}: status=${refreshed.status}`);
          if (refreshed.status === 'error' || refreshed.status === 'stopped') {
            this.deployments.delete(record.id);
            throw new Error(`Deployment failed on Nosana (status: ${refreshed.status}). Check credits and market availability.`);
          }
        }
      } catch (verifyErr: any) {
        if (verifyErr.message?.includes('Deployment failed on Nosana')) throw verifyErr;
        console.warn('[AgentForge:Manager] Could not verify deployment status:', verifyErr);
      }

      // Handle QUEUED: wait for RUNNING with automatic market fallback
      const currentRecord = this.deployments.get(record.id) || record;
      if (currentRecord.status === 'queued') {
        return this.waitForRunningOrFallback(record.id, params);
      }

      return currentRecord;
    } catch (error) {
      console.error(`[AgentForge:Manager] Deployment failed for ${params.name}:`, error);
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to deploy ${params.name}: ${msg}`);
    }
  }

  /**
   * Wait for a QUEUED deployment to become RUNNING.
   * If queued too long (>120s), cancel and redeploy on the next cheapest market.
   */
  private async waitForRunningOrFallback(
    deploymentId: string,
    params: {
      name: string;
      dockerImage: string;
      env: Record<string, string>;
      replicas?: number;
      timeout?: number;
    },
    triedAddresses: string[] = [],
  ): Promise<NosanaDeploymentRecord> {
    const record = this.deployments.get(deploymentId);
    if (!record) throw new Error(`Deployment ${deploymentId} not found`);

    const QUEUE_FALLBACK_MS = 120_000; // 2 min before trying next market
    const MAX_QUEUE_MS = 600_000; // 10 min absolute max
    const queueStart = Date.now();

    while (Date.now() - queueStart < MAX_QUEUE_MS) {
      await new Promise(r => setTimeout(r, 10_000));

      const refreshed = await this.refreshDeploymentStatus(deploymentId);
      if (!refreshed) break;

      if (refreshed.status === 'running') return refreshed;

      if (refreshed.status === 'error' || refreshed.status === 'stopped') {
        throw new Error(`Deployment ${record.name} failed on Nosana (status: ${refreshed.status})`);
      }

      if (refreshed.status === 'queued') {
        const elapsed = Math.floor((Date.now() - queueStart) / 1000);
        console.log(`[AgentForge:Manager] ${record.name}: QUEUED (${elapsed}s, waiting for available GPU node)`);

        if (Date.now() - queueStart > QUEUE_FALLBACK_MS && triedAddresses.length < 3) {
          try { await this.stopDeployment(deploymentId); } catch (e) { console.warn(`[AgentForge:Manager] Failed to stop queued deployment ${deploymentId}:`, e); }
          this.deployments.delete(deploymentId);

          triedAddresses.push(record.marketAddress);
          const nextMarket = await this.getNextBestMarket(triedAddresses);
          if (!nextMarket) {
            console.log(`[AgentForge:Manager] No alternative markets available, continuing to wait...`);
            continue;
          }

          console.log(`[AgentForge:Manager] Falling back to ${nextMarket.name} for ${record.name}`);
          const newRecord = await this.createAndStartDeployment({
            ...params,
            resolvedMarket: nextMarket,
          });
          return this.waitForRunningOrFallback(newRecord.id, params, triedAddresses);
        }
      }

      if (refreshed.status === 'starting') {
        console.log(`[AgentForge:Manager] ${record.name}: starting (container booting)`);
      }
    }

    return this.deployments.get(deploymentId) || record;
  }

  async scaleDeployment(deploymentId: string, replicas: number): Promise<NosanaDeploymentRecord> {
    const record = this.deployments.get(deploymentId);
    if (!record) throw new Error(`Deployment ${deploymentId} not found in fleet`);

    if (this.ensureClient() && !deploymentId.startsWith('mock-')) {
      try {
        const deployment = await this.client.api.deployments.get(deploymentId);
        await deployment.updateReplicaCount(replicas);
      } catch (error) {
        console.error(`[AgentForge:Manager] Scale failed for ${deploymentId}:`, error);
        throw error;
      }
    }

    const oldReplicas = record.replicas;
    const perReplicaCost = oldReplicas > 0 ? record.costPerHour / oldReplicas : record.costPerHour;
    record.replicas = replicas;
    record.costPerHour = perReplicaCost * replicas;
    this.deployments.set(deploymentId, record);
    return record;
  }

  /**
   * Stop a running deployment and clean up resources.
   * Gracefully handles already-stopped and not-found deployments.
   *
   * @param deploymentId - Deployment ID to stop
   */
  async stopDeployment(deploymentId: string): Promise<NosanaDeploymentRecord> {
    const record = this.deployments.get(deploymentId);
    if (!record) throw new Error(`Deployment ${deploymentId} not found in fleet`);

    if (this.ensureClient() && !deploymentId.startsWith('mock-')) {
      try {
        const deployment = await this.client.api.deployments.get(deploymentId);
        await deployment.stop();
      } catch (error: any) {
        const msg = error?.message || String(error);
        if (msg.includes('already stopped') || msg.includes('not running') || msg.includes('not found')) {
          console.log(`[AgentForge:Manager] ${record.name} (${deploymentId}): already stopped, skipping`);
        } else {
          console.error(`[AgentForge:Manager] Stop failed for ${deploymentId}:`, error);
          throw error;
        }
      }
    }

    record.status = 'stopped';
    this.deployments.set(deploymentId, record);
    return record;
  }

  async refreshDeploymentStatus(deploymentId: string): Promise<NosanaDeploymentRecord | null> {
    const record = this.deployments.get(deploymentId);
    if (!record) return null;

    if (this.ensureClient() && !deploymentId.startsWith('mock-')) {
      try {
        const deployment = await this.client.api.deployments.get(deploymentId);
        const apiStatus = (deployment.status || '').toLowerCase();
        const mapped = NOSANA_STATUS_MAP[apiStatus];
        console.log(`[AgentForge:Manager] Refresh ${record.name}: Nosana=${deployment.status} → ${mapped || record.status}`);
        record.status = mapped || record.status;
        const endpointUrl = deployment.endpoints?.[0]?.url || deployment.url;
        if (endpointUrl) record.url = endpointUrl;
        this.deployments.set(deploymentId, record);
      } catch (error) {
        console.warn(`[AgentForge:Manager] Could not refresh ${deploymentId}:`, error);
      }
    }

    return record;
  }

  private async refreshAllActiveDeployments(): Promise<void> {
    if (!this.ensureClient()) return;
    const now = Date.now();
    if (now - this.lastRefresh < this.REFRESH_INTERVAL) return;
    this.lastRefresh = now;

    const active = Array.from(this.deployments.values())
      .filter(d => d.status === 'running' || d.status === 'starting' || d.status === 'queued');

    for (const dep of active) {
      if (dep.id.startsWith('mock-')) continue;
      try {
        await this.refreshDeploymentStatus(dep.id);
      } catch (err) {
        console.warn(`[AgentForge:Manager] Failed to refresh ${dep.name}: ${err}`);
      }
    }
  }

  async getFleetStatus(): Promise<FleetStatus> {
    await this.refreshAllActiveDeployments();
    const all = Array.from(this.deployments.values());
    const active = all.filter(d => d.status === 'running' || d.status === 'starting');
    return {
      deployments: all,
      totalCostPerHour: active.reduce((sum, d) => sum + d.costPerHour, 0),
      totalReplicas: active.reduce((sum, d) => sum + d.replicas, 0),
      activeCount: active.length,
      totalSpent: this.getTotalCost(),
    };
  }

  getDeployment(id: string): NosanaDeploymentRecord | undefined {
    return this.deployments.get(id);
  }

  getDeploymentByName(name: string): NosanaDeploymentRecord | undefined {
    return Array.from(this.deployments.values()).find(
      d => d.name.toLowerCase().includes(name.toLowerCase()) ||
           name.toLowerCase().includes(d.name.toLowerCase())
    );
  }

  async getMarkets(): Promise<GpuMarket[]> {
    if (this.cachedMarkets.length > 0 && Date.now() - this.lastMarketFetch < 300_000) {
      return this.cachedMarkets;
    }

    const fallback: GpuMarket[] = Object.entries(GPU_MARKETS).map(([key, m]) => ({
      address: m.address, name: m.name, slug: key,
      gpu: key, pricePerHour: m.estimatedCostPerHour,
    }));

    if (!this.ensureClient() || !this.client) return fallback;

    try {
      const apiMarkets = await this.client.api.markets.list();
      const markets: GpuMarket[] = apiMarkets.map((m: any) => {
        const reward = typeof m.usd_reward_per_hour === 'number' ? m.usd_reward_per_hour : 0;
        const fee = typeof m.network_fee_percentage === 'number' ? m.network_fee_percentage : 10;
        const userCost = reward * (1 + fee / 100);
        return {
          address: m.address,
          name: m.name || m.slug || 'Unknown',
          slug: m.slug || (m.name || '').toLowerCase().replace(/\s+/g, '-'),
          gpu: (m.gpu_types || []).join(', ') || m.slug || '',
          pricePerHour: Math.round(userCost * 1000) / 1000,
          type: m.type || 'PREMIUM',
        };
      });
      markets.sort((a, b) => a.pricePerHour - b.pricePerHour);
      this.cachedMarkets = markets;
      this.lastMarketFetch = Date.now();
      return markets;
    } catch (err) {
      console.warn('[AgentForge:Manager] Failed to list markets:', err);
      return fallback;
    }
  }

  async findMarket(query: string): Promise<GpuMarket | null> {
    const markets = await this.getMarkets();
    const q = query.toLowerCase().replace(/[^a-z0-9]/g, '');
    // Only premium markets — community markets reject credit payments
    const premium = markets.filter(m => m.type === 'PREMIUM');
    return premium.find(m =>
      m.slug.replace(/[^a-z0-9]/g, '').includes(q) ||
      m.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(q) ||
      m.gpu.toLowerCase().replace(/[^a-z0-9]/g, '').includes(q)
    ) || null;
  }

  /**
   * Get the cheapest available PREMIUM GPU market from Nosana.
   * Filters out COMMUNITY markets (they reject credit payments).
   * Markets are cached for 5 minutes to reduce API calls.
   *
   * @returns The cheapest GPU market, or null if none available
   */
  async getBestMarket(): Promise<GpuMarket | null> {
    const markets = await this.getMarkets();
    // Only premium markets — community/other types reject credit payments
    return markets.find(m => m.pricePerHour > 0 && m.type === 'PREMIUM') || null;
  }

  /**
   * Get the next cheapest PREMIUM market, excluding already-tried addresses.
   * Used for QUEUED fallback — when the first market has no available nodes.
   *
   * @param excludeAddresses - Market addresses that already returned QUEUED
   * @returns Next cheapest market, or null if all markets tried
   */
  async getNextBestMarket(excludeAddresses: string[]): Promise<GpuMarket | null> {
    const markets = await this.getMarkets();
    const excluded = new Set(excludeAddresses);
    return markets.find(m => m.pricePerHour > 0 && m.type === 'PREMIUM' && !excluded.has(m.address)) || null;
  }

  /**
   * Check the user's available Nosana credit balance.
   * Tries SDK first, falls back to HTTP API if SDK method unavailable.
   *
   * @returns Balance in USD, or null if unable to fetch
   */
  async getCreditsBalance(): Promise<{ balance: number; currency: string } | null> {
    // Method 1: Use SDK (preferred)
    if (this.ensureClient() && this.client) {
      try {
        const bal = await this.client.api.credits.balance();
        const available = (bal.assignedCredits ?? 0) - (bal.reservedCredits ?? 0) - (bal.settledCredits ?? 0);
        return { balance: available, currency: 'USD' };
      } catch (err) {
        console.warn('[AgentForge:Manager] SDK credits.balance() failed, trying HTTP fallback:', err);
      }
    }

    // Method 2: HTTP fallback
    if (!this.apiKey) return null;
    try {
      const response = await fetch('https://dashboard.k8s.prd.nos.ci/api/credits/balance', {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        console.warn('[AgentForge:Manager] Credits HTTP error:', response.status);
        return null;
      }
      const data = await response.json();
      const available = (data.assignedCredits ?? 0) - (data.reservedCredits ?? 0) - (data.settledCredits ?? 0);
      return { balance: available, currency: 'USD' };
    } catch (err) {
      console.warn('[AgentForge:Manager] Credits fetch failed:', err);
      return null;
    }
  }

  getTotalCost(): number {
    let total = 0;
    for (const dep of this.deployments.values()) {
      if (dep.status === 'running') {
        const hours = (Date.now() - dep.startedAt.getTime()) / (1000 * 60 * 60);
        total += hours * dep.costPerHour;
      }
    }
    return Math.round(total * 1000) / 1000;
  }
}

let _instance: NosanaManager | null = null;

export function getNosanaManager(apiKey?: string): NosanaManager {
  // If an explicit API key is provided and differs from the current instance, re-create
  if (_instance && apiKey && apiKey !== _instance['apiKey']) {
    _instance = new NosanaManager(apiKey);
  }
  if (!_instance) {
    _instance = new NosanaManager(apiKey || process.env.NOSANA_API_KEY || '');
  }
  return _instance;
}
