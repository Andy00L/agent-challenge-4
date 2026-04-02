import { NosanaDeploymentRecord, FleetStatus, GPU_MARKETS, type GpuMarket } from '../types.js';
import type { MediaServiceConfig } from './mediaServiceDefinitions.js';

// Known VRAM per GPU model — used for VRAM-based market filtering
const GPU_VRAM_GB: Record<string, number> = {
  '3060': 12, '3070': 8, '3080': 10, '3090': 24,
  '4060': 8, '4070': 12, '4080': 16, '4090': 24,
  'a100': 80, 'a10g': 24, 'a10': 24, 'l4': 24, 'l40': 48, 'h100': 80,
};

function estimateGpuVram(gpuField: string): number {
  const lower = gpuField.toLowerCase();
  for (const [model, vram] of Object.entries(GPU_VRAM_GB)) {
    if (lower.includes(model)) return vram;
  }
  return 0;
}

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
    if (!Number.isInteger(replicas) || replicas < 1 || replicas > 10) {
      throw new Error(`Invalid replica count: ${replicas}. Must be an integer between 1 and 10.`);
    }
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
    // Evict stopped/error deployments older than 10 minutes to prevent unbounded Map growth
    const evictThreshold = Date.now() - 600_000;
    for (const [id, dep] of this.deployments) {
      if ((dep.status === 'stopped' || dep.status === 'error' || dep.status === 'archived') && dep.startedAt.getTime() < evictThreshold) {
        this.deployments.delete(id);
      }
    }
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
    if (this.cachedMarkets.length > 0 && Date.now() - this.lastMarketFetch < 120_000) {
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

        // Map node availability from the "nodes" field
        const rawNodes = m.nodes;
        const nodesAvailable: number | undefined =
          typeof rawNodes === 'number' ? rawNodes :
          Array.isArray(rawNodes) ? rawNodes.length :
          undefined;

        return {
          address: m.address,
          name: m.name || m.slug || 'Unknown',
          slug: m.slug || (m.name || '').toLowerCase().replace(/\s+/g, '-'),
          gpu: (m.gpu_types || []).join(', ') || m.slug || '',
          pricePerHour: Math.round(userCost * 1000) / 1000,
          type: m.type || 'PREMIUM',
          nodesAvailable,
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

    // Exact normalized substring match (original logic)
    const exact = premium.find(m =>
      m.slug.replace(/[^a-z0-9]/g, '').includes(q) ||
      m.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(q) ||
      m.gpu.toLowerCase().replace(/[^a-z0-9]/g, '').includes(q)
    );
    if (exact) return exact;

    // Fuzzy: extract GPU model number (e.g., "4090", "a100") and match on that.
    // Handles cases where preferred name has extra words like "RTX" that API names omit.
    const modelMatch = query.match(/\b(3060|3070|3080|3090|4060|4070|4080|4090|a100|a10g?|h100|l4|l40)\b/i);
    if (modelMatch) {
      const model = modelMatch[1].toLowerCase();
      const hit = premium.find(m =>
        m.name.toLowerCase().includes(model) ||
        m.gpu.toLowerCase().includes(model) ||
        m.slug.toLowerCase().includes(model)
      );
      if (hit) {
        console.log(`[AgentForge:Manager] Fuzzy market match: "${query}" → "${hit.name}" (matched GPU model "${model}")`);
        return hit;
      }
    }

    return null;
  }

  /**
   * Get the cheapest available PREMIUM GPU market from Nosana.
   * Prefers markets with available nodes over empty ones.
   * Markets with unknown availability (nodesAvailable === undefined) are treated as available.
   *
   * @param excludeAddresses - Market addresses to skip (cold/failed markets)
   */
  async getBestMarket(excludeAddresses: string[] = []): Promise<GpuMarket | null> {
    const markets = await this.getMarkets();
    const excluded = new Set(excludeAddresses);
    const candidates = markets.filter(m =>
      m.pricePerHour > 0 && m.type === 'PREMIUM' && !excluded.has(m.address)
    );
    if (candidates.length === 0) return null;

    // Separate: markets with nodes (or unknown) vs confirmed empty
    const withNodes = candidates.filter(m => m.nodesAvailable === undefined || m.nodesAvailable > 0);
    const empty = candidates.filter(m => m.nodesAvailable !== undefined && m.nodesAvailable === 0);

    const selected = withNodes.length > 0 ? withNodes[0] : empty[0];
    if (!selected) return null;

    if (empty.length > 0 && withNodes.length > 0) {
      console.log(
        `[AgentForge:Manager] Market selected: ${selected.name} ($${selected.pricePerHour}/hr, ` +
        `${selected.nodesAvailable ?? '?'} nodes) — skipped empty: ${empty.map(m => m.name).join(', ')}`
      );
    } else {
      console.log(
        `[AgentForge:Manager] Market selected: ${selected.name} ($${selected.pricePerHour}/hr, ` +
        `${selected.nodesAvailable ?? '?'} nodes)`
      );
    }
    return selected;
  }

  /**
   * Get the next cheapest PREMIUM market, excluding already-tried addresses.
   * Prefers markets with available nodes over empty ones.
   */
  async getNextBestMarket(excludeAddresses: string[]): Promise<GpuMarket | null> {
    const markets = await this.getMarkets();
    const excluded = new Set(excludeAddresses);
    const candidates = markets.filter(m =>
      m.pricePerHour > 0 && m.type === 'PREMIUM' && !excluded.has(m.address)
    );
    if (candidates.length === 0) return null;

    const withNodes = candidates.filter(m => m.nodesAvailable === undefined || m.nodesAvailable > 0);
    return withNodes.length > 0 ? withNodes[0] : candidates[0];
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

  // ── Dynamic media service deployment ──────────────────

  private mediaServiceDeployments = new Map<string, {
    deploymentId: string;
    url: string;
    serviceType: string;
    status: 'deploying' | 'running' | 'stopped';
  }>();

  /**
   * Get PREMIUM GPU markets with at least `minVramGB` of VRAM.
   * Returns markets sorted by price (cheapest first), excluding already-tried addresses.
   */
  async getMarketsWithMinVram(minVramGB: number, excludeAddresses: string[] = []): Promise<GpuMarket[]> {
    const markets = await this.getMarkets();
    const excluded = new Set(excludeAddresses);
    return markets.filter(m =>
      m.pricePerHour > 0 &&
      m.type === 'PREMIUM' &&
      !excluded.has(m.address) &&
      estimateGpuVram(m.gpu || m.name) >= minVramGB
    );
  }

  /**
   * Deploy a media service (ComfyUI, Wan 2.2, TTS, A1111) on Nosana GPU.
   * Reuses an existing running deployment if available.
   *
   * Market selection: tries `preferredMarket` (by name) first, then falls back
   * to VRAM-eligible markets if QUEUED. Up to 3 markets are tried before giving up.
   * Once a deployment reaches RUNNING/starting, `waitForMediaServiceReady` takes over.
   *
   * @returns The service base URL (e.g. https://xxx.node.k8s.prd.nos.ci)
   */
  async deployMediaService(serviceKey: string): Promise<string> {
    // Reuse existing deployment if still running
    const existing = this.mediaServiceDeployments.get(serviceKey);
    if (existing && existing.status === 'running') {
      console.log(`[AgentForge:Manager] Reusing existing media service: ${serviceKey} at ${existing.url}`);
      return existing.url;
    }

    const { MEDIA_SERVICES } = await import('./mediaServiceDefinitions.js');
    const config = MEDIA_SERVICES[serviceKey];
    if (!config) throw new Error(`Unknown media service: ${serviceKey}`);

    console.log(`[AgentForge:Manager] Deploying media service: ${config.name} (minVram=${config.minVramGB}GB, preferred=${config.preferredMarket})`);

    if (!this.ensureClient()) {
      throw new Error(`Cannot deploy media service "${config.name}" in mock mode. Set NOSANA_API_KEY.`);
    }

    // Build ordered market candidate list: preferred first, then VRAM-eligible by price
    const marketCandidates: GpuMarket[] = [];
    const preferred = await this.findMarket(config.preferredMarket);
    if (preferred) {
      marketCandidates.push(preferred);
    } else {
      console.warn(`[AgentForge:Manager] Preferred market "${config.preferredMarket}" not found, using VRAM fallback only`);
    }
    const vramMarkets = await this.getMarketsWithMinVram(config.minVramGB);
    for (const m of vramMarkets) {
      if (!marketCandidates.some(c => c.address === m.address)) {
        marketCandidates.push(m);
      }
    }
    if (marketCandidates.length === 0) {
      throw new Error(`No GPU markets with ≥${config.minVramGB}GB VRAM available for ${config.name}`);
    }

    // Credit pre-check against cheapest candidate
    const cheapest = marketCandidates.reduce((a, b) => a.pricePerHour < b.pricePerHour ? a : b);
    const credits = await this.getCreditsBalance();
    if (credits && credits.balance < cheapest.pricePerHour) {
      throw new Error(
        `Insufficient credits for ${config.name}. ` +
        `Available: $${credits.balance.toFixed(2)}, need $${cheapest.pricePerHour.toFixed(3)}/hr. ` +
        `Top up at https://deploy.nosana.com`
      );
    }

    const safeName = `media-${serviceKey}`.replace(/[^a-z0-9-]/g, '-').slice(0, 50);
    const triedAddresses: string[] = [];
    const MAX_ATTEMPTS = 3;
    const QUEUE_FALLBACK_MS = 120_000;

    for (let attempt = 0; attempt < Math.min(marketCandidates.length, MAX_ATTEMPTS); attempt++) {
      const market = marketCandidates.find(m => !triedAddresses.includes(m.address));
      if (!market) break;

      console.log(`[AgentForge:Manager] Media deploy attempt ${attempt + 1}/${MAX_ATTEMPTS}: ${config.name} → ${market.name} ($${market.pricePerHour.toFixed(3)}/hr)`);

      let deploymentId: string;
      try {
        deploymentId = await this._createMediaDeployment(serviceKey, config, market, safeName);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[AgentForge:Manager] SDK deploy failed on ${market.name}: ${msg}`);
        triedAddresses.push(market.address);
        continue;
      }

      // Poll for QUEUED→RUNNING transition (market fallback handles QUEUED only)
      const queueStart = Date.now();
      let reachedRunning = false;

      while (Date.now() - queueStart < QUEUE_FALLBACK_MS) {
        await new Promise(r => setTimeout(r, 10_000));
        const refreshed = await this.refreshDeploymentStatus(deploymentId);
        if (!refreshed) break;

        if (refreshed.status === 'running' || refreshed.status === 'starting') {
          console.log(`[AgentForge:Manager] ${config.name}: ${refreshed.status} on ${market.name} — handing off to health check`);
          reachedRunning = true;
          break;
        }

        if (refreshed.status === 'error' || refreshed.status === 'stopped') {
          throw new Error(`Media service ${config.name} failed on ${market.name} (status: ${refreshed.status})`);
        }

        if (refreshed.status === 'queued') {
          const elapsed = Math.floor((Date.now() - queueStart) / 1000);
          console.log(`[AgentForge:Manager] ${config.name}: QUEUED on ${market.name} ($${market.pricePerHour.toFixed(3)}/hr) — ${elapsed}s elapsed`);
        }
      }

      if (reachedRunning) {
        // Health check takes over from here (waitForMediaServiceReady remains separate)
        try {
          return await this.waitForMediaServiceReady(deploymentId, serviceKey, config);
        } catch (healthErr) {
          console.error(`[AgentForge:Manager] ${config.name}: health check failed on ${market.name}:`, healthErr);
          throw healthErr;
        }
      }

      // Still QUEUED after timeout — cancel and try next market
      console.log(`[AgentForge:Manager] ${config.name}: QUEUED too long on ${market.name}, cancelling and trying next market`);
      triedAddresses.push(market.address);
      try { await this.stopDeployment(deploymentId); } catch (e) {
        console.warn(`[AgentForge:Manager] Failed to stop QUEUED deployment ${deploymentId}: ${e}`);
      }
      this.deployments.delete(deploymentId);
      this.mediaServiceDeployments.delete(serviceKey);
    }

    throw new Error(
      `Failed to deploy ${config.name}: all ${triedAddresses.length} market(s) QUEUED or unavailable. ` +
      `Tried markets with ≥${config.minVramGB}GB VRAM. No GPU nodes available — try again later.`
    );
  }

  /**
   * Create a media service deployment on a specific market via the Nosana SDK.
   * Returns the deployment ID. Does NOT wait for RUNNING or health check.
   */
  private async _createMediaDeployment(
    serviceKey: string,
    config: MediaServiceConfig,
    market: GpuMarket,
    safeName: string,
  ): Promise<string> {
    // Log resources included in the job spec for debugging
    const ops = config.jobDefinition?.ops;
    if (Array.isArray(ops) && ops.length > 0) {
      const resources = ops[0]?.args?.resources;
      if (Array.isArray(resources) && resources.length > 0) {
        console.log(`[AgentForge:Manager] Media job includes ${resources.length} resource download(s):`);
        for (const r of resources) {
          if (r.type === 'S3') console.log(`  S3: ${r.url} → ${r.target}`);
          if (r.type === 'HF') console.log(`  HF: ${r.repo} (${r.files?.length || 0} files) → ${r.target}`);
        }
      } else {
        console.warn(`[AgentForge:Manager] WARNING: Media job for ${config.name} has NO resource downloads — models may be missing`);
      }
    }

    const deploymentBody = {
      name: safeName,
      market: market.address,
      timeout: Math.ceil(config.bootTimeoutMs / 60_000) + 30,
      replicas: 1,
      strategy: 'SIMPLE',
      job_definition: config.jobDefinition,
    };

    let deployment: any;
    if (this.client.api?.deployments?.pipe) {
      deployment = await this.client.api.deployments.pipe(
        deploymentBody,
        async (dep: any) => {
          console.log(`[AgentForge:Manager] Starting media service: ${config.name} on ${market.name}`);
          await dep.start();
        },
      );
    } else if (this.client.api?.deployments?.create) {
      const created = await this.client.api.deployments.create(deploymentBody);
      deployment = await this.client.api.deployments.get(created.id || created._id);
      await deployment.start();
    } else {
      throw new Error('No supported deployment method found in @nosana/kit SDK');
    }

    const deploymentId = deployment.id || deployment._id || `dep-${Date.now()}`;
    const endpointUrl = deployment.endpoints?.[0]?.url || deployment.url || undefined;

    const record: NosanaDeploymentRecord = {
      id: deploymentId,
      name: safeName,
      status: 'starting',
      market: market.name,
      marketAddress: market.address,
      replicas: 1,
      costPerHour: market.pricePerHour,
      startedAt: new Date(),
      url: endpointUrl,
      agentTemplate: 'media-service',
    };
    this.deployments.set(deploymentId, record);

    this.mediaServiceDeployments.set(serviceKey, {
      deploymentId,
      url: '',
      serviceType: serviceKey,
      status: 'deploying',
    });

    return deploymentId;
  }

  /**
   * Poll until a media service deployment is running and its health endpoint responds.
   */
  private async waitForMediaServiceReady(
    deploymentId: string,
    serviceKey: string,
    config: { name: string; healthCheckPath: string; bootTimeoutMs: number },
  ): Promise<string> {
    const start = Date.now();

    // Phase 1: Wait for deployment to reach RUNNING status and get a URL
    let serviceUrl = '';
    while (Date.now() - start < config.bootTimeoutMs) {
      await new Promise(r => setTimeout(r, 10_000));
      try {
        const refreshed = await this.refreshDeploymentStatus(deploymentId);
        if (!refreshed) continue;

        if (refreshed.status === 'error' || refreshed.status === 'stopped') {
          throw new Error(`Media service ${config.name} failed (status: ${refreshed.status})`);
        }

        if (refreshed.url && refreshed.status === 'running') {
          serviceUrl = refreshed.url.startsWith('http') ? refreshed.url : `https://${refreshed.url}`;
          console.log(`[AgentForge:Manager] Media service running: ${config.name} at ${serviceUrl}`);
          break;
        }
      } catch (err: any) {
        if (err.message?.includes('failed (status:')) throw err;
        // Transient refresh errors — keep polling
      }
    }

    if (!serviceUrl) {
      throw new Error(`Media service ${config.name} did not start within ${config.bootTimeoutMs / 1000}s`);
    }

    // Phase 2: Health check — poll until the service is actually ready to accept requests
    const healthUrl = `${serviceUrl}${config.healthCheckPath}`;
    const timeoutSec = config.bootTimeoutMs / 1000;
    let healthAttempt = 0;
    console.log(`[AgentForge:Manager] Health check starting: ${config.name} → ${healthUrl} (timeout: ${timeoutSec}s)`);

    while (Date.now() - start < config.bootTimeoutMs) {
      healthAttempt++;
      const elapsed = Math.floor((Date.now() - start) / 1000);
      try {
        const res = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
        console.log(`[AgentForge:Manager] Health check #${healthAttempt} (${elapsed}s): ${healthUrl} → HTTP ${res.status}`);
        if (res.ok) {
          console.log(`[AgentForge:Manager] Media service healthy: ${config.name} (after ${elapsed}s, ${healthAttempt} attempts)`);
          this.mediaServiceDeployments.set(serviceKey, {
            deploymentId,
            url: serviceUrl,
            serviceType: serviceKey,
            status: 'running',
          });
          return serviceUrl;
        }
      } catch (healthErr: any) {
        const reason = healthErr?.cause?.code || healthErr?.code || healthErr?.message || 'unknown';
        console.log(`[AgentForge:Manager] Health check #${healthAttempt} (${elapsed}s): ${healthUrl} → FAILED (${reason})`);
      }
      await new Promise(r => setTimeout(r, 5000));
    }

    const totalElapsed = Math.floor((Date.now() - start) / 1000);
    throw new Error(`Media service ${config.name} running but health check at ${healthUrl} failed after ${totalElapsed}s (${healthAttempt} attempts)`);
  }

  /**
   * Stop a media service deployment.
   */
  async stopMediaService(serviceKey: string): Promise<void> {
    const service = this.mediaServiceDeployments.get(serviceKey);
    if (!service) return;

    try {
      await this.stopDeployment(service.deploymentId);
      console.log(`[AgentForge:Manager] Stopped media service: ${serviceKey}`);
    } catch (err: any) {
      console.warn(`[AgentForge:Manager] Failed to stop media service ${serviceKey}: ${err.message}`);
    }
    this.mediaServiceDeployments.delete(serviceKey);
  }

  /**
   * Stop ALL deployed media services. Called at end of mission.
   */
  async stopAllMediaServices(): Promise<void> {
    const keys = [...this.mediaServiceDeployments.keys()];
    for (const key of keys) {
      await this.stopMediaService(key);
    }
  }

  /**
   * Get the URL of an already-running media service, or null.
   */
  getMediaServiceUrl(serviceKey: string): string | null {
    const service = this.mediaServiceDeployments.get(serviceKey);
    return service?.status === 'running' ? service.url : null;
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
