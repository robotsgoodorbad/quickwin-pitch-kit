/* ── Disambiguation: Wikidata-first with hardcoded fallback ──
   Short/ambiguous inputs (1-2 words) ALWAYS show a chooser. */

import type { DisambiguationOption } from "./types";
import { searchWikidata, candidatesToOptions } from "./enrichment/wikidata";
import { isUrl } from "./siteFetch";

/* ── Hardcoded known-ambiguous list (fallback + supplement) ── */

const KNOWN: Record<string, DisambiguationOption[]> = {
  apple: [
    { label: "Apple Inc.", description: "Technology — iPhone, Mac, iOS", domain: "apple.com", wikidataId: "Q312" },
    { label: "Apple Records", description: "Record label founded by The Beatles", domain: "applerecords.com", wikidataId: "Q213660" },
    { label: "Apple Federal Credit Union", description: "Financial institution", domain: "applefcu.org" },
  ],
  delta: [
    { label: "Delta Air Lines", description: "Major US airline", domain: "delta.com", wikidataId: "Q188920" },
    { label: "Delta Faucet", description: "Kitchen & bath fixtures", domain: "deltafaucet.com" },
    { label: "Delta Dental", description: "Dental insurance provider", domain: "deltadental.com" },
  ],
  mercury: [
    { label: "Mercury (fintech)", description: "Banking for startups", domain: "mercury.com" },
    { label: "Mercury Insurance", description: "Auto insurance company", domain: "mercuryinsurance.com" },
    { label: "Mercury Systems", description: "Defense electronics", domain: "mrcy.com" },
  ],
  amazon: [
    { label: "Amazon.com", description: "E-commerce & cloud computing", domain: "amazon.com", wikidataId: "Q3884" },
    { label: "Amazon (region)", description: "South American rainforest region" },
  ],
  atlas: [
    { label: "MongoDB Atlas", description: "Cloud database service", domain: "mongodb.com" },
    { label: "Atlas Copco", description: "Industrial equipment", domain: "atlascopco.com" },
    { label: "Atlas VPN", description: "VPN service provider", domain: "atlasvpn.com" },
  ],
  notion: [
    { label: "Notion", description: "Workspace & note-taking app", domain: "notion.so", wikidataId: "Q60747998" },
    { label: "Notion Capital", description: "European venture capital", domain: "notion.vc" },
  ],
  linear: [
    { label: "Linear", description: "Project management for teams", domain: "linear.app" },
    { label: "Linear Finance", description: "DeFi protocol", domain: "linear.finance" },
  ],
  spark: [
    { label: "Apache Spark", description: "Big data processing", domain: "spark.apache.org" },
    { label: "Spark Mail", description: "Email client by Readdle", domain: "sparkmailapp.com" },
    { label: "Spark Networks", description: "Online dating company", domain: "spark.net" },
  ],
  scout: [
    { label: "Scout APM", description: "Application monitoring", domain: "scoutapm.com" },
    { label: "Scout Motors", description: "Electric vehicles", domain: "scoutmotors.com" },
    { label: "Scout24", description: "Digital marketplace", domain: "scout24.com" },
  ],
  frontier: [
    { label: "Frontier Airlines", description: "US low-cost airline", domain: "flyfrontier.com" },
    { label: "Frontier Communications", description: "Telecom provider", domain: "frontier.com" },
  ],
  sage: [
    { label: "Sage (accounting)", description: "Accounting software", domain: "sage.com" },
    { label: "Sage Therapeutics", description: "Biopharmaceutical company", domain: "sagerx.com" },
  ],
};

/* ── Helpers ── */

/** True if input is likely ambiguous (1-2 words, not a URL, not clearly long). */
function isLikelyAmbiguous(input: string): boolean {
  const cleaned = input.trim();
  if (isUrl(cleaned)) return false;
  const words = cleaned.split(/\s+/);
  return words.length <= 2;
}

/** Merge Wikidata options with hardcoded options, deduplicating by label (case-insensitive). */
function mergeOptions(
  wikiOpts: DisambiguationOption[],
  hardcoded: DisambiguationOption[]
): DisambiguationOption[] {
  const seen = new Set<string>();
  const result: DisambiguationOption[] = [];

  // Wikidata options first (higher quality)
  for (const opt of wikiOpts) {
    const key = opt.label.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(opt);
    }
  }

  // Supplement with hardcoded options
  for (const opt of hardcoded) {
    const key = opt.label.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(opt);
    }
  }

  return result.slice(0, 6); // cap at 6 options
}

/* ── Synchronous check (for backwards compat) ── */

export function needsDisambiguation(input: string): boolean {
  const cleaned = input.trim().toLowerCase();
  if (isUrl(cleaned)) return false;
  const words = cleaned.split(/\s+/);
  if (words.length === 1 && KNOWN[cleaned]) return true;
  return false;
}

export function getDisambiguationOptions(input: string): DisambiguationOption[] {
  const cleaned = input.trim().toLowerCase();
  return KNOWN[cleaned] ?? [];
}

/* ── Async Wikidata-powered disambiguation ──
   Returns:
   - { needed: false } → clear single match or URL input
   - { needed: true, options } → multiple candidates for user to pick
   - { needed: false, autoResolved? } → auto-resolved with Wikidata profile
*/

export interface DisambiguationResult {
  needed: boolean;
  options?: DisambiguationOption[];
  /** When a single Wikidata match is found AND input is long enough to be unambiguous */
  autoResolved?: {
    wikidataId: string;
    label: string;
    description: string;
    website?: string;
  };
  /** Total Wikidata candidates found (for evidence) */
  candidatesCount: number;
}

export async function resolveDisambiguation(
  input: string
): Promise<DisambiguationResult> {
  if (isUrl(input)) {
    return { needed: false, candidatesCount: 0 };
  }

  const ambiguous = isLikelyAmbiguous(input);
  const hardcoded = getDisambiguationOptions(input);
  let wikiOptions: DisambiguationOption[] = [];
  let wikiCandidateCount = 0;

  // Try Wikidata search
  try {
    const candidates = await searchWikidata(input);
    wikiCandidateCount = candidates.length;

    if (candidates.length > 0) {
      wikiOptions = candidatesToOptions(candidates);
    }
  } catch {
    /* Wikidata failed — continue with hardcoded only */
  }

  // Combine Wikidata + hardcoded options
  const allOptions = mergeOptions(wikiOptions, hardcoded);

  // RULE 1: If input is short/ambiguous (1-2 words), ALWAYS show chooser
  //         as long as we have at least 2 options to show.
  if (ambiguous && allOptions.length >= 2) {
    return {
      needed: true,
      options: allOptions,
      candidatesCount: wikiCandidateCount,
    };
  }

  // RULE 2: If Wikidata found multiple candidates, show chooser
  if (wikiOptions.length >= 2) {
    return {
      needed: true,
      options: allOptions,
      candidatesCount: wikiCandidateCount,
    };
  }

  // RULE 3: If exactly 1 Wikidata match AND input is 3+ words (unambiguous),
  //         auto-resolve
  if (wikiOptions.length === 1 && !ambiguous) {
    const opt = wikiOptions[0];
    return {
      needed: false,
      autoResolved: {
        wikidataId: opt.wikidataId!,
        label: opt.label,
        description: opt.description,
        website: opt.domain ? `https://${opt.domain}` : undefined,
      },
      candidatesCount: wikiCandidateCount,
    };
  }

  // RULE 4: If we have hardcoded options only (Wikidata returned 0), show chooser
  if (hardcoded.length >= 2) {
    return {
      needed: true,
      options: hardcoded,
      candidatesCount: 0,
    };
  }

  // RULE 5: Single Wikidata result + ambiguous → still show chooser with a
  //         "None of these" option appended
  if (wikiOptions.length === 1 && ambiguous) {
    return {
      needed: true,
      options: [
        ...wikiOptions,
        {
          label: `"${input}" — use as-is`,
          description: "Proceed without Wikidata enrichment",
        },
      ],
      candidatesCount: wikiCandidateCount,
    };
  }

  // Nothing found — proceed without disambiguation
  return { needed: false, candidatesCount: 0 };
}
