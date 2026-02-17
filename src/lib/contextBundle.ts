/* ── ContextBundle: build, serialize to prompt, summarize for logs ──
   Single source of truth that flows from the analysis pipeline
   into idea generation. Nothing else is used. */

import type {
  CompanyContext,
  JobEvidence,
  Theme,
  ContextBundle,
  ContextBundlePage,
} from "./types";

/* ═══════════════════════════════════════════
   1. Build a ContextBundle from pipeline outputs
   ═══════════════════════════════════════════ */

export function buildContextBundle(
  ctx: CompanyContext,
  ev: JobEvidence,
  theme?: Theme
): ContextBundle {
  /* ── Company identity ── */
  const company: ContextBundle["company"] = {
    name: ctx.name,
    url: ctx.url,
    description: ctx.description,
    wikidataId: ctx.wikidataId,
    industryHints: ctx.industryHints ?? [],
  };

  /* ── Pages read ── */
  const pageItems: ContextBundlePage[] = ev.keyPages.map((url) => ({
    url,
    headings: [] as string[], // populated below
  }));
  // Distribute headings to homepage (first page) since that's where most live
  if (pageItems.length > 0 && ctx.headings?.length) {
    pageItems[0].headings = ctx.headings.slice(0, 20);
  }
  const thinContent =
    (ctx.headings?.length ?? 0) < 2 ||
    pageItems.length === 0;
  const pages: ContextBundle["pages"] = {
    items: pageItems,
    navLabels: ctx.navLabels ?? [],
    thinContent,
  };

  /* ── Brand signals ── */
  const brandFound = !!theme && theme.source !== "default";
  const brand: ContextBundle["brand"] = {
    found: brandFound,
    source: theme?.source,
    primary: theme?.primary,
    accent: theme?.accent,
    fontFamily: theme?.fontFamily,
    faviconUrl: theme?.faviconUrl,
  };

  /* ── Press / newsroom ── */
  const press: ContextBundle["press"] = {
    items: ev.pressLinks.map((url) => ({ url })),
    headlines: ctx.pressHeadlines ?? [],
  };

  /* ── GDELT external news ── */
  const gdelt: ContextBundle["gdelt"] = {
    items: (ev.news?.items ?? []).map((n) => ({
      title: n.title,
      source: n.source,
      url: n.url,
      date: n.date,
    })),
  };

  /* ── Product Hunt ── */
  const pack = ev.inspirationPack;
  const productHunt: ContextBundle["productHunt"] = {
    items: (pack?.products ?? []).map((p) => ({
      name: p.name,
      tagline: p.tagline,
      url: p.url,
    })),
    keywords: pack?.keywords ?? [],
    modeUsed: pack?.modeUsed,
    commonPatterns: pack?.commonPatterns ?? [],
  };

  return { company, pages, brand, press, gdelt, productHunt };
}

/* ═══════════════════════════════════════════
   2. Serialize ContextBundle → Gemini prompt text
   Only includes sections that have data.
   ═══════════════════════════════════════════ */

export function contextBundleToPrompt(b: ContextBundle): string {
  const parts: string[] = [];

  // Company
  parts.push(`Company: ${b.company.name}`);
  if (b.company.url) parts.push(`Website: ${b.company.url}`);
  if (b.company.description) parts.push(`Description: ${b.company.description}`);
  if (b.company.wikidataId) parts.push(`Wikidata ID: ${b.company.wikidataId}`);
  if (b.company.industryHints.length > 0)
    parts.push(`Industry/type: ${b.company.industryHints.join(", ")}`);

  // Pages
  if (b.pages.items.length > 0) {
    parts.push(`Key pages fetched: ${b.pages.items.map((p) => p.url).join(", ")}`);
    const allHeadings = b.pages.items.flatMap((p) => p.headings);
    if (allHeadings.length > 0)
      parts.push(`Key headings from site:\n  ${allHeadings.slice(0, 15).join("\n  ")}`);
  }
  if (b.pages.navLabels.length > 0)
    parts.push(`Navigation labels: ${b.pages.navLabels.join(", ")}`);

  // Press
  if (b.press.headlines.length > 0)
    parts.push(`Press headlines:\n  ${b.press.headlines.slice(0, 8).join("\n  ")}`);
  if (b.press.items.length > 0)
    parts.push(`Press/newsroom URLs (${b.press.items.length}): ${b.press.items.slice(0, 5).map((p) => p.url).join(", ")}`);

  // GDELT
  if (b.gdelt.items.length > 0) {
    const block = b.gdelt.items
      .slice(0, 5)
      .map((n) => `• ${n.title} (${n.source}${n.date ? ", " + n.date : ""})`)
      .join("\n  ");
    parts.push(`Recent external news (GDELT):\n  ${block}`);
  }

  // Product Hunt (via InspirationPack)
  if (b.productHunt.items.length > 0) {
    parts.push(
      `\n--- INSPIRATION PACK (${b.productHunt.items.length} products, mode: ${b.productHunt.modeUsed ?? "unknown"}, keywords: ${b.productHunt.keywords.join(", ")}) ---`
    );
    parts.push("Products for inspiration:");
    for (const p of b.productHunt.items.slice(0, 8)) {
      parts.push(`  • ${p.name}: ${p.tagline}`);
    }
    if (b.productHunt.commonPatterns.length > 0) {
      parts.push("");
      parts.push("Common patterns observed:");
      for (const pat of b.productHunt.commonPatterns) {
        parts.push(`  • ${pat}`);
      }
    }
  }

  return parts.join("\n\n");
}

/* ═══════════════════════════════════════════
   3. Summarize ContextBundle for compact server logs
   ═══════════════════════════════════════════ */

export interface ContextBundleSummary {
  line: string;       // compact one-liner
  preview: string;    // multi-line preview (redacted, no secrets)
}

export function summarizeContextBundleForLogs(b: ContextBundle): ContextBundleSummary {
  const allHeadings = b.pages.items.flatMap((p) => p.headings);
  const line = [
    `pages=${b.pages.items.length}`,
    `press=${b.press.items.length}`,
    `gdelt=${b.gdelt.items.length}`,
    `ph=${b.productHunt.items.length}`,
    `brand=${b.brand.found}`,
    `thinContent=${b.pages.thinContent}`,
  ].join(" ");

  const preview: string[] = [];

  if (b.pages.items.length > 0) {
    preview.push(`  pages: ${b.pages.items.slice(0, 3).map((p) => p.url).join(", ")}`);
    if (allHeadings.length > 0) {
      preview.push(`  headings(${allHeadings.length}): ${allHeadings.slice(0, 3).join("; ")}`);
    }
  }
  if (b.press.headlines.length > 0) {
    preview.push(`  press(${b.press.headlines.length}): ${b.press.headlines.slice(0, 3).join("; ")}`);
  }
  if (b.gdelt.items.length > 0) {
    preview.push(`  gdelt(${b.gdelt.items.length}): ${b.gdelt.items.slice(0, 3).map((n) => n.title).join("; ")}`);
  }
  if (b.productHunt.items.length > 0) {
    preview.push(`  ph(${b.productHunt.items.length}): ${b.productHunt.items.slice(0, 3).map((p) => p.name).join("; ")}`);
  }
  if (preview.length === 0) {
    preview.push("  (no external context gathered)");
  }

  return { line, preview: preview.join("\n") };
}
