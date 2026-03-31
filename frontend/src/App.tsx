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
      <header className="h-12 flex items-center justify-between px-4 border-b bg-card/80 backdrop-blur-sm accent-border-bottom shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-500 flex items-center justify-center">
            <span className="text-white text-sm font-bold">&#x26A1;</span>
          </div>
          <div>
            <h1 className="text-sm font-semibold leading-none">AgentForge</h1>
            <p className="text-[10px] text-muted-foreground leading-none mt-0.5">Decentralized Agent Orchestration</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {creditsBalance !== null && (
            <Badge variant="outline" className="gap-1.5 font-normal">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
              <span className="cost-counter">${creditsBalance.toFixed(2)}</span>
              <span className="text-muted-foreground">credits</span>
            </Badge>
          )}
          <Badge variant="secondary" className="font-normal text-violet-400 bg-violet-950/30 border-violet-800/30">
            Powered by Nosana
          </Badge>
        </div>
      </header>

      {/* Main layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chat panel */}
        <div className="w-[35%] min-w-[340px] max-w-[480px] border-r flex flex-col bg-card/50">
          <ChatPanel />
        </div>

        {/* Right side with Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
          <div className="px-4 py-2 border-b shrink-0">
            <TabsList>
              <TabsTrigger value="mission" className="gap-1.5">
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
              <TabsTrigger value="fleet">
                Fleet ({deployments.length})
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="mission" className="flex-1 m-0 data-[state=inactive]:hidden">
            <MissionCanvas />
          </TabsContent>
          <TabsContent value="fleet" className="flex-1 m-0 overflow-hidden data-[state=inactive]:hidden">
            <FleetDashboard />
          </TabsContent>
        </Tabs>
      </div>
    </div>
    </TooltipProvider>
    </ErrorBoundary>
  );
}
