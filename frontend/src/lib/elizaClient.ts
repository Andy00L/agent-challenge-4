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
function getOrCreateUserId(): string {
  const KEY = 'agentforge-user-id';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
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
  await fetch(`${API_BASE}/agents/${agentId}/start`, { method: 'POST' });
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
let messageListeners: Array<(msg: ChannelMessage) => void> = [];

export function onAgentMessage(cb: (msg: ChannelMessage) => void): () => void {
  messageListeners.push(cb);
  return () => {
    messageListeners = messageListeners.filter((l) => l !== cb);
  };
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

    socket.on('connect', () => resolve(socket!));
    socket.on('connect_error', (err) => reject(err));

    socket.on('messageBroadcast', (data: any) => {
      // Only relay messages NOT from the current user
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
    });
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
}
