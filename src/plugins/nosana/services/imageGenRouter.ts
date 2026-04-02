// Image generation router with automatic fallback chain.
// Priority: SD 1.5 on Nosana → DALL-E 3 (with safety sanitize) → fal.ai Flux → manual endpoints → null
//
// Graceful degradation: returns null if all backends fail (caller handles text fallback).

import { A1111Client } from './a1111Client.js';

export type ImageGenBackend = 'nosana-sd15' | 'openai-dalle' | 'fal' | 'a1111' | 'comfyui' | 'none';

// ── DALL-E safety prompt sanitization ───────────────────

const UNSAFE_PATTERNS = [
  /\b(violent|violence|blood|gore|bloody|death|dead|kill|murder|corpse)\b/gi,
  /\b(nude|naked|sexual|erotic|nsfw|pornograph)\b/gi,
  /\b(weapon|gun|rifle|sword|knife|bomb|explosion|grenade)\b/gi,
  /\b(war|battle|combat|fight|attack|destroy|destruction|warfare)\b/gi,
  /\b(drug|cocaine|heroin|meth|marijuana|cannabis)\b/gi,
  /\b(terrorist|terrorism|extremist|suicide)\b/gi,
];

function sanitizeImagePrompt(prompt: string): string {
  let sanitized = prompt;
  for (const pattern of UNSAFE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '');
  }
  sanitized = sanitized.replace(/\s+/g, ' ').trim();

  if (sanitized.length < 20) {
    sanitized = `A beautiful detailed illustration: ${prompt.slice(0, 100).replace(/[^a-zA-Z0-9\s,.-]/g, '')}`;
  }

  console.log(`[AgentForge:ImageGen] Sanitized prompt: "${sanitized.slice(0, 80)}..."`);
  return sanitized;
}

// ── DALL-E backend ───────────────────────────────────────

async function generateWithDallE(
  prompt: string,
  apiKey: string,
  width: number = 1024,
  height: number = 1024,
): Promise<{ base64: string }> {
  const size = width >= 1792 ? '1792x1024'
    : height >= 1792 ? '1024x1792'
    : '1024x1024';

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size,
      response_format: 'b64_json',
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const isSafety = body.includes('safety') || body.includes('content_policy') || res.status === 400;
    if (isSafety) {
      throw new Error(`DALL-E safety rejection: ${body.slice(0, 200)}`);
    }
    throw new Error(`DALL-E API error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json() as any;
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error('DALL-E returned no image data');
  return { base64: b64 };
}

// ── Router ───────────────────────────────────────────────

export class ImageGenRouter {
  static detectBackend(): ImageGenBackend {
    if (process.env.NOSANA_API_KEY && process.env.NOSANA_API_KEY !== 'YOUR_NOSANA_API_KEY') return 'nosana-sd15';
    const openaiKey = process.env.OPENAI_API_KEY;
    const openaiUrl = process.env.OPENAI_API_URL || '';
    if (openaiKey && openaiUrl.includes('openai.com')) return 'openai-dalle';
    if (process.env.FAL_KEY) return 'fal';
    if (process.env.A1111_ENDPOINT) return 'a1111';
    if (process.env.COMFYUI_ENDPOINT) return 'comfyui';
    return 'none';
  }

  static isAvailable(): boolean {
    return this.detectBackend() !== 'none';
  }

  /**
   * Generate an image. Returns null if all backends fail (graceful degradation).
   * Tries backends in order: SD 1.5 Nosana → DALL-E 3 → fal.ai → manual endpoints.
   */
  static async generate(
    prompt: string,
    width: number = 1024,
    height: number = 1024,
  ): Promise<{ base64?: string; url?: string }> {
    const openaiKey = process.env.OPENAI_API_KEY;
    const openaiUrl = process.env.OPENAI_API_URL || '';

    // Backend 1: SD 1.5 on Nosana GPU (boot once, reuse for subsequent calls)
    if (process.env.NOSANA_API_KEY && process.env.NOSANA_API_KEY !== 'YOUR_NOSANA_API_KEY') {
      try {
        console.log('[AgentForge:ImageGen] Trying SD 1.5 on Nosana GPU...');
        const { getNosanaManager } = await import('./nosanaManager.js');
        const { IMAGE_SERVICE } = await import('./mediaServiceDefinitions.js');
        const manager = getNosanaManager();
        const serviceUrl = await manager.deployMediaService(IMAGE_SERVICE);
        const client = new A1111Client(serviceUrl);
        const result = await client.generateImage(prompt, '', width, height);
        console.log('[AgentForge:ImageGen] SD 1.5 Nosana success');
        return { base64: result.base64 };
      } catch (err: any) {
        console.warn(`[AgentForge:ImageGen] SD 1.5 Nosana failed: ${err.message}, trying next`);
      }
    }

    // Backend 2: DALL-E 3 (with safety sanitize + retry)
    if (openaiKey && openaiUrl.includes('openai.com')) {
      try {
        console.log('[AgentForge:ImageGen] Trying DALL-E 3...');
        return await generateWithDallE(prompt, openaiKey, width, height);
      } catch (err: any) {
        if (err.message?.includes('safety')) {
          console.log('[AgentForge:ImageGen] DALL-E safety rejection — sanitizing prompt and retrying...');
          try {
            const sanitized = sanitizeImagePrompt(prompt);
            return await generateWithDallE(sanitized, openaiKey, width, height);
          } catch (retryErr: any) {
            console.warn(`[AgentForge:ImageGen] DALL-E sanitized retry also failed: ${retryErr.message}`);
          }
        } else {
          console.warn(`[AgentForge:ImageGen] DALL-E failed: ${err.message}, trying next`);
        }
      }
    }

    // Backend 3: fal.ai Flux
    if (process.env.FAL_KEY) {
      try {
        console.log('[AgentForge:ImageGen] Trying fal.ai Flux...');
        const { fal } = await (Function('return import("@fal-ai/client")')() as Promise<any>);
        fal.config({ credentials: process.env.FAL_KEY! });
        const result = (await fal.subscribe('fal-ai/flux/schnell', {
          input: { prompt, image_size: { width, height } },
        })) as any;
        const url = result.data?.images?.[0]?.url || '';
        if (!url) throw new Error('fal.ai returned no image URL');
        return { url };
      } catch (err: any) {
        console.warn(`[AgentForge:ImageGen] fal.ai failed: ${err.message}, trying next`);
      }
    }

    // Backend 4: Manual A1111 endpoint
    if (process.env.A1111_ENDPOINT) {
      try {
        console.log('[AgentForge:ImageGen] Trying manual A1111 endpoint...');
        const client = new A1111Client(process.env.A1111_ENDPOINT);
        const result = await client.generateImage(prompt, '', width, height);
        return { base64: result.base64 };
      } catch (err: any) {
        console.warn(`[AgentForge:ImageGen] Manual A1111 failed: ${err.message}, trying next`);
      }
    }

    // Backend 5: Manual ComfyUI endpoint
    if (process.env.COMFYUI_ENDPOINT) {
      try {
        console.log('[AgentForge:ImageGen] Trying manual ComfyUI endpoint...');
        const { ComfyUIClient } = await import('./comfyuiClient.js');
        const client = new ComfyUIClient(process.env.COMFYUI_ENDPOINT);
        const result = await client.generateImage(prompt, '', width, height);
        return { base64: result.base64 };
      } catch (err: any) {
        console.warn(`[AgentForge:ImageGen] Manual ComfyUI failed: ${err.message}`);
      }
    }

    // All backends failed — return empty (caller handles graceful degradation)
    console.warn('[AgentForge:ImageGen] All image generation backends failed');
    throw new Error('All image generation backends failed. Check NOSANA_API_KEY, OPENAI_API_KEY, or FAL_KEY.');
  }
}
