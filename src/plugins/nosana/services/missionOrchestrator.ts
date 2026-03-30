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

// ── Pipeline state exposed to REST endpoint ──────────────

export interface MissionPipelineState {
  id: string | null;
  mission: string | null;
  status: 'idle' | 'planning' | 'deploying' | 'executing' | 'complete' | 'error';
  steps: Array<{
    id: string;
    name: string;
    template: string;
    task: string;
    status: 'pending' | 'deploying' | 'deployed' | 'ready' | 'processing' | 'complete' | 'error' | 'stopped';
    deploymentId?: string;
    url?: string;
    market?: string;
    costPerHour?: number;
    outputPreview?: string;
    error?: string;
    dependsOn?: string;
  }>;
  finalOutput: string | null;
  startedAt: number | null;
  completedAt: number | null;
}

let currentPipelineState: MissionPipelineState = {
  id: null, mission: null, status: 'idle', steps: [],
  finalOutput: null, startedAt: null, completedAt: null,
};

export function getPipelineState(): MissionPipelineState {
  return currentPipelineState;
}

export function resetPipelineState(): void {
  currentPipelineState = {
    id: null, mission: null, status: 'idle', steps: [],
    finalOutput: null, startedAt: null, completedAt: null,
  };
}

function stepStatusForClient(node: PipelineNode): MissionPipelineState['steps'][number]['status'] {
  if (node.status === 'deploying' && node.deploymentId) return 'deployed';
  return node.status;
}

// ── Orchestrator ─────────────────────────────────────────

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
        signal: AbortSignal.timeout(60_000),
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
      steps.push({
        template: 'researcher',
        name: 'Researcher',
        task: `Research the following topic thoroughly. Gather key facts, recent developments, notable sources, and relevant data. Provide a well-structured summary with your findings: ${mission}`,
      });
    }

    if (lower.includes('analy') || lower.includes('compare') || lower.includes('data')) {
      steps.push({
        template: 'analyst',
        name: 'Analyst',
        task: `Analyze the research findings. Identify key trends, patterns, comparisons, and actionable insights related to: ${mission}`,
      });
    }

    if (lower.includes('write') || lower.includes('blog') || lower.includes('article') || lower.includes('content') || lower.includes('post')) {
      const format = lower.includes('blog') ? 'blog post' : lower.includes('article') ? 'article' : 'written piece';
      steps.push({
        template: 'writer',
        name: 'Writer',
        task: `Using the research provided, write a polished, engaging ${format} with clear sections, compelling narrative, and a strong conclusion about: ${mission}`,
      });
    }

    if (steps.length === 0) {
      steps.push(
        {
          template: 'researcher',
          name: 'Researcher',
          task: `Thoroughly research the following topic. Gather key facts, recent developments, data points, and expert perspectives. Provide a comprehensive, well-structured summary: ${mission}`,
        },
        {
          template: 'writer',
          name: 'Writer',
          task: `Using the research provided, synthesize the findings into a clear, well-organized report. Highlight the most important points and present actionable conclusions about: ${mission}`,
        },
      );
    }

    return steps;
  }

  async execute(mission: string, callback?: (text: string) => Promise<void>, originalMission?: string): Promise<MissionResult> {
    const startTime = Date.now();
    const log = (msg: string) => console.log(`[MissionOrchestrator] ${msg}`);
    const missionId = `mission-${Date.now()}`;

    // Init pipeline state
    currentPipelineState = {
      id: missionId, mission, status: 'planning', steps: [],
      finalOutput: null, startedAt: startTime, completedAt: null,
    };

    // 1. Plan
    log('Planning mission pipeline...');
    const steps = await this.planPipeline(mission);
    const nodes: PipelineNode[] = steps.map(s => ({ step: s, status: 'pending' as const }));

    // State sync helper — call after every node status change
    let marketName: string | undefined;
    let marketCost: number | undefined;
    const syncState = (pipelineStatus?: MissionPipelineState['status']) => {
      currentPipelineState = {
        ...currentPipelineState,
        status: pipelineStatus || currentPipelineState.status,
        steps: nodes.map((n, i) => ({
          id: `step-${i}`,
          name: n.step.name,
          template: n.step.template,
          task: n.step.task,
          status: stepStatusForClient(n),
          deploymentId: n.deploymentId,
          url: n.url,
          market: marketName,
          costPerHour: marketCost,
          outputPreview: n.output?.slice(0, 300),
          error: n.error,
          dependsOn: i > 0 ? `step-${i - 1}` : undefined,
        })),
      };
    };

    syncState('deploying');

    log(`pipeline:created — ${steps.length} steps: ${steps.map(s => s.template).join(' → ')}`);
    if (callback) {
      await callback(
        `**Mission planned!** ${steps.length} agents in pipeline:\n` +
        steps.map((s, i) => `${i + 1}. **${s.name}** (${s.template}) — ${s.task.slice(0, 100)}`).join('\n') +
        '\n\nStarting pipeline on Nosana...'
      );
    }

    const manager = getNosanaManager();
    const market = await manager.getBestMarket();
    if (!market) throw new Error('No GPU markets available');
    marketName = market.name;
    marketCost = market.pricePerHour;

    const workerImage = process.env.AGENTFORGE_WORKER_IMAGE || 'drewdockerus/agentforge-worker:latest';

    // --- Helpers ---

    const deployNode = async (node: PipelineNode) => {
      const tmpl = AGENT_TEMPLATES[node.step.template] || AGENT_TEMPLATES['researcher'];
      node.status = 'deploying';
      log(`node:status — ${node.step.name}: deploying`);
      syncState();

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
        syncState();
      } catch (err: any) {
        node.status = 'error';
        node.error = err.message;
        log(`node:status — ${node.step.name}: deploy error — ${err.message}`);
        syncState();
      }
    };

    const waitForNodeReady = async (node: PipelineNode): Promise<boolean> => {
      if (node.status === 'error' || !node.url) return false;
      const client = new WorkerClient(node.url);

      try {
        await client.waitForReady(240_000);
        node.status = 'ready';
        log(`node:status — ${node.step.name}: ready`);
        syncState();
        return true;
      } catch (err: any) {
        log(`node:status — ${node.step.name}: waitForReady failed — ${err.message}, retrying...`);
      }

      try {
        await client.waitForReady(240_000);
        node.status = 'ready';
        log(`node:status — ${node.step.name}: ready (retry)`);
        syncState();
        return true;
      } catch (err: any) {
        log(`node:status — ${node.step.name}: retry also failed — ${err.message}`);
        return false;
      }
    };

    // 2. Pipeline overlap execution
    const missionText = originalMission || mission;
    let previousOutput = '';
    let lastSuccessfulStep = '';
    let finalOutput = '';
    let backgroundDeploy: Promise<void> | null = null;

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const nextNode = i + 1 < nodes.length ? nodes[i + 1] : null;

      if (backgroundDeploy) {
        await backgroundDeploy;
        backgroundDeploy = null;
      } else if (node.status === 'pending') {
        await deployNode(node);
      }

      if (node.status === 'error' || !node.url) {
        log(`node:status — ${node.step.name}: skipped (deploy failed: ${node.error})`);
        if (nextNode && nextNode.status === 'pending') {
          backgroundDeploy = deployNode(nextNode);
        }
        continue;
      }

      let ready = await waitForNodeReady(node);

      if (!ready && node.url) {
        if (nextNode && nextNode.status === 'pending') {
          backgroundDeploy = deployNode(nextNode);
        }

        try {
          const client = new WorkerClient(node.url);
          await client.waitForReady(60_000);
          node.status = 'ready';
          ready = true;
          log(`node:status — ${node.step.name}: ready (late)`);
          syncState();
        } catch {
          node.status = 'error';
          node.error = 'Not ready after extended wait';
          log(`node:status — ${node.step.name}: giving up after extended wait`);
          syncState();
        }
      }

      if (!ready) {
        continue;
      }

      if (nextNode && nextNode.status === 'pending' && !backgroundDeploy) {
        backgroundDeploy = deployNode(nextNode);
      }

      // --- Execute this step ---

      node.status = 'processing';
      log(`node:status — ${node.step.name}: processing`);
      syncState('executing');

      let prompt: string;
      if (i === 0 || !previousOutput) {
        prompt = [
          'You are executing a task. Do NOT say "I\'ll do this" or "Let me help you." Provide your complete output IMMEDIATELY.',
          '',
          `TASK: ${node.step.task}`,
          '',
          'INSTRUCTIONS:',
          '- Provide detailed, substantive content — not a plan or offer to help',
          '- Include specific facts, examples, names, and details from your knowledge',
          '- Write at least 300 words of actual content',
          '- Do NOT ask clarifying questions — just execute with your best judgment',
          '',
          'PROVIDE YOUR COMPLETE OUTPUT NOW:',
        ].join('\n');
      } else {
        prompt = [
          'You are executing a task. The previous agent provided input below. Use it to complete your task.',
          '',
          '=== INPUT FROM PREVIOUS AGENT ===',
          previousOutput,
          '=== END INPUT ===',
          '',
          `TASK: ${node.step.task}`,
          '',
          'INSTRUCTIONS:',
          '- Use ALL the information above as your source material',
          '- Do NOT ask for more data — work with what you have',
          '- Produce a complete, polished output ready for the end user',
          '- Write at least 400 words of detailed content',
          '',
          'PRODUCE YOUR COMPLETE OUTPUT NOW:',
        ].join('\n');
      }

      if (i > 0 && !previousOutput && lastSuccessfulStep === '') {
        prompt = `The previous agent was unavailable. Complete this mission using your own knowledge.\n\nMISSION: ${missionText}\nTASK: ${node.step.task}\n\nProvide a complete, detailed response. Execute the task NOW:`;
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
        syncState();
      } catch (err: any) {
        node.status = 'error';
        node.error = err.message;
        log(`node:status — ${node.step.name}: error — ${err.message}`);
        syncState();
      }
    }

    // Check if all steps failed
    if (nodes.every(n => n.status === 'error')) {
      for (const node of nodes) {
        if (node.deploymentId) {
          try { await manager.stopDeployment(node.deploymentId); } catch {}
        }
      }
      currentPipelineState = { ...currentPipelineState, status: 'error', completedAt: Date.now() };
      syncState('error');
      throw new Error(`All pipeline steps failed: ${nodes.map(n => `${n.step.name}: ${n.error}`).join('; ')}`);
    }

    // 3. Cleanup
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

    currentPipelineState = {
      ...currentPipelineState,
      status: 'complete',
      finalOutput: finalOutput || 'Mission produced no output.',
      completedAt: Date.now(),
    };
    syncState('complete');

    return {
      success: nodes.some(n => n.status === 'complete'),
      steps: nodes,
      finalOutput: finalOutput || 'Mission produced no output.',
      totalTime,
    };
  }
}
