import type { Action } from '@elizaos/core';
import { getNosanaManager } from '../services/nosanaManager.js';

function extractScaleParams(text: string) {
  const replicaMatch = text.match(/(?:to\s+)?(\d+)\s*replica/i)
    || text.match(/scale\s+.*?(?:to\s+)?(\d+)/i);
  const replicas = replicaMatch ? parseInt(replicaMatch[1], 10) : 2;

  const namePatterns = [
    /scale\s+(?:the\s+)?["']?([^"'\n,]+?)["']?\s+(?:to|up|down)/i,
    /(?:increase|decrease)\s+(?:the\s+)?["']?([^"'\n,]+?)["']?\s+(?:to|replica)/i,
    /scale\s+(?:the\s+)?["']?([^"'\n,]+?)["']?\s*$/i,
  ];
  let agentName = '';
  for (const pattern of namePatterns) {
    const match = text.match(pattern);
    if (match) {
      agentName = match[1].trim();
      break;
    }
  }

  return { agentName, replicas };
}

export const scaleReplicasAction: Action = {
  name: 'SCALE_REPLICAS',
  description: 'Scale the number of replicas for a deployed agent on Nosana. Increase or decrease compute power.',
  similes: ['SCALE_AGENT', 'ADD_REPLICAS', 'RESIZE_DEPLOYMENT'],
  validate: async (_runtime: any, message: any) => {
    const text = (message.content?.text || '').toLowerCase();
    return (
      text.includes('scale') ||
      text.includes('replica') ||
      text.includes('increase') ||
      text.includes('decrease')
    );
  },
  handler: async (runtime: any, message: any, _state?: any, _options?: any, callback?: any) => {
    const text = message.content?.text || '';
    const { agentName, replicas } = extractScaleParams(text);
    const manager = getNosanaManager();

    const fleet = await manager.getFleetStatus();
    let deployment = agentName ? manager.getDeploymentByName(agentName) : undefined;

    if (!deployment && fleet.deployments.length === 1) {
      deployment = fleet.deployments[0];
    }

    if (!deployment) {
      const errMsg = agentName
        ? `Could not find agent "${agentName}" in your fleet. Use "show my fleet" to see available agents.`
        : `Please specify which agent to scale. Use "show my fleet" to see your agents.`;
      if (callback) {
        await callback({ text: errMsg, action: 'SCALE_REPLICAS' });
      }
      return { text: errMsg, success: false, error: 'Agent not found' };
    }

    try {
      const oldReplicas = deployment.replicas;
      const updated = await manager.scaleDeployment(deployment.id, replicas);
      const responseText = [
        `Scaled **${updated.name}** from ${oldReplicas} to ${replicas} replicas.`,
        ``,
        `- GPU Market: ${updated.market}`,
        `- New cost: $${updated.costPerHour.toFixed(2)}/hr`,
        `- All ${replicas} replica${replicas > 1 ? 's' : ''} running on decentralized GPU nodes.`,
      ].join('\n');

      if (callback) {
        await callback({ text: responseText, action: 'SCALE_REPLICAS' });
      }
      return { text: responseText, success: true, data: { deployment: updated } };
    } catch (error: any) {
      const errMsg = `Failed to scale: ${error.message || error}`;
      if (callback) {
        await callback({ text: errMsg, action: 'SCALE_REPLICAS' });
      }
      return { text: errMsg, success: false, error: error.message };
    }
  },
  examples: [
    [
      { name: '{{user1}}', content: { text: 'Scale the HN Monitor to 3 replicas' } },
      { name: 'AgentForge', content: { text: 'Scaled **HN Monitor** from 1 to 3 replicas.\n\n- GPU Market: NVIDIA RTX 3090\n- New cost: $0.45/hr', action: 'SCALE_REPLICAS' } },
    ],
  ],
};
