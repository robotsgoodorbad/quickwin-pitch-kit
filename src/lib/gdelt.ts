/* ── GDELT Doc API integration (free, no auth) ──
   Fetches recent news articles mentioning a company.
   Tries 30-day window first; falls back to 90 days if empty.
   Best-effort, never throws. */

import type { EvidenceNewsItem } from "./types";

/** Internal: run a single GDELT query with a given time span. */
async function queryGdelt(
  companyName: string,
  domain: string | undefined,
  timespan: string
): Promise<EvidenceNewsItem[]> {
  let q = `"${companyName}"`;
  if (domain) {
    q += ` domain:${domain}`;
  }
  const query = encodeURIComponent(q);
  const url =
    `https://api.gdeltproject.org/api/v2/doc/doc` +
    `?query=${query}&mode=artlist&maxrecords=5&format=json&timespan=${timespan}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  const res = await fetch(url, {
    signal: ctrl.signal,
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; AmuseBouchenator/1.0)",
    },
  });
  clearTimeout(timer);

  if (!res.ok) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const articles: any[] = data?.articles ?? [];

  return articles.slice(0, 5).map((a) => ({
    title: (a.title ?? "").trim(),
    source: (a.domain ?? "").replace(/^www\./, ""),
    url: a.url ?? "",
    date: a.seendate
      ? `${a.seendate.slice(0, 4)}-${a.seendate.slice(4, 6)}-${a.seendate.slice(6, 8)}`
      : undefined,
  }));
}

/**
 * Query GDELT for recent news about `companyName`.
 * Strategy:
 *  1. Try name + domain, last 30 days
 *  2. If empty: try name-only, last 30 days
 *  3. If still empty: try name + domain, last 90 days
 *  4. If still empty: try name-only, last 90 days
 * Returns up to 5 articles. Never throws.
 */
export async function fetchGdeltNews(
  companyName: string,
  domain?: string
): Promise<EvidenceNewsItem[]> {
  if (!companyName || companyName.length < 2) return [];

  try {
    // Strategy 1: name + domain, 30 days
    if (domain) {
      const results = await queryGdelt(companyName, domain, "30d");
      if (results.length > 0) return results;
    }

    // Strategy 2: name-only, 30 days
    {
      const results = await queryGdelt(companyName, undefined, "30d");
      if (results.length > 0) return results;
    }

    // Strategy 3: name + domain, 90 days
    if (domain) {
      const results = await queryGdelt(companyName, domain, "90d");
      if (results.length > 0) return results;
    }

    // Strategy 4: name-only, 90 days
    {
      const results = await queryGdelt(companyName, undefined, "90d");
      if (results.length > 0) return results;
    }

    return [];
  } catch {
    return [];
  }
}
