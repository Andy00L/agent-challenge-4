// AUTOMATIC1111 Stable Diffusion client — simpler API than ComfyUI

export class A1111Client {
  private baseUrl: string;

  constructor(endpoint: string) {
    this.baseUrl = endpoint.replace(/\/$/, '');
  }

  async generateImage(
    prompt: string,
    negativePrompt: string = '',
    width: number = 512,
    height: number = 512,
  ): Promise<{ base64: string }> {
    const res = await fetch(`${this.baseUrl}/sdapi/v1/txt2img`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        negative_prompt: negativePrompt || 'blurry, bad quality, distorted',
        steps: 20,
        width,
        height,
        cfg_scale: 7,
        sampler_name: 'Euler',
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`A1111 generation failed: ${res.status}`);
    const data = (await res.json()) as any;
    if (!data.images?.length) throw new Error('A1111 returned no images');
    return { base64: data.images[0] };
  }
}
