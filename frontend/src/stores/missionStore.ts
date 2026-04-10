import { create } from 'zustand';

export type NodeStatus = 'pending' | 'deploying' | 'deployed' | 'ready' | 'processing' | 'complete' | 'error' | 'stopped' | 'skipped';
export type PipelineStatus = 'idle' | 'planning' | 'deploying' | 'executing' | 'complete' | 'error';

export interface MissionWarning {
  type: 'missing_key' | 'fallback' | 'degraded';
  message: string;
  step?: string;
}

export interface PipelineStep {
  id: string;
  name: string;
  template: string;
  task: string;
  status: NodeStatus;
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
}

interface MissionState {
  pipelineId: string | null;
  mission: string | null;
  steps: PipelineStep[];
  warnings: MissionWarning[];
  status: PipelineStatus;
  finalOutput: string | null;
  startedAt: number | null;
  completedAt: number | null;
  isActive: boolean;
  isHistorical: boolean;

  updateFromServer: (data: any) => void;
  loadFromHistory: (data: any) => void;
  reset: () => void;
}

export const useMissionStore = create<MissionState>((set, get) => ({
  pipelineId: null,
  mission: null,
  steps: [],
  warnings: [],
  status: 'idle',
  finalOutput: null,
  startedAt: null,
  completedAt: null,
  isActive: false,
  isHistorical: false,

  updateFromServer: (data: any) => {
    if (!data) return;
    // Don't overwrite historical view with live polling data
    if (get().isHistorical) return;

    const serverStatus: PipelineStatus = data.status ?? 'idle';
    const localStatus = get().status;

    if (serverStatus === 'idle') {
      // Already idle — nothing to do
      if (localStatus === 'idle') return;
      // User viewing completed/errored results — preserve them
      if (localStatus === 'complete' || localStatus === 'error') return;
      // Active state (planning/deploying/executing) but backend says idle
      // → backend was reset externally, sync local state
    }

    set({
      pipelineId: data.id ?? null,
      mission: data.mission ?? null,
      steps: Array.isArray(data.steps) ? data.steps : [],
      warnings: Array.isArray(data.warnings) ? data.warnings : [],
      status: serverStatus,
      finalOutput: data.finalOutput ?? null,
      startedAt: data.startedAt ?? null,
      completedAt: data.completedAt ?? null,
      isActive: serverStatus !== 'idle' && serverStatus !== 'complete' && serverStatus !== 'error',
      isHistorical: false,
    });
  },

  loadFromHistory: (data: any) => {
    if (!data) return;
    set({
      pipelineId: data.id ?? null,
      mission: data.mission ?? null,
      steps: (Array.isArray(data.steps) ? data.steps : []).map((s: any) => ({
        ...s,
        outputPreview: s.output?.slice(0, 300),
      })),
      warnings: data.warnings ?? [],
      status: data.status === 'error' ? 'error' : 'complete',
      finalOutput: data.finalOutput ?? null,
      startedAt: data.startedAt ?? null,
      completedAt: data.completedAt ?? null,
      isActive: false,
      isHistorical: true,
    });
  },

  reset: () => set({
    pipelineId: null, mission: null, steps: [], warnings: [], status: 'idle',
    finalOutput: null, startedAt: null, completedAt: null, isActive: false,
    isHistorical: false,
  }),
}));
