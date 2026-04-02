// ComfyUI client for Stable Diffusion image generation on Nosana GPU

export class ComfyUIClient {
  private baseUrl: string;
  private cachedCheckpoint: string | null = null;

  constructor(endpoint: string) {
    this.baseUrl = endpoint.replace(/\/$/, '');
  }

  /**
   * Discover available checkpoints on this ComfyUI instance.
   * Tries /api/v1/models, then /object_info/CheckpointLoaderSimple, then falls back.
   */
  async discoverCheckpoint(): Promise<string> {
    if (this.cachedCheckpoint) return this.cachedCheckpoint;

    try {
      const res = await fetch(`${this.baseUrl}/api/v1/models`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        const checkpoints = data.models || data.data || [];
        if (Array.isArray(checkpoints) && checkpoints.length > 0) {
          const name: string = checkpoints[0].name || checkpoints[0];
          this.cachedCheckpoint = name;
          console.log(`[AgentForge:ComfyUI] Discovered checkpoint: ${name}`);
          return name;
        }
      }
    } catch { /* try next method */ }

    try {
      const res = await fetch(`${this.baseUrl}/object_info/CheckpointLoaderSimple`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        const ckptOptions = data?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
        if (Array.isArray(ckptOptions) && ckptOptions.length > 0) {
          const name: string = ckptOptions[0];
          this.cachedCheckpoint = name;
          console.log(`[AgentForge:ComfyUI] Discovered checkpoint via object_info: ${name}`);
          return name;
        }
      }
    } catch { /* fall through to default */ }

    console.warn('[AgentForge:ComfyUI] Could not discover checkpoint, using default');
    this.cachedCheckpoint = 'model.safetensors';
    return 'model.safetensors';
  }

  /**
   * Generate an image using Stable Diffusion via ComfyUI API.
   * Queues a txt2img workflow, polls for completion, downloads the result.
   * Automatically discovers the available checkpoint model.
   * @returns base64 encoded image string and filename
   */
  async generateImage(
    prompt: string,
    negativePrompt: string = '',
    width: number = 512,
    height: number = 512,
  ): Promise<{ base64: string; filename: string }> {
    // Clamp dimensions to safe range to prevent GPU OOM
    width = Math.max(64, Math.min(2048, width));
    height = Math.max(64, Math.min(2048, height));
    const checkpoint = await this.discoverCheckpoint();

    const workflow: Record<string, any> = {
      '3': {
        class_type: 'KSampler',
        inputs: {
          seed: Math.floor(Math.random() * 1_000_000_000),
          steps: 20,
          cfg: 7,
          sampler_name: 'euler',
          scheduler: 'normal',
          denoise: 1,
          model: ['4', 0],
          positive: ['6', 0],
          negative: ['7', 0],
          latent_image: ['5', 0],
        },
      },
      '4': {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: checkpoint },
      },
      '5': {
        class_type: 'EmptyLatentImage',
        inputs: { width, height, batch_size: 1 },
      },
      '6': {
        class_type: 'CLIPTextEncode',
        inputs: { text: prompt, clip: ['4', 1] },
      },
      '7': {
        class_type: 'CLIPTextEncode',
        inputs: { text: negativePrompt || 'blurry, bad quality, distorted', clip: ['4', 1] },
      },
      '8': {
        class_type: 'VAEDecode',
        inputs: { samples: ['3', 0], vae: ['4', 2] },
      },
      '9': {
        class_type: 'SaveImage',
        inputs: { filename_prefix: 'agentforge', images: ['8', 0] },
      },
    };

    // 1. Queue the prompt
    const queueRes = await fetch(`${this.baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!queueRes.ok) throw new Error(`ComfyUI queue failed: ${queueRes.status}`);
    const { prompt_id } = (await queueRes.json()) as any;

    // 2. Poll for completion (max 120s for images)
    const start = Date.now();
    while (Date.now() - start < 120_000) {
      await new Promise(r => setTimeout(r, 3000));
      const histRes = await fetch(`${this.baseUrl}/history/${prompt_id}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!histRes.ok) continue;
      const history = (await histRes.json()) as any;
      const result = history[prompt_id];
      if (!result) continue;

      // Check for ComfyUI execution errors
      if (result.status?.status_str === 'error') {
        const errMsg = result.status?.messages?.map((m: any) => m[1]?.exception_message).filter(Boolean).join('; ') || 'unknown error';
        throw new Error(`ComfyUI execution failed: ${errMsg}`);
      }

      if (!result.outputs) continue;

      for (const nodeId of Object.keys(result.outputs)) {
        const output = result.outputs[nodeId];
        if (output.images?.length > 0) {
          const img = output.images[0];
          const imgRes = await fetch(
            `${this.baseUrl}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${encodeURIComponent(img.type || 'output')}`,
            { signal: AbortSignal.timeout(30_000) },
          );
          if (!imgRes.ok) throw new Error('Failed to download image from ComfyUI');
          const buffer = await imgRes.arrayBuffer();
          return { base64: Buffer.from(buffer).toString('base64'), filename: img.filename };
        }
      }
    }
    throw new Error('ComfyUI image generation timed out (120s)');
  }

}
