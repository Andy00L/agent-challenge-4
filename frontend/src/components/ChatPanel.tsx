import { useState, useRef, useEffect } from 'react';
import { Send, Loader2 } from 'lucide-react';
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

function sanitizeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderMarkdown(text: string): string {
  const safe = sanitizeHtml(text);
  return safe
    .replace(/^### (.+)$/gm, '<h3 class="text-sm font-semibold text-zinc-200 mt-3 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-base font-bold text-zinc-100 mt-4 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-lg font-bold text-white mt-4 mb-2">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-zinc-100 font-semibold">$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="bg-zinc-800 text-indigo-300 px-1.5 py-0.5 rounded text-xs font-mono">$1</code>')
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 text-zinc-300">$1</li>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 text-zinc-300 list-disc">$1</li>')
    .replace(/^---$/gm, '<hr class="border-zinc-700 my-3">')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');
}

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

const MISSION_TEMPLATES = [
  {
    icon: '\u{1F50D}',
    title: 'Research Pipeline',
    description: 'Research a topic and write a detailed blog post',
    prompt: 'Research the latest developments in artificial intelligence and write me a comprehensive blog post',
  },
  {
    icon: '\u{270D}\u{FE0F}',
    title: 'Content Pipeline',
    description: 'Blog post + YouTube script from research',
    prompt: 'Research AI trends and write me a blog post AND a YouTube video script',
  },
  {
    icon: '\u{1F4CA}',
    title: 'Competitive Analysis',
    description: 'Research competitors and create a report',
    prompt: 'Research the top AI startups in 2026, analyze their strengths and weaknesses, and write a competitive analysis report',
  },
  {
    icon: '\u{1F680}',
    title: 'Quick Agent',
    description: 'Deploy one agent for a specific task',
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isMissionActive]);

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

  const statusLabel =
    status === 'connected' ? 'Connected' :
    status === 'connecting' ? 'Connecting...' :
    'Disconnected';

  const statusDotColor =
    status === 'connected' ? 'bg-green-500' :
    status === 'connecting' ? 'bg-amber-500 animate-pulse' :
    'bg-red-500';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-800">
        <div className="relative">
          <img src="/assets/thinker.png" alt="AgentForge" className="w-10 h-10 rounded-full object-cover" />
          <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full ${statusDotColor} border-2 border-zinc-950`} />
        </div>
        <div>
          <div className="text-sm font-semibold text-zinc-100">AgentForge</div>
          <div className="text-xs text-zinc-500">{statusLabel}</div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {errorMsg && (
          <div className="text-center text-sm text-red-400 bg-red-950/30 rounded-lg px-4 py-3">
            {errorMsg}. Make sure ElizaOS is running on port 3000.
          </div>
        )}

        {messages.length === 0 && !errorMsg && (
          <div className="flex flex-col items-center justify-center h-full gap-5 text-center px-4">
            <img src="/assets/thinker.png" alt="AgentForge" className="w-14 h-14 rounded-full object-cover" />
            <div>
              <h2 className="text-lg font-semibold text-zinc-200 mb-1">What do you want to build?</h2>
              <p className="text-xs text-zinc-500">Choose a template or type your own mission</p>
            </div>
            <div className="grid grid-cols-2 gap-2.5 w-full max-w-md">
              {MISSION_TEMPLATES.map((t, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(t.prompt)}
                  className="text-left p-3 bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-800 hover:border-indigo-500/50 rounded-lg transition-all group"
                >
                  <div className="text-base mb-1">{t.icon}</div>
                  <div className="text-xs font-medium text-zinc-200 group-hover:text-white">{t.title}</div>
                  <div className="text-[11px] text-zinc-500 mt-0.5 line-clamp-2">{t.description}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start items-start gap-2'}`}>
            {msg.role === 'assistant' && (
              <img src="/assets/thinker.png" alt="" className="w-7 h-7 rounded-full object-cover shrink-0 mt-0.5" />
            )}
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-purple-600 text-white whitespace-pre-wrap'
                  : 'bg-zinc-800 text-zinc-200'
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
          <div className="flex justify-start">
            <div className="bg-zinc-800 rounded-2xl px-4 py-3 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
              <span className="text-sm text-zinc-400">Thinking...</span>
            </div>
          </div>
        )}

        {isMissionActive && (
          <div className="flex items-center gap-2 px-3 py-2.5 bg-indigo-950/30 border border-indigo-800/30 rounded-lg">
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <span className="text-xs text-indigo-300">
              Mission in progress — watch the <strong>Mission</strong> tab for live updates
            </span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-zinc-800">
        <div className="flex items-center gap-2 bg-zinc-900 rounded-xl px-4 py-2 border border-zinc-800 focus-within:border-purple-600/50">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a mission or ask AgentForge anything..."
            className="flex-1 bg-transparent outline-none text-sm text-zinc-200 placeholder-zinc-600"
            disabled={isLoading}
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || isLoading}
            className="p-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-4 h-4 text-white" />
          </button>
        </div>
      </div>
    </div>
  );
}
