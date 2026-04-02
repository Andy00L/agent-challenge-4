import { useMissionStore } from '../stores/missionStore';
import { fleetFetch } from './fleetFetch';

let interval: ReturnType<typeof setInterval> | null = null;
let pollInFlight = false;
let lastAppliedTimestamp = 0;

async function poll() {
  if (pollInFlight) return; // skip if previous poll is still in-flight
  pollInFlight = true;
  const requestTime = Date.now();
  try {
    const res = await fleetFetch('/fleet/mission');
    if (!res.ok) return;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) return;
    const data = await res.json();
    // Guard: only apply if this response is newer than the last applied one
    if (requestTime >= lastAppliedTimestamp) {
      lastAppliedTimestamp = requestTime;
      useMissionStore.getState().updateFromServer(data);
    }
  } catch {
    // best-effort
  } finally {
    pollInFlight = false;
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
