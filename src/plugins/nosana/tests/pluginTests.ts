/**
 * ElizaOS Plugin Test Suite for plugin-nosana.
 *
 * Registered via the Plugin.tests field. Can be run with `elizaos test`.
 * Verifies core components without requiring Nosana API access.
 */
import type { TestSuite } from '@elizaos/core';

export const nosanaPluginTests: TestSuite = {
  name: 'plugin-nosana',

  tests: [
    {
      name: 'GPU market fallback constants are valid',
      fn: async () => {
        const { GPU_MARKETS } = await import('../types.js');
        const keys = Object.keys(GPU_MARKETS);
        if (keys.length < 5) throw new Error(`Expected >=5 GPU markets, got ${keys.length}`);
        for (const [key, m] of Object.entries(GPU_MARKETS)) {
          if (!m.address || m.address.length < 30) throw new Error(`Market ${key}: invalid address`);
          if (!m.name) throw new Error(`Market ${key}: no name`);
          if (m.estimatedCostPerHour <= 0) throw new Error(`Market ${key}: invalid cost`);
        }
        console.log(`[AgentForge:Test] \u2705 ${keys.length} GPU markets validated`);
      },
    },

    {
      name: 'Agent templates have valid configurations',
      fn: async () => {
        const { AGENT_TEMPLATES } = await import('../types.js');
        const required = ['researcher', 'writer', 'analyst', 'monitor', 'publisher'];
        for (const name of required) {
          if (!AGENT_TEMPLATES[name]) throw new Error(`Missing template: ${name}`);
          if (!AGENT_TEMPLATES[name].plugins.length) throw new Error(`Template ${name}: no plugins`);
          if (AGENT_TEMPLATES[name].defaultPrompt.length < 10) throw new Error(`Template ${name}: no prompt`);
        }
        if (!AGENT_TEMPLATES.researcher.plugins.some(p => p.includes('web-search'))) {
          throw new Error('Researcher must include web-search');
        }
        console.log(`[AgentForge:Test] \u2705 ${required.length} agent templates validated`);
      },
    },

    {
      name: 'Plugin actions are properly defined',
      fn: async () => {
        const { nosanaPlugin } = await import('../index.js');
        if (!nosanaPlugin.actions || nosanaPlugin.actions.length < 5) {
          throw new Error(`Expected >=5 actions, got ${nosanaPlugin.actions?.length || 0}`);
        }
        for (const action of nosanaPlugin.actions) {
          if (!action.name) throw new Error('Action missing name');
          if (!action.handler) throw new Error(`${action.name}: missing handler`);
          if (!action.validate) throw new Error(`${action.name}: missing validate`);
        }
        const em = nosanaPlugin.actions.find(a => a.name === 'EXECUTE_MISSION');
        if (!em) throw new Error('EXECUTE_MISSION not found');
        if (!em.similes || em.similes.length < 5) throw new Error('EXECUTE_MISSION: need >=5 similes');
        console.log(`[AgentForge:Test] \u2705 ${nosanaPlugin.actions.length} actions validated`);
      },
    },

    {
      name: 'Plugin provider returns fleet status',
      fn: async () => {
        const { nosanaPlugin } = await import('../index.js');
        if (!nosanaPlugin.providers?.length) throw new Error('No providers');
        const p = nosanaPlugin.providers[0];
        if (p.name !== 'nosana-fleet-status') throw new Error(`Wrong provider: ${p.name}`);
        if (typeof p.get !== 'function') throw new Error('Provider.get not a function');
        console.log(`[AgentForge:Test] \u2705 Provider '${p.name}' validated`);
      },
    },

    {
      name: 'Plugin has evaluator and event handlers',
      fn: async () => {
        const { nosanaPlugin } = await import('../index.js');
        if (!nosanaPlugin.evaluators?.length) throw new Error('No evaluators');
        if (nosanaPlugin.evaluators[0].name !== 'MISSION_QUALITY') {
          throw new Error(`Wrong evaluator: ${nosanaPlugin.evaluators[0].name}`);
        }
        if (!nosanaPlugin.events) throw new Error('No events registered');
        console.log(`[AgentForge:Test] \u2705 Evaluator and events registered`);
      },
    },
  ],
};
