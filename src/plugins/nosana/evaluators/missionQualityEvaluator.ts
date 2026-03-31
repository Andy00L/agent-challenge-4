/**
 * ElizaOS Evaluator: Mission Quality Scorer
 *
 * Runs AFTER every agent response. Checks if the response contains mission
 * pipeline results and scores them on completeness, structure, and actionability.
 * Demonstrates proper use of the ElizaOS Evaluator interface.
 */
import type { Evaluator } from '@elizaos/core';

export const missionQualityEvaluator: Evaluator = {
  name: 'MISSION_QUALITY',
  description: 'Scores the quality of mission pipeline outputs based on completeness, structure, and content depth',
  alwaysRun: false,
  similes: ['SCORE_OUTPUT', 'QUALITY_CHECK', 'RATE_MISSION'],

  examples: [
    {
      prompt: 'Agent completed a research + blog mission pipeline',
      messages: [
        { name: '{{user1}}', content: { text: 'Research AI trends and write a blog post' } },
        { name: '{{agentName}}', content: { text: '**Mission Complete!**\n\nPipeline: Researcher → Writer\n\n# AI Trends 2026\n\nAccording to recent research...' } },
      ],
      outcome: 'Quality score: 7/10 — structured output with headers, good length, some sources',
    },
  ],

  validate: async (_runtime, message) => {
    const text = (message.content as { text?: string })?.text || '';
    return (
      text.includes('Mission Complete') ||
      text.includes('mission complete') ||
      text.includes('Pipeline:') ||
      (text.length > 500 && (text.includes('##') || text.includes('**')))
    );
  },

  handler: async (_runtime, message) => {
    const text = (message.content as { text?: string })?.text || '';

    const scores = {
      length: 0,
      structure: 0,
      sources: 0,
      actionable: 0,
      formatting: 0,
    };

    // Length (0-2)
    if (text.length > 2000) scores.length = 2;
    else if (text.length > 800) scores.length = 1;

    // Structure — headers/sections (0-2)
    const headerCount = (text.match(/^#{1,3}\s/gm) || []).length;
    if (headerCount >= 4) scores.structure = 2;
    else if (headerCount >= 2 || (text.includes('**') && text.length > 500)) scores.structure = 1;

    // Sources (0-2)
    const hasUrls = /https?:\/\//.test(text);
    const hasCitations = /\[\d+\]|\(source|\(ref|according to/i.test(text);
    if (hasUrls && hasCitations) scores.sources = 2;
    else if (hasUrls || hasCitations) scores.sources = 1;

    // Actionable (0-2)
    const actionWords = ['recommend', 'suggest', 'consider', 'should', 'action', 'next step', 'takeaway'];
    const actionCount = actionWords.filter(k => text.toLowerCase().includes(k)).length;
    if (actionCount >= 3) scores.actionable = 2;
    else if (actionCount >= 1) scores.actionable = 1;

    // Formatting (0-2)
    const hasList = /^[\-\*]\s/m.test(text) || /^\d+\.\s/m.test(text);
    const hasTable = text.includes('|') && text.includes('---');
    if (hasList && hasTable) scores.formatting = 2;
    else if (hasList || hasTable) scores.formatting = 1;

    const total = Object.values(scores).reduce((a, b) => a + b, 0);
    const pct = Math.round((total / 10) * 100);

    console.log(
      `[AgentForge:Evaluator] Mission quality: ${total}/10 (${pct}%) — ` +
      `length=${scores.length}/2, structure=${scores.structure}/2, sources=${scores.sources}/2, ` +
      `actionable=${scores.actionable}/2, formatting=${scores.formatting}/2`
    );

    return {
      success: true,
      text: `Mission quality: ${total}/10 (${pct}%)`,
      data: { score: total, maxScore: 10, percentage: pct, breakdown: scores },
    };
  },
};
