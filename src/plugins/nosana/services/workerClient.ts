// REST client for communicating with deployed worker agents via their Nosana URLs
// Uses the ElizaOS v2 HTTP API: dm-channel + POST /channels/:id/messages with transport:"http"
// Fallback: polls channel messages if agentResponse is missing from the HTTP reply

const ORCHESTRATOR_USER_ID = '11111111-1111-1111-1111-111111111111';
const DEFAULT_SERVER_ID = '00000000-0000-0000-0000-000000000000';

export class WorkerClient {
  private baseUrl: string;

  constructor(url: string) {
    this.baseUrl = url.startsWith('http') ? url : `https://${url}`;
  }

  async waitForReady(timeoutMs = 120_000): Promise<string> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(`${this.baseUrl}/api/agents`, {
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const data = await res.json() as any;
          const agents = data?.agents || data?.data?.agents || [];
          if (agents.length > 0) {
            console.log(`[WorkerClient] Agent ready at ${this.baseUrl}: ${agents[0].name} (${agents[0].id})`);
            return agents[0].id;
          }
        }
      } catch {}
      await new Promise(r => setTimeout(r, 5000));
    }
    throw new Error(`Worker at ${this.baseUrl} not ready after ${timeoutMs / 1000}s`);
  }

  /** Get recent messages from a channel (ElizaOS returns { success, data: { messages } }). */
  private async getChannelMessages(channelId: string, limit = 20): Promise<any[]> {
    try {
      const res = await fetch(
        `${this.baseUrl}/api/messaging/channels/${channelId}/messages?limit=${limit}`,
        { signal: AbortSignal.timeout(10_000) },
      );
      if (!res.ok) return [];
      const data = await res.json() as any;
      return data?.data?.messages || data?.messages || [];
    } catch {
      return [];
    }
  }

  async sendMessage(agentId: string, text: string, timeoutMs = 300_000): Promise<string> {
    // 1. Get or create DM channel
    const dmParams = new URLSearchParams({
      currentUserId: ORCHESTRATOR_USER_ID,
      targetUserId: agentId,
      dmServerId: DEFAULT_SERVER_ID,
    });
    const dmRes = await fetch(`${this.baseUrl}/api/messaging/dm-channel?${dmParams}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!dmRes.ok) {
      const body = await dmRes.text().catch(() => '');
      throw new Error(`Failed to get DM channel: ${dmRes.status} ${body.slice(0, 200)}`);
    }
    const dmData = await dmRes.json() as any;
    const channelId = dmData?.data?.id || dmData?.id;
    if (!channelId) {
      throw new Error(`No channel ID in DM response: ${JSON.stringify(dmData).slice(0, 200)}`);
    }

    // 2. Snapshot existing messages so we know what's "old"
    const existingMessages = await this.getChannelMessages(channelId, 10);
    const existingIds = new Set(existingMessages.map((m: any) => m.id));
    console.log(`[WorkerClient] Channel ${channelId}: ${existingMessages.length} existing messages`);

    // 3. Send message with transport:"http" (waits for agent processing)
    console.log(`[WorkerClient] Sending to ${this.baseUrl} channel=${channelId}`);

    try {
      const msgRes = await fetch(`${this.baseUrl}/api/messaging/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(300_000),
        body: JSON.stringify({
          content: text,
          author_id: ORCHESTRATOR_USER_ID,
          message_server_id: DEFAULT_SERVER_ID,
          source_type: 'orchestrator',
          raw_message: { text },
          transport: 'http',
          metadata: { isDm: true, channelType: 'DM', targetUserId: agentId },
        }),
      });

      const rawBody = await msgRes.text();
      console.log(`[WorkerClient] HTTP response: status=${msgRes.status} body=${rawBody.slice(0, 500)}`);

      if (msgRes.ok) {
        try {
          const data = JSON.parse(rawBody);
          const ar = data.agentResponse;
          if (ar) {
            // agentResponse can be a string or an object — handle both
            const responseText = typeof ar === 'string'
              ? ar
              : ar.text || ar.content?.text || JSON.stringify(ar);
            if (responseText && responseText.length > 20 && responseText !== text) {
              console.log(`[WorkerClient] Got agentResponse from HTTP (${responseText.length} chars)`);
              return responseText;
            }
          }
        } catch {}
      }
    } catch (err: any) {
      console.log(`[WorkerClient] HTTP POST error: ${err.message} — will poll for response`);
    }

    // 4. Fallback: poll channel messages for a new agent response
    console.log('[WorkerClient] No usable agentResponse in HTTP reply, polling channel...');
    const pollStart = Date.now();
    const POLL_INTERVAL = 3_000;

    while (Date.now() - pollStart < timeoutMs) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL));

      const messages = await this.getChannelMessages(channelId, 20);
      const newAgentMsgs = messages.filter((m: any) => {
        if (existingIds.has(m.id)) return false;
        if ((m.authorId || m.author_id) === ORCHESTRATOR_USER_ID) return false;
        const content = typeof m.content === 'string' ? m.content : m.content?.text || '';
        if (content.length < 20) return false;
        if (content === text) return false;
        return true;
      });

      if (newAgentMsgs.length > 0) {
        const best = newAgentMsgs[newAgentMsgs.length - 1];
        const responseText = typeof best.content === 'string'
          ? best.content
          : best.content?.text || JSON.stringify(best.content);
        console.log(`[WorkerClient] Agent responded (poll, ${responseText.length} chars)`);
        return responseText;
      }

      const elapsed = Math.floor((Date.now() - pollStart) / 1000);
      if (elapsed % 15 === 0 && elapsed > 0) {
        console.log(`[WorkerClient] Waiting for agent response... ${elapsed}s elapsed`);
      }
    }

    throw new Error(`Agent did not respond within ${Math.floor(timeoutMs / 1000)}s`);
  }
}
