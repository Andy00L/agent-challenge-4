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
    if (!res.ok) return; // Plugin route not mounted — skip silently

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) return; // Got HTML fallback — skip

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

export function startFleetPolling(): ReturnType<typeof setInterval> {
  pollFleetOnce();
  pollCredits();
  setInterval(pollCredits, 30_000);
  return setInterval(pollFleetOnce, POLL_INTERVAL);
}
