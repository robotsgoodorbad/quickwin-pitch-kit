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

/* ── Request ID helper ── */
function makeRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

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

/* ── Effort → prompt-count range ── */

import type { EffortLevel } from "@/lib/types";

function promptCountRange(effort: string): [number, number] {
  switch (effort) {
    case "15min":   return [2, 3];
    case "1hr":     return [3, 5];
    case "4hr":     return [5, 8];
    case "8hr":     return [5, 8];
    case "1-3days": return [8, 14];
    default:        return [3, 8];
  }
}

/* ── Gemini system prompt ── */

function buildStepsSystemPrompt(effort: EffortLevel, themeReminder = false): string {
  const [min, max] = promptCountRange(effort);
  const themeWarning = themeReminder
    ? `\n\nCRITICAL REMINDER: Your previous attempt IGNORED the Brand Vibe Pack. This time you MUST include theme usage in EVERY prompt. Every promptText must reference PROTOTYPE_THEME or CSS variables. This is mandatory.\n`
    : "";
  return `You are an expert engineering coach writing a beginner-friendly guided workshop.
The user will copy your prompts one at a time into Cursor AI to build a STANDALONE Next.js prototype (its own fresh app, main page: src/app/page.tsx).
${themeWarning}
PLANNING PROCESS — follow these steps in order:

Step A: List the milestones a beginner needs to reach to build this idea.
  Think of the build as a story: what does the user see after each milestone?
  Each milestone should be a meaningful checkpoint — not just "add a file" but "now the page shows X and Y works".

Step B: Decide how many prompts are needed to implement those milestones.
  - The number of prompts is an OUTCOME of the milestones, not a fixed target.
  - If the milestones naturally require fewer than ${min} prompts, merge smaller milestones until you reach at least ${min}.
  - If the milestones naturally require more than ${max} prompts, combine related milestones until you have at most ${max}.
  - The final prompt count MUST be between ${min} and ${max} (inclusive).

Step C: Write the prompts.

OUTPUT: valid JSON:
{
  "totalPrompts": <number>,
  "rationaleForPromptCount": "<1–3 sentences explaining why you chose this many prompts based on the milestones>",
  "prompts": [
    {
      "role": "PM+UX" | "FE" | "FE+QA",
      "title": "plain-language title a beginner would understand",
      "goal": "why we're doing this — 1–2 sentences explaining the purpose of this milestone",
      "promptText": "the full Cursor prompt (pasted verbatim into Cursor)",
      "doneLooksLike": ["what you should see when it worked — bullet 1","bullet 2","bullet 3"]
    }
  ]
}

PROMPT STRUCTURE RULES:
1. promptText MUST start with "BMAD ROLE: <ROLE> — <1 sentence role instruction>" on the first line.

BRAND VIBE PACK — THEME CONTRACT (MANDATORY):
The Brand Vibe Pack is provided in the context. It MUST be used in every step.
2. The FIRST prompt (role PM+UX) MUST:
   - Assume the app is already scaffolded (create-next-app ran).
   - Replace src/app/page.tsx with a "use client" branded skeleton.
   - Create src/lib/prototypeTheme.ts exporting PROTOTYPE_THEME with the EXACT brand values from the Brand Vibe Pack (primary, accent, bg, text, fontFamily, radiusPx, companyName, faviconUrl).
   - Apply the theme via CSS variables on the root element: --ab-primary, --ab-accent, --ab-bg, --ab-text, --ab-font, --ab-radius.
   - Every button, card, link, and badge must use these CSS variables or PROTOTYPE_THEME values.
   - Build header (company name + "Prototype" badge), hero, placeholder sections with TODO markers.
   - If Brand Vibe Pack is missing or has default values, still create the theme file with sensible defaults.
3. EVERY middle prompt (role FE) MUST:
   - Each one delivers a specific milestone with visible progress.
   - Reference PROTOTYPE_THEME or CSS variables (--ab-primary, etc.) for all colors, border-radius, and fonts. Do NOT hardcode colors.
   - Wire real data inline (prefer inline arrays over separate files).
   - Buttons trigger visible state changes. No placeholders.
   - Build on previous prompts — never redo finished work.
   - Include in the promptText: "Use the theme from src/lib/prototypeTheme.ts for all styling (colors, radius, font)."
4. The LAST prompt (role FE+QA) MUST:
   - Fix TS/ESLint/runtime errors.
   - Verify all components use PROTOTYPE_THEME — replace any hardcoded colors with theme variables.
   - Add empty states, tighten spacing, add one microinteraction.
   - No new npm packages.
5. "goal" should explain the purpose in beginner-friendly language ("why we're doing this").
6. "doneLooksLike" should describe what the user sees when it worked (max 3 bullets).
7. No mock data unless unavoidable. If used, label it "temporary sample data" and note where real data would come from.
8. Avoid databases, authentication, and external APIs unless the idea truly requires them.
9. NEVER reference /p/<slug> routes. Use src/app/page.tsx.
10. Output ONLY the JSON. No markdown, no fences, no explanation.`;
}

/* ── Gemini config (centralized) ── */

import { getGeminiModel, getGeminiApiVersion, logGeminiCall } from "@/lib/geminiConfig";

/* ── Robust JSON extraction ── */

function extractJsonFromText(text: string): unknown {
  const trimmed = text.trim();

  // 1. Try direct parse
  try { return JSON.parse(trimmed); } catch { /* continue */ }

  // 2. Try code-fence extraction
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch { /* continue */ }
  }

  // 3. Try finding first { to last } (prose around JSON)
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try { return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)); } catch { /* continue */ }
  }

  // 4. Try finding first [ to last ] (array response)
  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const arr = trimmed.slice(firstBracket, lastBracket + 1);
    try {
      const parsed = JSON.parse(arr);
      if (Array.isArray(parsed)) return { prompts: parsed };
    } catch { /* continue */ }
  }

  return null;
}

/* ── Step schema guard ── */

function isValidGeminiStep(s: unknown): s is GeminiStep {
  if (!s || typeof s !== "object") return false;
  const step = s as Record<string, unknown>;
  return (
    typeof step.promptText === "string" && step.promptText.length > 10 &&
    typeof step.role === "string" && step.role.length > 0
  );
}

/* ── Call diagnostics ── */

interface CallDiag {
  responseChars: number;
  reason: "ok" | "no_key" | "api_error" | "parse_error" | "schema_invalid" | "timeout" | "empty_response";
  errorMessage?: string;
}

/* ── Gemini SDK call with timeout ── */

async function callGeminiForSteps(
  contextBlock: string,
  effort: EffortLevel,
  themeReminder = false,
  requestId = ""
): Promise<{ response: GeminiResponse | null; diag: CallDiag }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { response: null, diag: { responseChars: 0, reason: "no_key" } };

  const modelId = getGeminiModel("steps");
  const apiVersion = getGeminiApiVersion();
  const systemPrompt = buildStepsSystemPrompt(effort, themeReminder);

  let responseChars = 0;
  try {
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel(
      {
        model: modelId,
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
        },
      },
      { apiVersion }
    );

    const prompt = `${systemPrompt}\n\n--- CONTEXT ---\n${contextBlock}`;

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
    responseChars = text.length;

    if (!text || text.length < 10) {
      console.warn(`[steps] ${requestId} empty response (${responseChars} chars)`);
      return { response: null, diag: { responseChars, reason: "empty_response" } };
    }

    const rawParsed = extractJsonFromText(text);
    if (rawParsed === null) {
      console.warn(`[steps] ${requestId} JSON parse failed, responseChars=${responseChars}`);
      return { response: null, diag: { responseChars, reason: "parse_error" } };
    }

    const normalized = normalizeGeminiResponse(rawParsed);
    if (!normalized) {
      console.warn(`[steps] ${requestId} schema invalid after normalize, responseChars=${responseChars}`);
      return { response: null, diag: { responseChars, reason: "schema_invalid" } };
    }

    // Validate each step has required fields
    const validSteps = normalized.prompts.filter(isValidGeminiStep);
    if (validSteps.length < 2) {
      console.warn(`[steps] ${requestId} only ${validSteps.length} valid steps out of ${normalized.prompts.length}`);
      return { response: null, diag: { responseChars, reason: "schema_invalid", errorMessage: `only ${validSteps.length} valid steps` } };
    }

    return {
      response: { ...normalized, prompts: validSteps },
      diag: { responseChars, reason: "ok" },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.includes("timeout");
    console.warn(`[steps] ${requestId} Gemini call failed: ${msg}`);
    return {
      response: null,
      diag: { responseChars, reason: isTimeout ? "timeout" : "api_error", errorMessage: msg },
    };
  }
}

/** Check if the prompt count is within the expected range for the effort level. */
function isPromptCountValid(count: number, effort: string): boolean {
  const [min, max] = promptCountRange(effort);
  return count >= min && count <= max;
}

interface GeminiStep {
  role: string;
  title: string;
  goal: string;
  promptText: string;
  doneLooksLike: string[];
}

interface GeminiResponse {
  prompts: GeminiStep[];
  totalPrompts?: number;
  rationaleForPromptCount?: string;
}

/** Accept both new { prompts: [...] } and legacy { prompt1, prompt2, prompt3 } formats. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeGeminiResponse(raw: any): GeminiResponse | null {
  if (Array.isArray(raw?.prompts) && raw.prompts.length >= 2) {
    return {
      prompts: raw.prompts,
      totalPrompts: typeof raw.totalPrompts === "number" ? raw.totalPrompts : raw.prompts.length,
      rationaleForPromptCount: typeof raw.rationaleForPromptCount === "string" ? raw.rationaleForPromptCount : undefined,
    };
  }
  if (raw?.prompt1?.promptText && raw?.prompt2?.promptText) {
    const prompts: GeminiStep[] = [raw.prompt1, raw.prompt2];
    if (raw.prompt3?.promptText) prompts.push(raw.prompt3);
    return { prompts, totalPrompts: prompts.length };
  }
  return null;
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
  const requestId = makeRequestId();

  try {
    const body = await request.json();
    const ideaId: string = body.ideaId;

    if (!ideaId) {
      return NextResponse.json(
        { error: { code: "MISSING_IDEA_ID", message: "ideaId is required", requestId } },
        { status: 400 }
      );
    }

    // Check cache
    const cached = getBuildPlan(ideaId);
    if (cached) {
      const durationMs = Math.round(performance.now() - t0);
      logGeminiCall("steps", { durationMs, used: "cache", fallback: false });
      return NextResponse.json({ ...cached, used: "cache", durationMs, requestId });
    }

    const idea = getIdea(ideaId);
    if (!idea) {
      console.warn(`[steps] ${requestId} idea not found: ${ideaId}`);
      return NextResponse.json(
        { error: { code: "IDEA_NOT_FOUND", message: "Idea not found — your session may have expired. Try starting a new search.", requestId } },
        { status: 404 }
      );
    }

    const job = getJob(idea.jobId);
    const ctx: CompanyContext = job?.companyContext ?? { name: "Unknown" };
    const theme: Theme = idea.theme ?? job?.theme ?? DEFAULT_THEME;
    const evidence: JobEvidence | undefined = job?.evidence;
    const companyName = ctx.name || idea.title.split(" ")[0];
    const folderName = buildFolderName(companyName, idea.title);
    const terminalSetup = buildTerminalSetup(folderName);

    const modelId = getGeminiModel("steps");
    const apiVersion = getGeminiApiVersion();

    let plan: BuildPlan | null = null;
    let used: "gemini" | "fallback" = "fallback";
    let savedRationale = "";
    let lastDiag: CallDiag | null = null;

    // Try Gemini (with retries for prompt count, missing theme, or parse failure)
    const contextBlock = buildStepContext(idea, ctx, theme, evidence);
    const effort = idea.effort;
    const [rangeMin, rangeMax] = promptCountRange(effort);

    /** Check if at least the first prompt references the theme contract. */
    function stepsUseTheme(steps: BuildStep[]): boolean {
      if (steps.length === 0) return false;
      const firstPrompt = steps[0].cursorPrompt.toLowerCase();
      return (
        firstPrompt.includes("prototypetheme") ||
        firstPrompt.includes("prototype_theme") ||
        firstPrompt.includes("--ab-primary") ||
        firstPrompt.includes("brand vibe") ||
        firstPrompt.includes("theme")
      );
    }

    let themeReminder = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      const { response: geminiResult, diag } = await callGeminiForSteps(contextBlock, effort, themeReminder, requestId);
      lastDiag = diag;

      if (!geminiResult) {
        // On first attempt parse/schema failure, retry with stronger JSON instruction
        if (attempt === 0 && (diag.reason === "parse_error" || diag.reason === "schema_invalid")) {
          console.log(`[steps] ${requestId} ${diag.reason}, retrying with JSON-only reminder`);
          themeReminder = true;
          continue;
        }
        break;
      }

      const steps: BuildStep[] = geminiResult.prompts.map(geminiStepToBuildStep);
      const validSteps = steps.filter((s) => s.cursorPrompt?.length > 10);

      if (validSteps.length < 2) {
        if (attempt === 0) {
          console.log(`[steps] ${requestId} too few valid steps (${validSteps.length}), retrying`);
          continue;
        }
        break;
      }

      const rationale = (geminiResult.rationaleForPromptCount || "").slice(0, 120);
      const usesTheme = stepsUseTheme(validSteps);
      console.log(`[steps] ${requestId} effort=${effort} expected=${rangeMin}-${rangeMax} got=${validSteps.length} theme=${usesTheme} rationale="${rationale}"`);
      savedRationale = geminiResult.rationaleForPromptCount || "";

      if (isPromptCountValid(validSteps.length, effort)) {
        if (!usesTheme && attempt === 0) {
          console.log(`[steps] ${requestId} theme not referenced, retrying with reminder`);
          themeReminder = true;
          continue;
        }
        plan = { ideaId: idea.id, bmadExplanation: "", terminalSetup, folderName, steps: validSteps };
        used = "gemini";
        break;
      }

      if (attempt === 0) {
        console.log(`[steps] ${requestId} count out of range, retrying`);
        themeReminder = !usesTheme;
      }
    }

    // Fallback to deterministic plan if Gemini didn't produce a valid result
    if (!plan) {
      console.log(`[steps] ${requestId} falling back to generated plan (reason=${lastDiag?.reason ?? "unknown"} responseChars=${lastDiag?.responseChars ?? 0})`);
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
    logGeminiCall("steps", { durationMs, used, fallback: used === "fallback" });
    console.log(`[steps] ${requestId} done effort=${effort} model=${modelId} apiVersion=${apiVersion} used=${used} durationMs=${durationMs} steps=${plan.steps.length}`);

    return NextResponse.json({
      ...plan,
      used,
      durationMs,
      requestId,
      ...(savedRationale ? { rationaleForPromptCount: savedRationale } : {}),
    });
  } catch (err) {
    const durationMs = Math.round(performance.now() - t0);
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[steps] ${requestId} unhandled error durationMs=${durationMs}: ${msg}`);
    return NextResponse.json(
      { error: { code: "STEPS_FAILED", message: "Step generation encountered an unexpected error. Please try again.", requestId } },
      { status: 500 }
    );
  }
}
