export interface NosanaDeploymentRecord {
  id: string;
  name: string;
  status: 'draft' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error' | 'archived' | 'queued';
  market: string;
  marketAddress: string;
  replicas: number;
  costPerHour: number;
  startedAt: Date;
  url?: string;
  agentTemplate?: string;
  agentConfig?: Record<string, any>;
}

export interface FleetStatus {
  deployments: NosanaDeploymentRecord[];
  totalCostPerHour: number;
  totalReplicas: number;
  activeCount: number;
  totalSpent: number;
}

export interface GpuMarket {
  address: string;
  name: string;
  slug: string;
  gpu: string;
  pricePerHour: number;
  type?: string;
  nodesAvailable?: number;
}

// Fallback addresses (used only when API is unavailable)
export const GPU_MARKETS: Record<string, { address: string; name: string; estimatedCostPerHour: number }> = {
  'nvidia-3090': {
    address: '985pQEVPn7SL5os3Z2iNwBoX4f9Bva334dENweXWyt9t',
    name: 'NVIDIA RTX 3090',
    estimatedCostPerHour: 0.13,
  },
  'nvidia-4090': {
    address: '97G9NnvBDQ2WpKu6fasoMsAKmfj63C9rhysJnkeWodAf',
    name: 'NVIDIA RTX 4090',
    estimatedCostPerHour: 0.29,
  },
  'nvidia-4070': {
    address: 'EzuHhkrhmV98HWzREsgLenKj2iHdJgrKmzfL8psP8Aso',
    name: 'NVIDIA RTX 4070',
    estimatedCostPerHour: 0.09,
  },
  'nvidia-3080': {
    address: '7RepDm4Xt9k6qV5oiSHvi8oBoty4Q2tfBGnCYjFLj6vA',
    name: 'NVIDIA RTX 3080',
    estimatedCostPerHour: 0.09,
  },
  'nvidia-3060': {
    address: '62bAk2ppEL2HpotfPZsscSq4CGEfY6VEqD5dQQuTo7JC',
    name: 'NVIDIA RTX 3060',
    estimatedCostPerHour: 0.03,
  },
  'cpu-only': {
    address: '62bAk2ppEL2HpotfPZsscSq4CGEfY6VEqD5dQQuTo7JC',
    name: 'NVIDIA RTX 3060 (budget)',
    estimatedCostPerHour: 0.03,
  },
};

export const AGENT_TEMPLATES: Record<string, {
  name: string;
  plugins: string[];
  defaultPrompt: string;
  market: string;
}> = {
  researcher: {
    name: 'Research Agent',
    plugins: ['plugin-web-search', 'plugin-bootstrap', 'plugin-openai'],
    defaultPrompt: 'You are a research agent. Search the web for information, synthesize findings, and produce structured research reports. Focus on accuracy and cite sources.',
    market: 'nvidia-3090',
  },
  writer: {
    name: 'Content Writer',
    plugins: ['plugin-bootstrap', 'plugin-openai'],
    defaultPrompt: 'You are a content writer agent. Take research briefs or topics and produce high-quality written content — blog posts, summaries, reports, or social media copy.',
    market: 'cpu-only',
  },
  monitor: {
    name: 'Monitoring Agent',
    plugins: ['plugin-web-search', 'plugin-bootstrap', 'plugin-openai'],
    defaultPrompt: 'You are a monitoring agent. Periodically scan specified sources (websites, feeds, APIs) for new information matching specified criteria. Report findings immediately.',
    market: 'nvidia-3090',
  },
  publisher: {
    name: 'Social Publisher',
    plugins: ['plugin-bootstrap', 'plugin-openai'],
    defaultPrompt: 'You are a social publishing agent. Take content and publish it to configured social media channels with appropriate formatting, hashtags, and timing.',
    market: 'cpu-only',
  },
  analyst: {
    name: 'Data Analyst',
    plugins: ['plugin-web-search', 'plugin-bootstrap', 'plugin-openai'],
    defaultPrompt: 'You are a data analyst agent. Analyze datasets, generate insights, create summaries, and identify trends. Present findings clearly with supporting evidence.',
    market: 'nvidia-3090',
  },
  'scene-writer': {
    name: 'Scene Writer',
    plugins: ['plugin-bootstrap', 'plugin-openai'],
    defaultPrompt: 'You break content into individual visual scenes with detailed image descriptions. Output structured JSON.',
    market: 'cpu-only',
  },
  'image-generator': {
    name: 'Image Generator',
    plugins: [],
    defaultPrompt: 'Generate an image based on the description provided.',
    market: 'nvidia-3090',
  },
  'video-generator': {
    name: 'Video Generator',
    plugins: [],
    defaultPrompt: 'Generate a video based on the description provided.',
    market: 'nvidia-4090',
  },
  'narrator': {
    name: 'Narrator',
    plugins: [],
    defaultPrompt: 'Convert the provided text into narrated speech audio.',
    market: 'nvidia-3090',
  },
};
