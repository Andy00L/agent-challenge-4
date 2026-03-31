import { useState, useEffect } from 'react';
import { Activity, Cpu, Server, DollarSign, ExternalLink, Square, ChevronDown, ChevronUp, LayoutGrid, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { useFleetStore, type DeploymentInfo, type AgentActivity } from '../stores/fleetStore';

const TEMPLATE_DESCRIPTIONS: Record<string, string> = {
  researcher: 'Searches the web, analyzes findings, provides summaries',
  writer: 'Creates blog posts, social media content, marketing copy',
  monitor: 'Watches sources for updates, alerts on changes',
  publisher: 'Manages social media posts and engagement',
  analyst: 'Analyzes data, identifies trends, generates insights',
};

function formatUptime(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'running' ? 'bg-green-400 ring-2 ring-green-400/20' :
    status === 'starting' ? 'bg-amber-400 animate-pulse ring-2 ring-amber-400/20' :
    status === 'error' ? 'bg-red-400 ring-2 ring-red-400/20' :
    'bg-zinc-500';
  return <div className={`w-2.5 h-2.5 rounded-full ${color}`} />;
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card className="border border-zinc-700/50"><CardContent className="px-4 py-3">
      <div className="flex items-center gap-2 text-zinc-500 mb-1">
        {icon}
        <span className="text-xs uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-xl font-semibold text-zinc-100">{value}</div>
    </CardContent></Card>
  );
}

function ActivityPanel({ activity }: { activity: AgentActivity | undefined }) {
  if (!activity) return <p className="text-xs text-zinc-600">Loading activity...</p>;

  if (activity.status === 'active' && activity.messages.length > 0) {
    return (
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {activity.messages.slice(0, 10).map((msg, i) => (
          <div key={i} className="text-xs">
            <span className={`font-medium ${
              msg.sender === activity.agentName ? 'text-violet-400' : 'text-zinc-400'
            }`}>
              {msg.sender}:
            </span>
            <span className="text-zinc-300 ml-1">
              {msg.text.length > 150 ? msg.text.slice(0, 150) + '...' : msg.text}
            </span>
            <span className="text-zinc-600 ml-1 text-[10px]">
              {new Date(msg.timestamp).toLocaleTimeString()}
            </span>
          </div>
        ))}
      </div>
    );
  }

  if (activity.status === 'unreachable' || activity.status === 'no_url') {
    return <p className="text-xs text-amber-400">Agent is starting up or unreachable...</p>;
  }

  return <p className="text-xs text-zinc-500">No activity yet. Send a message to the agent to get started.</p>;
}

function AgentCard({ dep, expanded, onToggle }: { dep: DeploymentInfo; expanded: boolean; onToggle: () => void }) {
  const activity = useFleetStore(s => s.agentActivity[dep.id]);
  const fetchActivity = useFleetStore(s => s.fetchActivity);

  useEffect(() => {
    if (!expanded) return;
    fetchActivity(dep.id);
    const interval = setInterval(() => fetchActivity(dep.id), 10_000);
    return () => clearInterval(interval);
  }, [expanded, dep.id, fetchActivity]);

  const agentUrl = dep.url ? (dep.url.startsWith('http') ? dep.url : `https://${dep.url}`) : null;

  return (
    <Card className="border border-zinc-700/50 bg-zinc-900/50 hover:bg-accent/30 transition-colors"><CardContent className="p-4">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2.5">
          <StatusDot status={dep.status} />
          <div>
            <div className="text-sm font-semibold text-zinc-100">{dep.name}</div>
            <div className="text-xs text-zinc-500">
              {TEMPLATE_DESCRIPTIONS[dep.agentTemplate || ''] || dep.agentTemplate || 'custom'}
            </div>
          </div>
        </div>
        <Badge variant={dep.status === 'running' ? 'default' : dep.status === 'error' ? 'destructive' : 'secondary'}>
          {dep.status}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs mb-3">
        <div>
          <span className="text-zinc-500">Market</span>
          <div className="text-zinc-300">{dep.market}</div>
        </div>
        <div>
          <span className="text-zinc-500">Replicas</span>
          <div className="text-zinc-300">{dep.replicas}</div>
        </div>
        <div>
          <span className="text-zinc-500">Cost</span>
          <div className="text-zinc-300">${dep.costPerHour.toFixed(3)}/hr</div>
        </div>
        <div>
          <span className="text-zinc-500">Uptime</span>
          <div className="text-zinc-300">{dep.status === 'running' ? formatUptime(dep.startedAt) : '\u2014'}</div>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-2">
        {dep.status === 'running' && agentUrl && (
          <Button variant="ghost" size="sm" render={<a href={agentUrl} target="_blank" rel="noopener noreferrer" />}>
            <ExternalLink className="w-3 h-3" />
            Open Agent
          </Button>
        )}
        {dep.status === 'stopped' && (
          <Button variant="ghost" size="sm" render={<a href={`https://deploy.nosana.com/deployments/${dep.id}`} target="_blank" rel="noopener noreferrer" />}>
            <ExternalLink className="w-3 h-3" />
            View on Nosana
          </Button>
        )}
        {dep.status === 'running' && (
          <Button variant="ghost" size="sm" onClick={onToggle}>
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? 'Hide Activity' : 'Show Activity'}
          </Button>
        )}
      </div>

      {expanded && (
        <>
          <Separator className="my-2" />
          <div className="pt-1">
            <h4 className="text-xs font-semibold text-zinc-400 uppercase mb-2">Recent Activity</h4>
            <ActivityPanel activity={activity} />
          </div>
        </>
      )}

      <Separator className="my-2" />
      <div className="flex gap-2">
        <span className="text-[10px] uppercase tracking-wider text-zinc-600 bg-zinc-800/50 rounded px-2 py-1">
          ID: {dep.id.slice(0, 16)}...
        </span>
      </div>
    </CardContent></Card>
  );
}

export function FleetDashboard() {
  const { deployments, totalCostPerHour, totalSpent, creditsBalance, markets } = useFleetStore();
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const activeCount = deployments.filter(d => d.status === 'running' || d.status === 'starting').length;
  const totalReplicas = deployments.filter(d => d.status === 'running').reduce((sum, d) => sum + d.replicas, 0);
  const premiumMarkets = markets
    .filter(m => m.type === 'PREMIUM' || !m.type)
    .sort((a, b) => a.pricePerHour - b.pricePerHour)
    .slice(0, 6);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-700/50 bg-zinc-900/40 shrink-0">
        <div className="flex items-center gap-2">
          <Server className="w-5 h-5 text-violet-400" />
          <span className="text-sm font-semibold text-zinc-100">Agent Fleet</span>
          <span className="text-xs text-zinc-500">({deployments.length})</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span className="cost-counter">${totalCostPerHour.toFixed(3)}/hr</span>
          <span className="text-zinc-700">|</span>
          <span>Spent: <span className="cost-counter">${totalSpent.toFixed(3)}</span></span>
          {creditsBalance !== null && (
            <>
              <span className="text-zinc-700">|</span>
              <span>Credits: <span className="text-green-400 cost-counter">${creditsBalance.toFixed(2)}</span></span>
            </>
          )}
        </div>
      </div>

      {/* Section 1: Fleet Overview */}
      <div className="shrink-0 px-5 pt-4 mb-4">
        <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <LayoutGrid className="w-3.5 h-3.5" />
          Fleet Overview
        </h3>
        <div className="grid grid-cols-4 gap-3">
          <StatCard icon={<Activity className="w-3.5 h-3.5" />} label="Agents" value={String(activeCount)} />
          <StatCard icon={<Server className="w-3.5 h-3.5" />} label="Replicas" value={String(totalReplicas)} />
          <StatCard icon={<Cpu className="w-3.5 h-3.5" />} label="GPUs" value={String(activeCount)} />
          <StatCard icon={<DollarSign className="w-3.5 h-3.5" />} label="Cost/hr" value={`$${totalCostPerHour.toFixed(3)}`} />
        </div>
      </div>

      <div className="px-5 shrink-0"><Separator className="my-4" /></div>

      {/* Section 2: GPU Markets */}
      {premiumMarkets.length > 0 && (
        <>
          <div className="shrink-0 px-5 mb-4">
            <Card className="border border-zinc-700/50">
              <CardHeader className="pb-0">
                <CardTitle className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5" />
                  Nosana GPU Markets
                  <span className="text-[10px] text-zinc-600 normal-case tracking-normal font-normal">(live pricing)</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="max-h-[200px] overflow-y-auto">
                <div className="grid grid-cols-3 gap-2">
                  {premiumMarkets.map((market) => (
                    <Tooltip key={market.address}>
                      <TooltipTrigger>
                        <Card className="hover:bg-accent/30 transition-colors cursor-default"><CardContent className="p-2.5">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] font-medium text-zinc-200 truncate">
                              {market.gpu || market.name}
                            </span>
                            {market.type === 'PREMIUM' && (
                              <Badge variant="secondary" className="text-[9px] shrink-0 ml-1">PREMIUM</Badge>
                            )}
                          </div>
                          <span className="text-sm font-semibold text-zinc-100 cost-counter">
                            ${market.pricePerHour.toFixed(3)}
                            <span className="text-[10px] text-zinc-500 font-normal">/hr</span>
                          </span>
                        </CardContent></Card>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{market.name}</p>
                        <p className="text-muted-foreground text-xs">{market.address.slice(0,16)}...</p>
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="px-5 shrink-0"><Separator className="my-4" /></div>
        </>
      )}

      {/* Section 3: Active Deployments */}
      <div className="shrink-0 px-5 pt-2 pb-2">
        <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center gap-2">
          <Users className="w-3.5 h-3.5" />
          Active Deployments
          <Badge variant="secondary" className="text-[10px]">{deployments.length}</Badge>
        </h3>
      </div>
      <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-3">
        {deployments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-12 h-12 rounded-xl bg-zinc-800/50 border border-zinc-700/30 flex items-center justify-center mb-4">
              <Square className="w-6 h-6 text-zinc-600" />
            </div>
            <p className="text-sm text-zinc-400 mb-1">No agents deployed</p>
            <p className="text-xs text-zinc-500">Use the chat to start a mission or deploy an agent</p>
          </div>
        ) : (
          deployments.map((dep) => (
            <AgentCard
              key={dep.id}
              dep={dep}
              expanded={expandedAgent === dep.id}
              onToggle={() => setExpandedAgent(expandedAgent === dep.id ? null : dep.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
