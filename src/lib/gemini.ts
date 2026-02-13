/* ── Gemini-powered idea generation (server-only) ──
   Uses the official @google/generative-ai SDK.
   Reads GEMINI_API_KEY from process.env — never exposed to the browser.
   Throws on any failure so the caller can fall back gracefully. */

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Idea, CompanyContext, JobEvidence, InspirationPack } from "./types";

const MODEL = "gemini-2.0-flash";

/* ── Rich context builder ── */

function buildRichContext(ctx: CompanyContext, evidence?: JobEvidence): string {
  const parts: string[] = [`Company: ${ctx.name}`];
  if (ctx.url) parts.push(`Website: ${ctx.url}`);
  if (ctx.description) parts.push(`Description: ${ctx.description}`);

  // Wikidata enrichment
  if (ctx.wikidataId) parts.push(`Wikidata ID: ${ctx.wikidataId}`);
  if (ctx.industryHints?.length)
    parts.push(`Industry/type: ${ctx.industryHints.join(", ")}`);

  if (ctx.headings?.length)
    parts.push(`Key headings from site:\n  ${ctx.headings.slice(0, 15).join("\n  ")}`);
  if (ctx.navLabels?.length)
    parts.push(`Navigation labels: ${ctx.navLabels.join(", ")}`);

  // Press / newsroom
  if (ctx.pressHeadlines?.length)
    parts.push(`Press headlines:\n  ${ctx.pressHeadlines.slice(0, 8).join("\n  ")}`);
  if (evidence?.pressLinks?.length)
    parts.push(`Press URLs discovered (${evidence.pressLinks.length}): ${evidence.pressLinks.slice(0, 5).join(", ")}`);

  // External news (GDELT)
  const newsItems = evidence?.news?.items;
  if (newsItems?.length) {
    const newsBlock = newsItems
      .slice(0, 5)
      .map((n) => `• ${n.title} (${n.source}${n.date ? ", " + n.date : ""})`)
      .join("\n  ");
    parts.push(`Recent external news (via ${evidence?.news?.provider ?? "GDELT"}):\n  ${newsBlock}`);
  } else if (ctx.newsItems?.length) {
    parts.push(`News items: ${ctx.newsItems.slice(0, 5).join("; ")}`);
  }

  // Key pages fetched
  if (evidence?.keyPages?.length)
    parts.push(`Key pages we fetched: ${evidence.keyPages.join(", ")}`);

  return parts.join("\n\n");
}

/* ── Inspiration Pack section for prompt ── */

function buildInspirationSection(pack: InspirationPack): string {
  const lines: string[] = [
    `\n--- INSPIRATION PACK (${pack.products.length} products, mode: ${pack.modeUsed}, keywords: ${pack.keywords.join(", ")}) ---`,
    ``,
  ];

  // Products with inferred features
  lines.push(`Products for inspiration:`);
  for (const p of pack.products.slice(0, 8)) {
    const features = p.inferredFeatures.length
      ? ` [${p.inferredFeatures.join("; ")}]`
      : "";
    lines.push(`  • ${p.name}: ${p.tagline}${features}`);
  }

  // Common patterns
  if (pack.commonPatterns.length > 0) {
    lines.push(``);
    lines.push(`Common patterns observed:`);
    for (const pattern of pack.commonPatterns) {
      lines.push(`  • ${pattern}`);
    }
  }

  return lines.join("\n");
}

/* ── System prompt ── */

const IDEAS_SYSTEM = `You are a creative product strategist and prototype ideation expert.
Generate exactly 15 quick-win prototype ideas for the company described below.
The ideas should be web-app prototypes buildable with Next.js + Tailwind CSS.

IMPORTANT RULES:
- Exactly 3 ideas per effort level: "15min", "1hr", "4hr", "8hr", "1-3days"
- Order from easiest (15min) to most ambitious (1-3days)
- Each idea must be specific to the company's domain, products, and current news
- Use the gathered context (site content, press, news) to make ideas hyper-relevant
- Use the Inspiration Pack's common patterns to ground each idea in proven product patterns
- Each idea MUST include an "inspiredAngle" field: ONE sentence explaining the creative angle, tied to a pattern from the Inspiration Pack (do NOT name "Product Hunt" — just describe the pattern)
- Each idea should be a distinct, buildable, demo-worthy prototype

Output ONLY valid JSON — an array of 15 objects with these exact fields:
- title (string, concise and catchy)
- summary (string, 1-2 sentences describing the prototype)
- effort (string, one of: "15min", "1hr", "4hr", "8hr", "1-3days")
- outline (object with: pages: string[], components: string[], data: string[], niceToHave: string[])
- inspiredAngle (string, 1 sentence: the creative angle inspired by a common pattern)

Do NOT include any markdown formatting, code fences, or extra text — just the raw JSON array.`;

/* ── Public API ── */

export async function generateIdeasWithGemini(
  jobId: string,
  context: CompanyContext,
  evidence?: JobEvidence
): Promise<Idea[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not configured");

  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({
    model: MODEL,
    generationConfig: {
      temperature: 0.85,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
    },
  });

  const richCtx = buildRichContext(context, evidence);

  // Build inspiration section if available
  const inspirationSection = evidence?.inspirationPack
    ? buildInspirationSection(evidence.inspirationPack)
    : "";

  const prompt = `${IDEAS_SYSTEM}\n\n--- COMPANY CONTEXT ---\n${richCtx}${inspirationSection}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();

  // Parse — Gemini with responseMimeType:"application/json" should return clean JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Try extracting JSON from potential markdown fences
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = fenceMatch ? fenceMatch[1].trim() : text.trim();
    parsed = JSON.parse(jsonStr);
  }

  if (!Array.isArray(parsed) || parsed.length < 15) {
    throw new Error(`Expected 15 ideas, got ${Array.isArray(parsed) ? parsed.length : "non-array"}`);
  }

  return parsed.slice(0, 15).map((item: Record<string, unknown>, i: number) => ({
    id: `${jobId}-${i}`,
    jobId,
    title: (item.title as string) || "Untitled Idea",
    summary: (item.summary as string) || "",
    effort: (item.effort as Idea["effort"]) || "1hr",
    outline: {
      pages: ((item.outline as Record<string, unknown>)?.pages as string[]) || [],
      components: ((item.outline as Record<string, unknown>)?.components as string[]) || [],
      data: ((item.outline as Record<string, unknown>)?.data as string[]) || [],
      niceToHave: ((item.outline as Record<string, unknown>)?.niceToHave as string[]) || [],
    },
    inspiredAngle: (item.inspiredAngle as string) || undefined,
  }));
}
