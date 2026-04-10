// Text-to-Speech with automatic fallback chain and word-level timestamps.
// Priority: ElevenLabs → OpenAI TTS → fal.ai → Coqui on Nosana GPU → null

// ── Interfaces ───────────────────────────────────────────

export interface TTSWordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
}

export interface TTSResult {
  audio: Buffer;
  mimeType: string;
  durationMs: number;
  timestamps: TTSWordTimestamp[];
  provider: string;
}

// ── Helpers ──────────────────────────────────────────────

function estimateWordTimestamps(text: string, totalDurationMs: number): TTSWordTimestamp[] {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0 || totalDurationMs <= 0) return [];

  const msPerWord = totalDurationMs / words.length;
  return words.map((word, i) => ({
    word,
    startMs: Math.round(i * msPerWord),
    endMs: Math.round((i + 1) * msPerWord),
  }));
}

function estimateDurationMs(text: string): number {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  return Math.round((words.length / 150) * 60 * 1000); // ~150 wpm
}

// ── Provider detection ──────────────────────────────────

type TTSProvider = 'elevenlabs' | 'openai' | 'falai' | 'none';

interface TTSConfig {
  provider: TTSProvider;
  apiKey: string;
}

function detectTTSProvider(): TTSConfig {
  const ttsKey = process.env.TTS_API_KEY || '';

  // Legacy support: fall back to ELEVENLABS_API_KEY if TTS_API_KEY not set
  if (!ttsKey && process.env.ELEVENLABS_API_KEY) {
    console.warn('[AgentForge:TTS] ELEVENLABS_API_KEY is deprecated. Use TTS_API_KEY instead.');
    return { provider: 'elevenlabs', apiKey: process.env.ELEVENLABS_API_KEY };
  }

  if (!ttsKey) {
    return { provider: 'none', apiKey: '' };
  }

  // ElevenLabs keys start with "sk_" (underscore)
  if (ttsKey.startsWith('sk_')) {
    return { provider: 'elevenlabs', apiKey: ttsKey };
  }

  // OpenAI keys start with "sk-" (dash)
  if (ttsKey.startsWith('sk-')) {
    return { provider: 'openai', apiKey: ttsKey };
  }

  // fal.ai keys
  if (ttsKey.startsWith('fal_') || ttsKey.startsWith('key_')) {
    return { provider: 'falai', apiKey: ttsKey };
  }

  // Unknown format — try OpenAI as default
  console.warn(`[AgentForge:TTS] Unknown TTS_API_KEY format. Attempting OpenAI TTS.`);
  return { provider: 'openai', apiKey: ttsKey };
}

const ttsConfig = detectTTSProvider();
if (ttsConfig.provider !== 'none') {
  console.log(`[AgentForge:TTS] Provider detected: ${ttsConfig.provider} (from TTS_API_KEY)`);
} else {
  console.warn('[AgentForge:TTS] No TTS_API_KEY set. TTS will use Coqui/Nosana if available, otherwise silent.');
}

// ── Backend 1: OpenAI TTS ────────────────────────────────

async function generateWithOpenAI(text: string, apiKey: string): Promise<TTSResult> {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'tts-1',
      voice: 'alloy',
      input: text,
      response_format: 'mp3',
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.warn(`[AgentForge:TTS] OpenAI TTS error (${res.status}): ${body.slice(0, 300)}`);
    throw new Error(`OpenAI TTS failed (status: ${res.status})`);
  }

  const audio = Buffer.from(await res.arrayBuffer());
  const durationMs = estimateDurationMs(text);
  const timestamps = estimateWordTimestamps(text, durationMs);

  return { audio, mimeType: 'audio/mpeg', durationMs, timestamps, provider: 'openai' };
}

// ── Backend 2: ElevenLabs TTS ────────────────────────────

async function generateWithElevenLabs(text: string, apiKey: string): Promise<TTSResult> {
  const voiceId = '21m00Tcm4TlvDq8ikWAM';

  // Try with-timestamps endpoint first
  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
      {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          model_id: 'eleven_flash_v2_5',
          output_format: 'mp3_44100_128',
        }),
        signal: AbortSignal.timeout(120_000),
      },
    );

    if (res.ok) {
      const data = await res.json() as any;
      const audio = Buffer.from(data.audio_base64, 'base64');
      const alignment = data.alignment;

      // Convert character-level alignment to word-level timestamps
      let timestamps: TTSWordTimestamp[] = [];
      let durationMs = estimateDurationMs(text);

      if (alignment?.characters && alignment.character_start_times_seconds) {
        const chars: string[] = alignment.characters;
        const starts: number[] = alignment.character_start_times_seconds;
        const ends: number[] = alignment.character_end_times_seconds;

        // Group characters into words
        let currentWord = '';
        let wordStart = 0;
        let wordEnd = 0;
        timestamps = [];

        for (let i = 0; i < chars.length; i++) {
          if (chars[i] === ' ' || chars[i] === '\n') {
            if (currentWord.length > 0) {
              timestamps.push({
                word: currentWord,
                startMs: Math.round(wordStart * 1000),
                endMs: Math.round(wordEnd * 1000),
              });
              currentWord = '';
            }
          } else {
            if (currentWord.length === 0) wordStart = starts[i] || 0;
            currentWord += chars[i];
            wordEnd = ends[i] || wordStart;
          }
        }
        if (currentWord.length > 0) {
          timestamps.push({
            word: currentWord,
            startMs: Math.round(wordStart * 1000),
            endMs: Math.round(wordEnd * 1000),
          });
        }

        if (timestamps.length > 0) {
          durationMs = timestamps[timestamps.length - 1].endMs;
        }
      } else {
        timestamps = estimateWordTimestamps(text, durationMs);
      }

      return { audio, mimeType: 'audio/mpeg', durationMs, timestamps, provider: 'elevenlabs' };
    }

    // Non-OK response from with-timestamps — fall through to regular endpoint
    console.warn(`[AgentForge:TTS] ElevenLabs with-timestamps returned ${res.status}, trying regular endpoint`);
  } catch (err: any) {
    console.warn(`[AgentForge:TTS] ElevenLabs with-timestamps failed: ${err.message}, trying regular endpoint`);
  }

  // Fallback: regular endpoint without timestamps
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: 'eleven_flash_v2_5',
        output_format: 'mp3_44100_128',
      }),
      signal: AbortSignal.timeout(120_000),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.warn(`[AgentForge:TTS] ElevenLabs error (${res.status}): ${body.slice(0, 300)}`);
    throw new Error(`ElevenLabs TTS failed (status: ${res.status})`);
  }

  const audio = Buffer.from(await res.arrayBuffer());
  const durationMs = estimateDurationMs(text);
  const timestamps = estimateWordTimestamps(text, durationMs);

  return { audio, mimeType: 'audio/mpeg', durationMs, timestamps, provider: 'elevenlabs' };
}

// ── Backend 3: fal.ai PlayAI TTS ────────────────────────

async function generateWithFal(text: string, apiKey: string): Promise<TTSResult> {
  // Submit async job
  const submitRes = await fetch('https://queue.fal.run/fal-ai/playai/tts/v3', {
    method: 'POST',
    headers: {
      'Authorization': `Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: text,
      voice: 's3://voice-cloning-zero-shot/775ae416-49bb-4fb6-bd45-740f205d20a1/jennifersaad/manifest.json',
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!submitRes.ok) {
    const body = await submitRes.text().catch(() => '');
    console.warn(`[AgentForge:TTS] fal.ai error (${submitRes.status}): ${body.slice(0, 300)}`);
    throw new Error(`fal.ai TTS failed (status: ${submitRes.status})`);
  }

  const submitData = await submitRes.json() as any;
  const requestId = submitData.request_id;
  if (!requestId) throw new Error('fal.ai returned no request_id');

  // Poll for completion (max 120s)
  const pollStart = Date.now();
  while (Date.now() - pollStart < 120_000) {
    await new Promise(r => setTimeout(r, 3000));

    try {
      const statusRes = await fetch(
        `https://queue.fal.run/fal-ai/playai/tts/v3/requests/${requestId}/status`,
        {
          headers: { 'Authorization': `Key ${apiKey}` },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!statusRes.ok) continue;
      const status = await statusRes.json() as any;

      if (status.status === 'COMPLETED') {
        // Fetch result
        const resultRes = await fetch(
          `https://queue.fal.run/fal-ai/playai/tts/v3/requests/${requestId}`,
          {
            headers: { 'Authorization': `Key ${apiKey}` },
            signal: AbortSignal.timeout(30_000),
          },
        );
        if (!resultRes.ok) throw new Error(`fal.ai result fetch HTTP ${resultRes.status}`);
        const result = await resultRes.json() as any;

        const audioUrl = result.audio?.url || result.audio_url || '';
        if (!audioUrl) throw new Error('fal.ai returned no audio URL');

        const audioRes = await fetch(audioUrl, { signal: AbortSignal.timeout(60_000) });
        if (!audioRes.ok) throw new Error(`fal.ai audio download HTTP ${audioRes.status}`);

        const audio = Buffer.from(await audioRes.arrayBuffer());
        const durationMs = estimateDurationMs(text);
        const timestamps = estimateWordTimestamps(text, durationMs);

        return { audio, mimeType: 'audio/mpeg', durationMs, timestamps, provider: 'fal' };
      }

      if (status.status === 'FAILED') {
        throw new Error(`fal.ai job failed: ${status.error || 'unknown error'}`);
      }
    } catch (pollErr: any) {
      if (pollErr.message?.includes('fal.ai job failed')) throw pollErr;
      // Transient poll error — keep trying
    }
  }

  throw new Error('fal.ai TTS timed out after 120s');
}

// ── Backend 4: Coqui TTS on Nosana GPU ──────────────────

async function generateWithCoqui(text: string, serviceUrl: string): Promise<TTSResult> {
  const url = `${serviceUrl.replace(/\/$/, '')}/api/tts?text=${encodeURIComponent(text)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.warn(`[AgentForge:TTS] Coqui TTS error (${res.status}): ${body.slice(0, 300)}`);
    throw new Error(`Coqui TTS failed (status: ${res.status})`);
  }

  const audio = Buffer.from(await res.arrayBuffer());
  const durationMs = estimateDurationMs(text);
  const timestamps = estimateWordTimestamps(text, durationMs);

  return { audio, mimeType: 'audio/wav', durationMs, timestamps, provider: 'coqui-nosana' };
}

// ── Router: TTS_API_KEY auto-detect + Coqui fallback ────

export async function generateTTS(text: string): Promise<TTSResult | null> {
  const nosanaKey = process.env.NOSANA_API_KEY;

  // Primary: use detected TTS provider from TTS_API_KEY
  if (ttsConfig.provider === 'elevenlabs') {
    try {
      console.log('[AgentForge:TTS] Using ElevenLabs TTS');
      return await generateWithElevenLabs(text, ttsConfig.apiKey);
    } catch (err: any) {
      console.warn(`[AgentForge:TTS] ElevenLabs failed: ${err.message}`);
    }
  }

  if (ttsConfig.provider === 'openai') {
    try {
      console.log('[AgentForge:TTS] Using OpenAI TTS');
      return await generateWithOpenAI(text, ttsConfig.apiKey);
    } catch (err: any) {
      console.warn(`[AgentForge:TTS] OpenAI TTS failed: ${err.message}`);
    }
  }

  if (ttsConfig.provider === 'falai') {
    try {
      console.log('[AgentForge:TTS] Using fal.ai PlayAI TTS');
      return await generateWithFal(text, ttsConfig.apiKey);
    } catch (err: any) {
      console.warn(`[AgentForge:TTS] fal.ai failed: ${err.message}`);
    }
  }

  // Fallback: Coqui TTS on Nosana GPU (no API key needed for TTS itself)
  if (nosanaKey && nosanaKey !== 'YOUR_NOSANA_API_KEY') {
    try {
      console.log('[AgentForge:TTS] Using Coqui TTS on Nosana GPU');
      const { getNosanaManager } = await import('./nosanaManager.js');
      const { TTS_SERVICE } = await import('./mediaServiceDefinitions.js');
      const manager = getNosanaManager();
      const serviceUrl = await manager.deployMediaService(TTS_SERVICE);
      return await generateWithCoqui(text, serviceUrl);
    } catch (err: any) {
      console.warn(`[AgentForge:TTS] Coqui/Nosana failed: ${err.message}`);
    }
  }

  console.log('[AgentForge:TTS] No TTS backend available, skipping audio generation');
  return null;
}
