import { getNosanaManager } from './nosanaManager.js';
import { WorkerClient } from './workerClient.js';
import { AGENT_TEMPLATES } from '../types.js';

// ── DAG helpers ─────────────────────────────────────────

function getDependencies(step: { dependsOn?: string | string[] }): string[] {
  if (!step.dependsOn) return [];
  return Array.isArray(step.dependsOn) ? step.dependsOn : [step.dependsOn];
}

function calculateDepthLevels(steps: { id: string; dependsOn?: string | string[] }[]): Map<number, string[]> {
  const depths = new Map<string, number>();

  function getDepth(stepId: string): number {
    if (depths.has(stepId)) return depths.get(stepId)!;
    const step = steps.find(s => s.id === stepId);
    if (!step) return 0;
    const deps = getDependencies(step);
    if (deps.length === 0) { depths.set(stepId, 0); return 0; }
    const maxParent = Math.max(...deps.map(d => getDepth(d)));
    const depth = maxParent + 1;
    depths.set(stepId, depth);
    return depth;
  }

  for (const step of steps) getDepth(step.id);

  const levels = new Map<number, string[]>();
  for (const [stepId, depth] of depths) {
    if (!levels.has(depth)) levels.set(depth, []);
    levels.get(depth)!.push(stepId);
  }
  return levels;
}

// ── Types ────────────────────────────────────────────────

interface PipelineStep {
  id: string;
  template: string;
  name: string;
  task: string;
  dependsOn?: string | string[];
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
    output?: string;
    error?: string;
    dependsOn?: string | string[];
    depth?: number;
    parallelIndex?: number;
    parallelCount?: number;
    queuedSince?: number;
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
  // Enrich with live deployment status (detect QUEUED during queue wait)
  if (currentPipelineState.steps.length > 0) {
    const mgr = getNosanaManager();
    return {
      ...currentPipelineState,
      steps: currentPipelineState.steps.map(s => {
        if (!s.deploymentId) return s;
        const dep = mgr.getDeployment(s.deploymentId);
        return {
          ...s,
          queuedSince: dep?.status === 'queued' ? dep.startedAt.getTime() : undefined,
        };
      }),
    };
  }
  return currentPipelineState;
}

export function resetPipelineState(): void {
  currentPipelineState = {
    id: null, mission: null, status: 'idle', steps: [],
    finalOutput: null, startedAt: null, completedAt: null,
  };
}

// ── Mission history ─────────────────────────────────────

interface MissionHistoryEntry {
  id: string;
  mission: string;
  status: 'complete' | 'error';
  stepsCount: number;
  finalOutputPreview: string;
  completedAt: number;
  totalTime: number;
}

const missionHistory: MissionHistoryEntry[] = [];

export function getMissionHistory(): MissionHistoryEntry[] {
  return missionHistory;
}

function stepStatusForClient(node: PipelineNode): MissionPipelineState['steps'][number]['status'] {
  if (node.status === 'deploying' && node.deploymentId) return 'deployed';
  return node.status;
}

// ── Prompts ──────────────────────────────────────────────

function buildRootPrompt(task: string): string {
  return [
    'You are executing a task. Do NOT say "I\'ll do this" or "Let me help you." Provide your complete output IMMEDIATELY.',
    '',
    `TASK: ${task}`,
    '',
    'INSTRUCTIONS:',
    '- Provide detailed, substantive content — not a plan or offer to help',
    '- Include specific facts, examples, names, and details from your knowledge',
    '- Write at least 300 words of actual content',
    '- Do NOT ask clarifying questions — just execute with your best judgment',
    '',
    'PROVIDE YOUR COMPLETE OUTPUT NOW:',
  ].join('\n');
}

function buildSequentialPrompt(task: string, parentOutput: string): string {
  return [
    'You are executing a task. The previous agent provided input below. Use it to complete your task.',
    '',
    '=== INPUT FROM PREVIOUS AGENT ===',
    parentOutput,
    '=== END INPUT ===',
    '',
    `TASK: ${task}`,
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

function buildMergePrompt(task: string, parentOutputs: { name: string; output: string }[]): string {
  const sections = parentOutputs.map((p, i) =>
    `=== INPUT FROM AGENT "${p.name}" (${i + 1}/${parentOutputs.length}) ===\n${p.output}\n=== END ===`
  ).join('\n\n');

  return [
    'You are executing a task. Multiple previous agents provided their outputs below. Combine and use ALL of them.',
    '',
    sections,
    '',
    `TASK: ${task}`,
    '',
    'INSTRUCTIONS:',
    '- Use ALL the inputs provided above — do not ignore any',
    '- Combine, synthesize, and integrate the information',
    '- Produce a cohesive, unified output',
    '- If inputs overlap, merge them intelligently',
    '- If inputs complement each other, weave them together',
    '',
    'PRODUCE YOUR COMBINED OUTPUT NOW:',
  ].join('\n');
}

function buildFallbackPrompt(task: string, missionText: string): string {
  return `The previous agent was unavailable. Complete this mission using your own knowledge.\n\nMISSION: ${missionText}\nTASK: ${task}\n\nProvide a complete, detailed response. Execute the task NOW:`;
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
Return ONLY a JSON array of steps. Each step: {"template":"...","name":"...","task":"...","dependsOn":...}
Rules for dependsOn:
- dependsOn: -1 means root node (takes the original mission as input)
- dependsOn: 0 means depends on step at index 0 (sequential)
- dependsOn: [1, 2] means depends on BOTH step 1 AND step 2 (merge node)
- Multiple steps with the same dependsOn run IN PARALLEL on separate GPUs
Rules:
- Use 2-5 agents maximum
- First agent(s) are usually researchers (dependsOn: -1)
- If multiple independent outputs are requested (e.g. "blog post AND script"), use parallel branches
- A merge step can combine parallel branches with dependsOn: [idx1, idx2]
Example sequential: "Research AI trends and write a blog post"
[{"template":"researcher","name":"AI-Researcher","task":"Research the latest AI trends with specific examples","dependsOn":-1},{"template":"writer","name":"Blog-Writer","task":"Write an engaging blog post from the research","dependsOn":0}]
Example parallel: "Research AI, write a blog post AND a YouTube script"
[{"template":"researcher","name":"AI-Researcher","task":"Research latest AI trends","dependsOn":-1},{"template":"writer","name":"Blog-Writer","task":"Write a blog post from the research","dependsOn":0},{"template":"writer","name":"Script-Writer","task":"Write a YouTube script from the research","dependsOn":0},{"template":"analyst","name":"Final-Editor","task":"Review and combine both outputs into a summary","dependsOn":[1,2]}]`,
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

      const raw = JSON.parse(jsonMatch[0]) as any[];
      if (!Array.isArray(raw) || raw.length === 0) throw new Error('Empty pipeline');

      return raw
        .filter(s => s.template && s.name && s.task && (AGENT_TEMPLATES[s.template] || s.template === 'custom'))
        .slice(0, 5)
        .map((s, i) => {
          let dependsOn: string | string[] | undefined;
          if (s.dependsOn === -1 || s.dependsOn === null || s.dependsOn === undefined) {
            dependsOn = undefined;
          } else if (Array.isArray(s.dependsOn)) {
            dependsOn = s.dependsOn.map((d: number) => `step-${d}`);
          } else if (typeof s.dependsOn === 'number') {
            dependsOn = `step-${s.dependsOn}`;
          }
          return { id: `step-${i}`, template: s.template, name: s.name, task: s.task, dependsOn };
        });
    } catch (err) {
      console.warn('[MissionOrchestrator] LLM planning failed, using fallback:', err);
      return this.planFallback(mission);
    }
  }

  private planFallback(mission: string): PipelineStep[] {
    const lower = mission.toLowerCase();

    // Detect "X AND Y" parallel pattern — needs 3+ meaningful segments
    const andParts = mission.split(/\band\b/i).map(s => s.trim()).filter(s => s.length > 10);
    if (andParts.length >= 3) {
      const steps: PipelineStep[] = [
        { id: 'step-0', template: 'researcher', name: 'Researcher', task: `Research the following topic thoroughly: ${mission}`, dependsOn: undefined },
      ];
      const writerIds: string[] = [];
      for (let i = 1; i < andParts.length; i++) {
        const stepId = `step-${i}`;
        writerIds.push(stepId);
        steps.push({ id: stepId, template: 'writer', name: `Writer-${i}`, task: `Using the research provided, ${andParts[i]}`, dependsOn: 'step-0' });
      }
      steps.push({
        id: `step-${steps.length}`, template: 'analyst', name: 'Final-Editor',
        task: 'Review and combine all outputs from the previous agents into a cohesive final document.',
        dependsOn: writerIds,
      });
      return steps;
    }

    // Sequential patterns
    const steps: PipelineStep[] = [];
    let idx = 0;

    if (lower.includes('research') || lower.includes('find') || lower.includes('latest') || lower.includes('trend') || lower.includes('search')) {
      steps.push({
        id: `step-${idx}`, template: 'researcher', name: 'Researcher',
        task: `Research the following topic thoroughly. Gather key facts, recent developments, notable sources, and relevant data. Provide a well-structured summary with your findings: ${mission}`,
        dependsOn: undefined,
      });
      idx++;
    }

    if (lower.includes('analy') || lower.includes('compare') || lower.includes('data')) {
      steps.push({
        id: `step-${idx}`, template: 'analyst', name: 'Analyst',
        task: `Analyze the research findings. Identify key trends, patterns, comparisons, and actionable insights related to: ${mission}`,
        dependsOn: idx > 0 ? `step-${idx - 1}` : undefined,
      });
      idx++;
    }

    if (lower.includes('write') || lower.includes('blog') || lower.includes('article') || lower.includes('content') || lower.includes('post')) {
      const format = lower.includes('blog') ? 'blog post' : lower.includes('article') ? 'article' : 'written piece';
      steps.push({
        id: `step-${idx}`, template: 'writer', name: 'Writer',
        task: `Using the research provided, write a polished, engaging ${format} with clear sections, compelling narrative, and a strong conclusion about: ${mission}`,
        dependsOn: idx > 0 ? `step-${idx - 1}` : undefined,
      });
      idx++;
    }

    if (steps.length === 0) {
      steps.push(
        {
          id: 'step-0', template: 'researcher', name: 'Researcher',
          task: `Thoroughly research the following topic. Gather key facts, recent developments, data points, and expert perspectives. Provide a comprehensive, well-structured summary: ${mission}`,
          dependsOn: undefined,
        },
        {
          id: 'step-1', template: 'writer', name: 'Writer',
          task: `Using the research provided, synthesize the findings into a clear, well-organized report. Highlight the most important points and present actionable conclusions about: ${mission}`,
          dependsOn: 'step-0',
        },
      );
    }

    return steps;
  }

  async execute(mission: string, callback?: (text: string) => Promise<void>, originalMission?: string): Promise<MissionResult> {
    const startTime = Date.now();
    const log = (msg: string) => console.log(`[MissionOrchestrator] ${msg}`);
    const missionId = `mission-${Date.now()}`;
    const missionText = originalMission || mission;

    // Init pipeline state
    currentPipelineState = {
      id: missionId, mission, status: 'planning', steps: [],
      finalOutput: null, startedAt: startTime, completedAt: null,
    };

    // 1. Plan
    log('Planning mission pipeline...');
    const steps = await this.planPipeline(mission);
    const nodes: PipelineNode[] = steps.map(s => ({ step: s, status: 'pending' as const }));

    // Calculate DAG depth levels for parallel execution
    const levels = calculateDepthLevels(steps);
    const maxDepth = levels.size > 0 ? Math.max(...levels.keys()) : 0;

    // Pre-compute depth info for frontend layout
    const depthInfo = new Map<string, { depth: number; parallelIndex: number; parallelCount: number }>();
    for (const [depth, stepIds] of levels) {
      stepIds.forEach((stepId, index) => {
        depthInfo.set(stepId, { depth, parallelIndex: index, parallelCount: stepIds.length });
      });
    }

    // State sync helper
    let marketName: string | undefined;
    let marketCost: number | undefined;
    const syncState = (pipelineStatus?: MissionPipelineState['status']) => {
      currentPipelineState = {
        ...currentPipelineState,
        status: pipelineStatus || currentPipelineState.status,
        steps: nodes.map(n => {
          const info = depthInfo.get(n.step.id);
          return {
            id: n.step.id,
            name: n.step.name,
            template: n.step.template,
            task: n.step.task,
            status: stepStatusForClient(n),
            deploymentId: n.deploymentId,
            url: n.url,
            market: marketName,
            costPerHour: marketCost,
            outputPreview: n.output?.slice(0, 300),
            output: n.output,
            error: n.error,
            dependsOn: n.step.dependsOn,
            depth: info?.depth,
            parallelIndex: info?.parallelIndex,
            parallelCount: info?.parallelCount,
          };
        }),
      };
    };

    syncState('deploying');
    log(`pipeline:created — ${steps.length} steps across ${levels.size} depth levels`);

    const manager = getNosanaManager();
    const market = await manager.getBestMarket();
    if (!market) throw new Error('No GPU markets available');
    marketName = market.name;
    marketCost = market.pricePerHour;

    const workerImage = process.env.AGENTFORGE_WORKER_IMAGE || 'drewdockerus/agentforge-worker:latest';

    // --- Helpers ---

    const deployOne = async (node: PipelineNode) => {
      const tmpl = AGENT_TEMPLATES[node.step.template] || AGENT_TEMPLATES['researcher'];
      node.status = 'deploying';
      syncState();
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
        syncState();
      } catch (err: any) {
        node.status = 'error';
        node.error = err.message;
        log(`node:status — ${node.step.name}: deploy error — ${err.message}`);
        syncState();
      }
    };

    const waitReady = async (node: PipelineNode): Promise<boolean> => {
      if (node.status === 'error' || !node.url) return false;
      const client = new WorkerClient(node.url);

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await client.waitForReady(240_000);
          node.status = 'ready';
          log(`node:status — ${node.step.name}: ready${attempt > 0 ? ' (retry)' : ''}`);
          syncState();
          return true;
        } catch (err: any) {
          log(`node:status — ${node.step.name}: waitForReady attempt ${attempt + 1} failed — ${err.message}`);
        }
      }

      node.status = 'error';
      node.error = 'Not ready after extended wait';
      log(`node:status — ${node.step.name}: giving up`);
      syncState();
      return false;
    };

    const executeOne = async (node: PipelineNode) => {
      node.status = 'processing';
      syncState('executing');
      log(`node:status — ${node.step.name}: processing`);

      const deps = getDependencies(node.step);
      let prompt: string;

      if (deps.length === 0) {
        prompt = buildRootPrompt(node.step.task);
      } else if (deps.length === 1) {
        const parent = nodes.find(n => n.step.id === deps[0]);
        prompt = parent?.output
          ? buildSequentialPrompt(node.step.task, parent.output)
          : buildFallbackPrompt(node.step.task, missionText);
      } else {
        const parentOutputs = deps.map(depId => {
          const parent = nodes.find(n => n.step.id === depId);
          return { name: parent?.step.name || depId, output: parent?.output || '(no output from this agent)' };
        });
        const hasAnyOutput = parentOutputs.some(p => p.output !== '(no output from this agent)');
        prompt = hasAnyOutput
          ? buildMergePrompt(node.step.task, parentOutputs)
          : buildFallbackPrompt(node.step.task, missionText);
      }

      try {
        const client = new WorkerClient(node.url!);
        const agentId = await client.waitForReady(10_000);
        const output = await client.sendMessage(agentId, prompt);
        node.output = output;
        node.status = 'complete';
        log(`node:status — ${node.step.name}: complete (${output.length} chars)`);
        syncState();
      } catch (err: any) {
        node.status = 'error';
        node.error = err.message;
        log(`node:status — ${node.step.name}: error — ${err.message}`);
        syncState();
      }
    };

    // 2. Execute level by level — nodes at each level run in parallel
    for (let depth = 0; depth <= maxDepth; depth++) {
      const levelStepIds = levels.get(depth) || [];
      const levelNodes = levelStepIds.map(id => nodes.find(n => n.step.id === id)!).filter(Boolean);

      log(`level:${depth} — ${levelNodes.length} agent(s): ${levelNodes.map(n => n.step.name).join(', ')}`);

      // Deploy all at this level in parallel
      await Promise.all(levelNodes.map(n => deployOne(n)));

      // Wait for all to be ready in parallel
      await Promise.all(levelNodes.map(n => waitReady(n)));

      // Execute all ready agents in parallel
      const readyNodes = levelNodes.filter(n => n.status === 'ready');
      if (readyNodes.length > 0) {
        await Promise.all(readyNodes.map(n => executeOne(n)));
      }
    }

    // 3. Check if all steps failed
    if (nodes.every(n => n.status === 'error')) {
      for (const node of nodes) {
        if (node.deploymentId) {
          try { await manager.stopDeployment(node.deploymentId); } catch {}
        }
      }
      currentPipelineState = { ...currentPipelineState, status: 'error', completedAt: Date.now() };
      syncState('error');

      missionHistory.unshift({
        id: missionId, mission, status: 'error', stepsCount: nodes.length,
        finalOutputPreview: nodes.map(n => n.error).filter(Boolean).join('; ').slice(0, 100),
        completedAt: Date.now(), totalTime: Date.now() - startTime,
      });
      if (missionHistory.length > 10) missionHistory.pop();

      throw new Error(`All pipeline steps failed: ${nodes.map(n => `${n.step.name}: ${n.error}`).join('; ')}`);
    }

    // 4. Determine final output from leaf nodes (nodes nothing else depends on)
    const allDepTargets = new Set(steps.flatMap(s => getDependencies(s)));
    const leafNodes = nodes.filter(n => !allDepTargets.has(n.step.id) && n.output);

    let finalOutput: string;
    if (leafNodes.length === 1) {
      finalOutput = leafNodes[0].output!;
    } else if (leafNodes.length > 1) {
      finalOutput = leafNodes.map(n => `## ${n.step.name}\n\n${n.output}`).join('\n\n---\n\n');
    } else {
      const completed = nodes.filter(n => n.output);
      finalOutput = completed.length > 0 ? completed[completed.length - 1].output! : 'Mission produced no output.';
    }

    // 5. Cleanup
    log('Cleaning up mission agents...');
    for (const node of nodes) {
      if (node.deploymentId) {
        try { await manager.stopDeployment(node.deploymentId); log(`Stopped ${node.step.name}`); } catch {}
      }
    }

    const totalTime = Date.now() - startTime;
    log(`mission:complete — ${totalTime}ms, ${nodes.filter(n => n.status === 'complete').length}/${nodes.length} steps succeeded`);

    currentPipelineState = {
      ...currentPipelineState,
      status: 'complete',
      finalOutput,
      completedAt: Date.now(),
    };
    syncState('complete');

    missionHistory.unshift({
      id: missionId, mission, status: 'complete', stepsCount: nodes.length,
      finalOutputPreview: finalOutput.slice(0, 100), completedAt: Date.now(), totalTime,
    });
    if (missionHistory.length > 10) missionHistory.pop();

    return { success: nodes.some(n => n.status === 'complete'), steps: nodes, finalOutput, totalTime };
  }
}
