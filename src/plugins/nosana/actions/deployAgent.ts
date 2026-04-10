import type { Action } from '@elizaos/core';
import { getNosanaManager } from '../services/nosanaManager.js';

function extractDeployParams(text: string) {
  const nameMatch = text.match(/(?:deploy|launch|run)\s+["']?([^"'\n,]+?)["']?\s+(?:on|to|at)/i)
    || text.match(/(?:deploy|launch|run)\s+["']?([^"'\n,]+?)["']?/i);
  const agentName = nameMatch ? nameMatch[1].trim() : `agent-${Date.now().toString(36).slice(-4)}`;

  const lower = text.toLowerCase();
  let gpuQuery: string | null = null;
  const gpuMatch = lower.match(/(?:on\s+(?:a\s+)?|using\s+(?:a\s+)?)(?:nvidia\s+)?(?:rtx\s+)?(\d{4})/);
  if (gpuMatch) gpuQuery = gpuMatch[1];
  else if (lower.includes('cpu')) gpuQuery = '3060';

  const replicaMatch = text.match(/(\d+)\s*replica/i);
  const replicas = replicaMatch ? parseInt(replicaMatch[1], 10) : 1;

  const imageMatch = text.match(/image[:\s]+["']?([^\s"']+)/i);
  let dockerImage = process.env.AGENTFORGE_WORKER_IMAGE || 'drewdockerus/agentforge-worker:latest';
  if (imageMatch) {
    // Validate Docker image name: alphanumeric, dots, hyphens, slashes, underscores, colons
    const candidate = imageMatch[1];
    if (/^[a-zA-Z0-9][a-zA-Z0-9._\-/]{0,255}(?::[a-zA-Z0-9._\-]{1,128})?$/.test(candidate)) {
      dockerImage = candidate;
    }
    // else: silently fall back to default image (reject invalid input)
  }

  return { agentName, gpuQuery, replicas, dockerImage };
}

export const deployAgentAction: Action = {
  name: 'DEPLOY_AGENT',
  description: 'Deploy an agent container to the Nosana decentralized GPU network. Specify the agent name, GPU market, and replica count.',
  similes: ['LAUNCH_AGENT', 'RUN_ON_NOSANA', 'START_DEPLOYMENT'],
  validate: async (_runtime: any, message: any) => {
    const text = (message.content?.text || '').toLowerCase();
    return (
      text.includes('deploy') ||
      text.includes('launch') ||
      (text.includes('run') && text.includes('nosana'))
    );
  },
  handler: async (_runtime: any, message: any, _state?: any, _options?: any, callback?: any) => {
    const text = message.content?.text || '';
    const { agentName, gpuQuery, replicas, dockerImage } = extractDeployParams(text);
    const manager = getNosanaManager();

    // Resolve GPU market dynamically
    let market = gpuQuery ? await manager.findMarket(gpuQuery) : null;
    if (!market) market = await manager.getBestMarket();
    if (!market) {
      const errMsg = 'No GPU markets available. Try again later.';
      if (callback) await callback({ text: errMsg, action: 'DEPLOY_AGENT' });
      return { text: errMsg, success: false };
    }

    try {
      const record = await manager.createAndStartDeployment({
        name: agentName,
        dockerImage,
        env: {
          OPENAI_API_KEY: process.env.OPENAI_API_KEY || 'nosana',
          OPENAI_API_URL: process.env.OPENAI_API_URL || '',
          OPENAI_BASE_URL: process.env.OPENAI_API_URL || '',
          MODEL_NAME: process.env.MODEL_NAME || 'Qwen3.5-27B-AWQ-4bit',
          OPENAI_SMALL_MODEL: process.env.MODEL_NAME || 'Qwen3.5-27B-AWQ-4bit',
          OPENAI_LARGE_MODEL: process.env.MODEL_NAME || 'Qwen3.5-27B-AWQ-4bit',
          TAVILY_API_KEY: process.env.TAVILY_API_KEY || '',
          IMAGE_API_KEY: process.env.IMAGE_API_KEY || '',
          SERVER_PORT: '3000',
        },
        resolvedMarket: market,
        replicas,
      });

      const responseText = [
        `Deployed **${agentName}** to Nosana!`,
        ``,
        `- GPU: ${market.name} ($${market.pricePerHour.toFixed(3)}/hr)`,
        `- Replicas: ${record.replicas}`,
        `- Cost: $${record.costPerHour.toFixed(3)}/hr`,
        `- Status: ${record.status}`,
        `- Deployment ID: \`${record.id}\``,
        record.url ? `- URL: ${record.url}` : '',
      ].filter(Boolean).join('\n');

      if (callback) {
        await callback({ text: responseText, action: 'DEPLOY_AGENT' });
      }

      return { text: responseText, success: true, data: { deployment: record } };
    } catch (error: any) {
      const errMsg = `Deployment failed: ${error.message || error}`;
      if (callback) {
        await callback({ text: errMsg, action: 'DEPLOY_AGENT' });
      }
      return { text: errMsg, success: false, error: error.message };
    }
  },
  examples: [
    [
      { name: '{{user1}}', content: { text: 'Deploy my-agent to Nosana on a 4090' } },
      { name: 'AgentForge', content: { text: 'Deployed **my-agent** to Nosana!\n\n- GPU Market: NVIDIA RTX 4090\n- Cost: $0.30/hr\n- Status: running', action: 'DEPLOY_AGENT' } },
    ],
  ],
};
