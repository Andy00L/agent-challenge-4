import type { Action } from '@elizaos/core';
import { randomUUID } from 'crypto';
import { MissionOrchestrator } from '../services/missionOrchestrator.js';

export const executeMissionAction: Action = {
  name: 'EXECUTE_MISSION',
  description: 'Execute a complex multi-step mission by orchestrating multiple AI agents in a DAG pipeline on Nosana. Handles competitive analysis (parallel researchers), research+write pipelines, and any multi-agent task. Agents are automatically stopped after completion.',
  similes: [
    'EXECUTE_PIPELINE', 'RUN_MISSION', 'START_PIPELINE', 'ORCHESTRATE_AGENTS',
    'MULTI_AGENT_MISSION', 'RESEARCH_AND_WRITE', 'CREATE_PIPELINE',
    'COMPETITIVE_ANALYSIS', 'COMPARE_AND_ANALYZE', 'RUN_AGENTS',
    'AGENT_PIPELINE', 'PARALLEL_AGENTS',
  ],
  validate: async (_runtime: any, message: any) => {
    const text = (message.content?.text || '').toLowerCase();

    // Multi-step mission patterns
    if (text.includes('pipeline') || text.includes('mission')) return true;

    // Competitive / comparison patterns
    if (text.includes('competitive') && text.includes('analysis')) return true;
    if (text.includes('compare') && text.includes('vs')) return true;
    if (/\bvs\.?\s/.test(text)) return true;

    // Research + output patterns (multi-step)
    if (text.includes('research') && /write|blog|article|report|summarize|script|post|analysis/.test(text)) return true;
    if (text.includes('find') && /analy|write|report/.test(text)) return true;
    if (text.includes('monitor') && text.includes('report')) return true;

    // "X and Y" multi-task pattern
    if (/\b(research|search|find)\b.*\band\b.*\b(write|analyze|compare|create|report)\b/i.test(text)) return true;

    return false;
  },
  handler: async (_runtime: any, message: any, _state?: any, _options?: any, callback?: any) => {
    const mission = message.content?.text || '';
    const orchestrator = new MissionOrchestrator();

    const sendUpdate = async (text: string) => {
      if (!callback) return;
      try {
        // Each callback must have a unique ID to prevent DB duplicate key errors in ElizaOS
        await callback({ id: randomUUID(), text, action: 'EXECUTE_MISSION' });
      } catch (err: any) {
        // Still ignore errors — the orchestrator must not crash due to chat delivery failure
        console.warn(`[AgentForge:Mission] Callback failed: ${err.message?.slice(0, 100)}`);
      }
    };

    try {
      const result = await orchestrator.execute(mission, sendUpdate);

      const completedCount = result.steps.filter(s => s.status === 'complete').length;
      const summary = [
        `\u{2705} **Mission Complete!** ${completedCount}/${result.steps.length} agents succeeded in ${Math.round(result.totalTime / 1000)}s.`,
        '',
        `Pipeline: ${result.steps.map(s => `${s.step.name} (${s.status})`).join(' \u2192 ')}`,
        '',
        'View the full output in the **Mission Canvas** panel \u2192',
      ].join('\n');

      await sendUpdate(summary);
      return { text: result.finalOutput, success: true, data: { result } };
    } catch (error: any) {
      const errMsg = `Mission failed: ${error.message || error}`;
      await sendUpdate(errMsg);
      return { text: errMsg, success: false, error: error.message };
    }
  },
  examples: [
    [
      { name: '{{user1}}', content: { text: 'Research the latest AI trends and write me a blog post' } },
      { name: 'AgentForge', content: { text: '**Mission planned!** 2 agents in pipeline:\n1. **AI-Researcher** (researcher) \u2014 Research latest AI trends\n2. **Blog-Writer** (writer) \u2014 Write blog post from research\n\nDeploying agents on Nosana...', action: 'EXECUTE_MISSION' } },
    ],
    [
      { name: '{{user1}}', content: { text: 'Do a competitive analysis of CrewAI vs AutoGen vs ElizaOS' } },
      { name: 'AgentForge', content: { text: '**Mission planned!** 5 agents in pipeline (3 parallel):\n1. **Lead-Researcher** \u2014 Overview of AI agent frameworks\n2-4. **CrewAI/AutoGen/ElizaOS Researchers** (parallel) \u2014 Deep dive each\n5. **Competitive-Analyst** \u2014 Synthesize into comparison report\n\nDeploying on Nosana GPU network...', action: 'EXECUTE_MISSION' } },
    ],
  ],
};
