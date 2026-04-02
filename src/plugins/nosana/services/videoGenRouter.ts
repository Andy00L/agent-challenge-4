// Video is produced via the slideshow pipeline (scene images + TTS + FFmpeg).
// This file is kept as an empty stub for any stale imports.

export type VideoGenBackend = 'none';

export class VideoGenRouter {
  static detectBackend(): VideoGenBackend { return 'none'; }
  static isAvailable(): boolean { return false; }
}
