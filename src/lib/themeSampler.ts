/* ── Theme orchestrator ──
   Tries site CSS → favicon → default. Caches per origin for 30 min.
   Always captures favicon URL and optional logo. */

import { load } from "cheerio";
import type { Theme } from "./types";
import { DEFAULT_THEME, isBrandUsable, deterministicThemeFromName } from "./theme";
import { sampleThemeFromHtml } from "./styleSampler";
import { sampleThemeFromFavicon, findFaviconUrl } from "./faviconSampler";

/* ── In-memory cache ── */
const cache = new Map<string, { theme: Theme; ts: number }>();
const TTL = 30 * 60 * 1000; // 30 minutes

/** Check whether a theme for this origin is already cached. */
export function isThemeCached(siteUrl: string): boolean {
  try {
    const origin = new URL(siteUrl).origin;
    const entry = cache.get(origin);
    return !!entry && Date.now() - entry.ts < TTL;
  } catch {
    return false;
  }
}

/** Fetch homepage HTML with timeout */
async function fetchHomepage(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AmuseBouchenator/1.0)",
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const text = await res.text();
    return text.slice(0, 200_000);
  } catch {
    return null;
  }
}

/** Extract og:image URL if it looks like a logo (filename contains "logo" or image is small-ish). */
function findLogoUrl(html: string, siteUrl: string): string | undefined {
  try {
    const $ = load(html);
    const ogImage =
      $('meta[property="og:image"]').attr("content") ??
      $('meta[name="og:image"]').attr("content");
    if (!ogImage) return undefined;

    let fullUrl: string;
    try {
      fullUrl = new URL(ogImage, siteUrl).toString();
    } catch {
      return undefined;
    }

    // Only use if it looks like a logo (path/filename contains "logo")
    const lower = fullUrl.toLowerCase();
    if (
      lower.includes("logo") ||
      lower.includes("brand") ||
      lower.includes("icon")
    ) {
      return fullUrl;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/* ── Public API ── */

export async function getCompanyTheme(
  siteUrl?: string,
  companyName?: string
): Promise<Theme> {
  const baseMeta: Partial<Theme> = {
    companyName: companyName || undefined,
    radiusPx: 12, // sensible default
  };

  if (!siteUrl) {
    const fallback = companyName
      ? deterministicThemeFromName(companyName)
      : DEFAULT_THEME;
    return { ...fallback, ...baseMeta, note: "No website URL — using name-derived palette" };
  }

  // Check cache by origin
  let origin: string;
  try {
    origin = new URL(siteUrl).origin;
  } catch {
    return { ...DEFAULT_THEME, ...baseMeta, note: "Invalid URL" };
  }

  const cached = cache.get(origin);
  if (cached && Date.now() - cached.ts < TTL) {
    // Merge in companyName if it was updated
    return { ...cached.theme, ...baseMeta };
  }

  // Fetch homepage HTML once
  const html = await fetchHomepage(siteUrl);
  if (!html) {
    const detTheme = companyName
      ? deterministicThemeFromName(companyName)
      : DEFAULT_THEME;
    const fallback: Theme = {
      ...detTheme,
      ...baseMeta,
      note: "Could not fetch website — using name-derived palette",
    };
    cache.set(origin, { theme: fallback, ts: Date.now() });
    return fallback;
  }

  // Always extract favicon + logo regardless of color strategy
  const faviconUrl = findFaviconUrl(html, siteUrl);
  const logoUrl = findLogoUrl(html, siteUrl);
  const branding: Partial<Theme> = {
    ...baseMeta,
    faviconUrl,
    logoUrl: logoUrl || undefined,
  };

  // Strategy 1: Extract from site CSS / HTML (theme-color meta, CSS vars)
  let cssNote = "";
  try {
    const cssTheme = await sampleThemeFromHtml(html, siteUrl);
    if (cssTheme && cssTheme.source !== "default" && isBrandUsable(cssTheme.primary)) {
      const merged = { ...cssTheme, ...branding };
      cache.set(origin, { theme: merged, ts: Date.now() });
      return merged;
    }
    cssNote = cssTheme ? "CSS colors not brand-usable" : "no CSS brand colors found";
  } catch {
    cssNote = "CSS extraction error";
  }

  // Strategy 2: Sample dominant color from favicon (raster or SVG)
  let favNote = "";
  try {
    const favTheme = await sampleThemeFromFavicon(html, siteUrl);
    if (favTheme && favTheme.source === "favicon" && isBrandUsable(favTheme.primary)) {
      const merged: Theme = { ...favTheme, ...branding };
      cache.set(origin, { theme: merged, ts: Date.now() });
      return merged;
    }
    favNote = favTheme ? "favicon color too gray/unusable" : "favicon sampling returned nothing";
  } catch {
    favNote = "favicon sampling error";
  }

  // Fallback — neither strategy produced a brand-usable color.
  // Use deterministic palette so each company still gets a unique vibe.
  const detTheme = companyName
    ? deterministicThemeFromName(companyName)
    : DEFAULT_THEME;
  const fallback: Theme = {
    ...detTheme,
    ...branding,
    note: `No brand colors detected (${cssNote}; ${favNote}) — using name-derived palette`,
  };
  cache.set(origin, { theme: fallback, ts: Date.now() });
  return fallback;
}
