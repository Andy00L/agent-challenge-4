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
    status === 'running' ? 'bg-green-500 ring-2 ring-green-500/20' :
    status === 'starting' ? 'bg-amber-400 animate-pulse ring-2 ring-amber-400/20' :
    status === 'error' ? 'bg-red-500 ring-2 ring-red-500/20' :
    'bg-gray-300';
  return <div className={`w-2.5 h-2.5 rounded-full ${color}`} />;
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card className="hover:shadow-sm transition-all duration-200"><CardContent className="px-5 py-4">
      <div className="flex items-center gap-2 text-muted-foreground mb-1.5">
        {icon}
        <span className="text-xs uppercase tracking-widest font-medium">{label}</span>
      </div>
      <div className="text-2xl font-bold text-foreground">{value}</div>
    </CardContent></Card>
  );
}

function ActivityPanel({ activity }: { activity: AgentActivity | undefined }) {
  if (!activity) return <p className="text-xs text-muted-foreground">Loading activity...</p>;

  if (activity.status === 'active' && activity.messages.length > 0) {
    return (
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {activity.messages.slice(0, 10).map((msg, i) => (
          <div key={i} className="text-xs">
            <span className={`font-medium ${
              msg.sender === activity.agentName ? 'text-blue-600' : 'text-muted-foreground'
            }`}>
              {msg.sender}:
            </span>
            <span className="text-foreground/80 ml-1">
              {msg.text.length > 150 ? msg.text.slice(0, 150) + '...' : msg.text}
            </span>
            <span className="text-muted-foreground ml-1 text-[10px]">
              {new Date(msg.timestamp).toLocaleTimeString()}
            </span>
          </div>
        ))}
      </div>
    );
  }

  if (activity.status === 'unreachable' || activity.status === 'no_url') {
    return <p className="text-xs text-amber-600">Agent is starting up or unreachable...</p>;
  }

  return <p className="text-xs text-muted-foreground">No activity yet. Send a message to the agent to get started.</p>;
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

  const agentUrl = dep.url
    ? (dep.url.startsWith('https://') || dep.url.startsWith('http://'))
      ? dep.url
      : `https://${dep.url}`
    : null;

  return (
    <Card className="hover:shadow-sm transition-all duration-200"><CardContent className="p-5">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <StatusDot status={dep.status} />
          <div>
            <div className="text-sm font-semibold text-foreground">{dep.name}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
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
          <span className="text-muted-foreground">Market</span>
          <div className="font-medium text-foreground">{dep.market}</div>
        </div>
        <div>
          <span className="text-muted-foreground">Replicas</span>
          <div className="font-medium text-foreground">{dep.replicas}</div>
        </div>
        <div>
          <span className="text-muted-foreground">Cost</span>
          <div className="font-medium text-foreground">${dep.costPerHour.toFixed(3)}/hr</div>
        </div>
        <div>
          <span className="text-muted-foreground">Uptime</span>
          <div className="font-medium text-foreground">{dep.status === 'running' ? formatUptime(dep.startedAt) : '\u2014'}</div>
        </div>
      </div>

      <div className="flex items-center gap-3 mt-3 pt-3 border-t">
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
          <Separator className="my-3" />
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Recent Activity</h4>
            <ActivityPanel activity={activity} />
          </div>
        </>
      )}

      <div className="mt-3 pt-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
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
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-white shrink-0">
        <div className="flex items-center gap-2">
          <Server className="w-5 h-5 text-muted-foreground" />
          <span className="text-lg font-semibold text-foreground">Agent Fleet</span>
          <span className="text-sm text-muted-foreground">({deployments.length})</span>
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="cost-counter">${totalCostPerHour.toFixed(3)}/hr</span>
          <span className="text-border">|</span>
          <span>Spent: <span className="cost-counter">${totalSpent.toFixed(3)}</span></span>
          {creditsBalance !== null && (
            <>
              <span className="text-border">|</span>
              <span>Credits: <span className="text-green-600 font-semibold cost-counter">${creditsBalance.toFixed(2)}</span></span>
            </>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
        {/* Section 1: Fleet Overview */}
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2">
            <LayoutGrid className="w-3.5 h-3.5" />
            Fleet Overview
          </h3>
          <div className="grid grid-cols-4 gap-4">
            <StatCard icon={<Activity className="w-3.5 h-3.5" />} label="Agents" value={String(activeCount)} />
            <StatCard icon={<Server className="w-3.5 h-3.5" />} label="Replicas" value={String(totalReplicas)} />
            <StatCard icon={<Cpu className="w-3.5 h-3.5" />} label="GPUs" value={String(activeCount)} />
            <StatCard icon={<DollarSign className="w-3.5 h-3.5" />} label="Cost/hr" value={`$${totalCostPerHour.toFixed(3)}`} />
          </div>
        </div>

        {/* Section 2: GPU Markets */}
        {premiumMarkets.length > 0 && (
          <div>
            <Card>
              <CardHeader className="pb-0">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-2">
                  <Cpu className="w-3.5 h-3.5" />
                  Nosana GPU Markets
                  <span className="text-[10px] text-muted-foreground normal-case tracking-normal font-normal">(live pricing)</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="max-h-[220px] overflow-y-auto">
                <div className="grid grid-cols-3 gap-3">
                  {premiumMarkets.map((market) => (
                    <Tooltip key={market.address}>
                      <TooltipTrigger>
                        <Card className="bg-muted hover:border-foreground/30 hover:shadow-sm hover:-translate-y-px transition-all duration-200 cursor-default"><CardContent className="p-3">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-medium text-foreground truncate">
                              {market.gpu || market.name}
                            </span>
                            {market.type === 'PREMIUM' && (
                              <Badge className="bg-primary text-primary-foreground text-[9px] shrink-0 ml-1 border-transparent uppercase tracking-wider font-semibold">PREMIUM</Badge>
                            )}
                          </div>
                          <span className="text-xl font-bold text-foreground cost-counter">
                            ${market.pricePerHour.toFixed(3)}
                            <span className="text-xs text-muted-foreground font-normal">/hr</span>
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
        )}

        {/* Section 3: Active Deployments */}
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-2 mb-3">
            <Users className="w-3.5 h-3.5" />
            Active Deployments
            <Badge className="bg-primary text-primary-foreground text-[10px] border-transparent">{deployments.length}</Badge>
          </h3>
          <div className="space-y-3">
            {deployments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-12 h-12 rounded-xl bg-muted border flex items-center justify-center mb-4 opacity-40">
                  <Square className="w-6 h-6 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-muted-foreground mb-1">No agents deployed</p>
                <p className="text-xs text-muted-foreground/70">Use the chat to start a mission or deploy an agent</p>
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
      </div>
    </div>
  );
}
