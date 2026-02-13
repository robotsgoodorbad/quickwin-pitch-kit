/* ── 2-stage page reader: fetch-first, Playwright fallback ──
   Used by the analyzer's "Reading key pages" step.
   Playwright is opt-in via ENABLE_PLAYWRIGHT=true. */

export interface PageReadResult {
  url: string;
  ok: boolean;
  method: "fetch" | "playwright" | "none";
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
  return m ? m[1].trim() : undefined;
}

function extractHeadings(h: string): string[] {
  const out: string[] = [];
  const re = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(h)) !== null && out.length < 20) {
    const t = strip(m[1]);
    if (t.length > 2 && t.length < 200) out.push(t);
  }
  return out;
}

function extractNavLabels(h: string): string[] {
  const labels: string[] = [];
  const navs = h.match(/<nav[^>]*>([\s\S]*?)<\/nav>/gi) ?? [];
  for (const nav of navs.slice(0, 2)) {
    const re = /<a[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(nav)) !== null && labels.length < 20) {
      const t = strip(m[1]);
      if (t.length > 1 && t.length < 50) labels.push(t);
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
  // Strip scripts and styles first
  const clean = body
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  return strip(clean).length;
}

function parseHtml(html: string, url: string): Omit<PageReadResult, "ok" | "method"> {
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

/* ── Stage A: fetch reader ── */

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
      },
      redirect: "follow",
    });
    clearTimeout(t);
    if (!res.ok) return empty;

    const html = (await res.text()).slice(0, 300_000);
    const parsed = parseHtml(html, url);
    return {
      ...parsed,
      ok: true,
      method: "fetch",
    };
  } catch {
    return empty;
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
    // Dynamic import to avoid requiring Playwright when not enabled
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
      // Small wait for JS rendering
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
  return !r.ok || r.headings.length < 2 || r.textLen < 400;
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

  // Only try Playwright if fetch returned thin content
  if (PLAYWRIGHT_ENABLED) {
    const pwResult = await playwrightReader(url);
    if (pwResult.ok && !isThinResult(pwResult)) {
      return pwResult;
    }
    // If Playwright also thin, return whichever has more content
    if (pwResult.ok && pwResult.textLen > fetchResult.textLen) {
      return pwResult;
    }
  }

  // Return fetch result (even if thin) — better than nothing
  return fetchResult;
}

/**
 * Read the homepage + up to 2 key sub-pages.
 * Cap Playwright fallback to 2 pages total for speed.
 */
export async function readKeyPages(
  siteUrl: string
): Promise<{
  homepage: PageReadResult | null;
  keyPages: PageReadResult[];
  playwrightUsed: boolean;
  totalPages: number;
  totalHeadings: number;
}> {
  let playwrightUsed = false;

  // 1) Read homepage
  const home = await readPage(siteUrl);
  if (home.method === "playwright") playwrightUsed = true;

  if (!home.ok) {
    return { homepage: null, keyPages: [], playwrightUsed, totalPages: 0, totalHeadings: 0 };
  }

  // 2) Discover key sub-pages from nav links
  const KEY_RE = /\b(product|service|solution|pricing|about|features|platform|enterprise)\b/i;
  const keyUrls = home.links.filter((l) => KEY_RE.test(l)).slice(0, 2);

  // 3) Read sub-pages in parallel
  let pwCount = playwrightUsed ? 1 : 0;
  const keyPages: PageReadResult[] = [];

  for (const url of keyUrls) {
    const fetchResult = await fetchReader(url, 6000);
    if (!isThinResult(fetchResult)) {
      keyPages.push(fetchResult);
    } else if (PLAYWRIGHT_ENABLED && pwCount < 2) {
      const pwResult = await playwrightReader(url);
      if (pwResult.ok) {
        playwrightUsed = true;
        pwCount++;
        keyPages.push(pwResult);
      } else {
        // Use the fetch result (even if thin)
        if (fetchResult.ok) keyPages.push(fetchResult);
      }
    } else if (fetchResult.ok) {
      keyPages.push(fetchResult);
    }
  }

  const allPages = [home, ...keyPages];
  const totalHeadings = allPages.reduce((sum, p) => sum + p.headings.length, 0);

  return {
    homepage: home,
    keyPages,
    playwrightUsed,
    totalPages: allPages.length,
    totalHeadings,
  };
}
