import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2, MessageSquare, PanelLeftClose } from 'lucide-react';
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
import { fleetFetch } from '../lib/fleetFetch';
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
  estimatedCost?: number;
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
  const isMissionActive = !!missionStatus && missionStatus !== 'idle';
  const [history, setHistory] = useState<MissionHistoryEntry[]>([]);
  const [timeoutWarning, setTimeoutWarning] = useState(false);
  const responseReceivedRef = useRef(false);
  const timeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Overlay state
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [panelWidth, setPanelWidth] = useState(380);
  const isResizingRef = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isMissionActive, timeoutWarning]);

  // Poll mission history
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await fleetFetch('/fleet/mission/history');
        if (!res.ok) return;
        const ct = res.headers.get('content-type') ?? '';
        if (!ct.includes('application/json')) return;
        setHistory(await res.json());
      } catch {
        // Expected during initial load or when backend is starting
      }
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
      responseReceivedRef.current = true;
      if (timeoutIdRef.current) { clearTimeout(timeoutIdRef.current); timeoutIdRef.current = null; }
      setTimeoutWarning(false);
      addMessage({ role: 'assistant', text });
      setLoading(false);
      setTimeout(pollFleetOnce, 500);
    });
    return () => {
      unsub();
      // Clean up pending timeout on unmount
      if (timeoutIdRef.current) { clearTimeout(timeoutIdRef.current); timeoutIdRef.current = null; }
    };
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
      responseReceivedRef.current = false;
      setTimeoutWarning(false);

      // Clear any previous timeout to prevent stale callbacks
      if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = setTimeout(() => {
        if (!responseReceivedRef.current) {
          setTimeoutWarning(true);
          setLoading(false);
        }
        timeoutIdRef.current = null;
      }, 120_000);
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

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizingRef.current) return;
      setPanelWidth(Math.min(Math.max(ev.clientX, 280), 600));
    };
    const onMouseUp = () => {
      isResizingRef.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  // Collapsed state — small toggle button
  if (isCollapsed) {
    return (
      <button
        onClick={() => setIsCollapsed(false)}
        className="absolute left-4 z-50 w-10 h-10 rounded-xl border border-border/50 flex items-center justify-center hover:brightness-105 transition-all shadow-lg"
        style={{
          top: isMissionActive ? '56px' : '12px',
          backgroundColor: 'rgba(255, 255, 255, 0.9)',
        }}
        title="Open chat"
      >
        <MessageSquare className="w-4 h-4" />
      </button>
    );
  }

  return (
    <div className="absolute left-0 z-40 flex transition-all duration-300" style={{
      width: panelWidth,
      background: 'none',
      top: isMissionActive ? '44px' : '0px',
      height: isMissionActive ? 'calc(100% - 44px)' : '100%',
    }}>
      <div className="flex-1 flex flex-col h-full border-r border-border/30 overflow-hidden relative"
        style={{ background: 'none' }}>
        {/* Collapse button — floats top-right */}
        <button
          onClick={() => setIsCollapsed(true)}
          className="absolute top-3 right-3 z-10 w-7 h-7 rounded-lg flex items-center justify-center border border-border/30 hover:border-border/60 transition-all"
          style={{ backgroundColor: 'rgba(255, 255, 255, 0.7)' }}
          title="Collapse chat"
        >
          <PanelLeftClose className="w-3.5 h-3.5 text-muted-foreground" />
        </button>

        {/* Mission History — hidden during active missions to avoid status bar overlap */}
        {!isMissionActive && history.length > 0 && (
          <div className="px-4 py-2.5 border-b border-border/30 shrink-0" style={{ backgroundColor: 'rgba(255, 255, 255, 0.4)' }}>
            <div className="text-[11px] font-semibold text-foreground/70 uppercase tracking-widest mb-1.5">Recent Missions</div>
            <div className="space-y-0.5 max-h-28 overflow-y-auto">
              {history.slice(0, 5).map((h) => (
                <button
                  key={h.id}
                  onClick={async () => {
                    try {
                      const res = await fleetFetch(`/fleet/mission/history/${h.id}`);
                      if (!res.ok) return;
                      const data = await res.json();
                      useMissionStore.getState().loadFromHistory(data);
                    } catch (e) {
                      console.warn('[ChatPanel] Failed to load mission history:', e);
                    }
                  }}
                  className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-muted/50 transition-colors duration-150 group flex items-center justify-between"
                >
                  <span className="text-sm text-foreground group-hover:text-foreground truncate flex-1 mr-2">
                    {h.mission?.slice(0, 45)}{h.mission?.length > 45 ? '...' : ''}
                  </span>
                  <div className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
                    <span>{h.stepsCount}x</span>
                    <span>{Math.round((h.totalTime || 0) / 1000)}s</span>
                    <span className={h.status === 'complete' ? 'text-green-600' : 'text-red-500'}>
                      {h.status === 'complete' ? '\u2713' : '\u2717'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-3 pt-12 pb-4 space-y-3" style={{ backgroundColor: 'rgba(250, 250, 248, 0.65)' }}>
          {(messages.length > 0 || errorMsg) && (
            <div className="flex items-center gap-1.5" style={{ background: 'none' }}>
              <span className={`w-1.5 h-1.5 rounded-full ${status === 'connected' ? 'bg-green-500' : status === 'connecting' ? 'bg-amber-500 animate-pulse' : 'bg-red-400'}`} />
              <span className="text-[10px] text-muted-foreground/60">
                {status === 'connected' ? 'Connected' : status === 'connecting' ? 'Connecting...' : 'Disconnected'}
              </span>
            </div>
          )}
          {errorMsg && (
            <div className="text-center text-sm text-red-700 bg-red-50/80 rounded-xl px-4 py-3 border border-red-200/50 shadow-xs">
              {errorMsg}. Make sure ElizaOS is running on port 3000.
            </div>
          )}

          {messages.length === 0 && !errorMsg && (
            <div className="flex flex-col items-center justify-center h-full gap-5 text-center px-3">
              <img src="/assets/thinker.png" alt="AgentForge" className="w-14 h-14 rounded-full object-cover border-2 border-border/50 shadow-md" />
              <div>
                <div className="flex items-center justify-center gap-2 mb-1">
                  <h2 className="text-lg font-bold text-foreground tracking-tight">What do you want to build?</h2>
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${status === 'connected' ? 'bg-green-500' : status === 'connecting' ? 'bg-amber-500 animate-pulse' : 'bg-red-400'}`}
                    title={status === 'connected' ? 'Connected' : status === 'connecting' ? 'Connecting...' : 'Disconnected'}
                  />
                </div>
                <p className="text-xs text-muted-foreground">Choose a template or type your own mission</p>
              </div>
              <div className="grid grid-cols-1 gap-2.5 w-full">
                {MISSION_TEMPLATES.map((t) => (
                  <Card key={t.id} className="cursor-pointer group template-card !py-0" style={{ backgroundColor: 'rgba(255, 255, 255, 0.65)' }} onClick={() => handleSend(t.prompt)}>
                    <CardContent className="p-3">
                      <div className="flex items-start gap-2.5">
                        <span className="text-lg mt-0.5 group-hover:scale-110 transition-transform duration-200">{t.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-sm font-semibold text-foreground">{t.title}</span>
                            <Badge variant="secondary" className="text-[10px]">
                              {t.badge}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed">{t.description}</p>
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
                <Avatar className="w-7 h-7 shrink-0 mt-0.5"><AvatarFallback className="bg-muted text-muted-foreground text-[10px] border border-border">AF</AvatarFallback></Avatar>
              )}
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground rounded-br-md shadow-sm whitespace-pre-wrap'
                    : 'border border-border/50 rounded-bl-md shadow-xs'
                }`}
                style={msg.role === 'assistant' ? { backgroundColor: 'rgba(255, 255, 255, 0.9)' } : undefined}
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
            <div className="flex justify-start items-start gap-2 message-enter">
              <Avatar className="w-7 h-7 shrink-0 mt-0.5"><AvatarFallback className="bg-muted text-muted-foreground text-[10px] border border-border">AF</AvatarFallback></Avatar>
              <div className="border border-border/50 rounded-2xl rounded-bl-md px-3.5 py-2.5 flex items-center gap-2 shadow-xs"
                style={{ backgroundColor: 'rgba(255, 255, 255, 0.9)' }}>
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Thinking...</span>
              </div>
            </div>
          )}

          {(missionStatus === 'planning' || missionStatus === 'deploying' || missionStatus === 'executing') && (
            <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-blue-50/80 border border-blue-200/50 rounded-xl shadow-xs message-enter">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <span className="text-sm text-blue-700">
                Mission in progress {'\u2014'} watch the <strong>Mission Canvas</strong> tab for live updates
              </span>
            </div>
          )}

          {timeoutWarning && (
            <div className="bg-amber-50/80 border border-amber-200/50 text-amber-800 rounded-xl px-3.5 py-2.5 text-sm leading-relaxed shadow-xs message-enter">
              The AI model couldn't process this request. The message may be too long, or the inference endpoint may be temporarily unavailable. Try a shorter message or try again later.
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="px-3 py-3 border-t border-border/30 shrink-0" style={{ backgroundColor: 'rgba(255, 255, 255, 0.4)' }}>
          <div className="flex items-center gap-2 rounded-xl px-3.5 py-2 border border-border/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15 transition-all duration-200"
            style={{ backgroundColor: 'rgba(255, 255, 255, 0.95)' }}>
            <Input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a mission..."
              className="flex-1 bg-transparent border-0 outline-none text-sm text-foreground placeholder-muted-foreground/60 focus-visible:ring-0 focus-visible:border-0 h-auto py-0"
              disabled={isLoading}
            />
            <Button size="icon" onClick={() => handleSend()} disabled={!input.trim() || isLoading} className="shrink-0 w-8 h-8 rounded-lg shadow-sm">
              <Send className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Drag resize handle */}
      <div
        onMouseDown={startResize}
        className="w-2 cursor-ew-resize hover:bg-primary/20 active:bg-primary/40 transition-colors shrink-0"
        style={{ background: 'none' }}
      />
    </div>
  );
}
