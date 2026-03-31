import { useState, useRef, useEffect } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useChatStore } from '../stores/chatStore';
import {
  getAgents,
  startAgent,
  getOrCreateDmChannel,
  connectSocket,
  joinChannel,
  sendSocketMessage,
  onAgentMessage,
  disconnectSocket,
} from '../lib/elizaClient';
import { setFleetAgentId, pollFleetOnce } from '../lib/fleetPoller';
import { useMissionStore } from '../stores/missionStore';
import { renderMarkdown } from '../lib/markdown';

function enrichMessage(text: string): string {
  if (text.includes('Mission planned!') || text.includes('agents in pipeline')) {
    const agentCount = (text.match(/\d+\. \*\*/g) || []).length;
    if (agentCount > 0) {
      const estimate = agentCount * 0.048 * (5 / 60);
      text += `\n\n**Estimated cost:** ~$${estimate.toFixed(4)} (${agentCount} agents \u00D7 $0.048/hr \u00D7 ~5min)`;
    }
  }
  return text;
}

function isInternalMessage(text: string): boolean {
  return /^(Executing action:|Action:|(\[Action\]))/.test(text);
}

interface MissionHistoryEntry {
  id: string;
  mission: string;
  status: 'complete' | 'error';
  stepsCount: number;
  totalTime: number;
}

const MISSION_TEMPLATES = [
  {
    id: 'research',
    icon: '\u{1F50D}',
    title: 'Research Pipeline',
    description: 'Web research \u2192 analysis \u2192 report',
    badge: '3 agents',
    badgeColor: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    prompt: 'Research the latest developments in artificial intelligence and write me a comprehensive blog post',
  },
  {
    id: 'content',
    icon: '\u{270D}\u{FE0F}',
    title: 'Content Pipeline',
    description: 'Research \u2192 blog + script in parallel',
    badge: '4 agents \u00B7 parallel',
    badgeColor: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
    prompt: 'Research AI trends and write me a blog post AND a YouTube video script',
  },
  {
    id: 'competitive',
    icon: '\u{1F4CA}',
    title: 'Competitive Analysis',
    description: 'Parallel deep dives \u2192 comparison report',
    badge: '5 agents \u00B7 parallel',
    badgeColor: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    prompt: 'Run a multi-agent pipeline mission: research and compare CrewAI vs AutoGen vs ElizaOS. Research each framework, then write a competitive analysis report with comparison table.',
  },
  {
    id: 'quick',
    icon: '\u{26A1}',
    title: 'Quick Agent',
    description: 'Single agent, fast execution',
    badge: '1 agent',
    badgeColor: 'bg-green-500/20 text-green-400 border-green-500/30',
    prompt: 'Create a research agent that monitors Hacker News for AI papers',
  },
];

export function ChatPanel() {
  const { messages, isLoading, agentId, setAgentId, addMessage, setLoading } = useChatStore();
  const [input, setInput] = useState('');
  const [channelId, setChannelId] = useState<string | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const missionStatus = useMissionStore(s => s.status);
  const isMissionActive = missionStatus === 'deploying' || missionStatus === 'executing' || missionStatus === 'planning';
  const [history, setHistory] = useState<MissionHistoryEntry[]>([]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isMissionActive]);

  // Poll mission history
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await fetch('/fleet/mission/history');
        if (!res.ok) return;
        const ct = res.headers.get('content-type') ?? '';
        if (!ct.includes('application/json')) return;
        setHistory(await res.json());
      } catch {}
    };
    fetchHistory();
    const id = setInterval(fetchHistory, 10_000);
    return () => clearInterval(id);
  }, []);

  // Connect to agent on mount
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const agents = await getAgents();
        if (!mounted) return;
        if (agents.length === 0) {
          setStatus('disconnected');
          setErrorMsg('No agents found');
          return;
        }

        const agent = agents.find((a) => a.name === 'AgentForge') ?? agents[0];
        setAgentId(agent.id);
        setFleetAgentId(agent.id);

        if (agent.status !== 'active') {
          await startAgent(agent.id);
        }

        const chId = await getOrCreateDmChannel(agent.id);
        if (!mounted) return;
        setChannelId(chId);

        await connectSocket();
        if (!mounted) return;
        joinChannel(chId);

        setStatus('connected');
        setErrorMsg(null);
      } catch (err: any) {
        if (mounted) {
          setStatus('disconnected');
          setErrorMsg(err.message || 'Failed to connect to ElizaOS');
        }
      }
    })();

    return () => {
      mounted = false;
      disconnectSocket();
    };
  }, [setAgentId]);

  // Listen for agent responses via socket.io
  useEffect(() => {
    const unsub = onAgentMessage((msg) => {
      const text = msg.content;
      if (isInternalMessage(text)) return;
      addMessage({ role: 'assistant', text });
      setLoading(false);
      setTimeout(pollFleetOnce, 500);
    });
    return unsub;
  }, [addMessage, setLoading]);

  const handleSend = async (text?: string) => {
    const msg = text || input.trim();
    if (!msg || isLoading) return;

    setInput('');
    addMessage({ role: 'user', text: msg });
    setLoading(true);

    try {
      if (!channelId || !agentId) {
        addMessage({ role: 'assistant', text: 'Not connected to an agent yet. Please wait...' });
        setLoading(false);
        return;
      }

      sendSocketMessage(channelId, msg, agentId);

      setTimeout(() => {
        setLoading(false);
      }, 60_000);
    } catch (err: any) {
      addMessage({ role: 'assistant', text: `Error: ${err.message || 'Something went wrong'}` });
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const statusDotColor =
    status === 'connected' ? 'bg-green-500' :
    status === 'connecting' ? 'bg-amber-500 animate-pulse' :
    'bg-red-500';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-zinc-800/60 bg-zinc-900/60">
        <div className="relative">
          <img src="/assets/thinker.png" alt="AgentForge" className="w-9 h-9 rounded-full object-cover ring-2 ring-zinc-800" />
          <div className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ${statusDotColor} border-2 border-zinc-900`} />
        </div>
        <div>
          <div className="text-sm font-semibold text-zinc-100">AgentForge Chat</div>
          <div className="text-[11px] text-zinc-500">
            {status === 'connected' ? 'Connected' : status === 'connecting' ? 'Connecting...' : 'Disconnected'}
          </div>
        </div>
      </div>

      {/* Mission History */}
      {history.length > 0 && (
        <div className="px-4 py-2 border-b border-zinc-800/40 bg-zinc-900/30">
          <div className="text-[11px] font-medium text-zinc-600 uppercase tracking-wider mb-1">Recent Missions</div>
          <div className="space-y-0.5 max-h-28 overflow-y-auto">
            {history.slice(0, 5).map((h) => (
              <button
                key={h.id}
                onClick={() => handleSend(h.mission)}
                className="w-full text-left px-2 py-1 rounded hover:bg-zinc-800/50 transition-colors group flex items-center justify-between"
              >
                <span className="text-xs text-zinc-400 group-hover:text-zinc-200 truncate flex-1 mr-2">
                  {h.mission?.slice(0, 45)}{h.mission?.length > 45 ? '...' : ''}
                </span>
                <div className="flex items-center gap-2 shrink-0 text-[11px] text-zinc-600">
                  <span>{h.stepsCount}x</span>
                  <span>{Math.round((h.totalTime || 0) / 1000)}s</span>
                  <span className={h.status === 'complete' ? 'text-green-500' : 'text-red-500'}>
                    {h.status === 'complete' ? '\u2713' : '\u2717'}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {errorMsg && (
          <div className="text-center text-sm text-red-400 bg-red-950/30 rounded-lg px-4 py-3 border border-red-800/30">
            {errorMsg}. Make sure ElizaOS is running on port 3000.
          </div>
        )}

        {messages.length === 0 && !errorMsg && (
          <div className="flex flex-col items-center justify-center h-full gap-5 text-center px-4">
            <img src="/assets/thinker.png" alt="AgentForge" className="w-14 h-14 rounded-full object-cover ring-2 ring-zinc-800" />
            <div>
              <h2 className="text-lg font-semibold text-zinc-200 mb-1">What do you want to build?</h2>
              <p className="text-xs text-zinc-500">Choose a template or type your own mission</p>
            </div>
            <div className="grid grid-cols-1 gap-2.5 w-full max-w-md">
              {MISSION_TEMPLATES.map((t) => (
                <Card key={t.id} className="cursor-pointer hover:bg-accent/50 transition-colors group template-card" onClick={() => handleSend(t.prompt)}>
                  <CardContent className="p-3">
                    <div className="flex items-start gap-3">
                      <span className="text-xl mt-0.5 group-hover:scale-110 transition-transform">{t.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-zinc-200">{t.title}</span>
                          <Badge variant="secondary" className="text-[10px]">
                            {t.badge}
                          </Badge>
                        </div>
                        <p className="text-xs text-zinc-500">{t.description}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex message-enter ${msg.role === 'user' ? 'justify-end' : 'justify-start items-start gap-2'}`}>
            {msg.role === 'assistant' && (
              <Avatar className="w-7 h-7 shrink-0 mt-0.5"><AvatarFallback className="bg-primary/10 text-primary text-[10px]">AF</AvatarFallback></Avatar>
            )}
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground whitespace-pre-wrap'
                  : 'bg-muted border'
              }`}
            >
              {msg.role === 'user' ? (
                msg.text
              ) : (
                <div dangerouslySetInnerHTML={{ __html: renderMarkdown(enrichMessage(msg.text)) }} />
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start message-enter">
            <div className="bg-zinc-800/80 border border-zinc-700/30 rounded-2xl px-4 py-3 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
              <span className="text-sm text-zinc-400">Thinking...</span>
            </div>
          </div>
        )}

        {isMissionActive && (
          <div className="flex items-center gap-2 px-3 py-2.5 bg-violet-950/20 border border-violet-800/20 rounded-lg message-enter">
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <span className="text-xs text-violet-300">
              Mission in progress — watch the <strong>Mission Canvas</strong> tab for live updates
            </span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t bg-card/40">
        <div className="flex items-center gap-2 bg-zinc-800/50 rounded-xl px-4 py-2 border border-zinc-700/40 focus-within:border-violet-500/50 focus-within:ring-2 focus-within:ring-violet-500/20 transition-all">
          <Input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a mission or ask AgentForge anything..."
            className="flex-1 bg-transparent border-0 outline-none text-sm text-zinc-200 placeholder-zinc-600 focus-visible:ring-0 focus-visible:border-0 h-auto py-0"
            disabled={isLoading}
          />
          <Button size="icon" onClick={() => handleSend()} disabled={!input.trim() || isLoading} className="shrink-0">
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
