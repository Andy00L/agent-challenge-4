// REST client for communicating with deployed worker agents via their Nosana URLs
// Uses the ElizaOS v2 HTTP API: dm-channel + POST /channels/:id/messages with transport:"http"
// Fallback: polls channel messages if agentResponse is missing from the HTTP reply

const ORCHESTRATOR_USER_ID = '11111111-1111-1111-1111-111111111111';
const DEFAULT_SERVER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Strong patterns — if ANY of these match ANYWHERE in the text, it's intermediate
 * regardless of text length. These are unambiguously "I'm still working" signals.
 */
const STRONG_INTERMEDIATE_PATTERNS = [
  /hold on while i/i,
  /please (?:hold on|wait) while i/i,
  /please (?:hold on|be patient|wait)/i,
  /i(?:'m| am) (?:gathering|searching|working|looking|researching|analyzing|performing|fetching|processing)/i,
  /i(?:'ll| will) (?:now )?(?:search|look|find|gather|research|perform|analyze|do a|conduct)/i,
  /let me (?:search|find|look|check|gather|research|analyze|perform)/i,
  /working on (?:it|this|that|your)/i,
];

/**
 * Weak patterns — these only indicate intermediate status for SHORT responses (<150 chars).
 * Longer text containing these words may be legitimate final output.
 */
const WEAK_INTERMEDIATE_PATTERNS = [
  /^(?:ok|understood|i understand|sure|got it|certainly|of course)[.,!]?\s/i,
  /^(?:searching|looking|gathering|analyzing|processing|fetching)\b/i,
  /^i(?:'m| am) on it\b/i,
  /\bone moment\b/i,
  /\bjust a moment\b/i,
  /\bgive me a (?:moment|second|minute)\b/i,
];

/**
 * Check if a response looks like an intermediate "please wait" message
 * rather than the actual final answer.
 *
 * Real examples that MUST be caught:
 *   "I'm gathering detailed information about AutoGen for a comprehensive analysis. Please hold on while I perform the web search."
 *   "Executive Summary\n\nPlease hold on while I gather the latest information on ElizaOS."
 *   "Understood. I will perform a detailed web search to gather information about CrewAI..."
 *
 * Real examples that MUST pass through (final answers):
 *   "## Comprehensive Analysis of AutoGen\n\nAutoGen is a framework developed by Microsoft..."
 *   "Here is the detailed research report:\n\n### 1. Overview\n\nAI trends in 2025..."
 */
function isIntermediateResponse(text: string): boolean {
  if (!text || text.length === 0) return true;

  // Strong patterns match regardless of text length
  if (STRONG_INTERMEDIATE_PATTERNS.some(p => p.test(text))) return true;

  // Weak patterns only match for short texts
  if (text.length < 150 && WEAK_INTERMEDIATE_PATTERNS.some(p => p.test(text))) return true;

  // Very short responses (< 80 chars) that don't start with markdown headings are suspicious
  const trimmed = text.trim();
  if (trimmed.length < 80 && !trimmed.startsWith('#') && !trimmed.startsWith('##')) return true;

  return false;
}

/**
 * Client for communicating with deployed ElizaOS worker agents via their Nosana URLs.
 * Handles agent discovery, room creation, message sending, and response polling.
 */
export class WorkerClient {
  private baseUrl: string;

  constructor(url: string) {
    // Validate URL protocol — only allow http/https
    if (url.startsWith('https://') || url.startsWith('http://')) {
      this.baseUrl = url;
    } else {
      this.baseUrl = `https://${url}`;
    }
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
      } catch (e) {
        // Expected during boot — agent not yet available
      }
      await new Promise(r => setTimeout(r, 5000));
    }
    throw new Error(`Worker at ${this.baseUrl} not ready after ${timeoutMs / 1000}s`);
  }

  /** Get recent messages from a channel (ElizaOS returns { success, data: { messages } }). */
  private _channelMsgCallCount = 0;
  private async getChannelMessages(channelId: string, limit = 20): Promise<any[]> {
    this._channelMsgCallCount++;
    const callNum = this._channelMsgCallCount;
    try {
      const url = `${this.baseUrl}/api/messaging/channels/${channelId}/messages?limit=${limit}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        console.warn(`[AgentForge:Worker] getChannelMessages #${callNum} failed: HTTP ${res.status}`);
        return [];
      }
      const rawText = await res.text();
      let data: any;
      try {
        data = JSON.parse(rawText);
      } catch {
        console.warn(`[AgentForge:Worker] getChannelMessages #${callNum}: non-JSON response: ${rawText.slice(0, 300)}`);
        return [];
      }

      // On first few calls, dump the raw response structure for diagnosis
      if (callNum <= 3) {
        console.log(`[AgentForge:Worker] getChannelMessages #${callNum} raw response keys: ${Object.keys(data).join(', ')}`);
        if (data.data) console.log(`[AgentForge:Worker]   data.data keys: ${Object.keys(data.data).join(', ')}`);
        console.log(`[AgentForge:Worker]   raw body (first 500 chars): ${rawText.slice(0, 500)}`);
      }

      const msgs = data?.data?.messages || data?.messages || [];
      // If the response shape is unexpected, log it so we can diagnose
      if (msgs.length === 0 && data) {
        const keys = Object.keys(data);
        if (!keys.includes('data') && !keys.includes('messages')) {
          console.warn(`[AgentForge:Worker] getChannelMessages #${callNum}: unexpected response shape, keys: ${keys.join(', ')}`);
          console.warn(`[AgentForge:Worker]   full response: ${rawText.slice(0, 1000)}`);
        }
      }
      return msgs;
    } catch (err: any) {
      console.warn(`[AgentForge:Worker] getChannelMessages #${callNum} error: ${err.message}`);
      return [];
    }
  }

  /**
   * Extract text content from an agentResponse field (string or object).
   * Returns null if the content is empty, too short, or looks like metadata.
   */
  private extractResponseText(ar: any, inputText: string): string | null {
    const responseText = typeof ar === 'string'
      ? ar
      : ar.text || ar.content?.text || '';

    // Reject empty or trivially short
    if (!responseText || responseText.length < 20) return null;
    // Reject if it's just echoing the input
    if (responseText === inputText) return null;
    // Reject JSON metadata objects (no real text field found, fell through to stringify)
    if (!responseText && typeof ar === 'object') return null;

    return responseText;
  }

  /**
   * Check if a response is the final answer (not intermediate).
   * If it's intermediate, return null to signal "keep waiting".
   */
  private validateFinalResponse(text: string): string | null {
    if (isIntermediateResponse(text)) {
      console.log(`[AgentForge:Worker] Skipping intermediate response (${text.length} chars): "${text.slice(0, 80)}..."`);
      return null;
    }
    return text;
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
   * Intermediate "please wait" responses are detected and skipped — we continue
   * polling until the agent sends its final answer or the timeout is reached.
   *
   * @param waitForEnrichment When true (researchers), after getting the first response,
   *   wait up to 90s for a web-enriched follow-up (REPLY → WEB_SEARCH → REPLY pattern).
   */
  async sendMessage(
    agentId: string,
    text: string,
    timeoutMs = 300_000,
    checkAlive?: () => boolean,
    _waitForEnrichment = false,
    abortSignal?: AbortSignal,
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
    // Dump pre-existing messages for diagnosis
    for (const m of existingMessages) {
      const aid = m.authorId || m.author_id || m.entityId || 'NO_AUTHOR';
      const content = typeof m.content === 'string' ? m.content : m.content?.text || '';
      console.log(`[AgentForge:Worker]   PRE-EXISTING: id=${m.id} author=${aid} len=${content.length} "${content.slice(0, 80)}"`);
    }

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

    let httpResponseText: string | null = null;
    // Capture raw HTTP response text even if extractResponseText rejects it (too short, etc.)
    // Used as early-exit safety net when polling finds nothing for 30s.
    let rawHttpResponseText: string | null = null;

    try {
      const fetchSignal = abortSignal
        ? AbortSignal.any([AbortSignal.timeout(300_000), abortSignal])
        : AbortSignal.timeout(300_000);
      const msgRes = await fetch(`${this.baseUrl}/api/messaging/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: fetchSignal,
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
              const extracted = this.extractResponseText(retryData.agentResponse, text);
              if (extracted) {
                httpResponseText = extracted;
              }
            } catch (parseErr) {
              console.warn('[AgentForge:Worker] Failed to parse 503 retry response:', parseErr);
            }
          }
        } catch (retryErr: any) {
          console.log(`[AgentForge:Worker] 503 retry also failed: ${retryErr.message}`);
        }
      }

      if (!httpResponseText && msgRes.ok) {
        try {
          const data = JSON.parse(rawBody);
          const ar = data.agentResponse;
          console.log(`[AgentForge:Worker] agentResponse type=${typeof ar}, ` +
            (ar ? `keys=${typeof ar === 'object' ? Object.keys(ar).join(',') : 'N/A'}, ` +
            `text_len=${(typeof ar === 'string' ? ar : ar?.text || ar?.content?.text || '').length}` : 'null'));
          // Capture raw text before filtering — safety net for polling early exit
          const rawText = typeof ar === 'string' ? ar : ar?.text || ar?.content?.text || '';
          if (rawText.length > 0) rawHttpResponseText = rawText;

          const extracted = this.extractResponseText(ar, text);
          if (extracted) {
            httpResponseText = extracted;
            console.log(`[AgentForge:Worker] Extracted HTTP response: ${extracted.length} chars, "${extracted.slice(0, 120)}"`);
          } else {
            console.log(`[AgentForge:Worker] extractResponseText returned null (raw=${rawText.length} chars, empty/short/echo)`);
          }
        } catch (parseErr) {
          console.warn('[AgentForge:Worker] Failed to parse HTTP response body:', parseErr);
        }
      }
    } catch (err: any) {
      console.log(`[AgentForge:Worker] HTTP POST error: ${err.message} — will poll for response`);
    }

    // If HTTP gave us a response, check if it's a final answer or intermediate
    if (httpResponseText) {
      const finalText = this.validateFinalResponse(httpResponseText);
      if (finalText) {
        console.log(`[AgentForge:Worker] Got final agentResponse from HTTP (${finalText.length} chars)`);
        // Skip enrichment wait — orchestrator pre-searches Tavily and injects results
        // into the prompt, so the first HTTP response is already the final answer.
        return finalText;
      }
      // Intermediate response — fall through to polling to get the real answer
      console.log('[AgentForge:Worker] HTTP response was intermediate, polling for final answer...');
    }

    // 4. Fallback: poll channel messages for a new agent response
    const pollUrl = `${this.baseUrl}/api/messaging/channels/${channelId}/messages?limit=20`;
    console.log(`[AgentForge:Worker] ========== POLLING START ==========`);
    console.log(`[AgentForge:Worker] Poll URL: ${pollUrl}`);
    console.log(`[AgentForge:Worker] Channel ID: ${channelId}`);
    console.log(`[AgentForge:Worker] Agent ID: ${agentId}`);
    console.log(`[AgentForge:Worker] Orchestrator user ID: ${ORCHESTRATOR_USER_ID}`);
    console.log(`[AgentForge:Worker] Existing message IDs (${existingIds.size}): ${[...existingIds].join(', ')}`);
    console.log(`[AgentForge:Worker] Timeout: ${timeoutMs / 1000}s`);
    console.log(`[AgentForge:Worker] curl check: curl '${pollUrl}'`);
    const pollStart = Date.now();
    const POLL_INTERVAL = 3_000;
    let pollCycle = 0;

    while (Date.now() - pollStart < timeoutMs) {
      // Check if the deployment is still alive or mission was aborted
      if (abortSignal?.aborted) {
        throw new Error('Mission aborted by user');
      }
      if (checkAlive && !checkAlive()) {
        throw new Error('Deployment stopped or crashed during execution');
      }

      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      pollCycle++;

      const messages = await this.getChannelMessages(channelId, 20);
      const elapsed = Math.floor((Date.now() - pollStart) / 1000);

      // DEBUG: Log ALL messages in the channel EVERY poll cycle
      console.log(`[AgentForge:Worker] --- Poll #${pollCycle} at ${elapsed}s: ${messages.length} total messages in channel ---`);
      for (const m of messages) {
        const aid = m.authorId || m.author_id || m.entityId || 'NO_AUTHOR';
        const content = typeof m.content === 'string' ? m.content : m.content?.text || '';
        const rawContentType = typeof m.content;
        const rawContentKeys = typeof m.content === 'object' && m.content ? Object.keys(m.content).join(',') : 'N/A';
        const isExisting = existingIds.has(m.id);
        const isOrchestrator = aid === ORCHESTRATOR_USER_ID;
        const isAgent = aid === agentId;
        console.log(`[AgentForge:Worker]   [${isExisting ? 'OLD' : 'NEW'}] id=${m.id} | authorId=${aid} | isOrch=${isOrchestrator} | isAgent=${isAgent} | contentType=${rawContentType} | contentKeys=${rawContentKeys} | len=${content.length} | "${content.slice(0, 100)}"`);
        // On first cycle, dump full message structure of each message for diagnosis
        if (pollCycle === 1) {
          const msgKeys = Object.keys(m).join(', ');
          console.log(`[AgentForge:Worker]     ^ msg keys: [${msgKeys}]`);
          console.log(`[AgentForge:Worker]     ^ authorId=${m.authorId} author_id=${m.author_id} entityId=${m.entityId} userId=${m.userId} user_id=${m.user_id} senderId=${m.senderId} sender_id=${m.sender_id}`);
        }
      }

      const newAgentMsgs = messages.filter((m: any) => {
        const isExisting = existingIds.has(m.id);
        const authorId = m.authorId || m.author_id || m.entityId || '';
        const isOrchestrator = authorId === ORCHESTRATOR_USER_ID;
        const content = typeof m.content === 'string' ? m.content : m.content?.text || '';
        const tooShort = content.length < 20;
        const isEcho = content === text;

        // Log filter reasoning for NEW messages
        if (!isExisting) {
          const reasons: string[] = [];
          if (isOrchestrator) reasons.push('FILTERED:orchestrator');
          if (tooShort) reasons.push(`FILTERED:too_short(${content.length})`);
          if (isEcho) reasons.push('FILTERED:echo');
          if (reasons.length === 0) reasons.push('PASSED');
          console.log(`[AgentForge:Worker]   >> Filter: id=${m.id?.slice(0, 8)} author=${authorId.slice(0, 8)} → ${reasons.join(', ')}`);
        }

        if (isExisting) return false;
        if (isOrchestrator) return false;
        if (tooShort) return false;
        if (isEcho) return false;
        return true;
      });

      if (newAgentMsgs.length > 0) {
        console.log(`[AgentForge:Worker] *** Found ${newAgentMsgs.length} candidate agent messages ***`);
        // Check messages from newest to oldest — prefer the final answer
        for (let i = newAgentMsgs.length - 1; i >= 0; i--) {
          const msg = newAgentMsgs[i];
          const responseText = typeof msg.content === 'string'
            ? msg.content
            : msg.content?.text || '';

          const intermed = isIntermediateResponse(responseText);
          console.log(`[AgentForge:Worker] Candidate #${newAgentMsgs.length - i}: len=${responseText.length} intermediate=${intermed} author=${msg.authorId || msg.author_id || msg.entityId} "${responseText.slice(0, 200)}"`);

          if (!intermed) {
            console.log(`[AgentForge:Worker] ✓ FINAL RESPONSE found (poll, ${responseText.length} chars)`);
            return responseText;
          }
        }
        // All new messages are intermediate — keep polling
        console.log(`[AgentForge:Worker] All ${newAgentMsgs.length} new messages were intermediate, continuing...`);
      } else if (elapsed % 15 === 0 && elapsed > 0) {
        console.log(`[AgentForge:Worker] No new agent messages after ${elapsed}s (${messages.length} total in channel, ${existingIds.size} pre-existing)`);
      }

      // Early exit: if we had an initial HTTP response (even short/rejected) and
      // polling found nothing new for 30s, the worker already gave its best answer.
      // This prevents 600s timeouts when a required API key (e.g. TAVILY) is missing.
      if (rawHttpResponseText && rawHttpResponseText.length > 0 && newAgentMsgs.length === 0 && elapsed >= 30) {
        console.warn(
          `[AgentForge:Worker] Polling found no new messages after ${elapsed}s. ` +
          `Using initial HTTP response (${rawHttpResponseText.length} chars). ` +
          `This usually means the worker completed but a required API key is missing.`
        );
        return rawHttpResponseText;
      }
    }

    console.log(`[AgentForge:Worker] ========== POLLING TIMEOUT after ${Math.floor(timeoutMs / 1000)}s ==========`);

    // Last resort: if we got an intermediate HTTP response and timed out on polling,
    // return the intermediate response rather than throwing (some content > no content)
    if (httpResponseText) {
      console.warn(`[AgentForge:Worker] Timeout waiting for final response, returning intermediate (${httpResponseText.length} chars)`);
      return httpResponseText;
    }

    throw new Error(`Agent did not respond within ${Math.floor(timeoutMs / 1000)}s`);
  }
}
