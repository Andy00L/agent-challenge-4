import { useMissionStore } from '../stores/missionStore';

let interval: ReturnType<typeof setInterval> | null = null;

async function poll() {
  try {
    const res = await fetch('/fleet/mission');
    if (!res.ok) return;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) return;
    const data = await res.json();
    useMissionStore.getState().updateFromServer(data);
  } catch {
    // best-effort
  }
}

export function startMissionPoller() {
  if (interval) return;
  poll();
  interval = setInterval(poll, 2000);
}

export function stopMissionPoller() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
