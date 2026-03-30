// REST client for communicating with deployed worker agents via their Nosana URLs
// Uses the ElizaOS v2 HTTP API: dm-channel + POST /channels/:id/messages with transport:"http"

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

  async sendMessage(agentId: string, text: string): Promise<string> {
    // Step 1: Get or create a DM channel with the worker agent
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

    console.log(`[WorkerClient] Sending to ${this.baseUrl} channel=${channelId}`);

    // Step 2: POST message to the channel with transport:"http" for synchronous response
    const msgRes = await fetch(`${this.baseUrl}/api/messaging/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({
        content: text,
        author_id: ORCHESTRATOR_USER_ID,
        message_server_id: DEFAULT_SERVER_ID,
        source_type: 'orchestrator',
        raw_message: { text },
        transport: 'http',
        metadata: {
          isDm: true,
          channelType: 'DM',
          targetUserId: agentId,
        },
      }),
    });

    const rawBody = await msgRes.text();
    console.log(`[WorkerClient] Response: status=${msgRes.status} body=${rawBody.slice(0, 300)}`);

    if (!msgRes.ok) {
      throw new Error(`Worker message failed: ${msgRes.status} ${rawBody.slice(0, 300)}`);
    }

    let data: any;
    try {
      data = JSON.parse(rawBody);
    } catch {
      throw new Error(`Worker returned non-JSON: ${rawBody.slice(0, 300)}`);
    }

    // handleHttpTransport returns: { success, userMessage, agentResponse }
    // agentResponse is the content object from elizaOS.handleMessage()
    const agentResponse = data.agentResponse;
    if (agentResponse) {
      return agentResponse.text || agentResponse.content?.text || JSON.stringify(agentResponse);
    }

    // Fallback: try other response shapes
    if (data.text) return data.text;
    if (data.content?.text) return data.content.text;
    if (data.success && data.data?.text) return data.data.text;

    return rawBody.slice(0, 2000) || 'Agent produced no text response.';
  }
}
