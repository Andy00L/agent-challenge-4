import { getNosanaManager } from './nosanaManager.js';
import { WorkerClient } from './workerClient.js';
import { AGENT_TEMPLATES } from '../types.js';

// ── DAG helpers ─────────────────────────────────────────

function getDependencies(step: { dependsOn?: string | string[] }): string[] {
  if (!step.dependsOn) return [];
  return Array.isArray(step.dependsOn) ? step.dependsOn : [step.dependsOn];
}

/**
 * Calculate the depth level of each step in the pipeline DAG.
 * Steps with no dependencies are depth 0. Steps depending on depth-N nodes are depth N+1.
 * Steps at the same depth level can execute in parallel.
 *
 * @param steps - Pipeline steps with dependsOn fields
 * @returns Map of depth level → array of step IDs at that level
 */
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

function buildRootPrompt(task: string, mission?: string, template?: string): string {
  if (template === 'researcher') {
    return [
      'You are a RESEARCH agent with web search capabilities. Your PRIMARY JOB is to search the web for current information.',
      '',
      `TASK: ${task}`,
      '',
      'CRITICAL INSTRUCTIONS:',
      '1. FIRST, use your WEB_SEARCH action to find real, current information about this topic',
      '2. Search for at least 2-3 different queries to get comprehensive results',
      '3. AFTER searching, compile ALL your findings into a structured research report',
      '4. Include specific facts, dates, statistics, company names, and URLs from your search results',
      '5. Do NOT provide a response based only on your training data — the user needs CURRENT web information',
      '6. Your output will be passed to other agents who will use it to create content',
      '',
      'IMPORTANT: Do NOT say "I will research" or "Starting research now" or "Let me look into this". Actually DO the research RIGHT NOW in this response. Provide your complete findings, analysis, and sources in THIS message. Your response IS the deliverable — there is no follow-up. Write at least 500 words of actual research content.',
      '',
      mission ? `ORIGINAL MISSION: ${mission}` : '',
      '',
      'SEARCH THE WEB FIRST, THEN PROVIDE YOUR RESEARCH FINDINGS:',
    ].filter(Boolean).join('\n');
  }

  return [
    'You are executing a task. Your ENTIRE response must be the completed work product. Do not acknowledge, plan, or outline — just produce the final result.',
    '',
    `TASK: ${task}`,
    '',
    'IMPORTANT: Do NOT say "I will write" or "Starting now" or "Let me help you" or "I\'ll create this". Actually WRITE the complete content RIGHT NOW in this response. Your response IS the final deliverable. Write at least 500 words.',
    '',
    'INSTRUCTIONS:',
    '- Provide detailed, substantive content — not a plan or offer to help',
    '- Include specific facts, examples, names, and details from your knowledge',
    '- Write at least 500 words of actual content',
    '- Do NOT ask clarifying questions — just execute with your best judgment',
    '',
    'PROVIDE YOUR COMPLETE OUTPUT NOW:',
  ].join('\n');
}

function buildSequentialPrompt(task: string, parentOutput: string): string {
  return [
    'You are executing a task. Your ENTIRE response must be the completed work product. Do not acknowledge, plan, or outline — just produce the final result.',
    '',
    '=== INPUT FROM PREVIOUS AGENT ===',
    parentOutput,
    '=== END INPUT ===',
    '',
    `TASK: ${task}`,
    '',
    'IMPORTANT: Do NOT say "I will write" or "Starting now" or "Let me help you". Actually WRITE the complete content RIGHT NOW in this response. Your response IS the final deliverable. Write at least 500 words.',
    '',
    'INSTRUCTIONS:',
    '- Use ALL the information above as your source material',
    '- Do NOT ask for more data — work with what you have',
    '- Produce a complete, polished output ready for the end user',
    '- Write at least 500 words of detailed content',
    '',
    'PRODUCE YOUR COMPLETE OUTPUT NOW:',
  ].join('\n');
}

function buildMergePrompt(task: string, parentOutputs: { name: string; output: string }[]): string {
  const sections = parentOutputs.map((p, i) =>
    `=== INPUT FROM AGENT "${p.name}" (${i + 1}/${parentOutputs.length}) ===\n${p.output}\n=== END ===`
  ).join('\n\n');

  return [
    'You are executing a task. Your ENTIRE response must be the completed work product. Do not acknowledge, plan, or outline — just produce the final result.',
    '',
    sections,
    '',
    `TASK: ${task}`,
    '',
    'IMPORTANT: Produce the COMPLETE report RIGHT NOW in this response. Include: (1) Executive Summary, (2) Feature Comparison Table in markdown, (3) Strengths & Weaknesses for each, (4) Market Positioning, (5) Recommendation. Write at least 800 words. Do NOT say "I will analyze" — just DO IT.',
    '',
    'INSTRUCTIONS:',
    '- Use ALL the inputs provided above — do not ignore any',
    '- Combine, synthesize, and integrate the information',
    '- Produce a cohesive, unified output with markdown headers and tables',
    '- If inputs overlap, merge them intelligently',
    '- If inputs complement each other, weave them together',
    '- Do NOT summarize what you will do — DO IT NOW in this response',
    '',
    'PRODUCE YOUR COMBINED OUTPUT NOW:',
  ].join('\n');
}

function buildFallbackPrompt(task: string, missionText: string): string {
  return `The previous agent was unavailable. Complete this mission using your own knowledge. Your ENTIRE response must be the completed work product — do not acknowledge, plan, or outline.\n\nMISSION: ${missionText}\nTASK: ${task}\n\nIMPORTANT: Do NOT say "I will" or "Let me". Produce the COMPLETE, detailed result RIGHT NOW. Write at least 500 words. Execute the task NOW:`;
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
        signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content: `You are a pipeline planner. Output a JSON array of agents needed.
Templates: researcher (web search), analyst (analysis), writer (content), publisher (social media)
Rules: dependsOn:-1=first step, dependsOn:0=depends on step 0, dependsOn:[1,2]=depends on both. Multiple steps with same dependsOn run in PARALLEL. Max 5 steps.
Example: "Research X and write a blog post AND YouTube script"
[{"template":"researcher","name":"Researcher","task":"Research X thoroughly","dependsOn":-1},{"template":"writer","name":"Blog-Writer","task":"Write blog post","dependsOn":0},{"template":"writer","name":"Script-Writer","task":"Write YouTube script","dependsOn":0},{"template":"analyst","name":"Editor","task":"Review and merge outputs","dependsOn":[1,2]}]
JSON array only, no markdown:`,
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
      console.warn('[AgentForge:Orchestrator] LLM planning failed, using fallback:', err);
      return this.planFallback(mission);
    }
  }

  /**
   * Extract comparison subjects from a competitive analysis mission.
   * Detects patterns like "X vs Y vs Z", "compare X, Y, and Z".
   */
  private extractComparisonSubjects(mission: string): string[] {
    // Pattern: "X vs Y vs Z"
    const vsAll = mission.match(/(.+?)(?:\s+vs\.?\s+)(.+?)(?:\s+vs\.?\s+)(.+?)(?:\s*$|\s*[.!?,])/i);
    if (vsAll) return [vsAll[1].trim(), vsAll[2].trim(), vsAll[3].trim()];

    // Pattern: "X vs Y"
    const vs2 = mission.match(/(.+?)(?:\s+vs\.?\s+|\s+versus\s+)(.+?)(?:\s*$|\s*[.!?,])/i);
    if (vs2) return [vs2[1].trim(), vs2[2].trim()];

    // Pattern: "compare X, Y, and Z"
    const commaMatch = mission.match(/(?:compare|analysis of|benchmark)\s+(.+)/i);
    if (commaMatch) {
      const parts = commaMatch[1].split(/,\s*|\s+and\s+|\s+&\s+/).map(s => s.trim()).filter(s => s.length > 1 && s.length < 40);
      if (parts.length >= 2) return parts.slice(0, 4);
    }

    return [];
  }

  private planFallback(mission: string): PipelineStep[] {
    const lower = mission.toLowerCase();

    // Competitive analysis pattern → 5-agent parallel pipeline (guaranteed for demo)
    const isCompetitive = /competitive\s*analysis|compare.*(?:vs|versus|against)|benchmark.*(?:framework|tool|platform)/i.test(mission)
      || (lower.includes('vs') && (lower.includes('compare') || lower.includes('analysis')));

    if (isCompetitive) {
      console.log('[AgentForge:Orchestrator] Detected competitive analysis — using 5-agent parallel pipeline');
      const subjects = this.extractComparisonSubjects(mission);
      const subjectList = subjects.length >= 2 ? subjects.slice(0, 3) : ['Option A', 'Option B', 'Option C'];

      const steps: PipelineStep[] = [
        {
          id: 'step-0', template: 'researcher', name: 'Lead-Researcher',
          task: `Search the web for an overview of the competitive landscape around: ${mission}. Identify the main players, their key differentiators, recent developments, and market positioning. Provide a structured overview with sources.`,
          dependsOn: undefined,
        },
      ];

      subjectList.forEach((subject, i) => {
        steps.push({
          id: `step-${i + 1}`, template: 'researcher',
          name: `${subject.replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/\s+/g, '-')}-Researcher`,
          task: `Do a deep dive on ${subject}: features, pricing, strengths, weaknesses, recent updates, user sentiment, and unique selling points. Search the web for the latest information. Be specific and cite sources.`,
          dependsOn: 'step-0',
        });
      });

      steps.push({
        id: `step-${subjectList.length + 1}`, template: 'analyst', name: 'Competitive-Analyst',
        task: `Synthesize all research into a comprehensive competitive analysis report: (1) Executive Summary, (2) Feature Comparison Table, (3) Strengths & Weaknesses, (4) Market Positioning, (5) Recommendation. Use markdown headers and tables.`,
        dependsOn: subjectList.map((_, i) => `step-${i + 1}`),
      });

      return steps;
    }

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

  /**
   * Plan and execute a multi-agent DAG pipeline on the Nosana GPU network.
   * Deploys agents in parallel per depth level, chains outputs as inputs,
   * and auto-stops all agents when complete.
   *
   * @param mission - Natural language mission description
   * @param _callback - Unused callback (pipeline state polled via REST instead)
   * @param originalMission - Original mission text if this is a retry
   * @returns Final output from the leaf nodes of the DAG
   */
  async execute(mission: string, narrator?: (text: string) => Promise<void>, originalMission?: string): Promise<MissionResult> {
    const startTime = Date.now();
    const log = (msg: string) => console.log(`[AgentForge:Orchestrator] ${msg}`);
    const narrate = (text: string) => { if (narrator) { narrator(text).catch(() => {}); } };
    const missionId = `mission-${Date.now()}`;
    const missionText = originalMission || mission;

    // Init pipeline state
    currentPipelineState = {
      id: missionId, mission, status: 'planning', steps: [],
      finalOutput: null, startedAt: startTime, completedAt: null,
    };

    // 0. Stop orphan agents from previous missions/tests
    const manager = getNosanaManager();
    try {
      const fleet = await manager.getFleetStatus();
      const running = fleet.deployments.filter(
        d => d.status === 'running' || d.status === 'starting'
      );
      if (running.length > 0) {
        log(`Cleaning up ${running.length} orphan agent(s) before new mission...`);
        narrate(`\u{1F9F9} Cleaning up ${running.length} running agent(s) from previous sessions...`);
        await Promise.allSettled(
          running.map(async dep => {
            try {
              await manager.stopDeployment(dep.id);
              log(`Stopped orphan: ${dep.name} (${dep.id})`);
            } catch (e: any) {
              log(`Failed to stop orphan ${dep.name}: ${e.message}`);
            }
          })
        );
        await new Promise(r => setTimeout(r, 3000));
        log('Orphan cleanup complete');
      }
    } catch (e: any) {
      log(`Orphan cleanup failed (non-fatal): ${e.message}`);
    }

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

    // Narrate pipeline plan
    const maxParallel = Math.max(...[...levels.values()].map(ids => ids.length));
    narrate(
      `\u{1F4CB} **Pipeline planned:** ${steps.length} agents across ${levels.size} stage${levels.size > 1 ? 's' : ''}` +
      (maxParallel > 1 ? ` (${maxParallel} running in parallel)` : '') +
      `\n\n` +
      steps.map(s => `\u2022 **${s.name}** \u2014 ${s.task.slice(0, 80)}...`).join('\n')
    );

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

    const triedMarketAddresses: string[] = market ? [market.address] : [];

    const waitReady = async (node: PipelineNode): Promise<boolean> => {
      if (node.status === 'error' || !node.url) return false;

      // Attempt 1: wait on current deployment
      try {
        const client = new WorkerClient(node.url);
        await client.waitForReady(180_000);
        node.status = 'ready';
        log(`node:status — ${node.step.name}: ready`);
        syncState();
        return true;
      } catch (err: any) {
        log(`node:status — ${node.step.name}: waitForReady failed — ${err.message}`);
      }

      // Attempt 2: redeploy on a different market
      log(`node:status — ${node.step.name}: worker didn't boot — trying next GPU market`);
      narrate(`\u{26A0}\u{FE0F} **${node.step.name}** worker didn't boot — retrying on different market...`);

      try { if (node.deploymentId) await manager.stopDeployment(node.deploymentId); } catch {}

      const nextMarket = await manager.getNextBestMarket(triedMarketAddresses);
      if (!nextMarket) {
        node.status = 'error';
        node.error = 'Worker failed to boot and no alternative markets available';
        log(`node:status — ${node.step.name}: no alternative markets`);
        syncState();
        return false;
      }
      triedMarketAddresses.push(nextMarket.address);
      log(`node:status — ${node.step.name}: redeploying on ${nextMarket.name}`);
      narrate(`\u{1F504} Redeploying **${node.step.name}** on ${nextMarket.name}...`);

      const tmpl = AGENT_TEMPLATES[node.step.template] || AGENT_TEMPLATES['researcher'];
      try {
        const newDep = await manager.createAndStartDeployment({
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
          resolvedMarket: nextMarket,
          timeout: 30,
        });
        node.deploymentId = newDep.id;
        node.url = newDep.url;
        syncState();

        if (newDep.url) {
          const client2 = new WorkerClient(newDep.url);
          try {
            await client2.waitForReady(180_000);
            node.status = 'ready';
            log(`node:status — ${node.step.name}: ready (fallback market ${nextMarket.name})`);
            syncState();
            return true;
          } catch (err2: any) {
            log(`node:status — ${node.step.name}: fallback boot also failed — ${err2.message}`);
          }
        }
      } catch (redeployErr: any) {
        log(`node:status — ${node.step.name}: redeploy failed — ${redeployErr.message}`);
      }

      node.status = 'error';
      node.error = 'Worker failed to boot after 2 attempts on different markets';
      log(`node:status — ${node.step.name}: giving up after 2 attempts`);
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
        prompt = buildRootPrompt(node.step.task, missionText, node.step.template);
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
        const checkAlive = () => {
          if (!node.deploymentId) return true;
          const dep = manager.getDeployment(node.deploymentId);
          return !!dep && dep.status !== 'stopped' && dep.status !== 'error';
        };
        const isResearcher = node.step.template === 'researcher';
        const output = await client.sendMessage(agentId, prompt, 300_000, checkAlive, isResearcher);
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

      // Narrate deployment
      for (const n of levelNodes) {
        narrate(`\u{1F680} Deploying **${n.step.name}** to ${marketName} ($${marketCost?.toFixed(3)}/hr)...`);
      }

      // Deploy all at this level in parallel
      await Promise.all(levelNodes.map(n => deployOne(n)));

      // Wait for all to be ready in parallel
      await Promise.all(levelNodes.map(n => waitReady(n)));

      // Execute all ready agents in parallel
      const readyNodes = levelNodes.filter(n => n.status === 'ready');
      if (readyNodes.length > 0) {
        if (readyNodes.length > 1) {
          narrate(
            `\u{26A1} **${readyNodes.length} agents working in parallel** on separate Nosana GPUs:\n` +
            readyNodes.map(n => `\u2022 ${n.step.name}`).join('\n')
          );
        } else {
          const templateIcons: Record<string, string> = { researcher: '\u{1F50D}', writer: '\u{270D}\u{FE0F}', analyst: '\u{1F4CA}', monitor: '\u{1F441}\u{FE0F}', publisher: '\u{1F4E2}' };
          const icon = templateIcons[readyNodes[0].step.template] || '\u{1F916}';
          narrate(`${icon} **${readyNodes[0].step.name}** is working...`);
        }

        const levelStart = Date.now();
        await Promise.all(readyNodes.map(n => executeOne(n)));
        const levelElapsed = Math.round((Date.now() - levelStart) / 1000);

        // Narrate level completion
        const completedNames = readyNodes.filter(n => n.status === 'complete').map(n => n.step.name);
        if (completedNames.length > 0) {
          narrate(`\u{2705} ${completedNames.join(', ')} complete (${levelElapsed}s)`);
        }

        // Narrate intermediate cost
        const elapsedHrs = (Date.now() - startTime) / 3_600_000;
        const currentCost = (marketCost || 0) * steps.length * elapsedHrs;
        if (currentCost > 0.0001 && depth < maxDepth) {
          narrate(`\u{1F4B0} Mission cost so far: $${currentCost.toFixed(4)}`);
        }
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
    narrate(`\u{1F3C1} All agents complete \u2014 stopping ${nodes.filter(n => n.deploymentId).length} deployments to save credits...`);
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
