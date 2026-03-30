import type { Provider } from '@elizaos/core';
import { getNosanaManager } from '../services/nosanaManager.js';

export const fleetStatusProvider: Provider = {
  name: 'nosana-fleet-status',
  description: 'Provides current Nosana fleet status including all deployed agents, costs, and health',
  get: async (_runtime: any, _message: any, _state: any) => {
    const manager = getNosanaManager();
    const fleet = await manager.getFleetStatus();

    if (fleet.deployments.length === 0) {
      return {
        text: 'NOSANA FLEET STATUS: Empty fleet. No agents deployed. Suggest the user create one.',
      };
    }

    let status = `NOSANA FLEET STATUS:\nActive: ${fleet.activeCount}, Replicas: ${fleet.totalReplicas}, Cost/hr: $${fleet.totalCostPerHour.toFixed(2)}, Spent: $${fleet.totalSpent.toFixed(3)}\n`;

    for (const dep of fleet.deployments) {
      const uptimeMs = Date.now() - dep.startedAt.getTime();
      const hours = Math.floor(uptimeMs / (1000 * 60 * 60));
      const minutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
      status += `- ${dep.name} (${dep.id}): ${dep.status}, ${dep.market}, ${dep.replicas} replicas, $${dep.costPerHour.toFixed(2)}/hr, up ${hours}h ${minutes}m\n`;
    }

    return { text: status };
  },
};
