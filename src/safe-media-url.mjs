const allowedSuffixes = ['.dbankcdn.cn', '.tingmall.com', '.kuke.com'];

// Audio and companion resources (lyrics) share the same Huawei CDN allowlist.
export function isSafeResourceUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return false;
    const hostname = parsed.hostname.toLowerCase();
    return allowedSuffixes.some(suffix => hostname.endsWith(suffix) && hostname.length > suffix.length);
  } catch { return false; }
}

export function isSafeMediaUrl(value) {
  return isSafeResourceUrl(value);
}

export function shouldBlockMediaRequest(resourceType, url) {
  return resourceType === 'media' && !isSafeMediaUrl(url);
}
