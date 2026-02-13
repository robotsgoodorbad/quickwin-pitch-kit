/* ── Website fetching + lightweight HTML parsing ── */

interface PageData {
  url: string;
  title?: string;
  metaDescription?: string;
  headings: string[];
  navLabels: string[];
  links: string[];
}

export interface SiteData {
  url: string;
  homepage: PageData | null;
  keyPages: PageData[];
  pressPages: PageData[];
}

/* ── helpers ── */

async function fetchText(url: string, timeoutMs = 8000): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AmuseBouchenator/1.0)",
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      },
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const text = await res.text();
    return text.slice(0, 200_000);
  } catch {
    return null;
  }
}

function strip(html: string) {
  return html.replace(/<[^>]+>/g, "").trim().replace(/\s+/g, " ");
}

function extractTitle(h: string) {
  const m = h.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? strip(m[1]) : undefined;
}

function extractMetaDesc(h: string) {
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

function parsePage(html: string, url: string): PageData {
  return {
    url,
    title: extractTitle(html),
    metaDescription: extractMetaDesc(html),
    headings: extractHeadings(html),
    navLabels: extractNavLabels(html),
    links: extractLinks(html, url),
  };
}

const KEY_RE = /\b(product|service|solution|pricing|about|features|platform|enterprise)\b/i;
const PRESS_RE = /\b(press|newsroom|news|media|announcement|blog|stories)\b/i;

/** Common press/newsroom paths to probe when homepage links don't yield results. */
const PRESS_PATHS = ["/news", "/newsroom", "/press", "/press-releases", "/media", "/blog"];

/**
 * Best-effort press URL discovery:
 * 1) Homepage links matching PRESS_RE
 * 2) Probe common paths (HEAD request)
 * 3) Sitemap.xml URLs containing press/news/blog
 */
export async function discoverPressUrls(siteUrl: string): Promise<string[]> {
  const found: Set<string> = new Set();
  let origin: string;
  try {
    origin = new URL(siteUrl).origin;
  } catch {
    return [];
  }

  // 1) Probe common paths
  await Promise.all(
    PRESS_PATHS.map(async (path) => {
      try {
        const u = `${origin}${path}`;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        const res = await fetch(u, {
          method: "HEAD",
          signal: ctrl.signal,
          redirect: "follow",
          headers: { "User-Agent": "Mozilla/5.0 (compatible; AmuseBouchenator/1.0)" },
        });
        clearTimeout(timer);
        if (res.ok) found.add(u);
      } catch {
        /* skip */
      }
    })
  );

  // 2) Sitemap.xml — pull first 20 URLs containing news/press/blog
  try {
    const sitemapText = await fetchText(`${origin}/sitemap.xml`, 5000);
    if (sitemapText) {
      const locRe = /<loc>([\s\S]*?)<\/loc>/gi;
      let m: RegExpExecArray | null;
      let count = 0;
      while ((m = locRe.exec(sitemapText)) !== null && count < 20) {
        const loc = m[1].trim();
        if (PRESS_RE.test(loc)) {
          found.add(loc);
          count++;
        }
      }
    }
  } catch {
    /* skip */
  }

  return [...found].slice(0, 15);
}

/* ── public API ── */

export async function fetchSiteData(url: string): Promise<SiteData> {
  const result: SiteData = { url, homepage: null, keyPages: [], pressPages: [] };

  const homeHtml = await fetchText(url);
  if (!homeHtml) return result;

  result.homepage = parsePage(homeHtml, url);

  const allLinks = result.homepage.links;
  const keyUrls = allLinks.filter((l) => KEY_RE.test(l)).slice(0, 4);
  const pressUrls = allLinks.filter((l) => PRESS_RE.test(l)).slice(0, 2);

  const [keyPages, pressPages] = await Promise.all([
    Promise.all(
      keyUrls.map(async (u) => {
        const h = await fetchText(u, 5000);
        return h ? parsePage(h, u) : null;
      })
    ),
    Promise.all(
      pressUrls.map(async (u) => {
        const h = await fetchText(u, 5000);
        return h ? parsePage(h, u) : null;
      })
    ),
  ]);

  result.keyPages = keyPages.filter(Boolean) as PageData[];
  result.pressPages = pressPages.filter(Boolean) as PageData[];
  return result;
}

export function normalizeUrl(input: string): string {
  let url = input.trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) url = `https://${url}`;
  try {
    const p = new URL(url);
    return p.pathname === "/" || !p.pathname ? `${p.protocol}//${p.host}/` : url;
  } catch {
    return url;
  }
}

export function isUrl(input: string): boolean {
  const t = input.trim().toLowerCase();
  return (
    t.startsWith("http://") ||
    t.startsWith("https://") ||
    /^[a-z0-9][-a-z0-9]*\.[a-z]{2,}/i.test(t)
  );
}

export function extractDomainName(url: string): string {
  try {
    const p = new URL(url.startsWith("http") ? url : `https://${url}`);
    return p.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function domainToName(domain: string): string {
  return domain
    .replace(/\.\w+$/, "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
