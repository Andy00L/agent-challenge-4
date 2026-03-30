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

function sanitizeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderMarkdown(text: string): string {
  const safe = sanitizeHtml(text);
  return safe
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="bg-white/10 px-1 py-0.5 rounded text-sm font-mono">$1</code>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/\n/g, '<br/>');
}

function isInternalMessage(text: string): boolean {
  return /^(Executing action:|Action:|(\[Action\]))/.test(text);
}

const EXAMPLE_PROMPTS = [
  'Create an agent that monitors Hacker News for AI papers',
  'Build a writer agent for blog posts',
  'Show me my fleet',
  'Create a data analyst for crypto trends',
];

export function ChatPanel() {
  const { messages, isLoading, agentId, setAgentId, addMessage, setLoading } = useChatStore();
  const [input, setInput] = useState('');
  const [channelId, setChannelId] = useState<string | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Connect to agent on mount
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        // 1. Discover agents
        const agents = await getAgents();
        if (!mounted) return;
        if (agents.length === 0) {
          setStatus('disconnected');
          setErrorMsg('No agents found');
          return;
        }

        // Prefer AgentForge, fall back to first agent
        const agent = agents.find((a) => a.name === 'AgentForge') ?? agents[0];
        setAgentId(agent.id);
        setFleetAgentId(agent.id);

        // 2. Start agent if inactive
        if (agent.status !== 'active') {
          await startAgent(agent.id);
        }

        // 3. Get or create a DM channel
        const chId = await getOrCreateDmChannel(agent.id);
        if (!mounted) return;
        setChannelId(chId);

        // 4. Connect socket and join channel
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
      // Trigger fleet poll after agent response
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

      // Safety timeout — if no response after 60s, stop the spinner
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
          <div className="w-10 h-10 rounded-full bg-purple-600 flex items-center justify-center text-white font-bold text-sm">
            AF
          </div>
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
          <div className="flex flex-col items-center justify-center h-full gap-6 text-center px-4">
            <div className="w-16 h-16 rounded-full bg-purple-600/20 flex items-center justify-center">
              <span className="text-2xl font-bold text-purple-400">AF</span>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-zinc-200 mb-1">Welcome to AgentForge</h2>
              <p className="text-sm text-zinc-500">Create and deploy AI agents on Nosana's decentralized GPU network</p>
            </div>
            <div className="grid grid-cols-1 gap-2 w-full max-w-sm">
              {EXAMPLE_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => handleSend(prompt)}
                  className="text-left text-sm text-zinc-400 hover:text-zinc-200 bg-zinc-900 hover:bg-zinc-800 rounded-lg px-4 py-3 transition-colors border border-zinc-800"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
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
                <div dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }} />
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
            placeholder="Describe the agent you want to create..."
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
