import { useEffect, useState } from 'react';
import { ChatPanel } from './components/ChatPanel';
import { FleetDashboard } from './components/FleetDashboard';
import { MissionCanvas } from './components/canvas/MissionCanvas';
import { startFleetPolling } from './lib/fleetPoller';
import { startMissionPoller, stopMissionPoller } from './lib/missionPoller';
import { useMissionStore } from './stores/missionStore';
import { useFleetStore } from './stores/fleetStore';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TooltipProvider } from '@/components/ui/tooltip';

export default function App() {
  const [activeTab, setActiveTab] = useState('fleet');
  const missionStatus = useMissionStore(s => s.status);
  const deployments = useFleetStore(s => s.deployments);
  const creditsBalance = useFleetStore(s => s.creditsBalance);

  useEffect(() => {
    const cleanupFleet = startFleetPolling();
    startMissionPoller();
    return () => {
      cleanupFleet();
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
    <TooltipProvider>
    <div className="h-screen flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="h-14 flex items-center justify-between px-5 border-b bg-white/80 backdrop-blur-sm shadow-xs sticky top-0 z-40 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shadow-sm">
            <span className="text-white text-sm font-bold">&#x26A1;</span>
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight leading-none text-foreground">AgentForge</h1>
            <p className="text-[10px] text-muted-foreground leading-none mt-0.5 tracking-wide">Decentralized Agent Orchestration</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {creditsBalance !== null && (
            <Badge variant="outline" className="gap-1.5 bg-green-50 border-green-200 text-green-700 font-semibold px-3 py-1 h-auto">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="cost-counter">${creditsBalance.toFixed(2)}</span>
              <span className="text-green-600/70 font-normal">credits</span>
            </Badge>
          )}
          <span className="text-xs text-muted-foreground hover:text-foreground/70 transition-colors cursor-default">
            Powered by Nosana
          </span>
        </div>
      </header>

      {/* Main layout */}
      <div className="flex-1 overflow-hidden min-h-0">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col min-h-0" style={{ background: 'none' }}>
          <div className="px-5 py-2.5 border-b bg-white shrink-0">
            <TabsList variant="line">
              <TabsTrigger value="mission" className="gap-1.5 px-4 py-2.5">
                Mission Canvas
                {missionStatus !== 'idle' && (
                  <span className={`inline-block w-2 h-2 rounded-full ${
                    missionStatus === 'executing' ? 'bg-blue-500 animate-pulse' :
                    missionStatus === 'complete' ? 'bg-green-500' :
                    missionStatus === 'error' ? 'bg-red-500' :
                    'bg-amber-500 animate-pulse'
                  }`} />
                )}
              </TabsTrigger>
              <TabsTrigger value="fleet" className="px-4 py-2.5">
                Fleet ({deployments.length})
              </TabsTrigger>
            </TabsList>
          </div>
          <div className="flex-1 relative overflow-hidden min-h-0 flex flex-col" style={{ background: 'none' }}>
            <TabsContent value="mission" className="flex-1 m-0 min-h-0 data-[state=inactive]:hidden" style={{ background: 'none' }}>
              <MissionCanvas />
            </TabsContent>
            <TabsContent value="fleet" className="flex-1 m-0 overflow-hidden data-[state=inactive]:hidden">
              <FleetDashboard />
            </TabsContent>
            {/* Chat overlay — only on Mission Canvas tab */}
            {activeTab === 'mission' && <ChatPanel />}
          </div>
        </Tabs>
      </div>
    </div>
    </TooltipProvider>
    </ErrorBoundary>
  );
}
