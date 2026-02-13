/* ── Favicon dominant-color sampler ──
   Fetches the favicon and extracts a dominant *brand-like* color.
   Prefers saturated colors over frequent-but-gray ones.
   Also handles SVG favicons by parsing fill/stroke hex values.
   Runs server-side only. */

import { Jimp } from "jimp";
import { load } from "cheerio";
import type { Theme } from "./types";
import {
  DEFAULT_THEME,
  hexToRgb,
  rgbToHex,
  rgbToHsl,
  deriveAccent,
  isNearWhite,
  isNearBlack,
  isBrandUsable,
} from "./theme";

/* ── Favicon URL discovery ── */

/** Find favicon URL from HTML, fallback to /favicon.ico */
export function findFaviconUrl(html: string, siteUrl: string): string {
  try {
    const $ = load(html);
    // Try common favicon link tags, prefer larger / raster icons
    const selectors = [
      'link[rel="icon"][type="image/png"]',
      'link[rel="apple-touch-icon"]',
      'link[rel="icon"][type="image/svg+xml"]',
      'link[rel="shortcut icon"]',
      'link[rel="icon"]',
    ];
    for (const sel of selectors) {
      const href = $(sel).first().attr("href");
      if (href) {
        try {
          return new URL(href, siteUrl).toString();
        } catch {
          continue;
        }
      }
    }
  } catch {
    /* fall through */
  }
  // Default fallback
  try {
    const origin = new URL(siteUrl).origin;
    return `${origin}/favicon.ico`;
  } catch {
    return `${siteUrl}/favicon.ico`;
  }
}

/* ── Color bucket helpers ── */

/** Quantize a color channel to reduce variance (round to nearest 24) */
function quantize(v: number): number {
  return Math.round(v / 24) * 24;
}

interface Bucket {
  count: number;
  rSum: number;
  gSum: number;
  bSum: number;
}

/** Score a bucket — brand-useful colors score higher. */
function scoreBucket(bucket: Bucket): number {
  const r = Math.round(bucket.rSum / bucket.count);
  const g = Math.round(bucket.gSum / bucket.count);
  const b = Math.round(bucket.bSum / bucket.count);
  const [, sat] = rgbToHsl(r, g, b);
  // score = frequency × (1 + saturation boost)
  // This way a moderately frequent but saturated color beats a
  // very frequent but gray one.
  return bucket.count * (1 + sat * 3);
}

/* ── Raster favicon sampling ── */

/**
 * Extract a dominant *brand-like* color from a favicon image buffer.
 * Prefers saturated colors. Returns [r, g, b] or null.
 */
async function extractDominantColor(
  buffer: Buffer
): Promise<[number, number, number] | null> {
  const image = await Jimp.fromBuffer(buffer);
  const { width, height } = image;
  if (width < 1 || height < 1) return null;

  // Sample pixels, counting quantized color buckets
  const buckets = new Map<string, Bucket>();
  const step = Math.max(1, Math.floor(Math.min(width, height) / 32));

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const pixel = image.getPixelColor(x, y);
      // Jimp v1.6: pixel is 0xRRGGBBAA
      const r = (pixel >>> 24) & 0xff;
      const g = (pixel >>> 16) & 0xff;
      const b = (pixel >>> 8) & 0xff;
      const a = pixel & 0xff;

      // Skip transparent, near-white, near-black pixels
      if (a < 128) continue;
      if (isNearWhite(r, g, b)) continue;
      if (isNearBlack(r, g, b)) continue;

      const key = `${quantize(r)},${quantize(g)},${quantize(b)}`;
      const bucket = buckets.get(key) ?? { count: 0, rSum: 0, gSum: 0, bSum: 0 };
      bucket.count++;
      bucket.rSum += r;
      bucket.gSum += g;
      bucket.bSum += b;
      buckets.set(key, bucket);
    }
  }

  if (buckets.size === 0) return null;

  // Sort buckets by score (saturation-weighted frequency)
  const sorted = [...buckets.values()].sort(
    (a, b) => scoreBucket(b) - scoreBucket(a)
  );

  // Walk through candidates; return the first one that passes brand-usability
  for (const bucket of sorted) {
    const r = Math.round(bucket.rSum / bucket.count);
    const g = Math.round(bucket.gSum / bucket.count);
    const b = Math.round(bucket.bSum / bucket.count);
    const hex = rgbToHex(r, g, b);
    if (isBrandUsable(hex)) return [r, g, b];
  }

  // If nothing passes strict check, return the top-scored bucket anyway
  // (the orchestrator will do its own usability check)
  const top = sorted[0];
  return [
    Math.round(top.rSum / top.count),
    Math.round(top.gSum / top.count),
    Math.round(top.bSum / top.count),
  ];
}

/* ── SVG favicon color extraction ── */

const SVG_HEX_RE = /(?:fill|stroke|stop-color|color)\s*[:=]\s*["']?(#[0-9a-fA-F]{3,8})\b/gi;

/**
 * Extract a brand-usable color from SVG text by finding hex values
 * in fill/stroke/stop-color attributes.
 */
function extractColorFromSvg(svgText: string): string | null {
  SVG_HEX_RE.lastIndex = 0;
  const candidates: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = SVG_HEX_RE.exec(svgText)) !== null) {
    if (m[1]) candidates.push(m[1]);
  }
  // Return first brand-usable color
  for (const hex of candidates) {
    if (isBrandUsable(hex)) return hex;
  }
  return null;
}

/* ── Public API ── */

/**
 * Extract a Theme from the site's favicon.
 * Takes pre-fetched homepage HTML to find the favicon URL.
 * Returns Theme with source "favicon" if successful, null otherwise.
 */
export async function sampleThemeFromFavicon(
  html: string,
  siteUrl: string
): Promise<Theme | null> {
  try {
    const faviconUrl = findFaviconUrl(html, siteUrl);

    // Fetch favicon
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(faviconUrl, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AmuseBouchenator/1.0)",
      },
    });
    clearTimeout(timer);

    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") ?? "";

    // ── SVG favicons: parse text for fill/stroke colors ──
    if (contentType.includes("svg") || faviconUrl.endsWith(".svg")) {
      try {
        const svgText = await res.text();
        const svgColor = extractColorFromSvg(svgText);
        if (svgColor) {
          return {
            primary: svgColor,
            accent: deriveAccent(svgColor),
            bg: DEFAULT_THEME.bg,
            text: DEFAULT_THEME.text,
            source: "favicon",
            note: "Extracted color from SVG favicon",
            faviconUrl,
          };
        }
      } catch {
        /* SVG parse failed, continue */
      }
      return null;
    }

    // Skip HTML error pages
    if (contentType.includes("html")) return null;

    // ── Raster favicons: sample pixels ──
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length < 10) return null;

    const dominant = await extractDominantColor(buffer);
    if (!dominant) return null;

    const primary = rgbToHex(...dominant);

    // Final brand-usability gate: reject near-gray results
    if (!isBrandUsable(primary)) {
      return null;
    }

    const accent = deriveAccent(primary);

    return {
      primary,
      accent,
      bg: DEFAULT_THEME.bg,
      text: DEFAULT_THEME.text,
      source: "favicon",
      note: "Sampled dominant color from favicon",
      faviconUrl,
    };
  } catch {
    return null;
  }
}
