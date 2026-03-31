// REST client for communicating with deployed worker agents via their Nosana URLs
// Uses the ElizaOS v2 HTTP API: dm-channel + POST /channels/:id/messages with transport:"http"
// Fallback: polls channel messages if agentResponse is missing from the HTTP reply

const ORCHESTRATOR_USER_ID = '11111111-1111-1111-1111-111111111111';
const DEFAULT_SERVER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Client for communicating with deployed ElizaOS worker agents via their Nosana URLs.
 * Handles agent discovery, room creation, message sending, and response polling.
 */
export class WorkerClient {
  private baseUrl: string;

  constructor(url: string) {
    this.baseUrl = url.startsWith('http') ? url : `https://${url}`;
  }

  /**
   * Wait for the worker's ElizaOS instance to finish booting and respond to API calls.
   * Polls /api/agents every 5 seconds until an agent with non-initializing status appears.
   *
   * @param timeoutMs - Maximum wait time (default: 120s, typical boot: 60-90s)
   * @returns The agent ID if ready
   * @throws If worker not ready after timeout
   */
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
            console.log(`[AgentForge:Worker] Agent ready at ${this.baseUrl}: ${agents[0].name} (${agents[0].id})`);
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

  /**
   * After receiving an initial response from a researcher agent, poll for a
   * web-enriched follow-up response (the REPLY → WEB_SEARCH → REPLY pattern).
   * Returns the longest response found, which is typically the web-enriched one.
   */
  private async waitForEnrichedResponse(
    channelId: string,
    existingIds: Set<string>,
    initialResponse: string,
    inputText: string,
    checkAlive?: () => boolean,
  ): Promise<string> {
    console.log('[AgentForge:Worker] Researcher mode: waiting up to 90s for web-enriched response...');
    let bestResponse = initialResponse;
    const enrichStart = Date.now();
    const ENRICH_TIMEOUT = 90_000;

    while (Date.now() - enrichStart < ENRICH_TIMEOUT) {
      if (checkAlive && !checkAlive()) {
        console.log('[AgentForge:Worker] Deployment stopped during enrichment wait, using current best');
        break;
      }

      await new Promise(r => setTimeout(r, 5_000));

      try {
        const msgs = await this.getChannelMessages(channelId, 30);
        for (const m of msgs) {
          if (existingIds.has(m.id)) continue;
          if ((m.authorId || m.author_id) === ORCHESTRATOR_USER_ID) continue;
          const c = typeof m.content === 'string' ? m.content : m.content?.text || '';
          if (c.length > bestResponse.length && c !== inputText) {
            console.log(`[AgentForge:Worker] Found enriched response (${c.length} > ${bestResponse.length} chars)`);
            bestResponse = c;
          }
        }
      } catch {}

      // If we found something better after waiting 30s, that's good enough
      if (bestResponse.length > initialResponse.length && Date.now() - enrichStart > 30_000) {
        console.log('[AgentForge:Worker] Enriched response confirmed after 30s, proceeding');
        break;
      }

      const elapsed = Math.floor((Date.now() - enrichStart) / 1000);
      if (elapsed % 15 === 0 && elapsed > 0) {
        console.log(`[AgentForge:Worker] Enrichment wait: ${elapsed}s (best: ${bestResponse.length} chars)`);
      }
    }

    if (bestResponse.length > initialResponse.length) {
      console.log(`[AgentForge:Worker] Using web-enriched response (${bestResponse.length} chars, +${bestResponse.length - initialResponse.length} from web)`);
    } else {
      console.log(`[AgentForge:Worker] No enriched response found, using initial (${initialResponse.length} chars)`);
    }

    return bestResponse;
  }

  /**
   * Send a message to the worker agent and wait for its response.
   *
   * DUAL STRATEGY (by design):
   *
   * Strategy 1 — HTTP Synchronous (fast path):
   *   ElizaOS with `transport: "http"` returns the agent's response in the
   *   HTTP body as `agentResponse`. When it works, response arrives in ~30-60s.
   *
   * Strategy 2 — Channel Polling (reliable fallback):
   *   If agentResponse is null/empty (async processing, HTTP timeout, etc.),
   *   we poll channel messages every 3s for new agent responses.
   *   Slower but always works regardless of ElizaOS transport behavior.
   *
   * Both kept intentionally — Strategy 1 is fast (~50% success with Qwen3.5),
   * Strategy 2 is the reliable catch-all.
   *
   * @param waitForEnrichment When true (researchers), after getting the first response,
   *   wait up to 90s for a web-enriched follow-up (REPLY → WEB_SEARCH → REPLY pattern).
   */
  async sendMessage(
    agentId: string,
    text: string,
    timeoutMs = 300_000,
    checkAlive?: () => boolean,
    waitForEnrichment = false,
  ): Promise<string> {
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
    console.log(`[AgentForge:Worker] Channel ${channelId}: ${existingMessages.length} existing messages`);

    // 3. Send message with transport:"http" (waits for agent processing)
    console.log(`[AgentForge:Worker] Sending to ${this.baseUrl} channel=${channelId}`);

    const postBody = JSON.stringify({
      content: text,
      author_id: ORCHESTRATOR_USER_ID,
      message_server_id: DEFAULT_SERVER_ID,
      source_type: 'orchestrator',
      raw_message: { text },
      transport: 'http',
      metadata: { isDm: true, channelType: 'DM', targetUserId: agentId },
    });

    try {
      const msgRes = await fetch(`${this.baseUrl}/api/messaging/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(300_000),
        body: postBody,
      });

      const rawBody = await msgRes.text();
      console.log(`[AgentForge:Worker] HTTP response: status=${msgRes.status} body=${rawBody.slice(0, 500)}`);

      // Handle 503 (Service Initializing) — wait and retry once
      if (msgRes.status === 503) {
        console.log('[AgentForge:Worker] HTTP 503 — service initializing, retrying in 10s...');
        await new Promise(r => setTimeout(r, 10_000));
        try {
          const retryRes = await fetch(`${this.baseUrl}/api/messaging/channels/${channelId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(300_000),
            body: postBody,
          });
          if (retryRes.ok) {
            const retryBody = await retryRes.text();
            try {
              const retryData = JSON.parse(retryBody);
              const ar = retryData.agentResponse;
              if (ar) {
                const responseText = typeof ar === 'string' ? ar : ar.text || ar.content?.text || JSON.stringify(ar);
                if (responseText && responseText.length > 20 && responseText !== text) {
                  console.log(`[AgentForge:Worker] Got agentResponse from 503 retry (${responseText.length} chars)`);
                  if (waitForEnrichment) {
                    return this.waitForEnrichedResponse(channelId, existingIds, responseText, text, checkAlive);
                  }
                  return responseText;
                }
              }
            } catch {}
          }
        } catch (retryErr: any) {
          console.log(`[AgentForge:Worker] 503 retry also failed: ${retryErr.message}`);
        }
      }

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
              console.log(`[AgentForge:Worker] Got agentResponse from HTTP (${responseText.length} chars)`);
              if (waitForEnrichment) {
                return this.waitForEnrichedResponse(channelId, existingIds, responseText, text, checkAlive);
              }
              return responseText;
            }
          }
        } catch {}
      }
    } catch (err: any) {
      console.log(`[AgentForge:Worker] HTTP POST error: ${err.message} — will poll for response`);
    }

    // 4. Fallback: poll channel messages for a new agent response
    console.log('[AgentForge:Worker] No usable agentResponse in HTTP reply, polling channel...');
    const pollStart = Date.now();
    const POLL_INTERVAL = 3_000;

    while (Date.now() - pollStart < timeoutMs) {
      // Check if the deployment is still alive before waiting
      if (checkAlive && !checkAlive()) {
        throw new Error('Deployment stopped or crashed during execution');
      }

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
        console.log(`[AgentForge:Worker] Agent responded (poll, ${responseText.length} chars)`);
        if (waitForEnrichment) {
          return this.waitForEnrichedResponse(channelId, existingIds, responseText, text, checkAlive);
        }
        return responseText;
      }

      const elapsed = Math.floor((Date.now() - pollStart) / 1000);
      if (elapsed % 15 === 0 && elapsed > 0) {
        console.log(`[AgentForge:Worker] Waiting for agent response... ${elapsed}s elapsed`);
      }
    }

    throw new Error(`Agent did not respond within ${Math.floor(timeoutMs / 1000)}s`);
  }
}
