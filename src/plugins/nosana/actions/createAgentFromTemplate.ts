import type { Action } from '@elizaos/core';
import { getNosanaManager } from '../services/nosanaManager.js';
import { AGENT_TEMPLATES } from '../types.js';

function extractParams(text: string) {
  const lower = text.toLowerCase();

  let template = 'researcher';
  if (lower.includes('write') || lower.includes('blog') || lower.includes('content') || lower.includes('copywrite')) {
    template = 'writer';
  } else if (lower.includes('monitor') || lower.includes('watch') || lower.includes('track') || lower.includes('scan') || lower.includes('alert')) {
    template = 'monitor';
  } else if (lower.includes('publish') || lower.includes('tweet') || lower.includes('post') || lower.includes('social')) {
    template = 'publisher';
  } else if (lower.includes('analy') || lower.includes('data') || lower.includes('insight') || lower.includes('trend')) {
    template = 'analyst';
  } else if (lower.includes('research') || lower.includes('search') || lower.includes('find') || lower.includes('look up')) {
    template = 'researcher';
  }

  const nameMatch = text.match(/(?:called?|named?|name[d:]?)\s*["']?([^"'\n,]+?)["']?(?:\s+(?:that|which|to|for|on)|$)/i);
  let agentName = nameMatch ? nameMatch[1].trim() : '';
  if (!agentName) {
    const purposeMatch = text.match(/(?:create|build|make|deploy|launch|spin up)\s+(?:an?\s+)?(?:agent\s+)?(?:that\s+|to\s+|for\s+|which\s+)?(.{5,50}?)(?:\.|$|and\s)/i);
    if (purposeMatch) {
      agentName = purposeMatch[1].trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 30);
      agentName = agentName.charAt(0).toUpperCase() + agentName.slice(1);
    } else {
      agentName = `${AGENT_TEMPLATES[template].name}-${Date.now().toString(36).slice(-4)}`;
    }
  }
  // Sanitize agent name: only allow alphanumeric, hyphens, underscores, spaces
  agentName = agentName.replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 50);
  if (!agentName) agentName = `Agent-${Date.now().toString(36).slice(-4)}`;

  // Detect GPU preference from text (optional)
  let gpuQuery: string | null = null;
  const gpuMatch = lower.match(/(?:on\s+(?:a\s+)?|using\s+(?:a\s+)?|with\s+(?:a\s+)?)(?:nvidia\s+)?(?:rtx\s+)?(\d{4})/);
  if (gpuMatch) gpuQuery = gpuMatch[1];
  else if (lower.match(/\b(\d{4})\s*(?:gpu|market|card)/)) gpuQuery = lower.match(/\b(\d{4})\s*(?:gpu|market|card)/)![1];
  else if (lower.includes('cpu')) gpuQuery = '3060';

  const replicaMatch = text.match(/(\d+)\s*replica/i);
  const replicas = replicaMatch ? parseInt(replicaMatch[1], 10) : 1;

  return { template, agentName, gpuQuery, replicas };
}

export const createAgentFromTemplateAction: Action = {
  name: 'CREATE_AGENT_FROM_TEMPLATE',
  description: 'Create a new AI agent from a template and deploy it to the Nosana GPU network. Handles template selection, configuration, and deployment.',
  similes: ['BUILD_AGENT', 'MAKE_AGENT', 'NEW_AGENT', 'SPAWN_AGENT', 'CREATE_AGENT'],
  validate: async (_runtime: any, message: any) => {
    const text = (message.content?.text || '').toLowerCase();
    return (
      text.includes('create') ||
      text.includes('build') ||
      text.includes('make') ||
      text.includes('new agent') ||
      text.includes('i need') ||
      text.includes('i want') ||
      text.includes('agent that') ||
      text.includes('spin up') ||
      text.includes('set up')
    );
  },
  handler: async (_runtime: any, message: any, _state?: any, _options?: any, callback?: any) => {
    const text = message.content?.text || '';
    const { template, agentName, gpuQuery, replicas } = extractParams(text);
    const tmpl = AGENT_TEMPLATES[template];
    const manager = getNosanaManager();

    // Resolve GPU market dynamically
    let market = gpuQuery ? await manager.findMarket(gpuQuery) : null;
    if (gpuQuery && !market) {
      const available = await manager.getMarkets();
      const errMsg = `GPU "${gpuQuery}" not found. Available GPUs:\n` +
        available.filter(m => m.pricePerHour > 0).slice(0, 10).map(m =>
          `- ${m.name}: $${m.pricePerHour.toFixed(3)}/hr`
        ).join('\n');
      if (callback) await callback({ text: errMsg, action: 'CREATE_AGENT_FROM_TEMPLATE' });
      return { text: errMsg, success: false };
    }
    if (!market) market = await manager.getBestMarket();
    if (!market) {
      const errMsg = 'No GPU markets available. Try again later.';
      if (callback) await callback({ text: errMsg, action: 'CREATE_AGENT_FROM_TEMPLATE' });
      return { text: errMsg, success: false };
    }

    const workerImage = process.env.AGENTFORGE_WORKER_IMAGE || 'drewdockerus/agentforge-worker:latest';

    try {
      const record = await manager.createAndStartDeployment({
        name: agentName,
        dockerImage: workerImage,
        env: {
          AGENT_TEMPLATE: template,
          AGENT_NAME: agentName,
          AGENT_SYSTEM_PROMPT: tmpl.defaultPrompt,
          AGENT_PLUGINS: tmpl.plugins.join(','),
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
        `Agent created and deployed successfully!`,
        ``,
        `**${agentName}**`,
        `- Template: ${tmpl.name} (${template})`,
        `- GPU: ${market.name} ($${market.pricePerHour.toFixed(3)}/hr)`,
        `- Replicas: ${record.replicas}`,
        `- Cost: $${record.costPerHour.toFixed(3)}/hr`,
        `- Status: ${record.status}`,
        `- Deployment ID: \`${record.id}\``,
        record.url ? `- URL: ${record.url}` : '',
        ``,
        `Your agent is running on Nosana's decentralized GPU network.`,
      ].filter(Boolean).join('\n');

      if (callback) {
        await callback({ text: responseText, action: 'CREATE_AGENT_FROM_TEMPLATE' });
      }

      return { text: responseText, success: true, data: { deployment: record } };
    } catch (error: any) {
      const errMsg = `Failed to create agent: ${error.message || error}`;
      if (callback) {
        await callback({ text: errMsg, action: 'CREATE_AGENT_FROM_TEMPLATE' });
      }
      return { text: errMsg, success: false, error: error.message };
    }
  },
  examples: [
    [
      { name: '{{user1}}', content: { text: 'Create an agent that monitors Hacker News for AI papers' } },
      { name: 'AgentForge', content: { text: 'Agent created and deployed successfully!\n\n**monitors-Hacker-News-for-AI**\n- Template: Monitoring Agent (monitor)\n- GPU Market: NVIDIA RTX 3090\n- Cost: $0.15/hr\n- Status: running', action: 'CREATE_AGENT_FROM_TEMPLATE' } },
    ],
    [
      { name: '{{user1}}', content: { text: 'Build a writer agent for blog posts' } },
      { name: 'AgentForge', content: { text: 'Agent created and deployed successfully!\n\n**writer-for-blog-posts**\n- Template: Content Writer (writer)\n- GPU Market: CPU Only\n- Cost: $0.05/hr\n- Status: running', action: 'CREATE_AGENT_FROM_TEMPLATE' } },
    ],
  ],
};
