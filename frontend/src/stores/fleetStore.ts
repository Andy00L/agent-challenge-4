import { create } from 'zustand';

export interface DeploymentInfo {
  id: string;
  name: string;
  status: string;
  market: string;
  marketAddress?: string;
  replicas: number;
  costPerHour: number;
  startedAt: string;
  url?: string;
  agentTemplate?: string;
}

export interface AgentActivity {
  status: string;
  agentName: string;
  messages: Array<{ text: string; sender: string; timestamp: string }>;
  lastFetched: number;
}

interface FleetStore {
  deployments: DeploymentInfo[];
  totalCostPerHour: number;
  totalSpent: number;
  creditsBalance: number | null;
  agentActivity: Record<string, AgentActivity>;
  setDeployments: (deps: DeploymentInfo[]) => void;
  setTotalSpent: (spent: number) => void;
  setCreditsBalance: (balance: number | null) => void;
  fetchActivity: (deploymentId: string) => Promise<void>;
}

export const useFleetStore = create<FleetStore>((set) => ({
  deployments: [],
  totalCostPerHour: 0,
  totalSpent: 0,
  creditsBalance: null,
  agentActivity: {},
  setDeployments: (deps) =>
    set({
      deployments: deps,
      totalCostPerHour: deps
        .filter((d) => d.status === 'running')
        .reduce((sum, d) => sum + d.costPerHour, 0),
    }),
  setTotalSpent: (spent) => set({ totalSpent: spent }),
  setCreditsBalance: (balance) => set({ creditsBalance: balance }),
  fetchActivity: async (deploymentId) => {
    try {
      const res = await fetch(`/fleet/${deploymentId}/activity`);
      if (res.ok) {
        const data = await res.json();
        set((state) => ({
          agentActivity: {
            ...state.agentActivity,
            [deploymentId]: { ...data, lastFetched: Date.now() },
          },
        }));
      }
    } catch {}
  },
}));
