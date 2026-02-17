/* ── 2-stage page reader: fetch-first, Playwright fallback ──
   Used by the analyzer's "Reading key pages" step.
   Playwright is opt-in via ENABLE_PLAYWRIGHT=true. */

import type { PageFetchAttempt } from "./types";

export interface PageReadResult {
  url: string;
  ok: boolean;
  method: "fetch" | "playwright" | "none";
  statusCode?: number;
  failReason?: string;
  title?: string;
  metaDescription?: string;
  headings: string[];
  navLabels: string[];
  links: string[];
  textLen: number;
}

/* ── HTML parsing helpers (shared) ── */

function strip(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim().replace(/\s+/g, " ");
}

function extractTitle(h: string): string | undefined {
  const m = h.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? strip(m[1]) : undefined;
}

function extractMetaDesc(h: string): string | undefined {
  const m =
    h.match(/<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["']/i) ||
    h.match(/<meta[^>]*content=["']([\s\S]*?)["'][^>]*name=["']description["']/i);
  if (m) return m[1].trim();
  const og =
    h.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([\s\S]*?)["']/i) ||
    h.match(/<meta[^>]*content=["']([\s\S]*?)["'][^>]*property=["']og:description["']/i);
  return og ? og[1].trim() : undefined;
}

function extractHeadings(h: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  // h1-h4 tags
  const re = /<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(h)) !== null && out.length < 25) {
    const t = strip(m[1]);
    if (t.length > 2 && t.length < 200 && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }

  // role="heading" elements
  const roleRe = /role=["']heading["'][^>]*>([\s\S]*?)<\//gi;
  while ((m = roleRe.exec(h)) !== null && out.length < 25) {
    const t = strip(m[1]);
    if (t.length > 2 && t.length < 200 && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }

  // If still very few headings, extract og:title as a signal
  if (out.length < 2) {
    const ogTitle =
      h.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([\s\S]*?)["']/i) ||
      h.match(/<meta[^>]*content=["']([\s\S]*?)["'][^>]*property=["']og:title["']/i);
    if (ogTitle) {
      const t = ogTitle[1].trim();
      if (t.length > 2 && !seen.has(t.toLowerCase())) {
        seen.add(t.toLowerCase());
        out.unshift(t);
      }
    }
  }

  return out;
}

function extractNavLabels(h: string): string[] {
  const labels: string[] = [];
  const navs = h.match(/<nav[^>]*>([\s\S]*?)<\/nav>/gi) ?? [];
  for (const nav of navs.slice(0, 3)) {
    const re = /<a[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(nav)) !== null && labels.length < 25) {
      const t = strip(m[1]);
      if (t.length > 1 && t.length < 50) labels.push(t);
    }
  }
  // Also try header links if nav yielded nothing
  if (labels.length === 0) {
    const headerRe = /<header[^>]*>([\s\S]*?)<\/header>/gi;
    const headers = [...h.matchAll(headerRe)];
    for (const hdr of headers.slice(0, 1)) {
      const re = /<a[^>]*>([\s\S]*?)<\/a>/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(hdr[1])) !== null && labels.length < 20) {
        const t = strip(m[1]);
        if (t.length > 1 && t.length < 50) labels.push(t);
      }
    }
  }
  return [...new Set(labels)];
}

function extractLinks(h: string, baseUrl: string): string[] {
  const links: string[] = [];
  const re = /href=["']([\s\S]*?)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(h)) !== null) {
    let href = m[1].trim();
    if (href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) continue;
    if (href.startsWith("/")) {
      try {
        const b = new URL(baseUrl);
        href = `${b.protocol}//${b.host}${href}`;
      } catch {
        continue;
      }
    }
    if (href.startsWith("http")) links.push(href);
  }
  return [...new Set(links)].slice(0, 200);
}

function bodyTextLength(html: string): number {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : html;
  const clean = body
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "");
  return strip(clean).length;
}

function parseHtml(html: string, url: string): Omit<PageReadResult, "ok" | "method" | "statusCode" | "failReason"> {
  return {
    url,
    title: extractTitle(html),
    metaDescription: extractMetaDesc(html),
    headings: extractHeadings(html),
    navLabels: extractNavLabels(html),
    links: extractLinks(html, url),
    textLen: bodyTextLength(html),
  };
}

/* ── Stage A: fetch reader (now tracks status codes) ── */

async function fetchReader(url: string, timeoutMs = 8000): Promise<PageReadResult> {
  const empty: PageReadResult = {
    url, ok: false, method: "fetch",
    headings: [], navLabels: [], links: [], textLen: 0,
  };

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    clearTimeout(t);

    if (!res.ok) {
      const reason =
        res.status === 403 ? "Blocked (403 Forbidden)" :
        res.status === 404 ? "Not found (404)" :
        res.status === 429 ? "Rate limited (429)" :
        res.status >= 500 ? `Server error (${res.status})` :
        `HTTP ${res.status}`;
      return { ...empty, statusCode: res.status, failReason: reason };
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("xhtml")) {
      return { ...empty, statusCode: res.status, failReason: `Non-HTML response (${contentType.split(";")[0]})` };
    }

    const html = (await res.text()).slice(0, 300_000);
    const parsed = parseHtml(html, res.url || url);
    return {
      ...parsed,
      url: res.url || url,
      ok: true,
      method: "fetch",
      statusCode: res.status,
    };
  } catch (err) {
    const reason = err instanceof Error && err.name === "AbortError"
      ? `Timeout (${timeoutMs}ms)`
      : err instanceof Error
        ? err.message.slice(0, 80)
        : "Unknown error";
    return { ...empty, failReason: reason };
  }
}

/* ── Stage B: Playwright reader (opt-in) ── */

const PLAYWRIGHT_ENABLED = process.env.ENABLE_PLAYWRIGHT === "true";

async function playwrightReader(url: string): Promise<PageReadResult> {
  const empty: PageReadResult = {
    url, ok: false, method: "playwright",
    headings: [], navLabels: [], links: [], textLen: 0,
  };

  if (!PLAYWRIGHT_ENABLED) return empty;

  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
      await page.waitForTimeout(2000);
      const html = await page.content();
      const parsed = parseHtml(html.slice(0, 300_000), url);
      return { ...parsed, ok: true, method: "playwright" };
    } finally {
      await browser.close();
    }
  } catch {
    return empty;
  }
}

/* ── Thin-page detection ── */

function isThinResult(r: PageReadResult): boolean {
  return !r.ok || (r.headings.length < 2 && r.textLen < 400);
}

/* ── Common sub-page paths to probe when link discovery fails ── */

const COMMON_KEY_PATHS = [
  "/about", "/about-us", "/products", "/services",
  "/features", "/solutions", "/platform", "/pricing",
  "/company", "/who-we-are",
];

/**
 * Probe common sub-page paths via HEAD then GET.
 * Returns up to `max` successful page reads.
 */
async function probeCommonSubPages(
  siteUrl: string,
  max: number
): Promise<{ pages: PageReadResult[]; attempts: PageFetchAttempt[] }> {
  let origin: string;
  try {
    origin = new URL(siteUrl).origin;
  } catch {
    return { pages: [], attempts: [] };
  }

  const attempts: PageFetchAttempt[] = [];
  const pages: PageReadResult[] = [];

  // HEAD-probe all in parallel first
  const headResults = await Promise.all(
    COMMON_KEY_PATHS.map(async (path) => {
      const url = `${origin}${path}`;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        const res = await fetch(url, {
          method: "HEAD",
          signal: ctrl.signal,
          redirect: "follow",
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; AmuseBouchenator/1.0)",
            Accept: "text/html,*/*;q=0.8",
          },
        });
        clearTimeout(timer);
        return { url, ok: res.ok, status: res.status };
      } catch {
        return { url, ok: false, status: 0 };
      }
    })
  );

  // GET the first `max` that responded with 200
  const okUrls = headResults.filter((r) => r.ok).slice(0, max);
  for (const { url, status } of okUrls) {
    const result = await fetchReader(url, 6000);
    const attempt: PageFetchAttempt = {
      url,
      status: result.ok ? "ok" : "empty",
      statusCode: result.statusCode ?? status,
      headingCount: result.headings.length,
      note: result.failReason,
    };
    attempts.push(attempt);
    if (result.ok) pages.push(result);
  }

  // Record failed probes for evidence
  for (const r of headResults) {
    if (!r.ok && !attempts.some((a) => a.url === r.url)) {
      attempts.push({
        url: r.url,
        status: r.status === 0 ? "timeout" : r.status === 403 ? "blocked" : r.status === 404 ? "not_found" : "error",
        statusCode: r.status || undefined,
      });
    }
  }

  return { pages, attempts };
}

/* ── Public API ── */

/**
 * Read a single page. Tries fetch first; if the result is thin,
 * falls back to Playwright (when ENABLE_PLAYWRIGHT=true).
 */
export async function readPage(url: string): Promise<PageReadResult> {
  const fetchResult = await fetchReader(url);

  if (!isThinResult(fetchResult)) {
    return fetchResult;
  }

  if (PLAYWRIGHT_ENABLED) {
    const pwResult = await playwrightReader(url);
    if (pwResult.ok && !isThinResult(pwResult)) {
      return pwResult;
    }
    if (pwResult.ok && pwResult.textLen > fetchResult.textLen) {
      return pwResult;
    }
  }

  return fetchResult;
}

export interface KeyPagesResult {
  homepage: PageReadResult | null;
  keyPages: PageReadResult[];
  playwrightUsed: boolean;
  totalPages: number;
  totalHeadings: number;
  attempts: PageFetchAttempt[];
  thinContent: boolean;
  thinNote?: string;
}

/**
 * Read the homepage + up to 3 key sub-pages.
 * 1) Discover sub-pages from homepage links
 * 2) If link discovery yields < 2 pages, probe common paths as fallback
 * Tracks all fetch attempts for diagnostics.
 */
export async function readKeyPages(siteUrl: string): Promise<KeyPagesResult> {
  let playwrightUsed = false;
  const attempts: PageFetchAttempt[] = [];

  // 1) Read homepage
  const home = await readPage(siteUrl);
  if (home.method === "playwright") playwrightUsed = true;

  attempts.push({
    url: home.url || siteUrl,
    status: home.ok ? "ok" : home.failReason?.includes("403") ? "blocked" :
      home.failReason?.includes("404") ? "not_found" :
      home.failReason?.includes("Timeout") ? "timeout" : "error",
    statusCode: home.statusCode,
    headingCount: home.headings.length,
    note: home.failReason,
  });

  // 2) Discover key sub-pages from homepage links (if homepage was OK)
  const KEY_RE = /\b(product|service|solution|pricing|about|features|platform|enterprise|company)\b/i;
  const keyUrls = home.ok ? home.links.filter((l) => KEY_RE.test(l)).slice(0, 3) : [];

  let pwCount = playwrightUsed ? 1 : 0;
  const keyPages: PageReadResult[] = [];

  for (const url of keyUrls) {
    const fetchResult = await fetchReader(url, 6000);
    attempts.push({
      url,
      status: fetchResult.ok ? "ok" : fetchResult.failReason?.includes("403") ? "blocked" : "error",
      statusCode: fetchResult.statusCode,
      headingCount: fetchResult.headings.length,
      note: fetchResult.failReason,
    });
    if (!isThinResult(fetchResult)) {
      keyPages.push(fetchResult);
    } else if (PLAYWRIGHT_ENABLED && pwCount < 2) {
      const pwResult = await playwrightReader(url);
      if (pwResult.ok) {
        playwrightUsed = true;
        pwCount++;
        keyPages.push(pwResult);
      } else if (fetchResult.ok) {
        keyPages.push(fetchResult);
      }
    } else if (fetchResult.ok) {
      keyPages.push(fetchResult);
    }
  }

  // 3) Fallback: if link discovery yielded < 2 sub-pages (or homepage failed), probe common paths
  if (keyPages.length < 2) {
    const needed = 3 - keyPages.length;
    const existingUrls = new Set([siteUrl, ...keyUrls, ...keyPages.map((p) => p.url)]);
    const { pages: probed, attempts: probeAttempts } = await probeCommonSubPages(siteUrl, needed);
    for (const p of probed) {
      if (!existingUrls.has(p.url)) {
        keyPages.push(p);
        existingUrls.add(p.url);
      }
    }
    for (const a of probeAttempts) {
      if (!attempts.some((ea) => ea.url === a.url)) {
        attempts.push(a);
      }
    }
  }

  const successfulPages = home.ok ? [home, ...keyPages] : keyPages;
  const totalHeadings = successfulPages.reduce((sum, p) => sum + p.headings.length, 0);

  // Detect thin content + determine note
  const thinContent = totalHeadings < 3 && (home.ok ? home.textLen < 500 : true);
  let thinNote: string | undefined;
  if (!home.ok) {
    thinNote = home.failReason
      ? `Homepage: ${home.failReason}`
      : "Homepage returned no content";
    if (keyPages.length > 0) {
      thinNote += ` (but ${keyPages.length} sub-page(s) OK)`;
    }
  } else if (thinContent) {
    thinNote = PLAYWRIGHT_ENABLED
      ? "Content appears JS-rendered even after Playwright"
      : "Content appears JS-rendered; try enabling Playwright (ENABLE_PLAYWRIGHT=true)";
  }

  return {
    homepage: home.ok ? home : null,
    keyPages,
    playwrightUsed,
    totalPages: successfulPages.length,
    totalHeadings,
    attempts,
    thinContent,
    thinNote,
  };
}
