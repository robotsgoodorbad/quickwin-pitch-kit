/* ── Keyword derivation for Product Hunt search ──
   Extracts 5-10 deterministic keywords from available company context:
   Wikidata industry/description, key page headings, press topics.
   All lowercase, deduped, max 10. */

import type { CompanyContext } from "./types";

/** Common stopwords to filter out. */
const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "it", "its", "this", "that", "as",
  "are", "was", "were", "be", "has", "have", "had", "do", "does", "did",
  "will", "can", "could", "would", "should", "may", "might", "shall",
  "not", "no", "nor", "so", "if", "then", "than", "too", "very",
  "just", "about", "up", "out", "new", "also", "more", "our", "we",
  "you", "your", "their", "all", "each", "every", "both", "few", "some",
  "any", "most", "other", "into", "over", "such", "only", "own", "same",
  "how", "what", "which", "who", "when", "where", "why",
  "company", "inc", "ltd", "llc", "corp", "corporation", "group",
  "solutions", "services", "platform",
]);

/** Extract meaningful words from a string. */
function extractWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

/** Score a word by how many sources it appears in (higher = more relevant). */
function scoreAndDedup(wordSources: string[][]): string[] {
  const freq = new Map<string, number>();
  for (const words of wordSources) {
    const unique = new Set(words);
    for (const w of unique) {
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word);
}

/**
 * Derive 5–10 search keywords from available company context.
 * Deterministic: lowercase, deduped, max 10.
 */
export function deriveKeywords(ctx: CompanyContext): string[] {
  const sources: string[][] = [];

  // Source 1: Wikidata industry hints (highest signal)
  if (ctx.industryHints?.length) {
    sources.push(ctx.industryHints.flatMap(extractWords));
  }

  // Source 2: Company description
  if (ctx.description) {
    sources.push(extractWords(ctx.description));
  }

  // Source 3: Key page headings (products/services/about)
  if (ctx.headings?.length) {
    sources.push(ctx.headings.slice(0, 10).flatMap(extractWords));
  }

  // Source 4: Navigation labels
  if (ctx.navLabels?.length) {
    sources.push(ctx.navLabels.flatMap(extractWords));
  }

  // Source 5: Press headlines
  if (ctx.pressHeadlines?.length) {
    sources.push(ctx.pressHeadlines.slice(0, 5).flatMap(extractWords));
  }

  // Source 6: News items
  if (ctx.newsItems?.length) {
    sources.push(ctx.newsItems.slice(0, 5).flatMap(extractWords));
  }

  if (sources.length === 0) {
    // Last resort: extract from company name itself
    const nameWords = extractWords(ctx.name);
    if (nameWords.length > 0) return nameWords.slice(0, 5);
    return [];
  }

  const ranked = scoreAndDedup(sources);

  // Filter out the company name itself (not useful as a PH search term)
  const companyWords = new Set(extractWords(ctx.name));
  const filtered = ranked.filter((w) => !companyWords.has(w));

  // If filtering removed everything, use unfiltered
  const final = filtered.length >= 3 ? filtered : ranked;

  return final.slice(0, 10);
}
