/* ── Product Hunt GraphQL integration (best-effort) ──
   Supports keyword-based search with trending fallback.
   Never throws from public functions. */

import type { PHInspiration } from "./types";

interface CacheEntry {
  data: PHInspiration[];
  ts: number;
}

/** Result from PH fetch with mode metadata. */
export interface PHFetchResult {
  products: PHInspiration[];
  modeUsed: "keyword" | "trending";
  keywords: string[];
}

let trendingCache: CacheEntry | null = null;
const keywordCache = new Map<string, CacheEntry>();
const TTL = 10 * 60 * 1000; // 10 min

/* ── GraphQL queries ── */

const TRENDING_QUERY = `{
  posts(order: RANKING, first: 12) {
    edges {
      node {
        name
        tagline
        url
        topics { edges { node { name } } }
      }
    }
  }
}`;

function searchQuery(topic: string): string {
  return `{
  posts(order: RANKING, first: 6, topic: "${topic}") {
    edges {
      node {
        name
        tagline
        url
        topics { edges { node { name } } }
      }
    }
  }
}`;
}

/* ── Internal helpers ── */

function getToken(): string | undefined {
  return process.env.PRODUCT_HUNT_TOKEN;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parsePosts(edges: any[]): PHInspiration[] {
  return edges.map((e) => ({
    name: e.node.name,
    tagline: e.node.tagline,
    url: e.node.url ?? undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    topics: (e.node.topics?.edges ?? []).map((t: any) => t.node.name),
  }));
}

/** Last PH call error — exposed for logging in analyzer. */
export let lastPHError: { status: number; message: string } | null = null;

async function callPH(query: string): Promise<PHInspiration[]> {
  const token = getToken();
  if (!token) return [];

  lastPHError = null;

  const res = await fetch("https://api.producthunt.com/v2/api/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    lastPHError = { status: res.status, message: res.statusText || "unknown" };
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const edges: any[] = json?.data?.posts?.edges ?? [];
  return parsePosts(edges);
}

/** Deduplicate products by name (case-insensitive). */
function dedup(products: PHInspiration[]): PHInspiration[] {
  const seen = new Set<string>();
  return products.filter((p) => {
    const key = p.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ── Public API ── */

/** Check whether the in-memory PH cache is warm. */
export function isProductHuntCacheWarm(): boolean {
  return !!trendingCache && Date.now() - trendingCache.ts < TTL;
}

/**
 * Fetch PH products by keyword topics.
 * Tries up to 3 keyword queries, collects 8-12 products.
 * Falls back to trending if keyword results are too few (<6).
 * Never throws.
 */
export async function fetchProductHuntByKeywords(
  keywords: string[]
): Promise<PHFetchResult> {
  const token = getToken();
  if (!token) {
    return { products: [], modeUsed: "trending", keywords };
  }

  // Try keyword-based search (use top 3 keywords as topic queries)
  const searchKeywords = keywords.slice(0, 3);
  let collected: PHInspiration[] = [];

  try {
    for (const kw of searchKeywords) {
      // Check keyword cache
      const cacheKey = kw.toLowerCase();
      const cached = keywordCache.get(cacheKey);
      let results: PHInspiration[];

      if (cached && Date.now() - cached.ts < TTL) {
        results = cached.data;
      } else {
        results = await callPH(searchQuery(kw));
        keywordCache.set(cacheKey, { data: results, ts: Date.now() });
      }

      collected.push(...results);

      // Stop early if we have enough
      if (dedup(collected).length >= 12) break;
    }

    collected = dedup(collected).slice(0, 12);

    // If keyword search yielded enough, use it
    if (collected.length >= 6) {
      return { products: collected, modeUsed: "keyword", keywords: searchKeywords };
    }
  } catch {
    // Keyword search failed — fall through to trending
  }

  // Fallback: trending products
  try {
    const trending = await fetchProductHuntTrending();
    if (trending.length > 0) {
      // Merge any keyword results we did get
      const merged = dedup([...collected, ...trending]).slice(0, 12);
      return {
        products: merged,
        modeUsed: collected.length > 0 ? "keyword" : "trending",
        keywords: searchKeywords,
      };
    }
  } catch {
    /* ignore */
  }

  // Return whatever we have (even if empty)
  return {
    products: collected,
    modeUsed: collected.length > 0 ? "keyword" : "trending",
    keywords: searchKeywords,
  };
}

/**
 * Fetch trending PH products (original API, kept for backward compat).
 * Never throws.
 */
export async function fetchProductHuntTrending(): Promise<PHInspiration[]> {
  const token = getToken();
  if (!token) return [];

  if (trendingCache && Date.now() - trendingCache.ts < TTL) return trendingCache.data;

  try {
    const posts = await callPH(TRENDING_QUERY);
    trendingCache = { data: posts, ts: Date.now() };
    return posts;
  } catch {
    return [];
  }
}
