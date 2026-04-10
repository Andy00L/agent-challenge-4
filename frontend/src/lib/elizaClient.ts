import { io, type Socket } from 'socket.io-client';

const API_BASE = '/api';
const DEFAULT_SERVER_ID = '00000000-0000-0000-0000-000000000000';

export interface Agent {
  id: string;
  name: string;
  status: string;
}

export interface ChannelMessage {
  id: string;
  channelId: string;
  authorId: string;
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

// Persistent user ID stored in localStorage
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getOrCreateUserId(): string {
  const KEY = 'agentforge-user-id';
  try {
    const stored = localStorage.getItem(KEY);
    if (stored && UUID_RE.test(stored)) return stored;
    const id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    // localStorage unavailable (private browsing, quota exceeded)
    return crypto.randomUUID();
  }
}

export const userId = getOrCreateUserId();

// ── REST API ─────────────────────────────────────────

export async function getAgents(): Promise<Agent[]> {
  const res = await fetch(`${API_BASE}/agents`);
  if (!res.ok) throw new Error(`Failed to fetch agents: ${res.status}`);
  const json = await res.json();
  return json?.data?.agents ?? [];
}

export async function startAgent(agentId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/agents/${agentId}/start`, { method: 'POST' });
  if (!res.ok) throw new Error(`Failed to start agent: ${res.status}`);
}

export async function getOrCreateDmChannel(agentId: string): Promise<string> {
  const params = new URLSearchParams({
    currentUserId: userId,
    targetUserId: agentId,
    dmServerId: DEFAULT_SERVER_ID,
  });
  const res = await fetch(`${API_BASE}/messaging/dm-channel?${params}`);
  if (!res.ok) throw new Error(`Failed to get DM channel: ${res.status}`);
  const json = await res.json();
  const channelId = json?.data?.id;
  if (!channelId) throw new Error('No channel ID in response');
  return channelId;
}

// ── Socket.IO ────────────────────────────────────────

let socket: Socket | null = null;
let fleetSocket: Socket | null = null;
let messageListeners: Array<(msg: ChannelMessage) => void> = [];

export function onAgentMessage(cb: (msg: ChannelMessage) => void): () => void {
  messageListeners.push(cb);
  return () => {
    messageListeners = messageListeners.filter((l) => l !== cb);
  };
}

/** Broadcast a messageBroadcast payload to all registered listeners */
function dispatchMessage(data: any) {
  if (data.senderId === userId) return;
  const msg: ChannelMessage = {
    id: data.id || data.messageId || crypto.randomUUID(),
    channelId: data.channelId ?? '',
    authorId: data.senderId ?? '',
    content: data.text ?? data.message ?? data.content ?? '',
    createdAt: new Date(data.createdAt ?? Date.now()).toISOString(),
    metadata: data.metadata,
  };
  for (const cb of messageListeners) cb(msg);
}

export function connectSocket(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    if (socket?.connected) {
      resolve(socket);
      return;
    }

    socket?.disconnect();
    socket = io('/', {
      auth: { entityId: userId },
      transports: ['websocket', 'polling'],
    });

    // Timeout: reject if socket doesn't connect within 15 seconds
    const timeout = setTimeout(() => {
      reject(new Error('Socket connection timed out (15s)'));
    }, 15_000);

    socket.on('connect', () => { clearTimeout(timeout); resolve(socket!); });
    socket.on('connect_error', (err) => { clearTimeout(timeout); reject(err); });
    socket.on('messageBroadcast', dispatchMessage);

    // Fleet API Socket.IO — receives mission progress messages (bypasses ElizaOS SQL)
    if (!fleetSocket) {
      fleetSocket = io('/', {
        path: '/fleet/socket.io',
        transports: ['websocket', 'polling'],
      });
      fleetSocket.on('messageBroadcast', dispatchMessage);
      fleetSocket.on('connect_error', () => {
        // Silent — fleet socket is optional, progress messages are non-critical
      });
    }
  });
}

export function joinChannel(channelId: string) {
  if (!socket?.connected) return;
  socket.emit('1', { channelId });
}

export function sendSocketMessage(
  channelId: string,
  text: string,
  agentId: string,
) {
  if (!socket?.connected) throw new Error('Socket not connected');

  socket.emit('2', {
    channelId,
    roomId: channelId,
    senderId: userId,
    senderName: 'user',
    message: text,
    messageServerId: DEFAULT_SERVER_ID,
    source: 'client_chat',
    messageId: crypto.randomUUID(),
    metadata: {
      isDm: true,
      channelType: 'DM',
      targetUserId: agentId,
    },
    targetUserId: agentId,
  });
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
  fleetSocket?.disconnect();
  fleetSocket = null;
}
