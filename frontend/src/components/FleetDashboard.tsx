import { useState, useEffect } from 'react';
import { Activity, Cpu, Server, DollarSign, ExternalLink, Square, ChevronDown, ChevronUp } from 'lucide-react';
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
    status === 'running' ? 'bg-green-500' :
    status === 'starting' ? 'bg-amber-500 animate-pulse' :
    status === 'error' ? 'bg-red-500' :
    'bg-zinc-500';
  return <div className={`w-2.5 h-2.5 rounded-full ${color}`} />;
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-zinc-900 rounded-xl px-4 py-3 border border-zinc-800">
      <div className="flex items-center gap-2 text-zinc-500 mb-1">
        {icon}
        <span className="text-xs uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-xl font-semibold text-zinc-100">{value}</div>
    </div>
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
              msg.sender === activity.agentName ? 'text-purple-400' : 'text-zinc-400'
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
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
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
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          dep.status === 'running' ? 'bg-green-900/50 text-green-400' :
          dep.status === 'starting' ? 'bg-amber-900/50 text-amber-400' :
          dep.status === 'error' ? 'bg-red-900/50 text-red-400' :
          'bg-zinc-800 text-zinc-400'
        }`}>
          {dep.status}
        </span>
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
          <a
            href={agentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            Open Agent
          </a>
        )}
        {dep.status === 'stopped' && (
          <a
            href={`https://deploy.nosana.com/deployments/${dep.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-300 transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            View on Nosana
          </a>
        )}
        {dep.status === 'running' && (
          <button
            onClick={onToggle}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? 'Hide Activity' : 'Show Activity'}
          </button>
        )}
      </div>

      {expanded && (
        <div className="pt-3 border-t border-zinc-800">
          <h4 className="text-xs font-semibold text-zinc-400 uppercase mb-2">Recent Activity</h4>
          <ActivityPanel activity={activity} />
        </div>
      )}

      <div className="flex gap-2 mt-2 pt-2 border-t border-zinc-800">
        <span className="text-[10px] uppercase tracking-wider text-zinc-600 bg-zinc-800 rounded px-2 py-1">
          ID: {dep.id.slice(0, 16)}...
        </span>
      </div>
    </div>
  );
}

export function FleetDashboard() {
  const { deployments, totalCostPerHour, totalSpent, creditsBalance } = useFleetStore();
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const activeCount = deployments.filter(d => d.status === 'running' || d.status === 'starting').length;
  const totalReplicas = deployments.filter(d => d.status === 'running').reduce((sum, d) => sum + d.replicas, 0);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <Server className="w-5 h-5 text-purple-400" />
          <span className="text-sm font-semibold text-zinc-100">Agent Fleet</span>
          <span className="text-xs text-zinc-500">({deployments.length})</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span>${totalCostPerHour.toFixed(3)}/hr</span>
          <span className="text-zinc-700">|</span>
          <span>Spent: ${totalSpent.toFixed(3)}</span>
          {creditsBalance !== null && (
            <>
              <span className="text-zinc-700">|</span>
              <span>Credits: <span className="text-green-400">${creditsBalance.toFixed(2)}</span></span>
            </>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 px-5 py-4">
        <StatCard icon={<Activity className="w-3.5 h-3.5" />} label="Agents" value={String(activeCount)} />
        <StatCard icon={<Server className="w-3.5 h-3.5" />} label="Replicas" value={String(totalReplicas)} />
        <StatCard icon={<Cpu className="w-3.5 h-3.5" />} label="GPUs" value={String(activeCount)} />
        <StatCard icon={<DollarSign className="w-3.5 h-3.5" />} label="Cost/hr" value={`$${totalCostPerHour.toFixed(3)}`} />
      </div>

      {/* Agent List */}
      <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-3">
        {deployments.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Square className="w-12 h-12 text-zinc-700 mb-3" />
            <h3 className="text-sm font-semibold text-zinc-400 mb-1">No agents deployed</h3>
            <p className="text-xs text-zinc-600 max-w-xs">
              Use the chat panel to create your first agent. Try: "Create a research agent that monitors AI papers"
            </p>
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
