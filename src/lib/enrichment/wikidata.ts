/* ── Wikidata enrichment (free, no auth) ──
   Searches for company entities and fetches profile data.
   Uses the MediaWiki API (wbsearchentities + wbgetentities).
   Best-effort, never throws from public functions. */

import type { WikidataProfile, DisambiguationOption } from "../types";

const API = "https://www.wikidata.org/w/api.php";
const TIMEOUT = 6000;

/* ── Wikidata property IDs ── */
const P856 = "P856"; // official website
const P452 = "P452"; // industry
const P31 = "P31"; // instance of

/** Company-like keywords in descriptions (for filtering non-company results). */
const COMPANY_HINTS =
  /\b(company|corporation|inc\b|ltd\b|gmbh|plc\b|enterprise|firm|startup|organization|organisation|business|brand|manufacturer|provider|service|platform|software|tech|bank|airline|insurer)\b/i;

/* ── Internal helpers ── */

async function fetchJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  const res = await fetch(url, {
    signal: ctrl.signal,
    headers: { "User-Agent": "AmuseBouchenator/1.0 (demo app)" },
  });
  clearTimeout(timer);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Extract a simple string value from a Wikidata claim. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function claimStringValue(claims: any, prop: string): string | undefined {
  const arr = claims?.[prop];
  if (!Array.isArray(arr) || arr.length === 0) return undefined;
  const snak = arr[0]?.mainsnak;
  if (!snak) return undefined;
  // String-type value (e.g. P856 = URL)
  if (snak.datavalue?.type === "string") return snak.datavalue.value;
  return undefined;
}

/** Extract entity-reference IDs from a claim (e.g. P31, P452). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function claimEntityIds(claims: any, prop: string): string[] {
  const arr = claims?.[prop];
  if (!Array.isArray(arr)) return [];
  return arr
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((c: any) => c?.mainsnak?.datavalue?.value?.id)
    .filter(Boolean) as string[];
}

/** Resolve entity IDs to labels in batch. */
async function resolveLabels(ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const url =
    `${API}?action=wbgetentities&ids=${ids.join("|")}` +
    `&props=labels&languages=en&format=json&origin=*`;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await fetchJson(url)) as any;
    const result: Record<string, string> = {};
    for (const [id, entity] of Object.entries(data?.entities ?? {})) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      result[id] = (entity as any)?.labels?.en?.value ?? id;
    }
    return result;
  } catch {
    return {};
  }
}

/* ═══════════════════════════════════════════
   Public: search for company candidates
   ═══════════════════════════════════════════ */

export interface WikidataCandidate {
  id: string;
  label: string;
  description: string;
  website?: string;
  isLikelyCompany: boolean;
}

/**
 * Search Wikidata for company entities matching `query`.
 * Returns up to 5 likely-company candidates, enriched with website URL.
 * Never throws — returns empty array on failure.
 */
export async function searchWikidata(
  query: string
): Promise<WikidataCandidate[]> {
  if (!query || query.length < 2) return [];

  try {
    /* Step 1: text search */
    const searchUrl =
      `${API}?action=wbsearchentities&search=${encodeURIComponent(query)}` +
      `&language=en&type=item&limit=10&format=json&origin=*`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const searchData = (await fetchJson(searchUrl)) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawResults: any[] = searchData?.search ?? [];
    if (rawResults.length === 0) return [];

    /* Step 2: batch-fetch claims for all candidates (single API call) */
    const ids = rawResults.map((r) => r.id as string);
    const entUrl =
      `${API}?action=wbgetentities&ids=${ids.join("|")}` +
      `&props=claims|descriptions&languages=en&format=json&origin=*`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entData = (await fetchJson(entUrl)) as any;
    const entities = entData?.entities ?? {};

    /* Step 3: build candidates */
    const candidates: WikidataCandidate[] = [];

    for (const raw of rawResults) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entity: any = entities[raw.id];
      if (!entity) continue;

      const desc: string =
        entity.descriptions?.en?.value ?? raw.description ?? "";
      const claims = entity.claims ?? {};
      const website = claimStringValue(claims, P856);
      const hasWebsite = !!website;
      const instanceOf = claimEntityIds(claims, P31);
      // P31 values that indicate organizations/companies
      const orgLike = instanceOf.some((id) =>
        [
          "Q4830453", // business
          "Q783794", // company
          "Q6881511", // enterprise
          "Q43229", // organization
          "Q3918", // technology company
          "Q891723", // public company
          "Q431289", // brand
          "Q4611891", // internet company
          "Q18388277", // startup company
        ].includes(id)
      );

      const descHint = COMPANY_HINTS.test(desc);
      const isLikelyCompany = orgLike || hasWebsite || descHint;

      candidates.push({
        id: raw.id,
        label: raw.label ?? raw.id,
        description: desc,
        website,
        isLikelyCompany,
      });
    }

    // Prioritize company-like results, limit to 5
    candidates.sort((a, b) => {
      if (a.isLikelyCompany && !b.isLikelyCompany) return -1;
      if (!a.isLikelyCompany && b.isLikelyCompany) return 1;
      return 0;
    });

    return candidates.filter((c) => c.isLikelyCompany).slice(0, 5);
  } catch {
    return [];
  }
}

/* ═══════════════════════════════════════════
   Public: full profile for a selected entity
   ═══════════════════════════════════════════ */

/**
 * Fetch a full profile for a Wikidata entity.
 * Returns null on failure. Never throws.
 */
export async function getWikidataProfile(
  entityId: string
): Promise<WikidataProfile | null> {
  try {
    const url =
      `${API}?action=wbgetentities&ids=${entityId}` +
      `&props=claims|descriptions|labels&languages=en&format=json&origin=*`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await fetchJson(url)) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entity: any = data?.entities?.[entityId];
    if (!entity) return null;

    const label: string = entity.labels?.en?.value ?? entityId;
    const description: string = entity.descriptions?.en?.value ?? "";
    const claims = entity.claims ?? {};
    const website = claimStringValue(claims, P856);

    // Industry hints — resolve entity labels
    const industryIds = claimEntityIds(claims, P452);
    const instanceIds = claimEntityIds(claims, P31);
    const allLabelIds = [...new Set([...industryIds, ...instanceIds])];
    const labelMap = await resolveLabels(allLabelIds);

    const industryHints = [
      ...industryIds.map((id) => labelMap[id] ?? id),
      ...instanceIds.map((id) => labelMap[id] ?? id),
    ].filter(
      (h) =>
        h.length > 2 &&
        !["entity", "item"].includes(h.toLowerCase())
    );

    return {
      id: entityId,
      label,
      description,
      website: website || undefined,
      industryHints: [...new Set(industryHints)].slice(0, 5),
    };
  } catch {
    return null;
  }
}

/* ═══════════════════════════════════════════
   Public: convert candidates → disambiguation options
   ═══════════════════════════════════════════ */

export function candidatesToOptions(
  candidates: WikidataCandidate[]
): DisambiguationOption[] {
  return candidates.map((c) => ({
    label: c.label,
    description: c.description,
    domain: c.website
      ? (() => {
          try {
            return new URL(c.website).hostname.replace(/^www\./, "");
          } catch {
            return undefined;
          }
        })()
      : undefined,
    wikidataId: c.id,
  }));
}
