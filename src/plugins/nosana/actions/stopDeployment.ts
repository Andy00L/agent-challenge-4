import type { Action } from '@elizaos/core';
import { getNosanaManager } from '../services/nosanaManager.js';

function extractStopTarget(text: string): string {
  const patterns = [
    /(?:stop|kill|shutdown|shut down|terminate)\s+(?:the\s+)?["']?([^"'\n,]+?)["']?(?:\s+agent|\s+deployment|\s*$)/i,
    /(?:stop|kill|shutdown|shut down|terminate)\s+["']?([^"'\n,]+?)["']?/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }
  return '';
}

export const stopDeploymentAction: Action = {
  name: 'STOP_DEPLOYMENT',
  description: 'Stop a running agent deployment on Nosana. The agent will be shut down and resources released.',
  similes: ['KILL_AGENT', 'SHUTDOWN_AGENT', 'TERMINATE_AGENT', 'STOP_AGENT'],
  validate: async (_runtime: any, message: any) => {
    const text = (message.content?.text || '').toLowerCase();
    return (
      text.includes('stop') ||
      text.includes('kill') ||
      text.includes('shutdown') ||
      text.includes('shut down') ||
      text.includes('terminate')
    );
  },
  handler: async (_runtime: any, message: any, _state?: any, _options?: any, callback?: any) => {
    const text = message.content?.text || '';
    const agentName = extractStopTarget(text);
    const manager = getNosanaManager();

    const fleet = await manager.getFleetStatus();
    let deployment = agentName ? manager.getDeploymentByName(agentName) : undefined;

    if (!deployment && fleet.deployments.length === 1) {
      deployment = fleet.deployments[0];
    }

    if (!deployment) {
      const errMsg = agentName
        ? `Could not find agent "${agentName}" in your fleet. Use "show my fleet" to see available agents.`
        : `Please specify which agent to stop. Use "show my fleet" to see your agents.`;
      if (callback) {
        await callback({ text: errMsg, action: 'STOP_DEPLOYMENT' });
      }
      return { text: errMsg, success: false, error: 'Agent not found' };
    }

    if (deployment.status === 'stopped') {
      const msg = `**${deployment.name}** is already stopped.`;
      if (callback) {
        await callback({ text: msg, action: 'STOP_DEPLOYMENT' });
      }
      return { text: msg, success: true };
    }

    try {
      const uptimeMs = Date.now() - deployment.startedAt.getTime();
      const uptimeHours = uptimeMs / (1000 * 60 * 60);
      const finalCost = uptimeHours * deployment.costPerHour;

      const updated = await manager.stopDeployment(deployment.id);
      const remaining = await manager.getFleetStatus();

      const responseText = [
        `Stopped **${updated.name}**.`,
        ``,
        `- Status: stopped`,
        `- Runtime: ${Math.floor(uptimeHours)}h ${Math.floor((uptimeHours % 1) * 60)}m`,
        `- Final cost: $${finalCost.toFixed(3)}`,
        ``,
        `Fleet: ${remaining.activeCount} active agent${remaining.activeCount !== 1 ? 's' : ''} remaining.`,
      ].join('\n');

      if (callback) {
        await callback({ text: responseText, action: 'STOP_DEPLOYMENT' });
      }
      return { text: responseText, success: true, data: { deployment: updated } };
    } catch (error: any) {
      const errMsg = `Failed to stop: ${error.message || error}`;
      if (callback) {
        await callback({ text: errMsg, action: 'STOP_DEPLOYMENT' });
      }
      return { text: errMsg, success: false, error: error.message };
    }
  },
  examples: [
    [
      { name: '{{user1}}', content: { text: 'Stop the Twitter Publisher' } },
      { name: 'AgentForge', content: { text: 'Stopped **Twitter Publisher**.\n\n- Status: stopped\n- Runtime: 3h 10m\n- Final cost: $0.158\n\nFleet: 1 active agent remaining.', action: 'STOP_DEPLOYMENT' } },
    ],
  ],
};
