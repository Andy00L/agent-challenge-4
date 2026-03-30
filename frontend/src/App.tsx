import { useEffect, useState } from 'react';
import { ChatPanel } from './components/ChatPanel';
import { FleetDashboard } from './components/FleetDashboard';
import { MissionCanvas } from './components/canvas/MissionCanvas';
import { startFleetPolling } from './lib/fleetPoller';
import { startMissionPoller, stopMissionPoller } from './lib/missionPoller';
import { useMissionStore } from './stores/missionStore';
import { useFleetStore } from './stores/fleetStore';
import { ErrorBoundary } from './components/ErrorBoundary';

type Tab = 'fleet' | 'mission';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('fleet');
  const missionStatus = useMissionStore(s => s.status);
  const deployments = useFleetStore(s => s.deployments);

  useEffect(() => {
    const interval = startFleetPolling();
    startMissionPoller();
    return () => {
      clearInterval(interval);
      stopMissionPoller();
    };
  }, []);

  // Auto-switch to mission tab when a mission starts
  useEffect(() => {
    if (missionStatus !== 'idle') {
      setActiveTab('mission');
    }
  }, [missionStatus]);

  return (
    <ErrorBoundary>
    <div className="flex h-screen bg-zinc-950 text-zinc-200">
      <div className="w-[35%] border-r border-zinc-800">
        <ChatPanel />
      </div>
      <div className="flex-1 flex flex-col">
        {/* Tabs */}
        <div className="flex border-b border-zinc-800 shrink-0">
          <button
            onClick={() => setActiveTab('fleet')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'fleet'
                ? 'text-white border-b-2 border-purple-500'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Fleet ({deployments.length})
          </button>
          <button
            onClick={() => setActiveTab('mission')}
            className={`px-4 py-2 text-sm font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'mission'
                ? 'text-white border-b-2 border-blue-500'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Mission
            {missionStatus !== 'idle' && (
              <span className={`inline-block w-2 h-2 rounded-full ${
                missionStatus === 'executing' ? 'bg-blue-500 animate-pulse' :
                missionStatus === 'complete' ? 'bg-green-500' :
                missionStatus === 'error' ? 'bg-red-500' :
                'bg-amber-500 animate-pulse'
              }`} />
            )}
          </button>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'fleet' ? <FleetDashboard /> : <MissionCanvas />}
        </div>
      </div>
    </div>
    </ErrorBoundary>
  );
}
