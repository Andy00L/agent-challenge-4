import type { Action } from '@elizaos/core';
import { MissionOrchestrator } from '../services/missionOrchestrator.js';

export const executeMissionAction: Action = {
  name: 'EXECUTE_MISSION',
  description: 'Execute a complex multi-step mission by orchestrating multiple AI agents in a pipeline on Nosana. Each agent processes its step and passes output to the next. Agents are automatically stopped after the mission completes.',
  similes: ['RUN_MISSION', 'ORCHESTRATE', 'MULTI_AGENT', 'PIPELINE'],
  validate: async (_runtime: any, message: any) => {
    const text = (message.content?.text || '').toLowerCase();
    return (
      (text.includes('research') && (text.includes('write') || text.includes('blog') || text.includes('article') || text.includes('summarize') || text.includes('report'))) ||
      (text.includes('find') && (text.includes('analy') || text.includes('write') || text.includes('report'))) ||
      (text.includes('monitor') && text.includes('report')) ||
      text.includes('mission') ||
      text.includes('pipeline')
    );
  },
  handler: async (runtime: any, message: any, _state?: any, _options?: any, callback?: any) => {
    const mission = message.content?.text || '';
    const orchestrator = new MissionOrchestrator();

    const sendUpdate = async (text: string) => {
      if (!callback) return;
      try {
        await callback({ text, action: 'EXECUTE_MISSION' });
      } catch {
        // Ignore DB unique constraint errors from rapid sequential callbacks
      }
    };

    try {
      const result = await orchestrator.execute(mission, sendUpdate);

      const summary = [
        '**Mission Complete!**',
        '',
        `Pipeline: ${result.steps.map(s => `${s.step.name} (${s.status})`).join(' → ')}`,
        `Time: ${Math.round(result.totalTime / 1000)}s | Agents stopped to save credits`,
        '',
        '---',
        '',
        result.finalOutput,
      ].join('\n');

      await sendUpdate(summary);
      return { text: summary, success: true, data: { result } };
    } catch (error: any) {
      const errMsg = `Mission failed: ${error.message || error}`;
      await sendUpdate(errMsg);
      return { text: errMsg, success: false, error: error.message };
    }
  },
  examples: [
    [
      { name: '{{user1}}', content: { text: 'Research the latest AI trends and write me a blog post' } },
      { name: 'AgentForge', content: { text: '**Mission planned!** 2 agents in pipeline:\n1. **AI-Researcher** (researcher) — Research latest AI trends\n2. **Blog-Writer** (writer) — Write blog post from research\n\nDeploying agents on Nosana...', action: 'EXECUTE_MISSION' } },
    ],
  ],
};
