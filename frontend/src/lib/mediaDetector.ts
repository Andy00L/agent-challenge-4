/** Validate that a URL is safe to render in src/href attributes */
function isSafeUrl(url: string): boolean {
  // Allow relative fleet media paths
  if (url.startsWith('/fleet/media/')) return true;
  // Allow data: URIs for audio only (capped at ~10MB)
  if (url.startsWith('data:audio/') && url.length < 14_000_000) return true;
  // Allow only http/https protocols
  if (url.startsWith('https://') || url.startsWith('http://')) return true;
  return false;
}

export function detectMediaInOutput(output: string): {
  hasImages: boolean;
  hasVideo: boolean;
  hasAudio: boolean;
  imageUrls: string[];
  videoUrls: string[];
  audioUrls: string[];
} {
  const imageUrlRegex = /(https?:\/\/\S+\.(png|jpg|jpeg|gif|webp))/gi;
  const videoUrlRegex = /(https?:\/\/\S+\.(mp4|webm|mov))/gi;
  const audioUrlRegex = /(https?:\/\/\S+\.(mp3|wav|ogg))/gi;
  const dataAudioRegex = /(data:audio\/[^;\s]+;base64,[A-Za-z0-9+/=]{1,14000000})/g;
  const fleetMediaRegex = /\/fleet\/media\/[\w-]+/g;
  const watchVideoRegex = /\[Watch Video\]\(([^)]+)\)/g;

  const imageUrls = [
    ...(output.match(imageUrlRegex) || []),
    ...(output.match(fleetMediaRegex) || []).filter(u => u.includes('img-')),
  ].filter(isSafeUrl);

  const videoUrls = [
    ...(output.match(videoUrlRegex) || []),
    ...(output.match(fleetMediaRegex) || []).filter(u => u.includes('video-')),
    ...Array.from(output.matchAll(watchVideoRegex)).map(m => m[1]),
  ].filter(isSafeUrl);

  const audioUrls = [
    ...(output.match(audioUrlRegex) || []),
    ...(output.match(dataAudioRegex) || []),
    ...(output.match(fleetMediaRegex) || []).filter(u => u.includes('audio-')),
  ].filter(isSafeUrl);

  return {
    hasImages: imageUrls.length > 0,
    hasVideo: videoUrls.length > 0,
    hasAudio: audioUrls.length > 0,
    imageUrls: [...new Set(imageUrls)],
    videoUrls: [...new Set(videoUrls)],
    audioUrls: [...new Set(audioUrls)],
  };
}
