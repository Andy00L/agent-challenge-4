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

  'a1111-sd15': {
    name: 'AUTOMATIC1111 (SD 1.5)',
    port: 7860,
    healthCheckPath: '/sdapi/v1/sd-models',
    minVramGB: 4,
    preferredMarket: 'NVIDIA 3060',
    bootTimeoutMs: 300_000, // 5 min — SD 1.5 needs 3-4 min to boot + download 2GB model
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

export const IMAGE_SERVICE = 'a1111-sd15';
export const TTS_SERVICE = 'tts-coqui';
