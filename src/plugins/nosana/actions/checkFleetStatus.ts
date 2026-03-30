import type { Action } from '@elizaos/core';
import { getNosanaManager } from '../services/nosanaManager.js';

function formatUptime(startedAt: Date): string {
  const ms = Date.now() - startedAt.getTime();
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export const checkFleetStatusAction: Action = {
  name: 'CHECK_FLEET_STATUS',
  description: 'Check the status of all deployed agents in the Nosana fleet. Shows running agents, costs, and health.',
  similes: ['FLEET_STATUS', 'LIST_AGENTS', 'SHOW_FLEET', 'MY_AGENTS'],
  validate: async (_runtime: any, message: any) => {
    const text = (message.content?.text || '').toLowerCase();
    return (
      text.includes('fleet') ||
      text.includes('status') ||
      text.includes('my agent') ||
      text.includes('running') ||
      text.includes('show') ||
      text.includes('list') ||
      (text.includes('cost') && !text.includes('create'))
    );
  },
  handler: async (runtime: any, message: any, _state?: any, _options?: any, callback?: any) => {
    const manager = getNosanaManager();
    const fleet = await manager.getFleetStatus();

    if (fleet.deployments.length === 0) {
      const responseText = 'Your fleet is empty — no agents deployed yet.\n\nSay "Create a research agent" to get started!';
      if (callback) {
        await callback({ text: responseText, action: 'CHECK_FLEET_STATUS' });
      }
      return { text: responseText, success: true, data: { fleet } };
    }

    const lines: string[] = ['**Your Agent Fleet:**', ''];

    for (let i = 0; i < fleet.deployments.length; i++) {
      const dep = fleet.deployments[i];
      const statusIcon = dep.status === 'running' ? '🟢' : dep.status === 'starting' ? '🟡' : dep.status === 'error' ? '🔴' : '⚪';
      const uptime = dep.status === 'running' ? formatUptime(dep.startedAt) : '—';
      lines.push(
        `${i + 1}. ${statusIcon} **${dep.name}** — ${dep.status} on ${dep.market} (${dep.replicas} replica${dep.replicas > 1 ? 's' : ''}) — $${dep.costPerHour.toFixed(2)}/hr — Up ${uptime}`
      );
    }

    lines.push('');
    lines.push(`**Total:** $${fleet.totalCostPerHour.toFixed(2)}/hr | ${fleet.activeCount} active | ${fleet.totalReplicas} replicas | Spent: $${fleet.totalSpent.toFixed(3)}`);

    const responseText = lines.join('\n');
    if (callback) {
      await callback({ text: responseText, action: 'CHECK_FLEET_STATUS' });
    }
    return { text: responseText, success: true, data: { fleet } };
  },
  examples: [
    [
      { name: '{{user1}}', content: { text: 'Show me my fleet' } },
      { name: 'AgentForge', content: { text: '**Your Agent Fleet:**\n\n1. **HN Monitor** — running on NVIDIA RTX 3090 (2 replicas) — $0.30/hr — Up 4h 22m\n\n**Total:** $0.30/hr | 1 active | 2 replicas | Spent: $1.32', action: 'CHECK_FLEET_STATUS' } },
    ],
  ],
};
