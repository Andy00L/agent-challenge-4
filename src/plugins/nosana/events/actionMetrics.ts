/**
 * ElizaOS Event Handlers for AgentForge.
 *
 * Hooks into the ElizaOS event system to track action execution metrics.
 * Demonstrates proper use of the Plugin.events interface with typed payloads.
 *
 * Events used:
 * - MESSAGE_RECEIVED: Track incoming user messages
 * - ACTION_STARTED: Track when an action begins
 * - ACTION_COMPLETED: Track when an action finishes + measure duration
 */
import { EventType, type ActionEventPayload, type MessagePayload } from '@elizaos/core';
import type { PluginEvents } from '@elizaos/core';

// ── In-memory metrics store ──────────────────────────────

interface ActionMetric {
  action: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  success: boolean;
}

const metrics: ActionMetric[] = [];
const startTimes = new Map<string, number>();
const STALE_ENTRY_MS = 600_000; // 10 min — discard orphaned start entries

function pruneStaleStartTimes(): void {
  const cutoff = Date.now() - STALE_ENTRY_MS;
  for (const [key, ts] of startTimes) {
    if (ts < cutoff) startTimes.delete(key);
  }
}

// ── Event handlers (typed to ElizaOS EventPayloadMap) ────

export const actionEventHandlers: PluginEvents = {
  [EventType.MESSAGE_RECEIVED]: [
    async (payload: MessagePayload) => {
      const entityId = payload.message?.entityId || 'unknown';
      console.log(`[AgentForge:Event] MESSAGE_RECEIVED from ${String(entityId).slice(0, 8)}...`);
    },
  ],

  [EventType.ACTION_STARTED]: [
    async (payload: ActionEventPayload) => {
      const actionName = (payload.content as { action?: string })?.action || 'unknown';
      const key = `${actionName}:${payload.messageId || Date.now()}`;
      startTimes.set(key, Date.now());
      pruneStaleStartTimes();
      console.log(`[AgentForge:Event] ACTION_STARTED: ${actionName}`);
    },
  ],

  [EventType.ACTION_COMPLETED]: [
    async (payload: ActionEventPayload) => {
      const actionName = (payload.content as { action?: string })?.action || 'unknown';
      const key = `${actionName}:${payload.messageId || Date.now()}`;
      const startTime = startTimes.get(key) || Date.now();
      const durationMs = Date.now() - startTime;
      startTimes.delete(key);

      metrics.push({
        action: actionName,
        startedAt: startTime,
        completedAt: Date.now(),
        durationMs,
        success: true,
      });

      // Keep last 100 metrics
      if (metrics.length > 100) metrics.splice(0, metrics.length - 100);

      console.log(`[AgentForge:Event] ACTION_COMPLETED: ${actionName} (${durationMs}ms)`);
    },
  ],
};

// ── Public API for Fleet metrics endpoint ────────────────

export function getActionMetrics() {
  const last10 = metrics.slice(-10);
  const avgDuration = last10.length > 0
    ? Math.round(last10.reduce((sum, m) => sum + m.durationMs, 0) / last10.length)
    : 0;
  const successRate = last10.length > 0
    ? Math.round((last10.filter(m => m.success).length / last10.length) * 100)
    : 100;

  return {
    totalActions: metrics.length,
    last10Actions: last10.map(m => ({
      action: m.action,
      durationMs: m.durationMs,
      success: m.success,
      timestamp: new Date(m.startedAt).toISOString(),
    })),
    averageDurationMs: avgDuration,
    successRate: `${successRate}%`,
  };
}
