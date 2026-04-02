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
  const dataAudioRegex = /(data:audio\/[^;\s]+;base64,[A-Za-z0-9+/=]+)/g;
  const fleetMediaRegex = /\/fleet\/media\/[\w-]+/g;
  const watchVideoRegex = /\[Watch Video\]\(([^)]+)\)/g;

  const imageUrls = [
    ...(output.match(imageUrlRegex) || []),
    ...(output.match(fleetMediaRegex) || []).filter(u => u.includes('img-')),
  ];
  const videoUrls = [
    ...(output.match(videoUrlRegex) || []),
    ...(output.match(fleetMediaRegex) || []).filter(u => u.includes('video-')),
    ...Array.from(output.matchAll(watchVideoRegex)).map(m => m[1]),
  ];
  const audioUrls = [
    ...(output.match(audioUrlRegex) || []),
    ...(output.match(dataAudioRegex) || []),
    ...(output.match(fleetMediaRegex) || []).filter(u => u.includes('audio-')),
  ];

  return {
    hasImages: imageUrls.length > 0,
    hasVideo: videoUrls.length > 0,
    hasAudio: audioUrls.length > 0,
    imageUrls: [...new Set(imageUrls)],
    videoUrls: [...new Set(videoUrls)],
    audioUrls: [...new Set(audioUrls)],
  };
}
