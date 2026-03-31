import { useFleetStore } from '../stores/fleetStore';

const POLL_INTERVAL = 5000;

let _agentId: string | null = null;

export function setFleetAgentId(agentId: string) {
  _agentId = agentId;
}

export async function pollFleetOnce(): Promise<void> {
  if (!_agentId) return;

  try {
    const res = await fetch(`/fleet?agentId=${_agentId}`);
    if (!res.ok) return;

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) return;

    const data = await res.json();
    useFleetStore.getState().setDeployments(data.deployments || []);
    useFleetStore.getState().setTotalSpent(data.totalSpent || 0);
  } catch {
    // Silently ignore — fleet polling is best-effort
  }
}

async function pollCredits(): Promise<void> {
  try {
    const res = await fetch('/fleet/credits');
    if (!res.ok) return;
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) return;
    const data = await res.json();
    useFleetStore.getState().setCreditsBalance(data.balance);
  } catch {
    // best-effort
  }
}

async function pollMarkets(): Promise<void> {
  try {
    const res = await fetch('/fleet/markets');
    if (!res.ok) return;
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) return;
    const data = await res.json();
    const markets = Array.isArray(data) ? data : data.markets || [];
    useFleetStore.getState().setMarkets(markets);
  } catch {
    // best-effort
  }
}

/**
 * Start polling the Fleet API for deployment status, credit balance, and GPU markets.
 * Returns a cleanup function that stops all intervals.
 */
export function startFleetPolling(): () => void {
  pollFleetOnce();
  pollCredits();
  pollMarkets();
  const fleetInterval = setInterval(pollFleetOnce, POLL_INTERVAL);
  const creditsInterval = setInterval(pollCredits, 30_000);
  const marketsInterval = setInterval(pollMarkets, 60_000);

  return () => {
    clearInterval(fleetInterval);
    clearInterval(creditsInterval);
    clearInterval(marketsInterval);
  };
}
