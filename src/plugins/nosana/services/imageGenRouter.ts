// Image generation router with automatic fallback chain.
// Priority: OpenAI DALL-E 3 → fal.ai Flux → manual endpoint → Nosana GPU deploy → none

import { ComfyUIClient } from './comfyuiClient.js';
import { A1111Client } from './a1111Client.js';

export type ImageGenBackend = 'openai-dalle' | 'fal' | 'comfyui' | 'a1111' | 'nosana-dynamic' | 'none';

// ── DALL-E backend ───────────────────────────────────────

async function generateWithOpenAIDalle(
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
    throw new Error(`DALL-E API error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json() as any;
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error('DALL-E returned no image data');
  return { base64: b64 };
}

// ── Router ───────────────────────────────────────────────

export class ImageGenRouter {
  /**
   * Detect which image generation backend is available (first match wins).
   */
  static detectBackend(): ImageGenBackend {
    const openaiKey = process.env.OPENAI_API_KEY;
    const openaiUrl = process.env.OPENAI_API_URL || '';
    if (openaiKey && openaiUrl.includes('openai.com')) return 'openai-dalle';
    if (process.env.FAL_KEY) return 'fal';
    if (process.env.COMFYUI_ENDPOINT) return 'comfyui';
    if (process.env.A1111_ENDPOINT) return 'a1111';
    if (process.env.NOSANA_API_KEY && process.env.NOSANA_API_KEY !== 'YOUR_NOSANA_API_KEY') return 'nosana-dynamic';
    return 'none';
  }

  static isAvailable(): boolean {
    return this.detectBackend() !== 'none';
  }

  /**
   * Generate an image using the best available backend with automatic fallback.
   * Tries each configured backend in priority order until one succeeds.
   */
  static async generate(
    prompt: string,
    width: number = 1024,
    height: number = 1024,
  ): Promise<{ base64?: string; url?: string }> {
    const openaiKey = process.env.OPENAI_API_KEY;
    const openaiUrl = process.env.OPENAI_API_URL || '';

    // Priority 1: OpenAI DALL-E 3
    if (openaiKey && openaiUrl.includes('openai.com')) {
      try {
        console.log('[AgentForge:ImageGen] Using OpenAI DALL-E 3');
        return await generateWithOpenAIDalle(prompt, openaiKey, width, height);
      } catch (err: any) {
        console.warn(`[AgentForge:ImageGen] DALL-E failed: ${err.message}, trying next`);
      }
    }

    // Priority 2: fal.ai Flux
    if (process.env.FAL_KEY) {
      try {
        console.log('[AgentForge:ImageGen] Using fal.ai Flux');
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

    // Priority 3: Manual ComfyUI endpoint
    if (process.env.COMFYUI_ENDPOINT) {
      try {
        console.log('[AgentForge:ImageGen] Using manual ComfyUI endpoint');
        const client = new ComfyUIClient(process.env.COMFYUI_ENDPOINT);
        const result = await client.generateImage(prompt, '', width, height);
        return { base64: result.base64 };
      } catch (err: any) {
        console.warn(`[AgentForge:ImageGen] ComfyUI failed: ${err.message}, trying next`);
      }
    }

    // Priority 4: Manual A1111 endpoint
    if (process.env.A1111_ENDPOINT) {
      try {
        console.log('[AgentForge:ImageGen] Using manual A1111 endpoint');
        const client = new A1111Client(process.env.A1111_ENDPOINT);
        const result = await client.generateImage(prompt, '', width, height);
        return { base64: result.base64 };
      } catch (err: any) {
        console.warn(`[AgentForge:ImageGen] A1111 failed: ${err.message}, trying next`);
      }
    }

    // Priority 5: Nosana GPU dynamic deploy (ComfyUI or A1111)
    if (process.env.NOSANA_API_KEY && process.env.NOSANA_API_KEY !== 'YOUR_NOSANA_API_KEY') {
      try {
        console.log('[AgentForge:ImageGen] Using Nosana GPU dynamic deploy');
        const { getNosanaManager } = await import('./nosanaManager.js');
        const { PREFERRED_IMAGE_SERVICE, FALLBACK_IMAGE_SERVICE } = await import('./mediaServiceDefinitions.js');
        const manager = getNosanaManager();

        let serviceUrl: string;
        let deployedService = PREFERRED_IMAGE_SERVICE;
        try {
          serviceUrl = await manager.deployMediaService(PREFERRED_IMAGE_SERVICE);
        } catch (primaryErr: any) {
          console.warn(`[AgentForge:ImageGen] Primary GPU service failed: ${primaryErr.message}, trying fallback`);
          serviceUrl = await manager.deployMediaService(FALLBACK_IMAGE_SERVICE);
          deployedService = FALLBACK_IMAGE_SERVICE;
        }

        if (deployedService.startsWith('a1111')) {
          const client = new A1111Client(serviceUrl);
          const result = await client.generateImage(prompt, '', width, height);
          return { base64: result.base64 };
        } else {
          const client = new ComfyUIClient(serviceUrl);
          const result = await client.generateImage(prompt, '', width, height);
          return { base64: result.base64 };
        }
      } catch (err: any) {
        console.warn(`[AgentForge:ImageGen] Nosana GPU failed: ${err.message}`);
      }
    }

    throw new Error(
      'Image generation not configured. Set OPENAI_API_KEY (with openai.com URL), FAL_KEY, COMFYUI_ENDPOINT, A1111_ENDPOINT, or NOSANA_API_KEY.',
    );
  }
}
