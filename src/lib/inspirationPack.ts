/* ── Inspiration Pack builder ──
   Takes Product Hunt products + keywords and produces a structured
   InspirationPack with inferred features and common patterns.
   Purely deterministic — no AI calls. */

import type { PHInspiration, InspirationPack, InspirationProduct } from "./types";

/** Infer 2-3 feature bullets from a product's tagline and topics. */
function inferFeatures(product: PHInspiration): string[] {
  const features: string[] = [];

  // Extract key phrases from tagline
  const tagline = product.tagline || "";
  const tagWords = tagline.toLowerCase();

  // Pattern-match common value propositions
  if (/automat|ai-powered|ai\b|machine learning/i.test(tagWords))
    features.push("AI-powered automation");
  if (/collaborat|team|workspace|together/i.test(tagWords))
    features.push("Team collaboration");
  if (/analytic|dashboard|insight|metric|track/i.test(tagWords))
    features.push("Analytics dashboard");
  if (/api|integrat|connect|sync/i.test(tagWords))
    features.push("Integration / API connectivity");
  if (/design|ui|ux|beautiful|visual/i.test(tagWords))
    features.push("Visual design tools");
  if (/secur|privac|encrypt/i.test(tagWords))
    features.push("Security-first approach");
  if (/fast|speed|perform|instant|real-?time/i.test(tagWords))
    features.push("Real-time performance");
  if (/free|open.?source|affordable/i.test(tagWords))
    features.push("Accessible pricing");
  if (/manage|organiz|workflow|productiv/i.test(tagWords))
    features.push("Workflow management");
  if (/custom|personaliz|tailor/i.test(tagWords))
    features.push("Customizable experience");
  if (/notif|alert|monitor/i.test(tagWords))
    features.push("Smart notifications");
  if (/search|discover|find|explor/i.test(tagWords))
    features.push("Discovery / search");

  // Add topic-based features
  for (const topic of (product.topics || []).slice(0, 2)) {
    const t = topic.toLowerCase();
    if (!features.some((f) => f.toLowerCase().includes(t))) {
      features.push(`${topic} focus`);
    }
  }

  // If we still don't have enough, derive from tagline structure
  if (features.length === 0 && tagline.length > 10) {
    // Use first clause of tagline as a feature
    const firstClause = tagline.split(/[.!,—–-]/)[0].trim();
    if (firstClause.length > 5 && firstClause.length < 60) {
      features.push(firstClause);
    }
  }

  return features.slice(0, 3);
}

/** Derive 3-6 common patterns across a set of products. */
function deriveCommonPatterns(products: InspirationProduct[]): string[] {
  const patternCounts = new Map<string, number>();

  const featureKeys = [
    { pattern: /ai|automat|machine/i, label: "AI/automation is a core value prop — consider auto-generate, auto-suggest, or smart-fill features" },
    { pattern: /collaborat|team|share/i, label: "Collaboration features drive engagement — add sharing, commenting, or team views" },
    { pattern: /dashboard|analytic|metric/i, label: "Dashboards with key metrics create immediate demo value — show charts and KPIs" },
    { pattern: /integrat|api|connect/i, label: "Integrations multiply utility — even mock ones signal ecosystem thinking" },
    { pattern: /workflow|manage|organiz/i, label: "Workflow tools solve daily pain — add drag-drop, kanban, or step-by-step flows" },
    { pattern: /search|discover|find/i, label: "Search and discovery UIs feel powerful — add filters, facets, or smart recommendations" },
    { pattern: /custom|personaliz/i, label: "Personalization delights users — add preferences, saved views, or adaptive UI" },
    { pattern: /notif|alert|monitor/i, label: "Notifications create stickiness — add alerts, status updates, or activity feeds" },
    { pattern: /visual|design|beauti/i, label: "Visual polish matters — clean typography, consistent spacing, and micro-animations" },
    { pattern: /fast|speed|real-?time/i, label: "Perceived speed impresses — add optimistic UI, skeleton screens, or progress indicators" },
    { pattern: /secur|privac/i, label: "Trust signals matter — show badges, encryption notes, or privacy-first messaging" },
    { pattern: /free|open|accessib/i, label: "Low-barrier onboarding wins — make the demo instantly usable without sign-up" },
  ];

  for (const product of products) {
    const allText = [
      product.tagline,
      ...product.inferredFeatures,
      ...product.topics,
    ].join(" ");

    for (const { pattern, label } of featureKeys) {
      if (pattern.test(allText)) {
        patternCounts.set(label, (patternCounts.get(label) ?? 0) + 1);
      }
    }
  }

  // Sort by frequency and take top 3-6
  return [...patternCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label]) => label);
}

/**
 * Build an InspirationPack from Product Hunt products and search keywords.
 * Takes up to 12 products, infers features and common patterns.
 */
export function buildInspirationPack(
  products: PHInspiration[],
  keywords: string[],
  modeUsed: "keyword" | "trending"
): InspirationPack {
  const inspProducts: InspirationProduct[] = products.slice(0, 12).map((p) => ({
    name: p.name,
    tagline: p.tagline,
    url: p.url,
    topics: p.topics || [],
    inferredFeatures: inferFeatures(p),
  }));

  const commonPatterns = deriveCommonPatterns(inspProducts);

  // If we have too few patterns, add some universal ones
  if (commonPatterns.length < 3) {
    const universals = [
      "Clean, single-purpose UIs convert best — focus each page on one action",
      "Visual feedback on every interaction builds confidence — buttons, hovers, transitions",
      "Progressive disclosure keeps demos simple — show basics first, details on demand",
    ];
    for (const u of universals) {
      if (commonPatterns.length >= 6) break;
      if (!commonPatterns.includes(u)) commonPatterns.push(u);
    }
  }

  return {
    modeUsed,
    keywords,
    products: inspProducts,
    commonPatterns,
  };
}
