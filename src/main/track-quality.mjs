function declaredCodec(value) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (/\bflac\b/.test(normalized)) return 'flac';
  if (/\bmp3\b/.test(normalized) || normalized === 'audio/mpeg') return 'mp3';
  return undefined;
}

export function confirmedPlaybackQuality(playQuality, contentType) {
  const quality = String(playQuality ?? '');
  const codec = declaredCodec(contentType);
  if (quality === '3' && codec === 'flac') return 'lossless';
  if (quality === '1' && codec === 'mp3') return 'standard';
  return 'unknown';
}
