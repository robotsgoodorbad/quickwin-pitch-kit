/* ── Theme type, defaults, and color utilities ── */

import type { Theme } from "./types";

export const DEFAULT_THEME: Theme = {
  primary: "#2563eb",
  accent: "#7c3aed",
  bg: "#fafafa",
  text: "#171717",
  source: "default",
};

/* ── Color conversions ── */

export function hexToRgb(hex: string): [number, number, number] | null {
  const cleaned = hex.replace(/^#/, "");
  if (cleaned.length === 3) {
    const r = parseInt(cleaned[0] + cleaned[0], 16);
    const g = parseInt(cleaned[1] + cleaned[1], 16);
    const b = parseInt(cleaned[2] + cleaned[2], 16);
    return [r, g, b];
  }
  if (cleaned.length >= 6) {
    const r = parseInt(cleaned.slice(0, 2), 16);
    const g = parseInt(cleaned.slice(2, 4), 16);
    const b = parseInt(cleaned.slice(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return [r, g, b];
  }
  return null;
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function rgbToHsl(
  r: number,
  g: number,
  b: number
): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

export function hslToRgb(
  h: number,
  s: number,
  l: number
): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

/** Derive an accent color by shifting hue +30° */
export function deriveAccent(primaryHex: string): string {
  const rgb = hexToRgb(primaryHex);
  if (!rgb) return DEFAULT_THEME.accent;
  const [h, s, l] = rgbToHsl(...rgb);
  const newH = (h + 30 / 360) % 1;
  const newL = Math.max(0.2, Math.min(0.6, l));
  const [r, g, b] = hslToRgb(newH, Math.min(s, 0.8), newL);
  return rgbToHex(r, g, b);
}

/** Relative luminance (0 = black, 1 = white) */
export function luminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function isNearWhite(r: number, g: number, b: number): boolean {
  return luminance(r, g, b) > 0.85;
}

export function isNearBlack(r: number, g: number, b: number): boolean {
  return luminance(r, g, b) < 0.12;
}

/** Saturation of a hex color (0–1). Returns 0 for unparseable values. */
export function saturation(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [, s] = rgbToHsl(...rgb);
  return s;
}

/** True when a color is too gray/desaturated to serve as a brand primary. */
export function isNearGray(hex: string): boolean {
  return saturation(hex) < 0.15;
}

/** Check if a hex color looks usable (not too light, not too dark, not too gray) */
export function isUsableColor(hex: string): boolean {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  const lum = luminance(...rgb);
  return lum > 0.08 && lum < 0.9;
}

/** Stricter usability check: also rejects near-gray. Good for brand primaries. */
export function isBrandUsable(hex: string): boolean {
  return isUsableColor(hex) && !isNearGray(hex);
}

/* ── Deterministic theme from company name ──
   When all sampling fails, derive a unique-ish color from the company name
   so each company gets a distinct theme even with the "default" source. */

function nameHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Create a deterministic Theme whose primary hue is derived from the company name.
 * The result has `source: "default"` but a company-specific color, so it never
 * looks identical for two different companies.
 */
export function deterministicThemeFromName(companyName: string): Theme {
  if (!companyName || companyName.trim().length === 0) return DEFAULT_THEME;

  const hash = nameHash(companyName.toLowerCase().trim());
  const hue = (hash % 360) / 360; // 0–1
  const saturation = 0.55 + (hash % 20) / 100; // 0.55–0.75
  const lightness = 0.42 + (hash % 10) / 100; // 0.42–0.52

  const [pr, pg, pb] = hslToRgb(hue, saturation, lightness);
  const primary = rgbToHex(pr, pg, pb);
  const accent = deriveAccent(primary);

  return {
    ...DEFAULT_THEME,
    primary,
    accent,
    source: "default",
    note: `Deterministic palette for "${companyName}"`,
  };
}
