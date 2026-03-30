import { useEffect } from 'react';
import { ChatPanel } from './components/ChatPanel';
import { FleetDashboard } from './components/FleetDashboard';
import { startFleetPolling } from './lib/fleetPoller';

export default function App() {
  useEffect(() => {
    const interval = startFleetPolling();
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-200">
      <div className="w-[42%] border-r border-zinc-800">
        <ChatPanel />
      </div>
      <div className="flex-1">
        <FleetDashboard />
      </div>
    </div>
  );
}
