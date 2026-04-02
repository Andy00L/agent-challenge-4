import { getNosanaManager } from './nosanaManager.js';
import { WorkerClient } from './workerClient.js';
import { AGENT_TEMPLATES } from '../types.js';
import { ImageGenRouter } from './imageGenRouter.js';
import { generateTTS } from './ttsClient.js';
import { MediaAssembler } from './mediaAssembler.js';

// ── Mission abort mechanism ──────────────────────────────

let missionAborted = false;
let missionAbortController: AbortController | null = null;

/** Signal the running mission to abort. Exported for the Fleet API endpoint. */
export function abortMission(): void {
  missionAborted = true;
  missionAbortController?.abort();
}

/** Check if the current mission has been aborted. */
function isAborted(): boolean {
  return missionAborted;
}

// ── Multimodal constants ────────────────────────────────

/** Templates that execute directly (no ElizaOS worker needed) */
const DIRECT_EXECUTION_TEMPLATES = ['image-generator', 'video-generator', 'narrator'];

/** Per-template timeout for sendMessage — research/analysis need more time for web search + LLM processing */
const TEMPLATE_TIMEOUT_MS: Record<string, number> = {
  'researcher': 600_000,     // 10 min — web search via Tavily is slow
  'analyst': 600_000,        // 10 min — analysis of large merged inputs
  'writer': 300_000,         // 5 min
  'scene-writer': 300_000,   // 5 min
  'monitor': 300_000,        // 5 min
  'publisher': 300_000,      // 5 min
};

// ── Worker environment builder ──────────────────────────
// Workers receive the SAME config as the orchestrator — no hardcoded defaults.

const WORKER_ENV_KEYS = [
  'OPENAI_API_KEY', 'OPENAI_API_URL', 'OPENAI_BASE_URL',
  'MODEL_NAME', 'OPENAI_SMALL_MODEL', 'OPENAI_LARGE_MODEL',
  'TAVILY_API_KEY',
  'ELEVENLABS_API_KEY', 'FAL_API_KEY',
  'SERVER_PORT',
] as const;

function buildWorkerEnv(overrides?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of WORKER_ENV_KEYS) {
    const value = process.env[key];
    if (value && value.trim().length > 0) {
      env[key] = value;
    }
  }
  // Alias: ElizaOS expects OPENAI_BASE_URL, users configure OPENAI_API_URL
  if (env.OPENAI_API_URL && !env.OPENAI_BASE_URL) {
    env.OPENAI_BASE_URL = env.OPENAI_API_URL;
  }
  // Alias: ElizaOS model config
  if (env.MODEL_NAME) {
    if (!env.OPENAI_SMALL_MODEL) env.OPENAI_SMALL_MODEL = env.MODEL_NAME;
    if (!env.OPENAI_LARGE_MODEL) env.OPENAI_LARGE_MODEL = env.MODEL_NAME;
  }
  if (overrides) Object.assign(env, overrides);

  const present = WORKER_ENV_KEYS.filter(k => env[k]);
  const missing = WORKER_ENV_KEYS.filter(k => !env[k]);
  console.log(`[AgentForge:Manager] Worker env: ${present.length} keys forwarded (${present.join(', ')})`);
  if (missing.length > 0) {
    console.log(`[AgentForge:Manager] Worker env: ${missing.length} keys not set (${missing.join(', ')})`);
  }
  return env;
}

// ── Mission warnings (surfaced to frontend) ─────────────

export interface MissionWarning {
  type: 'missing_key' | 'fallback' | 'degraded';
  message: string;
  step?: string;
}

// ── Pre-deployment template checks ──────────────────────

const TEMPLATE_ENV_REQUIREMENTS: Record<string, { required: string[]; purpose: string }> = {
  researcher: { required: ['TAVILY_API_KEY'], purpose: 'web search via Tavily' },
};

/**
 * Check if required env vars exist for a template.
 * Returns warnings for any missing keys (also logs to console).
 */
function checkTemplateRequirements(templateName: string, stepName?: string): MissionWarning[] {
  const reqs = TEMPLATE_ENV_REQUIREMENTS[templateName];
  if (!reqs) return [];
  const missing = reqs.required.filter(k => !process.env[k]);
  if (missing.length === 0) return [];

  const msg = `${templateName} requires ${missing.join(', ')} for ${reqs.purpose} — results may be limited`;
  console.warn(`[AgentForge:Orchestrator] \u{26A0}\u{FE0F} ${msg}`);
  return [{ type: 'missing_key', message: msg, step: stepName }];
}

// ── Orchestrator-side Tavily search ─────────────────────

interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

async function searchTavily(query: string): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    console.warn('[AgentForge:Tavily] TAVILY_API_KEY not set, skipping web search');
    return [];
  }

  try {
    console.log(`[AgentForge:Tavily] Searching: "${query.slice(0, 80)}"`);
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: 5,
        include_answer: false,
        search_depth: 'basic',
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      console.warn(`[AgentForge:Tavily] Search failed: HTTP ${res.status}`);
      return [];
    }

    const data = await res.json() as any;
    const results: TavilyResult[] = (data.results || []).map((r: any) => ({
      title: r.title || '',
      url: r.url || '',
      content: r.content || '',
    }));
    console.log(`[AgentForge:Tavily] Got ${results.length} results`);
    return results;
  } catch (err: any) {
    console.warn(`[AgentForge:Tavily] Search error: ${err.message}`);
    return [];
  }
}

/** Detect which multimodal capabilities are configured */
function detectCapabilities() {
  const hasNosana = !!(process.env.NOSANA_API_KEY && process.env.NOSANA_API_KEY !== 'YOUR_NOSANA_API_KEY');
  return {
    imageGen: !!((process.env.OPENAI_API_KEY && (process.env.OPENAI_API_URL || '').includes('openai.com')) || process.env.FAL_KEY || process.env.COMFYUI_ENDPOINT || process.env.A1111_ENDPOINT || hasNosana),
    videoGen: !!((process.env.OPENAI_API_KEY && (process.env.OPENAI_API_URL || '').includes('openai.com')) || process.env.FAL_KEY || process.env.COMFYUI_ENDPOINT || process.env.A1111_ENDPOINT || hasNosana),
    tts: !!((process.env.OPENAI_API_KEY && (process.env.OPENAI_API_URL || '').includes('openai.com')) || process.env.ELEVENLABS_API_KEY || process.env.FAL_API_KEY || hasNosana),
  };
}

// ── Media store (served by Fleet API) ───────────────────

const generatedMedia = new Map<string, { data: Buffer; contentType: string; createdAt: number }>();
const MEDIA_TTL_MS = 3_600_000; // 1 hour
const MEDIA_MAX_ENTRIES = 100;

export function getMedia(id: string): { data: Buffer; contentType: string } | undefined {
  const entry = generatedMedia.get(id);
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt > MEDIA_TTL_MS) {
    generatedMedia.delete(id);
    return undefined;
  }
  return entry;
}

/** Evict expired entries and enforce max size */
function evictExpiredMedia(): void {
  const now = Date.now();
  for (const [id, entry] of generatedMedia) {
    if (now - entry.createdAt > MEDIA_TTL_MS) generatedMedia.delete(id);
  }
  // If still over limit, remove oldest entries
  if (generatedMedia.size > MEDIA_MAX_ENTRIES) {
    const sorted = [...generatedMedia.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
    const toRemove = sorted.slice(0, generatedMedia.size - MEDIA_MAX_ENTRIES);
    for (const [id] of toRemove) generatedMedia.delete(id);
  }
}

/** Clear all media (called after mission completes) */
export function clearExpiredMedia(): void {
  evictExpiredMedia();
}

export function storeMedia(id: string, base64: string, contentType: string = 'image/png'): string {
  evictExpiredMedia();
  generatedMedia.set(id, { data: Buffer.from(base64, 'base64'), contentType, createdAt: Date.now() });
  return `/fleet/media/${id}`;
}

export function storeMediaBuffer(id: string, buffer: Buffer, contentType: string = 'image/png'): string {
  evictExpiredMedia();
  generatedMedia.set(id, { data: buffer, contentType, createdAt: Date.now() });
  return `/fleet/media/${id}`;
}

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
  const stepIds = new Set(steps.map(s => s.id));

  function getDepth(stepId: string, visiting = new Set<string>()): number {
    if (depths.has(stepId)) return depths.get(stepId)!;
    if (visiting.has(stepId)) {
      // Cycle detected — break it by treating this node as depth 0
      console.warn(`[AgentForge:Orchestrator] Dependency cycle detected at ${stepId}, breaking cycle`);
      depths.set(stepId, 0);
      return 0;
    }
    const step = steps.find(s => s.id === stepId);
    if (!step) return 0;
    const deps = getDependencies(step).filter(d => stepIds.has(d)); // ignore dangling refs
    if (deps.length === 0) { depths.set(stepId, 0); return 0; }
    visiting.add(stepId);
    const maxParent = Math.max(...deps.map(d => getDepth(d, visiting)));
    visiting.delete(stepId);
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
  status: 'pending' | 'deploying' | 'ready' | 'processing' | 'complete' | 'error' | 'skipped';
  output?: string;
  error?: string;
  outputType?: 'text' | 'image' | 'video' | 'audio';
  outputUrls?: string[];
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
    status: 'pending' | 'deploying' | 'deployed' | 'ready' | 'processing' | 'complete' | 'error' | 'stopped' | 'skipped';
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
    outputType?: 'text' | 'image' | 'video' | 'audio';
    outputUrls?: string[];
  }>;
  warnings: MissionWarning[];
  finalOutput: string | null;
  startedAt: number | null;
  completedAt: number | null;
}

let currentPipelineState: MissionPipelineState = {
  id: null, mission: null, status: 'idle', steps: [], warnings: [],
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
    id: null, mission: null, status: 'idle', steps: [], warnings: [],
    finalOutput: null, startedAt: null, completedAt: null,
  };
}

// ── Mission history ─────────────────────────────────────

interface MissionHistoryStep {
  id: string;
  name: string;
  template: string;
  task: string;
  status: string;
  output?: string;
  error?: string;
  outputType?: string;
  outputUrls?: string[];
  dependsOn?: string | string[];
  depth?: number;
  parallelIndex?: number;
  parallelCount?: number;
}

interface MissionHistoryEntry {
  id: string;
  mission: string;
  status: 'complete' | 'error';
  stepsCount: number;
  stepsComplete: number;
  stepsFailed: number;
  stepsSkipped: number;
  finalOutput: string;
  finalOutputPreview: string;
  startedAt: number;
  completedAt: number;
  totalTime: number;
  estimatedCost: number;
  steps: MissionHistoryStep[];
}

const missionHistory: MissionHistoryEntry[] = [];
const MAX_HISTORY = 50;

/** Snapshot pipeline nodes into a serializable history format */
function snapshotSteps(nodes: PipelineNode[], depthInfo: Map<string, { depth: number; parallelIndex: number; parallelCount: number }>): MissionHistoryStep[] {
  return nodes.map(n => {
    const info = depthInfo.get(n.step.id);
    return {
      id: n.step.id,
      name: n.step.name,
      template: n.step.template,
      task: n.step.task,
      status: n.status,
      output: n.output,
      error: n.error,
      outputType: n.outputType,
      outputUrls: n.outputUrls,
      dependsOn: n.step.dependsOn,
      depth: info?.depth,
      parallelIndex: info?.parallelIndex,
      parallelCount: info?.parallelCount,
    };
  });
}

export function getMissionHistory(): MissionHistoryEntry[] {
  // Return lightweight list (without full step outputs) for the sidebar
  return missionHistory.map(m => ({
    ...m,
    finalOutput: '', // omit from list endpoint — use /history/:id for full data
    steps: [],       // omit from list endpoint
  }));
}

export function getMissionHistoryById(id: string): MissionHistoryEntry | undefined {
  return missionHistory.find(m => m.id === id);
}

function stepStatusForClient(node: PipelineNode): MissionPipelineState['steps'][number]['status'] {
  if (node.status === 'deploying' && node.deploymentId) return 'deployed';
  if (node.status === 'skipped') return 'skipped';
  return node.status;
}

// ── Anti-Reflection ──────────────────────────────────────

const ANTI_REFLECTION = [
  'FORBIDDEN (your response will be REJECTED if it contains ANY of these):',
  '- "Sure" / "Of course" / "Certainly" / "Absolutely" / "Great question"',
  '- "I will write" / "I\'ll create" / "Let me" / "I\'d be happy to"',
  '- "Here is" / "Here\'s" / "Based on" / "According to"',
  '- "Starting now" / "I don\'t have access" / "Unfortunately"',
  '- "[placeholder]" / "[insert]" / "would need to" / "TBD"',
  '- Any opening that is NOT the deliverable itself',
].join('\n');

/**
 * Strip common LLM reflection/acknowledgment prefixes from worker output.
 * Workers should produce content directly, but quantized models sometimes prepend filler.
 */
function stripReflection(text: string): string {
  const patterns = [
    /^Sure!?\s*/i,
    /^Here(?:'s| is| are)\s+(?:the|your|a|an)\s+\w+[.:!]?\s*/i,
    /^I'?(?:ll|d| will| would)\s+\w+.*?\.\s*/i,
    /^Based on\s+.*?\.\s*/i,
    /^Let me\s+\w+.*?\.\s*/i,
    /^Of course!?\s*/i,
    /^Certainly!?\s*/i,
    /^Absolutely!?\s*/i,
    /^Great(?:\s+\w+)?!?\s*/i,
    /^I'?d?\s+be\s+happy\s+to.*?\.\s*/i,
  ];
  let cleaned = text;
  for (const p of patterns) {
    cleaned = cleaned.replace(p, '');
  }
  return cleaned.trim() || text;
}

// ── Template-Specific Prompt Builders ────────────────────
//
// Each builder produces a prompt ALIGNED with the template's system prompt
// (set via AGENT_SYSTEM_PROMPT env var from types.ts defaultPrompt).
//
// System prompt alignment:
//   researcher  → prose/markdown, ## headings, citations
//   writer      → prose/markdown, # title, long-form
//   analyst     → structured analysis, tables, ## sections
//   scene-writer → JSON array only (no prose, no markdown)
//   monitor     → factual report, ## headings
//   publisher   → short social copy, direct content
//
// Direct-execution templates (image-generator, video-generator, narrator)
// bypass these builders entirely — they never reach executeOne().

// ── Researcher ──────────────────────────────────────────

function buildResearcherWithTavilyPrompt(task: string, tavilyResults: string): string {
  return [
    'ROLE: You are a RESEARCH ANALYST. Analyze the web search results below and produce a research report.',
    '',
    'CRITICAL RULES:',
    '1. START with "## Key Findings" on the very first line.',
    '2. Synthesize the search results into organized findings with facts, dates, and specifics.',
    '3. Cite sources by number [1], [2], etc.',
    '4. Do NOT say "I\'ll research this" or "Let me search" — the search is ALREADY DONE.',
    '5. Your response IS the deliverable. No preamble.',
    '6. MINIMUM 500 words of substantive analysis.',
    '',
    `TASK: ${task}`,
    '',
    '=== WEB SEARCH RESULTS (from Tavily) ===',
    '',
    tavilyResults,
    '',
    '=== END SEARCH RESULTS ===',
    '',
    ANTI_REFLECTION,
    '',
    'Now synthesize these results. Start with "## Key Findings":',
  ].join('\n');
}

function buildResearcherFallbackPrompt(task: string, missionText?: string): string {
  return [
    'ROLE: You are a RESEARCH SPECIALIST.',
    '',
    'CRITICAL RULES:',
    '1. START with "## Key Findings" on the very first line.',
    '2. Use your training knowledge to produce comprehensive findings.',
    '3. Include specific facts, dates, numbers, and names.',
    '4. Do NOT say "I\'ll research this" — produce the research NOW.',
    '5. MINIMUM 500 words.',
    '',
    `TASK: ${task}`,
    missionText ? `\nMISSION CONTEXT: ${missionText}` : '',
    '',
    ANTI_REFLECTION,
    '',
    'Produce a detailed research report. Start with "## Key Findings":',
  ].filter(Boolean).join('\n');
}

// ── Writer ──────────────────────────────────────────────
// System prompt: "content writer... produce high-quality written content"
// → Always prose/markdown. Varies by root vs sequential vs merge.

function detectVideoWordLimit(task: string): string {
  const videoKeywords = /\b(video|script|narration|narrator|voiceover)\b/i;
  const durationMatch = task.match(/(\d+)\s*-?\s*second/i);
  if (videoKeywords.test(task) || durationMatch) {
    const seconds = durationMatch ? parseInt(durationMatch[1]) : 30;
    const maxWords = Math.max(40, Math.round(seconds * 2.5));
    return `\n\nCRITICAL: This is a VIDEO NARRATION script. ` +
      `MAXIMUM ${maxWords} words (${seconds} seconds of speech at ~2.5 words/sec). ` +
      `Be concise. Every word must earn its place. Do NOT write an essay — write a punchy narration.`;
  }
  return '';
}

function buildWriterRootPrompt(task: string, missionText?: string): string {
  const videoLimit = detectVideoWordLimit(task);
  return [
    'ROLE: You are a content writer creating original material.',
    '',
    'CRITICAL RULES:',
    '1. START with the title: "# [Your Title]" on the very first line.',
    '2. No preamble. No planning. Just write.',
    videoLimit ? '' : '3. MINIMUM 600 words.',
    '4. Use markdown formatting: headings (##), bold, lists where appropriate.',
    '5. Include specific facts, examples, names, and details.',
    '',
    `TASK: ${task}`,
    missionText ? `\nMISSION CONTEXT: ${missionText}` : '',
    videoLimit,
    '',
    ANTI_REFLECTION,
    '',
    'BEGIN NOW (first line must be "# [Title]"):',
  ].filter(Boolean).join('\n');
}

function buildWriterSequentialPrompt(task: string, parentOutput: string): string {
  const videoLimit = detectVideoWordLimit(task);
  return [
    'ROLE: You are a content writer transforming source material into polished content.',
    '',
    'CRITICAL RULES:',
    '1. START with "# [Your Title]" on the very first line.',
    '2. Do NOT acknowledge the input. TRANSFORM it into the deliverable.',
    '3. Do NOT summarize what you received. Create NEW content from it.',
    videoLimit ? '' : '4. MINIMUM 800 words.',
    '5. Use markdown: headings (##), bold, lists, blockquotes where appropriate.',
    '',
    '=== SOURCE MATERIAL ===',
    parentOutput,
    '=== END SOURCE MATERIAL ===',
    '',
    `TASK: ${task}`,
    videoLimit,
    '',
    ANTI_REFLECTION,
    '- "Based on the research provided" / "The research shows that"',
    '- "The previous agent" / Any meta-commentary about source material',
    '',
    'PRODUCE THE CONTENT NOW (first line must be "# [Title]"):',
  ].filter(Boolean).join('\n');
}

function buildWriterMergePrompt(task: string, parentOutputs: { name: string; output: string }[]): string {
  const sections = parentOutputs.map((p, i) =>
    `=== SOURCE ${i + 1}: ${p.name} ===\n${p.output}\n=== END SOURCE ${i + 1} ===`
  ).join('\n\n');

  return [
    'ROLE: You are a SENIOR EDITOR merging multiple sources into one polished document.',
    '',
    'CRITICAL RULES:',
    '1. START with "# [Compelling Title]" on the very first line.',
    '2. MERGE and ENHANCE the sources into a unified piece.',
    '3. Organize by THEME, not by source.',
    '4. The reader must NEVER know this was assembled from multiple sources.',
    '5. MINIMUM 1000 words.',
    '',
    sections,
    '',
    `TASK: ${task}`,
    '',
    'STRUCTURE:',
    '1. # Title',
    '2. ## Executive Summary (2-3 sentences)',
    '3. ## Thematic sections',
    '4. Comparison table (markdown) if comparing items',
    '5. ## Key Takeaways (3-5 bullets)',
    '6. ## Conclusion',
    '',
    ANTI_REFLECTION,
    '- "Source 1 provides" / "Source 2 covers" or ANY reference to sources by number',
    '- ANY reference to "agents", "inputs", "sources", "pipeline", or assembly',
    '',
    'WRITE THE FINAL DOCUMENT NOW (first line must be "# [Title]"):',
  ].join('\n');
}

// ── Analyst ─────────────────────────────────────────────
// System prompt: "data analyst... analyze datasets, generate insights, identify trends"
// → Structured analysis with tables. First line: "## Analysis Summary"

function buildAnalystRootPrompt(task: string, missionText?: string): string {
  return [
    'ROLE: You are a data analyst producing a structured analysis report.',
    '',
    'CRITICAL RULES:',
    '1. START with "## Analysis Summary" on the very first line.',
    '2. Include comparisons, patterns, trends, and insights.',
    '3. Use markdown tables when comparing items.',
    '4. Support claims with specific data points.',
    '5. MINIMUM 500 words.',
    '',
    `TASK: ${task}`,
    missionText ? `\nMISSION CONTEXT: ${missionText}` : '',
    '',
    'FORMAT:',
    '## Analysis Summary — 2-3 sentence overview',
    '## Detailed Findings — structured analysis with subsections',
    '## Comparison (if applicable) — markdown table',
    '## Key Insights — numbered list',
    '## Recommendations — actionable items',
    '',
    ANTI_REFLECTION,
    '',
    'BEGIN YOUR ANALYSIS NOW (first line must be "## Analysis Summary"):',
  ].filter(Boolean).join('\n');
}

function buildAnalystSequentialPrompt(task: string, parentOutput: string): string {
  return [
    'ROLE: You are a data analyst producing a structured analysis from source data.',
    '',
    'CRITICAL RULES:',
    '1. START with "## Analysis Summary" on the very first line.',
    '2. Analyze the data — find patterns, trends, comparisons.',
    '3. Use markdown tables when comparing items.',
    '4. Support claims with specific data points from the source.',
    '5. MINIMUM 500 words.',
    '',
    '=== DATA TO ANALYZE ===',
    parentOutput,
    '=== END DATA ===',
    '',
    `TASK: ${task}`,
    '',
    'FORMAT:',
    '## Analysis Summary — 2-3 sentence overview',
    '## Detailed Findings — structured analysis with subsections',
    '## Comparison (if applicable) — markdown table',
    '## Key Insights — numbered list',
    '## Recommendations — actionable items',
    '',
    ANTI_REFLECTION,
    '',
    'BEGIN YOUR ANALYSIS NOW (first line must be "## Analysis Summary"):',
  ].join('\n');
}

function buildAnalystMergePrompt(task: string, parentOutputs: { name: string; output: string }[]): string {
  const sections = parentOutputs.map((p, i) =>
    `=== DATA SOURCE ${i + 1}: ${p.name} ===\n${p.output}\n=== END DATA SOURCE ${i + 1} ===`
  ).join('\n\n');

  return [
    'ROLE: You are a data analyst synthesizing multiple data sources into one analysis.',
    '',
    'CRITICAL RULES:',
    '1. START with "## Analysis Summary" on the very first line.',
    '2. Cross-reference and compare data across sources.',
    '3. Use markdown tables for comparisons.',
    '4. Identify agreements, contradictions, and unique insights.',
    '5. MINIMUM 600 words.',
    '',
    sections,
    '',
    `TASK: ${task}`,
    '',
    'FORMAT:',
    '## Analysis Summary — 2-3 sentence overview',
    '## Cross-Source Findings — analysis organized by theme',
    '## Comparison Table — markdown table',
    '## Key Insights — numbered list',
    '## Recommendations — actionable items',
    '',
    ANTI_REFLECTION,
    '',
    'BEGIN YOUR ANALYSIS NOW (first line must be "## Analysis Summary"):',
  ].join('\n');
}

// ── Scene Writer ────────────────────────────────────────
// System prompt: "break content into individual visual scenes... Output structured JSON"
// → JSON array ONLY. No prose. No markdown. No backticks.

function buildSceneWriterPrompt(task: string, sourceContent: string): string {
  return [
    'ROLE: You are a scene description writer for video production.',
    '',
    'OUTPUT FORMAT: Respond with ONLY a JSON array. No markdown. No explanation.',
    'No backticks. No ```json. ONLY the raw JSON array.',
    '',
    'Each scene object must have exactly these fields:',
    '  "sceneNumber": integer starting at 1',
    '  "title": short scene title string',
    '  "narration": 2-3 sentence voiceover text string',
    '  "imagePrompt": detailed 50-100 word visual description for AI image generation (describe as a photograph or painting)',
    '  "durationSeconds": integer between 5 and 8',
    '',
    '=== SOURCE CONTENT ===',
    sourceContent,
    '=== END SOURCE CONTENT ===',
    '',
    `TASK: ${task}`,
    '',
    'RULES:',
    '1. Create 4-6 scenes that cover the key points.',
    '2. Each imagePrompt must be standalone and detailed (subject, style, colors, composition, lighting).',
    '3. Narration should be engaging and suitable for voiceover.',
    '4. First character of your response MUST be [',
    '5. Last character of your response MUST be ]',
    '',
    'RESPOND WITH ONLY THE JSON ARRAY:',
  ].join('\n');
}

// ── Monitor ─────────────────────────────────────────────
// System prompt: "monitoring agent... scan sources for new information... report findings"
// → Factual report. First line: "## Monitoring Report"

function buildMonitorPrompt(task: string, sourceContent: string, missionText?: string): string {
  return [
    'ROLE: You are a monitoring analyst tracking changes and updates.',
    '',
    'CRITICAL RULES:',
    '1. START with "## Monitoring Report" on the very first line.',
    '2. Focus on what changed, what is new, what needs attention.',
    '3. Use specific timestamps, numbers, and facts.',
    '4. Flag anything urgent with WARNING.',
    '5. Be concise but thorough.',
    '',
    sourceContent ? `=== MONITORING DATA ===\n${sourceContent}\n=== END DATA ===\n` : '',
    `TASK: ${task}`,
    missionText && !sourceContent ? `\nMISSION CONTEXT: ${missionText}` : '',
    '',
    ANTI_REFLECTION,
    '',
    'BEGIN YOUR REPORT NOW (first line must be "## Monitoring Report"):',
  ].filter(Boolean).join('\n');
}

// ── Publisher ───────────────────────────────────────────
// System prompt: "social publishing agent... publish content... with formatting, hashtags"
// → Short social copy. No headings. Direct content. Emojis/hashtags welcome.

function buildPublisherPrompt(task: string, sourceContent: string): string {
  return [
    'ROLE: You are a social media content creator.',
    '',
    'CRITICAL RULES:',
    '1. START directly with the content. First word must be part of the post.',
    '2. Adapt format to the platform requested in the task.',
    '3. Use hooks, engagement techniques, emojis, and hashtags where appropriate.',
    '4. Keep within platform character limits (Twitter/X: 280, LinkedIn: 3000).',
    '5. If no platform specified, write for a general social audience.',
    '',
    sourceContent ? `=== SOURCE MATERIAL ===\n${sourceContent}\n=== END SOURCE MATERIAL ===\n` : '',
    `TASK: ${task}`,
    '',
    ANTI_REFLECTION,
    '',
    'BEGIN YOUR CONTENT NOW (start directly with the post):',
  ].filter(Boolean).join('\n');
}

// ── Generic Fallback (unknown templates) ────────────────

function buildGenericFallbackPrompt(task: string, missionText: string): string {
  return [
    'ROLE: You are a specialist executing a task. Your response IS the deliverable.',
    '',
    'CRITICAL RULES:',
    '1. START with actual content. First line must be "# [Title]" or a heading.',
    '2. Do NOT acknowledge, plan, or outline. Just produce the result.',
    '3. MINIMUM 600 words.',
    '',
    `TASK: ${task}`,
    `\nMISSION CONTEXT: ${missionText}`,
    '',
    ANTI_REFLECTION,
    '',
    'PRODUCE YOUR COMPLETE OUTPUT NOW:',
  ].join('\n');
}

// ── Prompt Router ───────────────────────────────────────
// Routes to the correct template-specific builder based on template name
// and dependency structure. Called from executeOne() for all non-researcher templates.

function buildPromptForTemplate(
  template: string,
  task: string,
  nodes: PipelineNode[],
  step: PipelineStep,
  missionText: string,
): string {
  const deps = getDependencies(step);

  // Gather parent outputs
  const parentData = deps.map(depId => {
    const parent = nodes.find(n => n.step.id === depId);
    return { name: parent?.step.name || depId, output: parent?.output || '' };
  });
  const hasParent = parentData.some(p => p.output.length > 0);
  const allSourceContent = hasParent
    ? parentData.filter(p => p.output.length > 0).map(p => p.output).join('\n\n---\n\n')
    : '';

  switch (template) {
    case 'scene-writer':
      return buildSceneWriterPrompt(task, allSourceContent || missionText);

    case 'writer':
      if (!hasParent) return buildWriterRootPrompt(task, missionText);
      if (parentData.length === 1) return buildWriterSequentialPrompt(task, parentData[0].output);
      return buildWriterMergePrompt(task, parentData);

    case 'analyst':
      if (!hasParent) return buildAnalystRootPrompt(task, missionText);
      if (parentData.length === 1) return buildAnalystSequentialPrompt(task, parentData[0].output);
      return buildAnalystMergePrompt(task, parentData);

    case 'monitor':
      return buildMonitorPrompt(task, allSourceContent, missionText);

    case 'publisher':
      return buildPublisherPrompt(task, allSourceContent);

    default:
      // Unknown template: use generic prose fallback
      if (!hasParent) return buildGenericFallbackPrompt(task, missionText);
      if (parentData.length === 1) return buildWriterSequentialPrompt(task, parentData[0].output);
      return buildWriterMergePrompt(task, parentData);
  }
}

/**
 * Detect and remove repeated content blocks in worker output.
 * LLMs (especially quantized models) sometimes get stuck in repetition loops,
 * producing the same content 2-6 times. This detects the first title heading
 * appearing multiple times and keeps only the first occurrence.
 */
function deduplicateOutput(text: string): string {
  if (!text || text.length < 200) return text;

  // Find the first markdown heading (title-level: # or ##)
  const lines = text.split('\n');
  const titleLine = lines.find(l => /^#{1,2}\s+\S/.test(l.trim()));
  if (!titleLine) return text;

  const title = titleLine.trim();
  const first = text.indexOf(title);
  if (first < 0) return text;

  const second = text.indexOf(title, first + title.length);
  if (second < 0) return text; // title only appears once — no duplication

  const kept = text.slice(0, second).trim();
  console.log(`[AgentForge:Dedup] Removed repeated content: "${title.slice(0, 50)}" found at pos ${first} and ${second} — kept ${kept.length}/${text.length} chars`);
  return kept;
}

// ── Scene parser for slideshow video pipeline ────────────

interface ParsedScene {
  sceneNumber: number;
  title: string;
  narration: string;
  imagePrompt: string;
  durationSeconds: number;
}

/**
 * Parse scene descriptions from scene-writer output or raw text.
 * Handles JSON arrays, wrapped JSON, and plain text paragraphs.
 */
function parseScenes(output: string | undefined): ParsedScene[] {
  if (!output) return [];
  try {
    const cleaned = output.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const arr = Array.isArray(parsed) ? parsed : (parsed.scenes && Array.isArray(parsed.scenes)) ? parsed.scenes : null;
    if (arr) {
      return arr.map((s: any, i: number) => ({
        sceneNumber: s.sceneNumber || i + 1,
        title: s.title || `Scene ${i + 1}`,
        narration: s.narration || s.text || '',
        imagePrompt: s.imagePrompt || s.image_prompt || s.description || s.narration || '',
        durationSeconds: s.durationSeconds || s.duration || 6,
      }));
    }
  } catch {
    // Try extracting JSON array from mixed text
    const jsonMatch = output.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try { return parseScenes(jsonMatch[0]); } catch { /* fall through */ }
    }
  }
  // Fallback: create scenes from text paragraphs
  return output.split('\n\n').filter(p => p.trim().length > 20).slice(0, 4).map((p, i) => ({
    sceneNumber: i + 1,
    title: `Scene ${i + 1}`,
    narration: p.trim(),
    imagePrompt: p.trim().slice(0, 200),
    durationSeconds: 6,
  }));
}

// ── Slideshow helpers ────────────────────────────────────

function formatTime(seconds: number): string {
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

function buildTimestampedNarration(scenes: ParsedScene[]): string {
  let time = 0;
  return scenes.map(scene => {
    const start = formatTime(time);
    time += scene.durationSeconds || 6;
    const end = formatTime(time);
    return `${start}-${end} | Scene ${scene.sceneNumber}: ${scene.narration || scene.title || 'N/A'}`;
  }).join('\n');
}

function buildScriptMarkdown(scenes: ParsedScene[]): string {
  return scenes.map(scene =>
    `### Scene ${scene.sceneNumber}: ${scene.title || ''}\n\n` +
    `**Narration:** ${scene.narration || 'N/A'}\n\n` +
    `**Image prompt:** ${scene.imagePrompt || 'N/A'}\n\n` +
    `**Duration:** ${scene.durationSeconds || 6}s`
  ).join('\n\n---\n\n');
}

// ── Orchestrator ─────────────────────────────────────────

export class MissionOrchestrator {

  async planPipeline(mission: string): Promise<PipelineStep[]> {
    const baseUrl = process.env.OPENAI_API_URL || '';
    const apiKey = process.env.OPENAI_API_KEY || 'nosana';
    const model = process.env.MODEL_NAME || 'Qwen3.5-27B-AWQ-4bit';
    const capabilities = detectCapabilities();

    if (!baseUrl) return this.planFallback(mission);

    const capabilitiesNote = `
AVAILABLE MULTIMODAL CAPABILITIES:
- Image generation: ${capabilities.imageGen ? 'YES — you may use "image-generator" steps' : 'NO — DO NOT include image-generator steps'}
- Video generation: ${capabilities.videoGen ? 'YES — you may use "video-generator" steps' : 'NO — DO NOT include video-generator steps'}
- Text-to-speech: ${capabilities.tts ? 'YES — you may use "narrator" steps' : 'NO — DO NOT include narrator steps'}

CRITICAL: If a capability is marked NO, you MUST NOT include steps with that template.`;

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
              content: `You are a pipeline planner. Given a user mission, output ONLY a JSON array. No markdown fences. No explanation. No text before or after the array.

Each object in the array: {"template":"...","name":"...","task":"...","dependsOn":N}

TEMPLATE values:
- "researcher" (web search — TEXT output)
- "analyst" (analysis/comparison — TEXT output)
- "writer" (content creation — TEXT output)
- "scene-writer" (breaks content into visual scenes with image descriptions — TEXT output)
- "image-generator" (generates an image from text — IMAGE output) — ONLY if image gen is available
- "video-generator" (assembles a slideshow video from scene images + narrated audio — VIDEO output) — ONLY if video gen is available. REQUIRES scene-writer and narrator as inputs.
- "narrator" (converts text to speech audio — AUDIO output) — ONLY if TTS is available

${capabilitiesNote}

DEPENDENCY rules:
- dependsOn: -1 means first step (no dependencies)
- dependsOn: 0 means depends on step at index 0
- dependsOn: [1,2] means depends on steps 1 AND 2
- Steps with the same dependsOn value run in PARALLEL
- Max 8 steps total

TASK field rules (CRITICAL for output quality):
- For researchers: "Find at least 5 specific facts with dates, numbers, and company names about [topic]."
- For writers: "Write an 800-word [format] with title, introduction, 3 detailed sections, and conclusion about [topic]."
- For analysts: "Produce a structured analysis with executive summary, comparison table, key findings, and recommendations about [topic]."
- For scene-writers: "Break the content into 4-6 scenes. For each scene provide: scene number, title, narration text (2-3 sentences), and a detailed image prompt."
- For image-generators: The task IS the image prompt — be detailed about subject, style, colors, composition.
- For video-generators: "Assemble a slideshow video from the scene images and narration audio." The video-generator MUST depend on scene-writer and narrator steps.
- For narrators: The task IS the text to convert to speech.
- Be SPECIFIC. Vague tasks produce vague outputs.

MULTIMODAL PIPELINE RULES:
1. image-generator, video-generator, and narrator steps execute DIRECTLY (no worker deployment).
2. A scene-writer should ALWAYS precede image-generator steps to create proper visual descriptions.
3. Multiple image-generators can run in PARALLEL (same dependsOn value).
4. Only include multimodal steps if the mission EXPLICITLY asks for visual content, video, images, or audio.
5. For text-only missions (research, blog posts, analysis), stick to researcher/writer/analyst.
6. video-generator MUST depend on BOTH a scene-writer AND a narrator step. It assembles scene images + narrated audio into an MP4 slideshow.
7. CRITICAL: video-generator generates its own images internally. NEVER add separate image-generator nodes alongside a video-generator. Maximum 5 steps for video missions: researcher → writer → scene-writer + narrator (parallel) → video-generator.

VIDEO DURATION RULE: When the user requests a specific video duration (e.g. "30-second video"), the writer step MUST include the word count limit in its task field. Approximate: 15s=40 words, 30s=75 words, 60s=150 words, 2min=300 words. Example task for 30s: "Write a concise 30-second narration script (MAXIMUM 75 words) about space exploration."

NAME field: short PascalCase (e.g. "AIResearcher", "BlogWriter", "CompetitiveAnalyst", "SceneWriter", "ImageGen1")

Example for "Research X and write a blog post AND YouTube script":
[{"template":"researcher","name":"Researcher","task":"Research X thoroughly. Find at least 5 specific facts with dates, numbers, and sources.","dependsOn":-1},{"template":"writer","name":"BlogWriter","task":"Write an 800-word blog post with title, intro, 3 sections, conclusion.","dependsOn":0},{"template":"writer","name":"ScriptWriter","task":"Write a YouTube video script with intro hook, 3 segments, and call-to-action.","dependsOn":0},{"template":"analyst","name":"Editor","task":"Merge both outputs into one polished document with executive summary.","dependsOn":[1,2]}]

Respond with ONLY the JSON array:`,
            },
            { role: 'user', content: mission },
          ],
          temperature: 0.3,
        }),
      });

      if (!res.ok) throw new Error(`LLM error: ${res.status}`);
      const data = await res.json() as any;
      const content = data.choices?.[0]?.message?.content || '';

      // Extract JSON array — use greedy match from first [ to last ] to handle nested arrays like dependsOn:[1,2]
      const stripped = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const firstBracket = stripped.indexOf('[');
      const lastBracket = stripped.lastIndexOf(']');
      if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) {
        throw new Error('No JSON array in LLM response');
      }
      const jsonStr = stripped.slice(firstBracket, lastBracket + 1);

      const raw = JSON.parse(jsonStr) as any[];
      if (!Array.isArray(raw) || raw.length === 0) throw new Error('Empty pipeline');

      let steps: PipelineStep[] = raw
        .filter(s => s.template && s.name && s.task && (AGENT_TEMPLATES[s.template] || s.template === 'custom'))
        .slice(0, 8)
        .map((s, i) => {
          let dependsOn: string | string[] | undefined;
          if (s.dependsOn === -1 || s.dependsOn === null || s.dependsOn === undefined) {
            dependsOn = undefined;
          } else if (Array.isArray(s.dependsOn)) {
            dependsOn = s.dependsOn.map((d: number) => `step-${d}`);
          } else if (typeof s.dependsOn === 'number') {
            dependsOn = `step-${s.dependsOn}`;
          }
          return { id: `step-${i}`, template: s.template as string, name: s.name as string, task: s.task as string, dependsOn };
        });

      // Post-plan validation: filter out steps for unavailable capabilities
      steps = this.validateMultimodalSteps(steps, capabilities);
      // Strip redundant image-generator nodes when video-generator exists
      steps = this.stripRedundantImageNodes(steps);

      // Guard: if all steps were filtered out, fall back
      if (steps.length === 0) {
        console.warn('[AgentForge:Orchestrator] All LLM-planned steps had unknown templates or unavailable capabilities');
        return this.planFallback(mission);
      }

      return steps;
    } catch (err) {
      console.warn('[AgentForge:Orchestrator] LLM planning failed, using fallback:', err);
      return this.planFallback(mission);
    }
  }

  /**
   * DOUBLE SAFETY: Remove multimodal steps if capabilities aren't configured.
   * Recalculates dependencies after removing steps.
   */
  private validateMultimodalSteps(
    steps: PipelineStep[],
    capabilities: { imageGen: boolean; videoGen: boolean; tts: boolean },
  ): PipelineStep[] {
    const removedIds = new Set<string>();

    const filtered = steps.filter(step => {
      if (step.template === 'image-generator' && !capabilities.imageGen) {
        console.warn(`[AgentForge:Orchestrator] Removed ${step.name}: image generation not configured`);
        removedIds.add(step.id);
        return false;
      }
      if (step.template === 'video-generator' && !capabilities.imageGen) {
        console.warn(`[AgentForge:Orchestrator] Removed ${step.name}: image generation not configured (required for slideshow video)`);
        removedIds.add(step.id);
        return false;
      }
      if (step.template === 'narrator' && !capabilities.tts) {
        console.warn(`[AgentForge:Orchestrator] Removed ${step.name}: TTS not configured`);
        removedIds.add(step.id);
        return false;
      }
      return true;
    });

    if (removedIds.size === 0) return filtered;

    // Rebuild IDs and fix dependencies pointing to removed steps
    const oldToNew = new Map<string, string>();
    const result: PipelineStep[] = [];
    let idx = 0;

    for (const step of filtered) {
      const newId = `step-${idx}`;
      oldToNew.set(step.id, newId);
      result.push({ ...step, id: newId });
      idx++;
    }

    // Remap dependsOn references
    for (const step of result) {
      if (!step.dependsOn) continue;
      const deps = Array.isArray(step.dependsOn) ? step.dependsOn : [step.dependsOn];
      const remapped = deps
        .filter(d => !removedIds.has(d))
        .map(d => oldToNew.get(d) || d);
      step.dependsOn = remapped.length === 0 ? undefined : remapped.length === 1 ? remapped[0] : remapped;
    }

    return result;
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

  /**
   * Strip redundant image-generator nodes when a video-generator exists.
   * The video-generator handles image generation internally — separate image-generator
   * nodes would spawn duplicate GPU containers.
   */
  private stripRedundantImageNodes(steps: PipelineStep[]): PipelineStep[] {
    const hasVideoGenerator = steps.some(s => s.template === 'video-generator');
    if (!hasVideoGenerator) return steps;

    const removedIds = new Set<string>();
    const filtered = steps.filter(step => {
      if (step.template === 'image-generator') {
        removedIds.add(step.id);
        return false;
      }
      return true;
    });

    if (removedIds.size > 0) {
      console.log(
        `[AgentForge:Orchestrator] Stripped ${removedIds.size} redundant image-generator node(s) ` +
        `(video-generator handles images internally)`
      );

      // Remap dependencies: anything depending on removed nodes should drop those deps
      for (const step of filtered) {
        if (!step.dependsOn) continue;
        const deps = Array.isArray(step.dependsOn) ? step.dependsOn : [step.dependsOn];
        const cleaned = deps.filter(d => !removedIds.has(d));
        step.dependsOn = cleaned.length === 0 ? undefined : cleaned.length === 1 ? cleaned[0] : cleaned;
      }

      // Re-index step IDs to be contiguous
      const oldToNew = new Map<string, string>();
      filtered.forEach((step, i) => {
        oldToNew.set(step.id, `step-${i}`);
        step.id = `step-${i}`;
      });
      for (const step of filtered) {
        if (!step.dependsOn) continue;
        const deps = Array.isArray(step.dependsOn) ? step.dependsOn : [step.dependsOn];
        const remapped = deps.map(d => oldToNew.get(d) || d);
        step.dependsOn = remapped.length === 1 ? remapped[0] : remapped;
      }
    }

    return filtered;
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

    // Video/animation pattern → 5-step slideshow pipeline
    if (/video|animation|film|movie|clip/i.test(lower)) {
      console.log('[AgentForge:Orchestrator] Detected video mission — using 5-step slideshow pipeline');
      const durationMatch = mission.match(/(\d+)\s*-?\s*second/i);
      const seconds = durationMatch ? parseInt(durationMatch[1]) : 30;
      const maxWords = Math.max(40, Math.round(seconds * 2.5));
      return [
        { id: 'step-0', template: 'researcher', name: 'Researcher',
          task: `Research the following topic thoroughly: ${mission}`, dependsOn: undefined },
        { id: 'step-1', template: 'writer', name: 'ScriptWriter',
          task: `Write a concise ${seconds}-second narration script (MAXIMUM ${maxWords} words) about ${mission}. Keep it punchy and visual.`,
          dependsOn: 'step-0' },
        { id: 'step-2', template: 'scene-writer', name: 'SceneWriter',
          task: 'Break the script into 4-6 visual scenes with image prompts',
          dependsOn: 'step-1' },
        { id: 'step-3', template: 'narrator', name: 'Narrator',
          task: 'Generate audio narration from the script',
          dependsOn: 'step-1' },
        { id: 'step-4', template: 'video-generator', name: 'VideoAssembler',
          task: 'Assemble slideshow video from scene images and narration audio',
          dependsOn: ['step-2', 'step-3'] },
      ];
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

    // Reset abort flag and create new abort controller for this mission
    missionAborted = false;
    missionAbortController = new AbortController();
    const abortSignal = missionAbortController.signal;

    // Init pipeline state
    const missionWarnings: MissionWarning[] = [];
    currentPipelineState = {
      id: missionId, mission, status: 'planning', steps: [], warnings: missionWarnings,
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
    const maxDepth = levels.size > 0 ? Math.max(...Array.from(levels.keys())) : 0;

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
            outputType: n.outputType,
            outputUrls: n.outputUrls,
          };
        }),
      };
    };

    syncState('deploying');
    log(`pipeline:created — ${steps.length} steps across ${levels.size} depth levels`);

    // Narrate pipeline plan
    const levelSizes = [...levels.values()].map(ids => ids.length);
    const maxParallel = levelSizes.length > 0 ? Math.max(...levelSizes) : 1;
    narrate(
      `\u{1F4CB} **Pipeline planned:** ${steps.length} agents across ${levels.size} stage${levels.size > 1 ? 's' : ''}` +
      (maxParallel > 1 ? ` (${maxParallel} running in parallel)` : '') +
      `\n\n` +
      steps.map(s => `\u2022 **${s.name}** \u2014 ${s.task.slice(0, 80)}...`).join('\n')
    );

    // Track markets that failed during this mission — avoid retrying them for subsequent steps
    const coldMarkets = new Set<string>();

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
      const deployWarnings = checkTemplateRequirements(node.step.template, node.step.name);
      if (deployWarnings.length > 0) {
        missionWarnings.push(...deployWarnings);
        currentPipelineState.warnings = missionWarnings;
        for (const w of deployWarnings) {
          narrate(`\u{26A0}\u{FE0F} **${node.step.name}** may produce limited results \u2014 ${w.message}`);
        }
        syncState();
      }

      try {
        const dep = await manager.createAndStartDeployment({
          name: `mission-${node.step.name}`,
          dockerImage: workerImage,
          env: buildWorkerEnv({
            AGENT_TEMPLATE: node.step.template,
            AGENT_NAME: node.step.name,
            AGENT_SYSTEM_PROMPT: tmpl.defaultPrompt,
            AGENT_PLUGINS: tmpl.plugins.join(','),
            SERVER_PORT: '3000',
          }),
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
      // Combine per-node tried addresses with mission-wide cold markets
      const triedMarketAddresses: string[] = [...coldMarkets, ...(market ? [market.address] : [])];
      if (node.status === 'error' || !node.url) return false;

      // Attempt 1: wait on current deployment
      try {
        const client = new WorkerClient(node.url);
        await client.waitForReady(90_000);
        node.status = 'ready';
        log(`node:status — ${node.step.name}: ready`);
        syncState();
        return true;
      } catch (err: any) {
        log(`node:status — ${node.step.name}: waitForReady failed — ${err.message}`);
      }

      // Mark this market as cold for future steps in this mission
      if (market) {
        coldMarkets.add(market.address);
        log(`Market ${market.name} marked cold (${coldMarkets.size} cold markets this mission)`);
      }

      // Attempt 2: redeploy on a different market
      log(`node:status — ${node.step.name}: worker didn't boot — trying next GPU market`);
      narrate(`\u{26A0}\u{FE0F} **${node.step.name}** worker didn't boot — retrying on different market...`);

      try { if (node.deploymentId) await manager.stopDeployment(node.deploymentId); } catch (e) { log(`Failed to stop ${node.step.name}: ${e}`); }

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
          env: buildWorkerEnv({
            AGENT_TEMPLATE: node.step.template,
            AGENT_NAME: node.step.name,
            AGENT_SYSTEM_PROMPT: tmpl.defaultPrompt,
            AGENT_PLUGINS: tmpl.plugins.join(','),
            SERVER_PORT: '3000',
          }),
          resolvedMarket: nextMarket,
          timeout: 30,
        });
        node.deploymentId = newDep.id;
        node.url = newDep.url;
        syncState();

        if (newDep.url) {
          const client2 = new WorkerClient(newDep.url);
          try {
            await client2.waitForReady(90_000);
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

      let prompt: string;

      // Researcher: orchestrator calls Tavily directly and injects results into prompt.
      // This bypasses ElizaOS's async SEARCH action which doesn't post results to the channel.
      if (node.step.template === 'researcher') {
        const searchQuery = node.step.task;
        narrate(`\u{1F50D} **${node.step.name}** searching the web...`);
        const searchResults = await searchTavily(searchQuery);

        if (searchResults.length > 0) {
          const formattedResults = searchResults.map((r, i) =>
            `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.content}`
          ).join('\n\n');
          log(`Researcher prompt built with ${searchResults.length} Tavily results (${formattedResults.length} chars of context)`);
          prompt = buildResearcherWithTavilyPrompt(searchQuery, formattedResults);
        } else {
          log('No Tavily results, researcher will use LLM knowledge only');
          prompt = buildResearcherFallbackPrompt(searchQuery, missionText);
        }
      } else {
        // All other templates: route to template-specific prompt builder
        prompt = buildPromptForTemplate(node.step.template, node.step.task, nodes, node.step, missionText);
      }

      try {
        const client = new WorkerClient(node.url!);
        const agentId = await client.waitForReady(10_000);
        const checkAlive = () => {
          if (isAborted()) return false; // Abort interrupts active worker communication
          if (!node.deploymentId) return true;
          const dep = manager.getDeployment(node.deploymentId);
          return !!dep && dep.status !== 'stopped' && dep.status !== 'error';
        };
        const isResearcher = node.step.template === 'researcher';
        const timeoutMs = TEMPLATE_TIMEOUT_MS[node.step.template] || 300_000;
        const rawOutput = await client.sendMessage(agentId, prompt, timeoutMs, checkAlive, isResearcher, abortSignal);
        let output = deduplicateOutput(rawOutput);
        if (output.length !== rawOutput.length) {
          log(`node:dedup — ${node.step.name}: ${rawOutput.length} → ${output.length} chars (removed repeated content)`);
        }
        // Strip reflection prefixes for prose templates (not JSON like scene-writer)
        if (node.step.template !== 'scene-writer') {
          const cleaned = stripReflection(output);
          if (cleaned !== output) {
            log(`node:strip — ${node.step.name}: stripped reflection prefix (${output.length} → ${cleaned.length} chars)`);
            output = cleaned;
          }
        }
        node.output = output;
        node.status = 'complete';
        log(`node:status — ${node.step.name}: complete (${output.length} chars)`);
        syncState();
      } catch (err: any) {
        // If aborted, mark as skipped (not error) for cleaner UX
        if (isAborted() || err.message?.includes('aborted')) {
          node.status = 'skipped';
          node.output = '[Mission aborted by user]';
          log(`node:status — ${node.step.name}: skipped (aborted)`);
        } else {
          node.status = 'error';
          node.error = err.message;
          log(`node:status — ${node.step.name}: error — ${err.message}`);
        }
        syncState();
      }
    };

    // ── Multimodal direct execution (no worker needed) ────

    const executeMultimodal = async (node: PipelineNode) => {
      const template = node.step.template;
      const capabilities = detectCapabilities();

      // Gather input from parent nodes
      const deps = getDependencies(node.step);
      let inputText = node.step.task;
      if (deps.length > 0) {
        const parentOutputs = deps
          .map(depId => nodes.find(n => n.step.id === depId)?.output)
          .filter(Boolean);
        if (parentOutputs.length > 0) {
          inputText = parentOutputs.join('\n\n') + '\n\n' + node.step.task;
        }
      }

      if (template === 'image-generator') {
        if (!capabilities.imageGen) {
          narrate(`\u{26A0}\u{FE0F} **Image generation not available.** Skipping "${node.step.name}". Configure COMFYUI_ENDPOINT or FAL_KEY in .env to enable.`);
          node.status = 'skipped';
          node.output = '[Image generation not configured — step skipped]';
          node.outputType = 'text';
          syncState();
          return;
        }
        try {
          node.status = 'processing';
          syncState('executing');
          narrate(`\u{1F3A8} **${node.step.name}** generating image...`);
          const result = await ImageGenRouter.generate(inputText);
          let mediaUrl: string;
          if (result.url) {
            mediaUrl = result.url;
          } else if (result.base64) {
            const mediaId = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            mediaUrl = storeMedia(mediaId, result.base64, 'image/png');
          } else {
            throw new Error('Image generator returned no image');
          }
          node.output = mediaUrl;
          node.outputType = 'image';
          node.outputUrls = [mediaUrl];
          node.status = 'complete';
          log(`node:status — ${node.step.name}: complete (image)`);
          syncState();
        } catch (err: any) {
          narrate(`\u{26A0}\u{FE0F} **Image generation failed** for "${node.step.name}": ${err.message}. Continuing pipeline.`);
          node.status = 'error';
          node.error = err.message;
          node.output = `[Image generation failed: ${err.message}]`;
          syncState();
        }
        return;
      }

      if (template === 'video-generator') {
        // Slideshow video pipeline: scene images + TTS audio + FFmpeg → MP4
        node.status = 'processing';
        syncState('executing');
        narrate(`\u{1F3AC} **${node.step.name}** generating slideshow video...`);

        try {
          // 1. Parse scene descriptions from scene-writer sibling
          const sceneWriterSibling = nodes.find(n => n.step.template === 'scene-writer' && n.status === 'complete');
          const scenes = parseScenes(sceneWriterSibling?.output || inputText);
          if (scenes.length === 0) {
            // No scene-writer output — create a basic scene from parent text
            const parentText = inputText.slice(0, 500);
            scenes.push({
              sceneNumber: 1, title: 'Overview',
              narration: parentText, imagePrompt: parentText.slice(0, 200),
              durationSeconds: 8,
            });
          }
          log(`Generating slideshow: ${scenes.length} scenes`);

          // 2. Collect images — check sibling image-generator nodes first, then generate remaining
          const assembler = new MediaAssembler();
          const sceneMedias: Array<{ sceneNumber: number; imagePath: string; durationSeconds: number; title: string }> = [];

          // Check if sibling image-generator nodes already produced images
          const existingImageNodes = nodes.filter(n =>
            n.step.template === 'image-generator' && n.status === 'complete' && n.outputUrls && n.outputUrls.length > 0
          );
          if (existingImageNodes.length > 0) {
            log(`Found ${existingImageNodes.length} existing image node(s) — reusing their images`);
            for (const imgNode of existingImageNodes) {
              for (const url of imgNode.outputUrls || []) {
                try {
                  const imagePath = await assembler.downloadMedia(url, `existing-${sceneMedias.length + 1}.png`);
                  const sceneInfo = scenes[sceneMedias.length] || { sceneNumber: sceneMedias.length + 1, durationSeconds: 6, title: imgNode.step.name };
                  sceneMedias.push({
                    sceneNumber: sceneInfo.sceneNumber, imagePath,
                    durationSeconds: sceneInfo.durationSeconds, title: sceneInfo.title,
                  });
                } catch (dlErr: any) {
                  log(`Failed to download existing image from ${imgNode.step.name}: ${dlErr.message}`);
                }
              }
            }
            log(`Reused ${sceneMedias.length} image(s) from sibling nodes`);
          }

          // Only generate new images for scenes not yet covered
          const scenesNeedingImages = scenes.slice(sceneMedias.length);

          let sd15Url: string | null = null;
          let sd15Failed = false;
          const hasNosana = !!(process.env.NOSANA_API_KEY && process.env.NOSANA_API_KEY !== 'YOUR_NOSANA_API_KEY');

          // Try to boot SD 1.5 once for remaining scenes (skip if all covered by siblings)
          const { setNosanaImageService, markNosanaImageFailed } = await import('./imageGenRouter.js');
          if (scenesNeedingImages.length > 0 && hasNosana && !sd15Failed) {
            try {
              const { IMAGE_SERVICE } = await import('./mediaServiceDefinitions.js');
              narrate(`\u{1F680} Booting SD 1.5 on Nosana GPU...`);
              sd15Url = await manager.deployMediaService(IMAGE_SERVICE);
              log(`SD 1.5 ready at ${sd15Url}`);
              setNosanaImageService(sd15Url); // Share warm container with imageGenRouter
            } catch (bootErr: any) {
              log(`SD 1.5 boot failed: ${bootErr.message} — will use DALL-E/fal.ai`);
              sd15Failed = true;
              markNosanaImageFailed();
            }
          }

          const scenesToGenerate = scenesNeedingImages.slice(0, 6);

          if (sd15Url && !sd15Failed) {
            // SD 1.5 mode: sequential on warm ComfyUI container (~3-5s per image)
            const { ComfyUIClient } = await import('./comfyuiClient.js');
            for (const scene of scenesToGenerate) {
              const prompt = scene.imagePrompt || scene.narration || `Scene ${scene.sceneNumber}`;
              try {
                narrate(`\u{1F3A8} Scene ${scene.sceneNumber}: generating with ComfyUI SD 1.5...`);
                const client = new ComfyUIClient(sd15Url);
                const result = await client.generateImage(prompt, '', 512, 512);
                const imagePath = await assembler.downloadMedia(`data:image/png;base64,${result.base64}`, `scene-${scene.sceneNumber}.png`);
                sceneMedias.push({ sceneNumber: scene.sceneNumber, imagePath, durationSeconds: scene.durationSeconds, title: scene.title });
                log(`Scene ${scene.sceneNumber} generated via ComfyUI SD 1.5`);
              } catch (sdErr: any) {
                log(`ComfyUI SD 1.5 generation failed for scene ${scene.sceneNumber}: ${sdErr.message} — switching to DALL-E for remaining`);
                sd15Failed = true;
                markNosanaImageFailed();
                break; // Switch to parallel DALL-E for remaining scenes
              }
            }
          }

          // DALL-E/API mode: generate remaining images in parallel (Promise.all)
          const remainingScenes = scenesToGenerate.filter(s => !sceneMedias.some(m => m.sceneNumber === s.sceneNumber));
          if (remainingScenes.length > 0) {
            log(`Generating ${remainingScenes.length} images via API backends (parallel)`);
            narrate(`\u{1F3A8} Generating ${remainingScenes.length} scene images in parallel...`);

            const imagePromises = remainingScenes.map(async (scene) => {
              const prompt = scene.imagePrompt || scene.narration || `Scene ${scene.sceneNumber}`;
              try {
                const imgResult = await ImageGenRouter.generate(prompt);
                let imgSource: string;
                if (imgResult.url) imgSource = imgResult.url;
                else if (imgResult.base64) imgSource = `data:image/png;base64,${imgResult.base64}`;
                else return null;
                const imagePath = await assembler.downloadMedia(imgSource, `scene-${scene.sceneNumber}.png`);
                log(`Scene ${scene.sceneNumber} generated via API`);
                return { sceneNumber: scene.sceneNumber, imagePath, durationSeconds: scene.durationSeconds, title: scene.title };
              } catch (imgErr: any) {
                log(`Scene ${scene.sceneNumber} image failed: ${imgErr.message}`);
                return null;
              }
            });

            const results = await Promise.all(imagePromises);
            for (const r of results) {
              if (r) sceneMedias.push(r);
            }
          }

          // 3. Get narrator audio if available
          const narratorSibling = nodes.find(n => n.step.template === 'narrator' && n.status === 'complete');
          let audioPath: string | null = null;
          if (narratorSibling?.outputUrls?.[0]) {
            try {
              audioPath = await assembler.downloadMedia(narratorSibling.outputUrls[0], 'narration.mp3');
            } catch { /* proceed without audio */ }
          }

          // 4. Assemble based on what we have
          const hasImages = sceneMedias.length > 0;
          const hasAudio = !!audioPath;

          if (hasImages) {
            const videoPath = await assembler.assembleSlideshow(sceneMedias, audioPath);
            if (videoPath.endsWith('.mp4')) {
              const videoId = `video-slideshow-${Date.now()}`;
              const { readFileSync: readFs } = await import('fs');
              const mediaUrl = storeMediaBuffer(videoId, readFs(videoPath), 'video/mp4');
              node.output = mediaUrl;
              node.outputType = 'video';
              node.outputUrls = [mediaUrl];

              // If no audio, append timestamped narration text so user can add voiceover
              if (!hasAudio) {
                const timestamps = buildTimestampedNarration(scenes);
                node.output = `${mediaUrl}\n\n**Narration timestamps (no audio generated):**\n\`\`\`\n${timestamps}\n\`\`\``;
              }

              node.status = 'complete';
              log(`node:status — ${node.step.name}: complete (slideshow, ${sceneMedias.length} scenes, audio=${hasAudio})`);
              narrate(`\u{2705} **Slideshow video assembled!** ${sceneMedias.length} scenes${hasAudio ? ', with narration' : ' (silent — add voiceover manually)'}`);
            } else {
              // FFmpeg not available — return images + audio separately
              const { readFileSync: readFs } = await import('fs');
              const mdContent = readFs(videoPath, 'utf-8');
              node.output = mdContent;
              node.outputType = 'text';
              node.status = 'complete';
              log(`node:status — ${node.step.name}: complete (no FFmpeg — images as markdown)`);
              narrate(`\u{2705} **Slideshow images ready** (FFmpeg not installed — images provided separately)`);
            }
          } else if (hasAudio) {
            // No images but audio exists — return audio + text script
            const script = buildScriptMarkdown(scenes);
            node.output = `**Audio narration generated but image generation failed.**\n\n${script}`;
            node.outputType = 'text';
            node.status = 'complete';
            log(`node:status — ${node.step.name}: complete (audio only, no images)`);
            narrate(`\u{2705} **Narration audio ready** but image generation failed. Script provided as text.`);
          } else {
            // No images, no audio — return complete markdown script
            const script = buildScriptMarkdown(scenes);
            const timestamps = buildTimestampedNarration(scenes);
            node.output = `**Video script** (image and audio generation unavailable):\n\n${script}\n\n---\n\n**Timing:**\n\`\`\`\n${timestamps}\n\`\`\``;
            node.outputType = 'text';
            node.status = 'complete';
            log(`node:status — ${node.step.name}: complete (text script only — no images or audio)`);
            narrate(`\u{2705} **Video script created** as text document (image/audio backends unavailable)`);
          }

          syncState();
          assembler.cleanup();
        } catch (err: any) {
          log(`Slideshow video failed: ${err.message}`);
          narrate(`\u{26A0}\u{FE0F} **Slideshow video failed**: ${err.message}. Continuing pipeline.`);
          node.status = 'error';
          node.error = err.message;
          node.output = `[Slideshow video failed: ${err.message}]`;
          syncState();
        }
        return;
      }

      if (template === 'narrator') {
        if (!capabilities.tts) {
          narrate(`\u{26A0}\u{FE0F} **Text-to-speech not available.** Skipping "${node.step.name}". Configure OPENAI_API_KEY, ELEVENLABS_API_KEY, FAL_API_KEY, or NOSANA_API_KEY.`);
          node.status = 'skipped';
          node.output = '[TTS not configured — step skipped]';
          node.outputType = 'text';
          syncState();
          return;
        }
        try {
          node.status = 'processing';
          syncState('executing');
          narrate(`\u{1F50A} **${node.step.name}** generating audio narration...`);

          // Get the ACTUAL SCRIPT from parent node — NOT the task instruction
          let textToSpeak = '';
          const parentIds = getDependencies(node.step);
          for (const depId of parentIds) {
            const parentNode = nodes.find(n => n.step.id === depId);
            if (parentNode?.output && parentNode.output.length > 20) {
              textToSpeak = parentNode.output;
              break;
            }
          }
          // Fallback: strip common instruction prefixes from task
          if (!textToSpeak || textToSpeak.length < 10) {
            textToSpeak = node.step.task
              .replace(/^(Convert|Generate|Create|Produce|Read|Narrate)\s+.*?(script|text|narration|audio)\s*(about|for|on|from)?\s*/i, '')
              .trim() || node.step.task;
          }
          log(`Narrator TTS input: "${textToSpeak.slice(0, 100)}..." (${textToSpeak.length} chars from ${parentIds.length > 0 ? 'parent output' : 'task'})`);

          const ttsResult = await generateTTS(textToSpeak);
          if (ttsResult) {
            const audioId = `audio-${Date.now()}`;
            const audioUrl = storeMediaBuffer(audioId, ttsResult.audio, ttsResult.mimeType);
            node.output = inputText;
            node.outputType = 'audio';
            node.outputUrls = [audioUrl];
            (node as any).metadata = {
              timestamps: ttsResult.timestamps,
              provider: ttsResult.provider,
              durationMs: ttsResult.durationMs,
            };
            node.status = 'complete';
            log(`node:status — ${node.step.name}: complete (${ttsResult.provider}, ${ttsResult.durationMs}ms, ${ttsResult.timestamps.length} words)`);
            syncState();
          } else {
            node.output = inputText;
            node.outputType = 'text';
            node.status = 'complete';
            log(`node:status — ${node.step.name}: complete (text-only, no TTS available)`);
            syncState();
          }
        } catch (err: any) {
          narrate(`\u{26A0}\u{FE0F} **TTS generation failed** for "${node.step.name}": ${err.message}. Continuing pipeline.`);
          node.status = 'error';
          node.error = err.message;
          node.output = `[TTS generation failed: ${err.message}]`;
          syncState();
        }
        return;
      }
    };

    // 2a. PRE-BOOT: Deploy ALL GPU workers from all depth levels simultaneously
    const allGpuWorkers = nodes.filter(n => !DIRECT_EXECUTION_TEMPLATES.includes(n.step.template));
    if (allGpuWorkers.length > 0) {
      log(`Pre-booting ${allGpuWorkers.length} workers in parallel across all depth levels...`);
      narrate(`\u{1F680} **Deploying ${allGpuWorkers.length} agents simultaneously** across Nosana GPU network...`);

      await Promise.allSettled(
        allGpuWorkers.map(async (node) => {
          try {
            await deployOne(node);
            await waitReady(node);
          } catch (err: any) {
            log(`Pre-boot failed for ${node.step.name}: ${err.message}`);
          }
        })
      );

      const booted = allGpuWorkers.filter(n => n.status === 'ready').length;
      const failed = allGpuWorkers.filter(n => n.status === 'error').length;
      log(`Pre-boot complete: ${booted} ready, ${failed} failed out of ${allGpuWorkers.length}`);
      if (booted > 0) {
        narrate(`\u{2705} **${booted} agents ready** — executing pipeline...`);
      }
    }

    // 2b. Execute level by level — workers are already booted, execute immediately
    for (let depth = 0; depth <= maxDepth; depth++) {
      // Check for abort before each depth level
      if (isAborted()) {
        log('Mission aborted by user');
        narrate('\u{1F6D1} **Mission aborted.** Stopping all agents...');
        for (const n of nodes) {
          if (n.status === 'pending' || n.status === 'deploying' || n.status === 'processing') {
            n.status = 'skipped';
            n.output = '[Mission aborted by user]';
          }
        }
        syncState();
        break;
      }

      const levelStepIds = levels.get(depth) || [];
      const levelNodes = levelStepIds.map(id => nodes.find(n => n.step.id === id)!).filter(Boolean);

      log(`level:${depth} — ${levelNodes.length} agent(s): ${levelNodes.map(n => n.step.name).join(', ')}`);

      // Split into text (need worker) and multimodal (direct execution)
      const textNodes = levelNodes.filter(n => !DIRECT_EXECUTION_TEMPLATES.includes(n.step.template));
      const multimodalNodes = levelNodes.filter(n => DIRECT_EXECUTION_TEMPLATES.includes(n.step.template));

      // Deploy text nodes — skip if already pre-booted
      if (textNodes.length > 0) {
        const needDeploy = textNodes.filter(n => n.status !== 'ready' && n.status !== 'error');
        if (needDeploy.length > 0) {
          // Check credits before deploying stragglers
          if (marketCost && marketCost > 0) {
            try {
              const credits = await manager.getCreditsBalance();
              const minRequired = marketCost * (5 / 60) * needDeploy.length;
              if (credits && credits.balance < minRequired) {
                narrate(
                  `\u{26A0}\u{FE0F} **Insufficient credits** ($${credits.balance.toFixed(3)} remaining). ` +
                  `Need ~$${minRequired.toFixed(3)} for ${needDeploy.length} agent(s). ` +
                  `Delivering partial results. Top up at deploy.nosana.com.`
                );
                for (const n of needDeploy) {
                  n.status = 'skipped';
                  n.output = '[Skipped: insufficient credits]';
                }
                syncState();
                if (textNodes.every(n => n.status === 'skipped' || n.status === 'error')) continue;
              }
            } catch { /* don't block on API errors */ }
          }

          for (const n of needDeploy) {
            narrate(`\u{1F680} Deploying **${n.step.name}** to ${marketName} ($${marketCost?.toFixed(3)}/hr)...`);
          }
          await Promise.all(needDeploy.map(n => deployOne(n)));
          await Promise.all(needDeploy.map(n => waitReady(n)));
        }
      }

      // Execute multimodal nodes directly (no deployment)
      if (multimodalNodes.length > 0) {
        for (const n of multimodalNodes) {
          log(`node:status — ${n.step.name}: direct execution (${n.step.template})`);
        }
        await Promise.all(multimodalNodes.map(n => executeMultimodal(n)));
      }

      // Execute text nodes that are ready
      const readyNodes = textNodes.filter(n => n.status === 'ready');
      const allExecuting = [...readyNodes];
      if (allExecuting.length > 0) {
        if (allExecuting.length > 1) {
          narrate(
            `\u{26A1} **${allExecuting.length} agents working in parallel** on separate Nosana GPUs:\n` +
            allExecuting.map(n => `\u2022 ${n.step.name}`).join('\n')
          );
        } else {
          const templateIcons: Record<string, string> = { researcher: '\u{1F50D}', writer: '\u{270D}\u{FE0F}', analyst: '\u{1F4CA}', monitor: '\u{1F441}\u{FE0F}', publisher: '\u{1F4E2}', 'scene-writer': '\u{1F3AC}' };
          const icon = templateIcons[allExecuting[0].step.template] || '\u{1F916}';
          narrate(`${icon} **${allExecuting[0].step.name}** is working...`);
        }

        const levelStart = Date.now();
        await Promise.all(allExecuting.map(n => executeOne(n)));
        const levelElapsed = Math.round((Date.now() - levelStart) / 1000);

        // Narrate level completion
        const completedNames = allExecuting.filter(n => n.status === 'complete').map(n => n.step.name);
        if (completedNames.length > 0) {
          narrate(`\u{2705} ${completedNames.join(', ')} complete (${levelElapsed}s)`);
        }
      }

      // Narrate completion for multimodal nodes too
      const mmCompleted = multimodalNodes.filter(n => n.status === 'complete').map(n => n.step.name);
      if (mmCompleted.length > 0 && readyNodes.length === 0) {
        narrate(`\u{2705} ${mmCompleted.join(', ')} complete`);
      }

      // Narrate intermediate cost
      const elapsedHrs = (Date.now() - startTime) / 3_600_000;
      const currentCost = (marketCost || 0) * textNodes.length * elapsedHrs;
      if (currentCost > 0.0001 && depth < maxDepth) {
        narrate(`\u{1F4B0} Mission cost so far: $${currentCost.toFixed(4)}`);
      }
    }

    // 3. Check if all steps failed (skipped doesn't count as failed)
    if (nodes.every(n => n.status === 'error' || n.status === 'skipped')) {
      for (const node of nodes) {
        if (node.deploymentId) {
          try { await manager.stopDeployment(node.deploymentId); } catch (e) { log(`Cleanup stop failed for ${node.step.name}: ${e}`); }
        }
      }
      // Stop dynamically deployed media services on error path too
      try { await manager.stopAllMediaServices(); } catch { /* best effort */ }

      currentPipelineState = { ...currentPipelineState, status: 'error', completedAt: Date.now() };
      syncState('error');

      const errorOutput = nodes.map(n => n.error).filter(Boolean).join('; ');
      missionHistory.unshift({
        id: missionId, mission, status: 'error', stepsCount: nodes.length,
        stepsComplete: nodes.filter(n => n.status === 'complete').length,
        stepsFailed: nodes.filter(n => n.status === 'error').length,
        stepsSkipped: nodes.filter(n => n.status === 'skipped').length,
        finalOutput: errorOutput,
        finalOutputPreview: errorOutput.slice(0, 100),
        startedAt: startTime, completedAt: Date.now(), totalTime: Date.now() - startTime,
        estimatedCost: (marketCost || 0) * nodes.filter(n => n.deploymentId).length * ((Date.now() - startTime) / 3_600_000),
        steps: snapshotSteps(nodes, depthInfo),
      });
      if (missionHistory.length > MAX_HISTORY) missionHistory.pop();

      throw new Error(`All pipeline steps failed: ${nodes.map(n => `${n.step.name}: ${n.error}`).join('; ')}`);
    }

    // 4. Attempt media assembly if we have images + scene data
    let assembledMediaUrl: string | null = null;
    const imageNodes = nodes.filter(n => n.step.template === 'image-generator' && n.status === 'complete');
    const sceneWriterNode = nodes.find(n => n.step.template === 'scene-writer' && n.status === 'complete');
    const narratorNode = nodes.find(n => n.step.template === 'narrator' && n.status === 'complete');

    if (imageNodes.length >= 2 && sceneWriterNode) {
      try {
        narrate('\u{1F3AC} **Assembling final video** from generated scenes...');
        const assembler = new MediaAssembler();

        let sceneTimings: Array<{ sceneNumber: number; durationSeconds: number; title: string }>;
        try {
          const cleaned = sceneWriterNode.output!.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          const parsed = JSON.parse(cleaned);
          if (!Array.isArray(parsed)) throw new Error('Scene data is not an array');
          sceneTimings = parsed;
        } catch (parseErr: any) {
          log(`Scene writer output is not valid JSON (${parseErr.message}), using default timings`);
          narrate('\u{26A0}\u{FE0F} Scene writer output was not structured — using default timings for assembly.');
          sceneTimings = imageNodes.map((_, i) => ({ sceneNumber: i + 1, durationSeconds: 8, title: `Scene ${i + 1}` }));
        }

        const sceneMedias: Array<{ sceneNumber: number; imagePath: string; durationSeconds: number; title: string }> = [];
        for (let i = 0; i < imageNodes.length; i++) {
          const node = imageNodes[i];
          const sceneInfo = sceneTimings[i] || { sceneNumber: i + 1, durationSeconds: 8, title: `Scene ${i + 1}` };
          const source = node.outputUrls?.[0] || node.output || '';
          if (!source) continue;
          try {
            const imagePath = await assembler.downloadMedia(source, `scene-${sceneInfo.sceneNumber}.png`);
            sceneMedias.push({ sceneNumber: sceneInfo.sceneNumber, imagePath, durationSeconds: sceneInfo.durationSeconds, title: sceneInfo.title });
          } catch (dlErr: any) {
            log(`Failed to download scene ${sceneInfo.sceneNumber} image: ${dlErr.message}`);
          }
        }

        let audioPath: string | null = null;
        if (narratorNode?.outputUrls?.[0]) {
          try { audioPath = await assembler.downloadMedia(narratorNode.outputUrls[0], 'narration.mp3'); } catch { /* ignore */ }
        }

        if (sceneMedias.length >= 2) {
          const videoPath = await assembler.assembleSlideshow(sceneMedias, audioPath);
          if (videoPath.endsWith('.mp4')) {
            const videoId = `video-${Date.now()}`;
            const { readFileSync: readFs } = await import('fs');
            assembledMediaUrl = storeMediaBuffer(videoId, readFs(videoPath), 'video/mp4');
            narrate(`\u{2705} **Video assembled!** ${sceneMedias.length} scenes${audioPath ? ', with narration' : ''}`);
          }
        }
        // Clean up temp files after storing the result
        assembler.cleanup();
      } catch (err: any) {
        log(`Media assembly failed: ${err.message}`);
        narrate(`\u{26A0}\u{FE0F} Video assembly failed: ${err.message}. Returning individual outputs.`);
      }
    }

    // 4b. Determine final output from leaf nodes (nodes nothing else depends on)
    const allDepTargets = new Set(steps.flatMap(s => getDependencies(s)));
    const leafNodes = nodes.filter(n => !allDepTargets.has(n.step.id) && n.output && n.status !== 'skipped');

    console.log('[AgentForge:Debug] leafNodes:', leafNodes.map(n => ({
      name: n.step.name, template: n.step.template, outputType: n.outputType, outputLen: n.output?.length,
    })));

    let finalOutput: string;

    // If we assembled a video, lead with that
    if (assembledMediaUrl) {
      const textLeaves = leafNodes.filter(n => n.outputType === 'text' || !n.outputType);
      const textContent = textLeaves.length > 0 ? textLeaves[textLeaves.length - 1].output! : '';
      finalOutput = `[Watch Video](${assembledMediaUrl})\n\n${textContent}`.trim();
    } else if (leafNodes.length >= 1) {
      // Use the last text leaf node; fall back to the last leaf of any type
      const textLeaves = leafNodes.filter(n => n.outputType === 'text' || !n.outputType);
      finalOutput = textLeaves.length > 0
        ? textLeaves[textLeaves.length - 1].output!
        : leafNodes[leafNodes.length - 1].output!;
    } else {
      const completed = nodes.filter(n => n.output && n.status !== 'skipped');
      finalOutput = completed.length > 0 ? completed[completed.length - 1].output! : 'Mission produced no output.';
    }

    // 5. Cleanup (parallel to minimize credit burn during shutdown)
    narrate(`\u{1F3C1} All agents complete \u2014 stopping ${nodes.filter(n => n.deploymentId).length} deployments to save credits...`);
    log('Cleaning up mission agents...');
    await Promise.allSettled(
      nodes
        .filter(n => n.deploymentId)
        .map(async n => {
          try { await manager.stopDeployment(n.deploymentId!); log(`Stopped ${n.step.name}`); }
          catch (e) { log(`Failed to stop ${n.step.name} during cleanup: ${e}`); }
        })
    );
    // Stop dynamically deployed media services
    try { await manager.stopAllMediaServices(); log('Media services stopped'); } catch (e) { log(`Media service cleanup failed: ${e}`); }
    // Reset shared image generation state for next mission
    try { const { resetNosanaImageState } = await import('./imageGenRouter.js'); resetNosanaImageState(); } catch { /* best effort */ }
    // Evict expired media to prevent unbounded memory growth
    clearExpiredMedia();

    const totalTime = Date.now() - startTime;
    const completedCount = nodes.filter(n => n.status === 'complete').length;
    const skippedCount = nodes.filter(n => n.status === 'skipped').length;
    log(`mission:complete — ${totalTime}ms, ${completedCount}/${nodes.length} steps succeeded${skippedCount > 0 ? `, ${skippedCount} skipped` : ''}`);

    currentPipelineState = {
      ...currentPipelineState,
      status: 'complete',
      finalOutput,
      completedAt: Date.now(),
    };
    syncState('complete');

    missionHistory.unshift({
      id: missionId, mission, status: 'complete', stepsCount: nodes.length,
      stepsComplete: completedCount,
      stepsFailed: nodes.filter(n => n.status === 'error').length,
      stepsSkipped: skippedCount,
      finalOutput,
      finalOutputPreview: finalOutput.slice(0, 100),
      startedAt: startTime, completedAt: Date.now(), totalTime,
      estimatedCost: (marketCost || 0) * nodes.filter(n => n.deploymentId).length * (totalTime / 3_600_000),
      steps: snapshotSteps(nodes, depthInfo),
    });
    if (missionHistory.length > MAX_HISTORY) missionHistory.pop();

    return { success: nodes.some(n => n.status === 'complete'), steps: nodes, finalOutput, totalTime };
  }
}
