// Video generation router — selects the best available backend
// Priority: fal.ai API > manual Wan endpoint > Nosana dynamic deploy > none

import { ComfyUIClient } from './comfyuiClient.js';

export type VideoGenBackend = 'fal' | 'wan-endpoint' | 'nosana-dynamic' | 'none';

export class VideoGenRouter {
  /**
   * Detect which video generation backend is available.
   */
  static detectBackend(): VideoGenBackend {
    if (process.env.FAL_KEY) return 'fal';
    if (process.env.WAN_VIDEO_ENDPOINT) return 'wan-endpoint';
    if (process.env.NOSANA_API_KEY && process.env.NOSANA_API_KEY !== 'YOUR_NOSANA_API_KEY') return 'nosana-dynamic';
    return 'none';
  }

  /**
   * Check if any video generation backend is configured.
   */
  static isAvailable(): boolean {
    return this.detectBackend() !== 'none';
  }

  /**
   * Generate a video using the best available backend.
   * Priority: fal.ai > manual Wan 2.2 endpoint > Nosana dynamic deploy
   */
  static async generate(
    prompt: string,
    durationSeconds: number = 4,
  ): Promise<{ url: string }> {
    const backend = this.detectBackend();

    if (backend === 'fal') {
      const { fal } = await (Function('return import("@fal-ai/client")')() as Promise<any>);
      fal.config({ credentials: process.env.FAL_KEY! });
      const result = (await fal.subscribe('fal-ai/minimax/hailuo-02/standard/text-to-video', {
        input: { prompt, duration: String(durationSeconds) },
      })) as any;
      const url = result.data?.video?.url || '';
      if (!url) throw new Error('fal.ai returned no video URL');
      return { url };
    }

    if (backend === 'wan-endpoint') {
      const client = new ComfyUIClient(process.env.WAN_VIDEO_ENDPOINT!);
      const result = await client.generateVideo(prompt, durationSeconds);
      return { url: result.url };
    }

    if (backend === 'nosana-dynamic') {
      const { getNosanaManager } = await import('./nosanaManager.js');
      const { VIDEO_SERVICE } = await import('./mediaServiceDefinitions.js');
      const manager = getNosanaManager();
      const serviceUrl = await manager.deployMediaService(VIDEO_SERVICE);
      const client = new ComfyUIClient(serviceUrl);
      const result = await client.generateVideo(prompt, durationSeconds);
      return { url: result.url };
    }

    throw new Error(
      'Video generation not configured. Set FAL_KEY, WAN_VIDEO_ENDPOINT, or NOSANA_API_KEY in .env',
    );
  }
}
