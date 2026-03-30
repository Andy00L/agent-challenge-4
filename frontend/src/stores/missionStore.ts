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
  dependsOn?: string | string[];
  depth?: number;
  parallelIndex?: number;
  parallelCount?: number;
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
      steps: data.steps ?? [],
      status: serverStatus,
      finalOutput: data.finalOutput ?? null,
      startedAt: data.startedAt ?? null,
      completedAt: data.completedAt ?? null,
      isActive: serverStatus !== 'idle' && serverStatus !== 'complete' && serverStatus !== 'error',
    });
  },

  reset: () => set({
    pipelineId: null, mission: null, steps: [], status: 'idle',
    finalOutput: null, startedAt: null, completedAt: null, isActive: false,
  }),
}));
