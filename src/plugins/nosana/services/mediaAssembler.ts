// Media assembler — combines images + audio into a slideshow video via FFmpeg (async, non-blocking)

import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'fs';
import { join, resolve } from 'path';

const execFileAsync = promisify(execFile);

interface SceneMedia {
  sceneNumber: number;
  imagePath: string;
  durationSeconds: number;
  title: string;
}

/** Run an FFmpeg command asynchronously (does not block the event loop). */
async function runFFmpeg(args: string[]): Promise<void> {
  try {
    await execFileAsync('ffmpeg', args, { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });
  } catch (err: any) {
    const stderr = err.stderr?.toString().slice(0, 300) || '';
    throw new Error(`FFmpeg failed: ${stderr || err.message}`);
  }
}

/** Check if FFmpeg is installed (async). */
async function checkFFmpeg(): Promise<boolean> {
  try {
    await execFileAsync('ffmpeg', ['-version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export class MediaAssembler {
  private workDir: string;

  constructor() {
    this.workDir = join(process.cwd(), '.media-assembly', `job-${Date.now()}`);
    mkdirSync(this.workDir, { recursive: true });
  }

  /**
   * Download a media file from URL, base64 data URI, or local fleet endpoint.
   */
  async downloadMedia(source: string, filename: string): Promise<string> {
    // Sanitize filename to prevent path traversal (../../../etc/passwd)
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const outPath = join(this.workDir, safeName);
    // Defense-in-depth: verify resolved path is within workDir
    if (!resolve(outPath).startsWith(resolve(this.workDir))) {
      throw new Error(`Path traversal detected in filename: ${filename}`);
    }

    if (source.startsWith('data:')) {
      const base64Data = source.split(',')[1];
      writeFileSync(outPath, Buffer.from(base64Data, 'base64'));
    } else if (source.startsWith('http')) {
      const res = await fetch(source, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`Failed to download ${source}: ${res.status}`);
      writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
    } else if (source.startsWith('/fleet/media/')) {
      const baseUrl = `http://localhost:${process.env.FLEET_API_PORT || '3001'}`;
      const res = await fetch(`${baseUrl}${source}`, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`Failed to download fleet media: ${res.status}`);
      writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
    } else {
      throw new Error(`Unknown media source format: ${source.slice(0, 50)}`);
    }

    return outPath;
  }

  /**
   * Assemble a slideshow video from images + optional audio using FFmpeg (async).
   * Falls back to a markdown document if FFmpeg is not installed.
   * @returns path to the output file (MP4 or MD)
   */
  async assembleSlideshow(
    scenes: SceneMedia[],
    audioPath: string | null,
  ): Promise<string> {
    scenes.sort((a, b) => a.sceneNumber - b.sceneNumber);

    if (!(await checkFFmpeg())) {
      console.warn('[AgentForge:MediaAssembler] FFmpeg not available — returning images as markdown');
      const markdown = scenes
        .map(s => `## Scene ${s.sceneNumber}: ${s.title}\n\n![Scene ${s.sceneNumber}](${s.imagePath})\n\n*Duration: ${s.durationSeconds}s*`)
        .join('\n\n---\n\n');
      const mdPath = join(this.workDir, 'slideshow.md');
      writeFileSync(mdPath, markdown);
      return mdPath;
    }

    // Create FFmpeg concat file
    const concatLines: string[] = [];
    for (const scene of scenes) {
      concatLines.push(`file '${scene.imagePath.replace(/'/g, "'\\''")}'`);
      concatLines.push(`duration ${scene.durationSeconds}`);
    }
    if (scenes.length > 0) {
      concatLines.push(`file '${scenes[scenes.length - 1].imagePath.replace(/'/g, "'\\''")}'`);
    }
    const concatFile = join(this.workDir, 'concat.txt');
    writeFileSync(concatFile, concatLines.join('\n'));

    const outputPath = join(this.workDir, 'output.mp4');
    const vf = 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p';

    const args = ['-y', '-f', 'concat', '-safe', '0', '-i', concatFile];
    if (audioPath) {
      args.push('-i', audioPath);
    }
    args.push('-vf', vf, '-c:v', 'libx264', '-preset', 'fast', '-crf', '23');
    if (audioPath) {
      args.push('-c:a', 'aac', '-b:a', '128k', '-shortest');
    } else {
      args.push('-an');
    }
    args.push(outputPath);

    await runFFmpeg(args);

    if (!existsSync(outputPath)) {
      throw new Error('FFmpeg produced no output file');
    }

    return outputPath;
  }

  /**
   * Read a file into a base64 string for storage in the fleet media store.
   */
  readAsBase64(filePath: string): string {
    return readFileSync(filePath).toString('base64');
  }

  /**
   * Clean up the work directory to reclaim disk space.
   */
  cleanup(): void {
    try {
      rmSync(this.workDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}
