/* ── Best-effort CSS/HTML style sampler ──
   Extracts brand colors + font from homepage HTML using cheerio.
   Runs server-side only. */

import { load } from "cheerio";
import type { Theme } from "./types";
import { DEFAULT_THEME, hexToRgb, rgbToHex, deriveAccent, isUsableColor } from "./theme";
import { findFaviconUrl } from "./faviconSampler";

/* ── Regex patterns for CSS variable names that often hold brand colors ── */
const COLOR_VAR_PATTERNS = [
  /--(?:brand|primary|accent|main|theme)[-_]?color\s*:\s*(#[0-9a-fA-F]{3,8})/gi,
  /--color[-_]?(?:brand|primary|accent|main|theme)\s*:\s*(#[0-9a-fA-F]{3,8})/gi,
  /--(?:brand|primary|accent)\s*:\s*(#[0-9a-fA-F]{3,8})/gi,
  /--(?:brand|primary|accent|main|theme)[-_]?color\s*:\s*rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/gi,
];

const FONT_VAR_PATTERNS = [
  /--(?:font[-_]?(?:family|sans|primary|brand|body|base))\s*:\s*["']?([^;"'\n}]+)/gi,
  /font-family\s*:\s*["']?([^;"'\n}]+)/gi,
];

/** Extract hex colors from CSS text using brand-related variable patterns */
function extractBrandColors(cssText: string): string[] {
  const colors: string[] = [];
  for (const pattern of COLOR_VAR_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(cssText)) !== null) {
      if (m[1] && m[1].startsWith("#")) {
        colors.push(m[1]);
      } else if (m[1] && m[2] && m[3]) {
        colors.push(rgbToHex(Number(m[1]), Number(m[2]), Number(m[3])));
      }
    }
  }
  return colors.filter(isUsableColor);
}

/** Extract font-family from CSS text */
function extractFonts(cssText: string): string | undefined {
  for (const pattern of FONT_VAR_PATTERNS) {
    pattern.lastIndex = 0;
    const m = pattern.exec(cssText);
    if (m?.[1]) {
      const font = m[1]
        .trim()
        .replace(/['"]/g, "")
        .replace(/\s*!important\s*/, "");
      // Skip generic CSS fonts and inherited values
      if (
        font &&
        !font.match(
          /^(inherit|initial|unset|revert|system-ui|sans-serif|serif|monospace|cursive|fantasy|var\()$/i
        )
      ) {
        return font;
      }
    }
  }
  return undefined;
}

/** Try to fetch a same-origin stylesheet (first one only) */
async function fetchFirstStylesheet(
  siteUrl: string,
  html: string
): Promise<string | null> {
  const $ = load(html);
  const links = $('link[rel="stylesheet"]').toArray();
  for (const el of links.slice(0, 2)) {
    const href = $(el).attr("href");
    if (!href) continue;
    let fullUrl: string;
    try {
      fullUrl = new URL(href, siteUrl).toString();
      const origin = new URL(siteUrl).origin;
      if (!fullUrl.startsWith(origin)) continue; // skip cross-origin
    } catch {
      continue;
    }
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(fullUrl, {
        signal: ctrl.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; AmuseBouchenator/1.0)",
        },
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const text = await res.text();
      return text.slice(0, 100_000); // limit
    } catch {
      continue;
    }
  }
  return null;
}

/* ── Public API ── */

/**
 * Extract a Theme from pre-fetched homepage HTML.
 * Returns a Theme with source "site-css" if successful, null otherwise.
 */
export async function sampleThemeFromHtml(
  html: string,
  siteUrl: string
): Promise<Theme | null> {
  try {
    const $ = load(html);

    /* ── 1. Check <meta name="theme-color"> (very reliable) ── */
    const themeColorMeta =
      $('meta[name="theme-color"]').attr("content") ??
      $('meta[name="msapplication-TileColor"]').attr("content");

    /* ── 2. Collect CSS text from inline <style> tags ── */
    let allCss = "";
    $("style").each((_, el) => {
      allCss += $(el).text() + "\n";
    });

    // Also check body/html style attributes
    const bodyStyle = $("body").attr("style") ?? "";
    const htmlStyle = $("html").attr("style") ?? "";
    allCss += bodyStyle + "\n" + htmlStyle + "\n";

    /* ── 3. Try to fetch first same-origin stylesheet ── */
    const externalCss = await fetchFirstStylesheet(siteUrl, html);
    if (externalCss) allCss += externalCss + "\n";

    /* ── 4. Extract colors ── */
    const cssColors = extractBrandColors(allCss);

    // Determine primary color
    let primary: string | undefined;
    if (themeColorMeta && isUsableColor(themeColorMeta)) {
      primary = themeColorMeta;
    } else if (cssColors.length > 0) {
      primary = cssColors[0];
    }

    if (!primary) return null;

    // Derive accent
    const accent = cssColors.length > 1 ? cssColors[1] : deriveAccent(primary);

    /* ── 5. Extract font ── */
    const fontFamily = extractFonts(allCss);

    /* ── 6. Find favicon URL ── */
    const faviconUrl = findFaviconUrl(html, siteUrl);

    return {
      primary,
      accent: isUsableColor(accent) ? accent : deriveAccent(primary),
      bg: DEFAULT_THEME.bg,
      text: DEFAULT_THEME.text,
      fontFamily,
      source: "site-css",
      note: `Extracted from ${themeColorMeta ? "theme-color meta" : "site CSS variables"}`,
      faviconUrl,
    };
  } catch {
    return null;
  }
}
