// Nosana job definitions for dynamically-deployed media services.
// These are deployed on-demand by the orchestrator when no API key or manual endpoint is configured.

export interface MediaServiceConfig {
  name: string;
  jobDefinition: Record<string, any>;
  port: number;
  healthCheckPath: string;
  minVramGB: number;
  preferredMarket: string;
  bootTimeoutMs: number;
}

export const MEDIA_SERVICES: Record<string, MediaServiceConfig> = {

  'comfyui-flux': {
    name: 'ComfyUI (Flux Schnell)',
    port: 8188,
    healthCheckPath: '/api/v1/models',
    minVramGB: 12,
    preferredMarket: 'NVIDIA RTX 3090',
    bootTimeoutMs: 180_000,
    jobDefinition: {
      version: '0.1',
      type: 'container',
      meta: { trigger: 'api', system_requirements: { required_vram: 12 } },
      ops: [{
        type: 'container/run',
        id: 'comfyui-flux',
        args: {
          cmd: [],
          gpu: true,
          image: 'docker.io/nosana/comfyui:2.0.5',
          expose: 8188,
          resources: [{
            url: 'https://models.nosana.io/flux/schnell',
            type: 'S3',
            target: '/comfyui/models/checkpoints',
          }],
        },
      }],
    },
  },

  'comfyui-sdxl': {
    name: 'ComfyUI (SDXL)',
    port: 8188,
    healthCheckPath: '/api/v1/models',
    minVramGB: 8,
    preferredMarket: 'NVIDIA RTX 3080',
    bootTimeoutMs: 180_000,
    jobDefinition: {
      version: '0.1',
      type: 'container',
      meta: { trigger: 'api', system_requirements: { required_vram: 8 } },
      ops: [{
        type: 'container/run',
        id: 'comfyui-sdxl',
        args: {
          cmd: [],
          gpu: true,
          image: 'docker.io/nosana/comfyui:2.0.5',
          expose: 8188,
          resources: [{
            url: 'https://models.nosana.io/stable-diffusion/sd-xl',
            type: 'S3',
            target: '/comfyui/models/checkpoints',
          }],
        },
      }],
    },
  },

  'wan22-video': {
    name: 'Wan 2.2 Text-to-Video',
    port: 8188,
    healthCheckPath: '/api/v1/models',
    minVramGB: 22,
    preferredMarket: 'NVIDIA RTX 4090',
    bootTimeoutMs: 300_000,
    jobDefinition: {
      version: '0.1',
      type: 'container',
      meta: { trigger: 'api', system_requirements: { required_vram: 22 } },
      ops: [{
        type: 'container/run',
        id: 'wan22-video',
        args: {
          gpu: true,
          image: 'docker.io/nosana/comfyui:2.0.8',
          expose: 8188,
          resources: [
            {
              repo: 'Comfy-Org/Wan_2.1_ComfyUI_repackaged',
              type: 'HF',
              files: ['split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors'],
              target: '/comfyui/models/text_encoders/',
            },
            {
              repo: 'Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
              type: 'HF',
              files: ['split_files/vae/wan_2.1_vae.safetensors'],
              target: '/comfyui/models/vae/',
            },
            {
              repo: 'Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
              type: 'HF',
              files: [
                'split_files/diffusion_models/wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors',
                'split_files/diffusion_models/wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors',
              ],
              target: '/comfyui/models/diffusion_models/',
            },
            {
              repo: 'Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
              type: 'HF',
              files: [
                'split_files/loras/wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors',
                'split_files/loras/wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors',
              ],
              target: '/comfyui/models/loras/',
            },
          ],
        },
      }],
    },
  },

  'tts-coqui': {
    name: 'Coqui TTS Server',
    port: 5002,
    healthCheckPath: '/api/tts?text=test',
    minVramGB: 4,
    preferredMarket: 'NVIDIA RTX 3060',
    bootTimeoutMs: 300_000,
    jobDefinition: {
      version: '0.1',
      type: 'container',
      meta: { trigger: 'api' },
      ops: [{
        type: 'container/run',
        id: 'tts-coqui',
        args: {
          cmd: ['tts-server', '--model_name', 'tts_models/en/ljspeech/tacotron2-DDC', '--port', '5002'],
          gpu: true,
          image: 'docker.io/synesthesiam/coqui-tts:latest',
          expose: 5002,
        },
      }],
    },
  },

  'a1111-sd15': {
    name: 'AUTOMATIC1111 (SD 1.5)',
    port: 7860,
    healthCheckPath: '/sdapi/v1/sd-models',
    minVramGB: 4,
    preferredMarket: 'NVIDIA RTX 3060',
    bootTimeoutMs: 180_000,
    jobDefinition: {
      version: '0.1',
      type: 'container',
      meta: { trigger: 'api' },
      ops: [{
        type: 'container/run',
        id: 'a1111-sd15',
        args: {
          cmd: ['python', '-u', 'launch.py', '--listen', '--port', '7860', '--api'],
          gpu: true,
          image: 'docker.io/nosana/automatic1111:0.0.1',
          expose: 7860,
          resources: [{
            url: 'https://models.nosana.io/stable-diffusion/1.5',
            type: 'S3',
            target: '/stable-diffusion-webui/models/Stable-diffusion',
          }],
        },
      }],
    },
  },
};

export const PREFERRED_IMAGE_SERVICE = 'comfyui-flux';
export const FALLBACK_IMAGE_SERVICE = 'a1111-sd15';
export const VIDEO_SERVICE = 'wan22-video';
export const TTS_SERVICE = 'tts-coqui';
