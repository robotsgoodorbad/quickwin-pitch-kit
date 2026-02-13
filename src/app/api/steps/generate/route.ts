/* ── POST /api/steps/generate ──
   Gemini-powered build step generation with safe fallback.
   Returns BuildPlan + { used, durationMs }. */

import { NextResponse } from "next/server";
import { getIdea, getJob, getBuildPlan, storeBuildPlan } from "@/lib/jobStore";
import { generateMockBuildPlan } from "@/lib/mockGenerator";
import { DEFAULT_THEME } from "@/lib/theme";
import type {
  Idea,
  Theme,
  CompanyContext,
  JobEvidence,
  BuildStep,
  BuildPlan,
  InspirationPack,
} from "@/lib/types";

/* ── Slug + folder helpers (mirrored from ai.ts) ── */

function toSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function buildFolderName(companyName: string, ideaTitle: string): string {
  const co = toSlug(companyName).slice(0, 20);
  const idea = toSlug(ideaTitle).slice(0, 25);
  return `v01-${co}-${idea}`;
}

function buildTerminalSetup(folderName: string): string {
  return [
    `cd ~/Desktop`,
    `mkdir -p cursor-prototypes && cd cursor-prototypes`,
    `mkdir ${folderName} && cd ${folderName}`,
    `npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm`,
    `npm run dev`,
  ].join("\n");
}

/* ── Rich context builder for Gemini ── */

function buildStepContext(
  idea: Idea,
  ctx: CompanyContext,
  theme: Theme,
  evidence?: JobEvidence
): string {
  const lines: string[] = [];

  // Company identity
  lines.push(`=== COMPANY ===`);
  lines.push(`Name: ${ctx.name}`);
  if (ctx.url) lines.push(`Website: ${ctx.url}`);
  if (ctx.description) lines.push(`Description: ${ctx.description}`);
  if (ctx.industryHints?.length)
    lines.push(`Industry: ${ctx.industryHints.join(", ")}`);
  if (ctx.wikidataId) lines.push(`Wikidata: ${ctx.wikidataId}`);

  // Key page summary
  if (ctx.headings?.length) {
    lines.push(`\n=== KEY PAGE HIGHLIGHTS ===`);
    lines.push(ctx.headings.slice(0, 12).map((h) => `• ${h}`).join("\n"));
  }

  // Press/news
  if (ctx.pressHeadlines?.length) {
    lines.push(`\n=== PRESS TOPICS ===`);
    lines.push(ctx.pressHeadlines.slice(0, 5).map((h) => `• ${h}`).join("\n"));
  }
  if (evidence?.news?.items?.length) {
    lines.push(`\n=== RECENT NEWS (${evidence.news.provider}) ===`);
    lines.push(
      evidence.news.items
        .slice(0, 5)
        .map((n) => `• ${n.title} (${n.source})`)
        .join("\n")
    );
  }

  // Inspiration Pack
  const pack: InspirationPack | undefined = evidence?.inspirationPack;
  if (pack) {
    lines.push(`\n=== INSPIRATION PATTERNS ===`);
    if (pack.commonPatterns.length > 0) {
      lines.push(pack.commonPatterns.map((p) => `• ${p}`).join("\n"));
    }
    if (pack.products.length > 0) {
      lines.push(`\nTop products for reference:`);
      for (const p of pack.products.slice(0, 6)) {
        const feats = p.inferredFeatures.length
          ? ` [${p.inferredFeatures.join("; ")}]`
          : "";
        lines.push(`  • ${p.name}: ${p.tagline}${feats}`);
      }
    }
  }

  // Selected idea
  lines.push(`\n=== SELECTED IDEA ===`);
  lines.push(`Title: ${idea.title}`);
  lines.push(`Summary: ${idea.summary}`);
  lines.push(`Effort: ${idea.effort}`);
  if (idea.inspiredAngle) lines.push(`Inspired angle: ${idea.inspiredAngle}`);
  lines.push(`Pages: ${idea.outline.pages.join(", ")}`);
  lines.push(`Components: ${idea.outline.components.join(", ")}`);
  lines.push(`Data: ${idea.outline.data.join(", ")}`);
  if (idea.outline.niceToHave.length)
    lines.push(`Nice-to-have: ${idea.outline.niceToHave.join(", ")}`);

  // Brand Vibe Pack
  const t = { ...DEFAULT_THEME, ...theme };
  const companyName = t.companyName || ctx.name || idea.title.split(" ")[0];
  const radius = t.radiusPx ?? 12;
  lines.push(`\n=== BRAND VIBE PACK ===`);
  lines.push(`primary: ${t.primary}`);
  lines.push(`accent: ${t.accent}`);
  lines.push(`bg: ${t.bg}`);
  lines.push(`text: ${t.text}`);
  lines.push(
    `fontFamily: ${t.fontFamily || "system-ui, -apple-system, sans-serif"}`
  );
  lines.push(`radiusPx: ${radius}`);
  lines.push(`companyName: ${companyName}`);
  if (t.faviconUrl) lines.push(`faviconUrl: ${t.faviconUrl}`);
  if (t.logoUrl) lines.push(`logoUrl: ${t.logoUrl}`);

  return lines.join("\n");
}

/* ── Gemini system prompt ── */

const GEMINI_STEPS_SYSTEM = `You are an expert engineering coach who writes Cursor AI prompts.
Generate a build plan for a STANDALONE Next.js prototype (its own fresh app, main page: src/app/page.tsx).

OUTPUT: valid JSON with these exact fields:
{
  "bmadExplanation": "2-3 sentences about BMAD roles",
  "prompt1": { "role": "PM+UX", "title": "Brand + skeleton", "goal": "...", "promptText": "...", "doneLooksLike": ["bullet1","bullet2","bullet3"] },
  "prompt2": { "role": "FE", "title": "Make it real", "goal": "...", "promptText": "...", "doneLooksLike": ["bullet1","bullet2","bullet3"] },
  "prompt3": { "role": "FE+QA", "title": "Fix + polish", "goal": "...", "promptText": "...", "doneLooksLike": ["bullet1","bullet2","bullet3"] }
}

CRITICAL RULES:
1. promptText MUST start with "BMAD ROLE: <ROLE> — <1 sentence role instruction>" on the first line.
2. prompt1 (PM+UX) MUST:
   - Assume the app is a FRESH standalone Next.js project already scaffolded (Prompt 0 handled that).
   - Replace src/app/page.tsx with a branded skeleton using "use client".
   - Apply the Brand Vibe Pack values via CSS variables (--ab-primary, --ab-accent, --ab-bg, --ab-text, --ab-font).
   - Create src/lib/prototypeTheme.ts with the exact brand values.
   - Build: header (company name + "Prototype" badge, favicon if provided), hero, placeholder sections with TODO markers.
   - Buttons/cards/links styled with the theme vars.
   - Do NOT implement real features — skeleton + TODOs only.
3. prompt2 (FE) MUST:
   - Replace every TODO with working implementation specific to this idea.
   - Wire mock data, add state, make buttons trigger visible changes.
   - Keep all styling using existing theme vars.
   - Keep it simple and demo-safe.
4. prompt3 (FE+QA, optional) MUST:
   - Fix TS/ESLint/runtime errors.
   - Add empty state, tighten spacing, add one microinteraction.
   - No new npm packages. No big checklist.
5. doneLooksLike: max 3 bullets each.
6. Make promptText specific, actionable, and detailed — it's pasted verbatim into Cursor.
7. NEVER reference /p/<slug> routes. Use src/app/page.tsx.
8. Output ONLY the JSON. No markdown, no fences, no explanation.`;

/* ── Gemini config (env-driven) ── */

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const GEMINI_API_VERSION = process.env.GEMINI_API_VERSION || "v1beta";

/* ── Gemini SDK call with timeout ── */

async function callGeminiForSteps(
  contextBlock: string
): Promise<GeminiResponse | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  try {
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel(
      {
        model: GEMINI_MODEL,
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 6144,
          responseMimeType: "application/json",
        },
      },
      { apiVersion: GEMINI_API_VERSION }
    );

    const prompt = `${GEMINI_STEPS_SYSTEM}\n\n--- CONTEXT ---\n${contextBlock}`;

    // Race against timeout
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);

    const result = await Promise.race([
      model.generateContent(prompt),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () =>
          reject(new Error("Gemini timeout (60s)"))
        );
      }),
    ]);
    clearTimeout(timer);

    const text = result.response.text();

    let parsed: GeminiResponse;
    try {
      parsed = JSON.parse(text);
    } catch {
      const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = fenceMatch ? fenceMatch[1].trim() : text.trim();
      parsed = JSON.parse(jsonStr);
    }

    if (!parsed.prompt1 || !parsed.prompt2) return null;
    if (!parsed.prompt1.promptText || !parsed.prompt2.promptText) return null;

    return parsed;
  } catch (err) {
    console.warn("Gemini step generation failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

interface GeminiStep {
  role: string;
  title: string;
  goal: string;
  promptText: string;
  doneLooksLike: string[];
}

interface GeminiResponse {
  bmadExplanation?: string;
  prompt1: GeminiStep;
  prompt2: GeminiStep;
  prompt3?: GeminiStep;
}

/** Convert Gemini output to our BuildStep format. */
function geminiStepToBuildStep(gs: GeminiStep): BuildStep {
  return {
    title: gs.title || "Untitled",
    role: gs.role || "FE",
    instruction: gs.goal || "",
    cursorPrompt: gs.promptText || "",
    doneLooksLike: Array.isArray(gs.doneLooksLike)
      ? gs.doneLooksLike.map((b) => (b.startsWith("•") ? b : `• ${b}`)).join("\n")
      : typeof gs.doneLooksLike === "string"
      ? gs.doneLooksLike
      : "",
  };
}

/* ── Brand vibe injection for fallback ── */

function buildBrandVibeBlock(theme: Theme, companyName: string): string {
  const t = { ...DEFAULT_THEME, ...theme };
  const radius = t.radiusPx ?? 12;

  const themeObj = [
    `  primary: "${t.primary}",`,
    `  accent: "${t.accent}",`,
    `  bg: "${t.bg}",`,
    `  text: "${t.text}",`,
    t.fontFamily
      ? `  fontFamily: "${t.fontFamily}",`
      : `  fontFamily: "system-ui, -apple-system, sans-serif",`,
    `  radiusPx: ${radius},`,
    `  companyName: "${companyName}",`,
    t.faviconUrl
      ? `  faviconUrl: "${t.faviconUrl}",`
      : `  faviconUrl: undefined,`,
  ].join("\n");

  return [
    ``,
    `--- BRAND VIBE (makes it feel like ${companyName}) ---`,
    ``,
    `Create src/lib/prototypeTheme.ts:`,
    ``,
    `export const PROTOTYPE_THEME = {`,
    themeObj,
    `} as const;`,
    ``,
    `In src/app/page.tsx, import PROTOTYPE_THEME and set CSS vars on the wrapper:`,
    `  style={{ "--ab-primary": PROTOTYPE_THEME.primary, "--ab-accent": PROTOTYPE_THEME.accent, "--ab-bg": PROTOTYPE_THEME.bg, "--ab-text": PROTOTYPE_THEME.text, "--ab-font": PROTOTYPE_THEME.fontFamily } as React.CSSProperties}`,
    ``,
    t.faviconUrl
      ? `Header: <img src="${t.faviconUrl}" className="h-6 w-6" /> + "${companyName}" + "Prototype" badge`
      : `Header: "${companyName}" + "Prototype" badge`,
    `Buttons: bg var(--ab-primary), border-radius ${radius}px`,
    `Cards: border-radius ${radius}px, hover ring var(--ab-accent)`,
    `Links: color var(--ab-primary)`,
    `Badges: bg color-mix(in srgb, var(--ab-accent) 15%, transparent), text var(--ab-accent)`,
  ].join("\n");
}

function injectBrandVibeIntoMock(plan: BuildPlan, idea: Idea, theme: Theme): BuildPlan {
  const t = { ...DEFAULT_THEME, ...theme };
  const companyName = t.companyName || idea.title.split(" ")[0];
  const brandBlock = buildBrandVibeBlock(theme, companyName);

  const steps = plan.steps.map((step) => {
    if (step.role !== "PM+UX") return step;
    return {
      ...step,
      cursorPrompt: step.cursorPrompt + "\n" + brandBlock,
      doneLooksLike: step.doneLooksLike.replace(
        /^(• .+)$/m,
        `$1 (styled for ${companyName})`
      ),
    };
  });

  return { ...plan, steps };
}

/* ── Route handler ── */

export async function POST(request: Request) {
  const t0 = performance.now();

  try {
    const body = await request.json();
    const ideaId: string = body.ideaId;

    if (!ideaId) {
      return NextResponse.json({ error: "ideaId is required" }, { status: 400 });
    }

    // Check cache
    const cached = getBuildPlan(ideaId);
    if (cached) {
      const durationMs = Math.round(performance.now() - t0);
      console.log(`[steps] model=${GEMINI_MODEL} used=cache reason=cached`);
      return NextResponse.json({ ...cached, used: "cache", durationMs });
    }

    const idea = getIdea(ideaId);
    if (!idea) {
      return NextResponse.json({ error: "Idea not found" }, { status: 404 });
    }

    const job = getJob(idea.jobId);
    const ctx: CompanyContext = job?.companyContext ?? { name: "Unknown" };
    const theme: Theme = idea.theme ?? job?.theme ?? DEFAULT_THEME;
    const evidence: JobEvidence | undefined = job?.evidence;
    const companyName = ctx.name || idea.title.split(" ")[0];
    const folderName = buildFolderName(companyName, idea.title);
    const terminalSetup = buildTerminalSetup(folderName);

    let plan: BuildPlan | null = null;
    let used: "gemini" | "fallback" = "fallback";
    let reason = "ok";

    // Try Gemini
    const contextBlock = buildStepContext(idea, ctx, theme, evidence);
    const geminiResult = await callGeminiForSteps(contextBlock);

    if (geminiResult) {
      const steps: BuildStep[] = [
        geminiStepToBuildStep(geminiResult.prompt1),
        geminiStepToBuildStep(geminiResult.prompt2),
      ];
      if (geminiResult.prompt3?.promptText) {
        steps.push(geminiStepToBuildStep(geminiResult.prompt3));
      }

      // Validate: at least 2 steps with actual prompt text
      const validSteps = steps.filter((s) => s.cursorPrompt?.length > 10);
      if (validSteps.length >= 2) {
        plan = {
          ideaId: idea.id,
          bmadExplanation:
            geminiResult.bmadExplanation ||
            `Each prompt uses a BMAD role — the mindset Cursor should adopt. PM+UX creates the skeleton. FE makes it real. FE+QA polishes.`,
          terminalSetup,
          folderName,
          steps,
        };
        used = "gemini";
      } else {
        reason = "invalid_json";
      }
    } else {
      reason = process.env.GEMINI_API_KEY ? "error" : "no_key";
    }

    // Fallback to deterministic mock if Gemini didn't produce a valid plan
    if (!plan) {
      const mockPlan = generateMockBuildPlan(idea, companyName);
      plan = injectBrandVibeIntoMock(
        { ...mockPlan, terminalSetup, folderName },
        idea,
        theme
      );
      used = "fallback";
    }

    // Store for cache
    storeBuildPlan(plan);

    const durationMs = Math.round(performance.now() - t0);
    console.log(`[steps] model=${GEMINI_MODEL} used=${used} reason=${reason} ${durationMs}ms`);
    return NextResponse.json({ ...plan, used, durationMs });
  } catch {
    return NextResponse.json({ error: "Generation failed" }, { status: 500 });
  }
}
