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

  'comfyui-sd15': {
    name: 'ComfyUI (SD 1.5)',
    port: 8188,
    healthCheckPath: '/system_stats',
    minVramGB: 4,
    preferredMarket: 'NVIDIA 3060',
    bootTimeoutMs: 600_000, // 10 min — SD 1.5 model download from S3 (4GB) takes 3-6 min on Nosana nodes
    jobDefinition: {
      version: '0.1',
      type: 'container',
      meta: { trigger: 'api' },
      ops: [{
        type: 'container/run',
        id: 'comfyui-sd15',
        args: {
          gpu: true,
          image: 'docker.io/nosana/comfyui:2.0.5',
          expose: 8188,
          resources: [{
            url: 'https://models.nosana.io/stable-diffusion/1.5',
            type: 'S3',
            target: '/comfyui/models/checkpoints',
          }],
        },
      }],
    },
  },

  'tts-coqui': {
    name: 'Coqui TTS Server',
    port: 5002,
    healthCheckPath: '/api/tts?text=test',
    minVramGB: 4,
    preferredMarket: 'NVIDIA 3060',
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
};

export const IMAGE_SERVICE = 'comfyui-sd15';
export const TTS_SERVICE = 'tts-coqui';
