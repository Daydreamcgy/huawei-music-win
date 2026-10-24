// Pure colour helpers for the custom accent, kept separate so they can be unit tested without
// a DOM. Everything returns CSS colour strings ready to be written to custom properties.

export function hexToRgb(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function rgbToHsl([r, g, b]) {
  const red = r / 255; const green = g / 255; const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness * 100];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue;
  if (max === red) hue = ((green - blue) / delta + (green < blue ? 6 : 0));
  else if (max === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;
  return [hue * 60, saturation * 100, lightness * 100];
}

function hslToChannel(p, q, t) {
  let value = t;
  if (value < 0) value += 1;
  if (value > 1) value -= 1;
  if (value < 1 / 6) return p + (q - p) * 6 * value;
  if (value < 1 / 2) return q;
  if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
  return p;
}

export function hslToHex(hue, saturation, lightness) {
  const h = (((hue % 360) + 360) % 360) / 360;
  const s = Math.min(100, Math.max(0, saturation)) / 100;
  const l = Math.min(100, Math.max(0, lightness)) / 100;
  if (s === 0) {
    const gray = Math.round(l * 255);
    return `#${[gray, gray, gray].map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channels = [hslToChannel(p, q, h + 1 / 3), hslToChannel(p, q, h), hslToChannel(p, q, h - 1 / 3)]
    .map(channel => Math.round(Math.min(1, Math.max(0, channel)) * 255));
  return `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Derives the full accent palette from one picked colour. Lightness is shifted rather than
 * mixed with white/black so the hue is preserved at the edges of the scale.
 */
export function tintFromHex(hex) {
  const rgb = hexToRgb(hex);
  const normalized = rgb ? `#${rgb.map(c => c.toString(16).padStart(2, '0')).join('')}` : '#c8202e';
  const base = rgb ?? [200, 32, 46];
  const [hue, saturation, lightness] = rgbToHsl(base);
  return {
    accent: normalized,
    light: hslToHex(hue, saturation + 6, Math.min(92, lightness + 12)),
    deep: hslToHex(hue, Math.min(100, saturation + 4), Math.max(12, lightness - 14)),
    soft: `rgba(${base[0]}, ${base[1]}, ${base[2]}, 0.10)`,
    line: `rgba(${base[0]}, ${base[1]}, ${base[2]}, 0.30)`,
    shadow: `rgba(${base[0]}, ${base[1]}, ${base[2]}, 0.26)`,
  };
}

/** Builds a safe CSS font stack whose first entry is the user's chosen installed family. */
export function fontStackFor(family, fallback) {
  const cleaned = String(family ?? '').replace(/["'\\;{}<>]/g, '').trim().slice(0, 80);
  if (!cleaned) return fallback;
  return `"${cleaned}", ${fallback}`;
}
