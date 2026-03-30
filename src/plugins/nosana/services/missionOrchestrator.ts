import { getNosanaManager } from './nosanaManager.js';
import { WorkerClient } from './workerClient.js';
import { AGENT_TEMPLATES } from '../types.js';

interface PipelineStep {
  template: string;
  name: string;
  task: string;
}

interface PipelineNode {
  step: PipelineStep;
  deploymentId?: string;
  url?: string;
  status: 'pending' | 'deploying' | 'ready' | 'processing' | 'complete' | 'error';
  output?: string;
  error?: string;
}

export interface MissionResult {
  success: boolean;
  steps: PipelineNode[];
  finalOutput: string;
  totalTime: number;
}

export class MissionOrchestrator {

  async planPipeline(mission: string): Promise<PipelineStep[]> {
    const baseUrl = process.env.OPENAI_BASE_URL || process.env.OPENAI_API_URL || '';
    const apiKey = process.env.OPENAI_API_KEY || 'nosana';
    const model = process.env.OPENAI_SMALL_MODEL || 'Qwen3.5-27B-AWQ-4bit';

    if (!baseUrl) return this.planFallback(mission);

    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content: `You are a mission planner for AgentForge. Given a user mission, plan a pipeline of AI agents.
Available templates: researcher (web search + analysis), writer (content creation), monitor (tracking changes), publisher (social media), analyst (data analysis).
Return ONLY a JSON array of steps. Each step: {"template":"...","name":"...","task":"what this agent should do"}.
Rules:
- Use 1-3 agents maximum
- First agent usually does research/gathering
- Last agent produces the final deliverable
- Each agent's task should reference the previous agent's output
Example for "Research AI trends and write a blog post":
[{"template":"researcher","name":"AI-Researcher","task":"Research the latest AI trends, breakthroughs, and industry developments. Provide a structured summary with key findings and sources."},{"template":"writer","name":"Blog-Writer","task":"Using the research provided, write an engaging 800-word blog post about the latest AI trends."}]`,
            },
            { role: 'user', content: mission },
          ],
          temperature: 0.3,
        }),
      });

      if (!res.ok) throw new Error(`LLM error: ${res.status}`);
      const data = await res.json() as any;
      const content = data.choices?.[0]?.message?.content || '';

      // Extract JSON array (may be wrapped in ```json ... ```)
      const jsonMatch = content.match(/\[[\s\S]*?\]/);
      if (!jsonMatch) throw new Error('No JSON array in LLM response');

      const steps = JSON.parse(jsonMatch[0]) as PipelineStep[];
      if (!Array.isArray(steps) || steps.length === 0) throw new Error('Empty pipeline');

      return steps
        .filter(s => s.template && s.name && s.task && (AGENT_TEMPLATES[s.template] || s.template === 'custom'))
        .slice(0, 3);
    } catch (err) {
      console.warn('[MissionOrchestrator] LLM planning failed, using fallback:', err);
      return this.planFallback(mission);
    }
  }

  private planFallback(mission: string): PipelineStep[] {
    const lower = mission.toLowerCase();
    const steps: PipelineStep[] = [];

    if (lower.includes('research') || lower.includes('find') || lower.includes('latest') || lower.includes('trend') || lower.includes('search')) {
      steps.push({ template: 'researcher', name: 'Researcher', task: `Research: ${mission}. Provide a detailed summary with key findings.` });
    }

    if (lower.includes('analy') || lower.includes('compare') || lower.includes('data')) {
      steps.push({ template: 'analyst', name: 'Analyst', task: 'Analyze the findings and identify key trends, patterns, and insights.' });
    }

    if (lower.includes('write') || lower.includes('blog') || lower.includes('article') || lower.includes('content') || lower.includes('post')) {
      steps.push({ template: 'writer', name: 'Writer', task: `Write a polished ${lower.includes('blog') ? 'blog post' : 'article'} based on the provided research.` });
    }

    if (steps.length === 0) {
      steps.push(
        { template: 'researcher', name: 'Researcher', task: `Research: ${mission}` },
        { template: 'writer', name: 'Writer', task: 'Summarize the research findings clearly.' },
      );
    }

    return steps;
  }

  async execute(mission: string, callback?: (text: string) => Promise<void>, originalMission?: string): Promise<MissionResult> {
    const startTime = Date.now();
    const log = (msg: string) => console.log(`[MissionOrchestrator] ${msg}`);

    // 1. Plan
    log('Planning mission pipeline...');
    const steps = await this.planPipeline(mission);
    const nodes: PipelineNode[] = steps.map(s => ({ step: s, status: 'pending' as const }));

    log(`pipeline:created — ${steps.length} steps: ${steps.map(s => s.template).join(' → ')}`);
    if (callback) {
      await callback(
        `**Mission planned!** ${steps.length} agents in pipeline:\n` +
        steps.map((s, i) => `${i + 1}. **${s.name}** (${s.template}) — ${s.task.slice(0, 100)}`).join('\n') +
        '\n\nDeploying agents on Nosana...'
      );
    }

    const manager = getNosanaManager();
    const market = await manager.getBestMarket();
    if (!market) throw new Error('No GPU markets available');

    const workerImage = process.env.AGENTFORGE_WORKER_IMAGE || 'drewdockerus/agentforge-worker:latest';

    // 2. Deploy all agents in parallel
    const deployPromises = nodes.map(async (node) => {
      const tmpl = AGENT_TEMPLATES[node.step.template] || AGENT_TEMPLATES['researcher'];
      node.status = 'deploying';
      log(`node:status — ${node.step.name}: deploying`);

      try {
        const dep = await manager.createAndStartDeployment({
          name: `mission-${node.step.name}`,
          dockerImage: workerImage,
          env: {
            AGENT_TEMPLATE: node.step.template,
            AGENT_NAME: node.step.name,
            AGENT_SYSTEM_PROMPT: tmpl.defaultPrompt,
            AGENT_PLUGINS: tmpl.plugins.join(','),
            OPENAI_API_KEY: process.env.OPENAI_API_KEY || 'nosana',
            OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || process.env.OPENAI_API_URL || '',
            OPENAI_API_URL: process.env.OPENAI_BASE_URL || process.env.OPENAI_API_URL || '',
            OPENAI_SMALL_MODEL: process.env.OPENAI_SMALL_MODEL || 'Qwen3.5-27B-AWQ-4bit',
            OPENAI_LARGE_MODEL: process.env.OPENAI_LARGE_MODEL || 'Qwen3.5-27B-AWQ-4bit',
            MODEL_NAME: process.env.MODEL_NAME || 'Qwen3.5-27B-AWQ-4bit',
            TAVILY_API_KEY: process.env.TAVILY_API_KEY || '',
            SERVER_PORT: '3000',
          },
          resolvedMarket: market,
          timeout: 30,
        });
        node.deploymentId = dep.id;
        node.url = dep.url;
        log(`node:status — ${node.step.name}: deployed (${dep.id})`);
      } catch (err: any) {
        node.status = 'error';
        node.error = err.message;
        log(`node:status — ${node.step.name}: error — ${err.message}`);
      }
    });

    await Promise.all(deployPromises);

    const failed = nodes.filter(n => n.status === 'error');
    if (failed.length === nodes.length) {
      throw new Error(`All deployments failed: ${failed.map(f => f.error).join('; ')}`);
    }

    if (callback) {
      await callback(`${nodes.length - failed.length} agents deployed. Waiting for them to come online...`);
    }

    // 3. Wait for agents to be ready
    for (const node of nodes) {
      if (node.status === 'error' || !node.url) continue;
      try {
        const client = new WorkerClient(node.url);
        await client.waitForReady(180_000);
        node.status = 'ready';
        log(`node:status — ${node.step.name}: ready`);
      } catch (err: any) {
        node.status = 'error';
        node.error = err.message;
        log(`node:status — ${node.step.name}: error waiting — ${err.message}`);
      }
    }

    // 4. Execute pipeline sequentially
    const missionText = originalMission || mission;
    let previousOutput = '';
    let lastSuccessfulStep = '';
    let finalOutput = '';

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];

      if (node.status !== 'ready') {
        // Step failed (deploy or readiness) — skip but don't lose context
        log(`node:status — ${node.step.name}: skipped (${node.status}: ${node.error})`);
        continue;
      }

      node.status = 'processing';
      log(`node:status — ${node.step.name}: processing`);

      if (callback) {
        await callback(`**Step ${i + 1}/${nodes.length}**: ${node.step.name} is working...`);
      }

      let prompt: string;
      if (i === 0 || !previousOutput) {
        // First step OR no previous output (prior steps failed)
        prompt = node.step.task;
      } else {
        prompt = `${node.step.task}\n\nHere is the output from the previous step:\n\n${previousOutput}`;
      }

      // If prior steps failed, give this agent the original mission as fallback
      if (i > 0 && !previousOutput && lastSuccessfulStep === '') {
        prompt = `The previous agent (${nodes[i - 1]?.step.template || 'unknown'}) was unavailable. ` +
          `Please complete the mission using your own knowledge: ${missionText}`;
      }

      try {
        const client = new WorkerClient(node.url!);
        const agentId = await client.waitForReady(10_000);
        const output = await client.sendMessage(agentId, prompt);
        node.output = output;
        node.status = 'complete';
        previousOutput = output;
        lastSuccessfulStep = node.step.name;
        finalOutput = output;
        log(`node:status — ${node.step.name}: complete (${output.length} chars)`);
      } catch (err: any) {
        node.status = 'error';
        node.error = err.message;
        log(`node:status — ${node.step.name}: error — ${err.message}`);
      }
    }

    // 5. Cleanup: stop all mission agents to save credits
    log('Cleaning up mission agents...');
    for (const node of nodes) {
      if (node.deploymentId) {
        try {
          await manager.stopDeployment(node.deploymentId);
          log(`Stopped ${node.step.name}`);
        } catch {}
      }
    }

    const totalTime = Date.now() - startTime;
    log(`mission:complete — ${totalTime}ms, ${nodes.filter(n => n.status === 'complete').length}/${nodes.length} steps succeeded`);

    return {
      success: nodes.some(n => n.status === 'complete'),
      steps: nodes,
      finalOutput: finalOutput || 'Mission produced no output.',
      totalTime,
    };
  }
}
