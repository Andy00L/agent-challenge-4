import { create } from 'zustand';

export type NodeStatus = 'pending' | 'deploying' | 'deployed' | 'ready' | 'processing' | 'complete' | 'error' | 'stopped';
export type PipelineStatus = 'idle' | 'planning' | 'deploying' | 'executing' | 'complete' | 'error';

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
  error?: string;
  dependsOn?: string;
}

interface MissionState {
  pipelineId: string | null;
  mission: string | null;
  steps: PipelineStep[];
  status: PipelineStatus;
  finalOutput: string | null;
  startedAt: number | null;
  completedAt: number | null;
  isActive: boolean;

  updateFromServer: (data: any) => void;
  reset: () => void;
}

export const useMissionStore = create<MissionState>((set, get) => ({
  pipelineId: null,
  mission: null,
  steps: [],
  status: 'idle',
  finalOutput: null,
  startedAt: null,
  completedAt: null,
  isActive: false,

  updateFromServer: (data: any) => {
    if (!data) return;
    // Don't overwrite active state with stale idle
    if (data.status === 'idle' && get().status !== 'idle' && get().isActive) return;
    set({
      pipelineId: data.id ?? null,
      mission: data.mission ?? null,
      steps: data.steps ?? [],
      status: data.status ?? 'idle',
      finalOutput: data.finalOutput ?? null,
      startedAt: data.startedAt ?? null,
      completedAt: data.completedAt ?? null,
      isActive: !!data.status && data.status !== 'idle' && data.status !== 'complete' && data.status !== 'error',
    });
  },

  reset: () => set({
    pipelineId: null, mission: null, steps: [], status: 'idle',
    finalOutput: null, startedAt: null, completedAt: null, isActive: false,
  }),
}));
