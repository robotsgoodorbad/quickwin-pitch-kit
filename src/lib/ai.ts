/* ── AI provider wrapper with graceful fallback ──
   Tries Gemini (SDK) → OpenAI → Gemini (REST) → mock generator.
   Build plans always use the 2+1 BMAD prompt format.
   Idea generation uses ContextBundle as the SOLE source of truth. */

import type { Idea, BuildPlan, CompanyContext, Theme, ContextBundle } from "./types";
import { generateMockIdeas, generateMockBuildPlan, generateMockCustomPlan } from "./mockGenerator";
import { generateIdeasWithGemini } from "./gemini";
import { contextBundleToPrompt, summarizeContextBundleForLogs } from "./contextBundle";
import { DEFAULT_THEME } from "./theme";
import { type GeminiStage, getGeminiModel, getGeminiApiVersion, logGeminiCall } from "./geminiConfig";

/* ── Return type for idea generation (includes observability metadata) ── */

export interface GenerateIdeasResult {
  ideas: Idea[];
  provider: "gemini" | "openai" | "mock";
  geminiError?: string;
}

/* ── Provider helpers ── */

async function callOpenAI(
  systemPrompt: string,
  userPrompt: string
): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.8,
        max_tokens: 4096,
      }),
    });
    if (!res.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    return data.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

async function callGeminiREST(prompt: string, stage: GeminiStage): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const modelId = getGeminiModel(stage);
  const apiVersion = getGeminiApiVersion();
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelId}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 4096 },
        }),
      }
    );
    if (!res.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  } catch {
    return null;
  }
}

async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  stage: GeminiStage = "ideas"
): Promise<string | null> {
  const openai = await callOpenAI(systemPrompt, userPrompt);
  if (openai) return openai;
  const combined = `${systemPrompt}\n\n${userPrompt}`;
  return callGeminiREST(combined, stage);
}

function extractJSON(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  const jsonMatch = text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  if (jsonMatch) return jsonMatch[1].trim();
  return text.trim();
}

/* ══════════════════════════════════════════════
   Public: generate ideas (uses ContextBundle only)
   ══════════════════════════════════════════════ */

const IDEAS_SYSTEM = `You are a creative product strategist. Generate exactly 15 quick-win prototype ideas for a company. The ideas should be web-app prototypes buildable with Next.js + Tailwind.

Output ONLY valid JSON — an array of 15 objects with these fields:
- title (string)
- summary (string, 1-2 sentences)
- effort (string, one of: "15min", "1hr", "4hr", "8hr", "1-3days")
- outline (object with: pages: string[], components: string[], data: string[], niceToHave: string[])
- inspiredAngle (string, 1 sentence: the creative angle grounded in a common product pattern or company context)

Requirements:
- Exactly 3 ideas per effort level (15min, 1hr, 4hr, 8hr, 1-3days)
- Order from easiest to hardest
- Ideas should be specific to the company's domain and offerings
- Each idea should be a distinct, buildable prototype
- If inspiration patterns are provided, ground each idea's inspiredAngle in one of them
- If no inspiration patterns, base inspiredAngle on the company's own context`;

export async function generateIdeas(
  jobId: string,
  bundle: ContextBundle
): Promise<GenerateIdeasResult> {
  let geminiError: string | undefined;

  // Log the bundle summary for every run
  const summary = summarizeContextBundleForLogs(bundle);
  console.log(`[ideas] context ${summary.line}`);
  console.log(`[ideas] preview:\n${summary.preview}`);

  /* ── Strategy 1: Gemini SDK (preferred — rich context, JSON mode) ── */
  if (process.env.GEMINI_API_KEY) {
    try {
      const ideas = await generateIdeasWithGemini(jobId, bundle);
      return { ideas, provider: "gemini" };
    } catch (err) {
      geminiError =
        err instanceof Error ? err.message : "Unknown Gemini error";
      console.warn("Gemini SDK idea generation failed, falling back:", geminiError);
    }
  }

  /* ── Strategy 2: OpenAI → Gemini REST (same ContextBundle prompt) ── */
  const ctxStr = contextBundleToPrompt(bundle);
  const t0Rest = performance.now();
  const raw = await callLLM(IDEAS_SYSTEM, ctxStr, "ideas");

  if (raw) {
    try {
      const parsed = JSON.parse(extractJSON(raw));
      if (Array.isArray(parsed) && parsed.length >= 15) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ideas = parsed.slice(0, 15).map((item: any, i: number) => ({
          id: `${jobId}-${i}`,
          jobId,
          title: item.title || "Untitled Idea",
          summary: item.summary || "",
          effort: item.effort || "1hr",
          outline: {
            pages: item.outline?.pages || [],
            components: item.outline?.components || [],
            data: item.outline?.data || [],
            niceToHave: item.outline?.niceToHave || [],
          },
          inspiredAngle: item.inspiredAngle || undefined,
        }));
        const provider = process.env.OPENAI_API_KEY ? "openai" : "gemini";
        const durationMs = Math.round(performance.now() - t0Rest);
        logGeminiCall("ideas", { durationMs, used: provider === "openai" ? "openai" : "gemini-rest", fallback: true });
        return { ideas, provider: provider as "openai" | "gemini", geminiError };
      }
    } catch {
      /* fall through to mock */
    }
  }

  /* ── Strategy 3: Deterministic mock fallback ── */
  const durationMs = Math.round(performance.now() - t0Rest);
  logGeminiCall("ideas", { durationMs, used: "mock", fallback: true });
  return {
    ideas: generateMockIdeas(jobId, { name: bundle.company.name, url: bundle.company.url }),
    provider: "mock",
    geminiError: geminiError || (process.env.GEMINI_API_KEY ? "LLM returned unparseable response" : undefined),
  };
}

/* ── Lightweight context string for build-plan generation (not used for ideas) ── */

function buildContextString(ctx: CompanyContext): string {
  const parts: string[] = [`Company: ${ctx.name}`];
  if (ctx.url) parts.push(`Website: ${ctx.url}`);
  if (ctx.description) parts.push(`Description: ${ctx.description}`);
  if (ctx.industryHints?.length) parts.push(`Industry: ${ctx.industryHints.join(", ")}`);
  if (ctx.headings?.length) parts.push(`Key headings: ${ctx.headings.slice(0, 10).join("; ")}`);
  return parts.join("\n");
}

/* ══════════════════════════════════════════════
   Public: generate build plan (2+1 BMAD prompts)
   ══════════════════════════════════════════════ */

const STEPS_SYSTEM = `You are an expert engineering coach. Generate a build plan for a standalone Next.js prototype using the BMAD prompt format.

IMPORTANT: The prototype lives in its OWN fresh Next.js app (not inside another app). The main page is src/app/page.tsx.

Output ONLY valid JSON with these fields:
- bmadExplanation (string, 2-3 sentences about the BMAD roles)
- steps (array of exactly 2-3 objects)

Each step object has: title, role, instruction, cursorPrompt, doneLooksLike.

CRITICAL FORMAT RULES:
1. Exactly 2 required steps + 1 optional Fix/Polish step.
2. Step 1 role = "PM+UX", title = "Brand + skeleton". Creates branded skeleton in src/app/page.tsx with CSS vars, header, hero, placeholder sections, and TODO markers. No real features yet.
3. Step 2 role = "FE", title = "Make it real". Replaces TODOs in src/app/page.tsx with working components and data wiring.
4. Step 3 (optional) role = "FE+QA", title = "Fix + polish". Fix errors, add empty state, tighten spacing, one microinteraction. No new libraries.
5. cursorPrompt MUST begin with "BMAD ROLE: <ROLE> — <1-sentence role instruction>" on the first line.
6. doneLooksLike: max 3 bullet lines (use "• " prefix).
7. instruction: a single goal sentence.
8. NEVER reference /p/<slug> routes. The prototype uses src/app/page.tsx directly.

Make cursorPrompts specific and actionable — these are pasted directly into Cursor AI.`;

/* ── Slug + folder helpers ── */

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

/* ── Brand vibe section builder ── */

/**
 * Build a text block to inject into the PM+UX prompt
 * with concrete theme values (colors, favicon, font, radius).
 */
function buildBrandVibeSection(idea: Idea, theme: Theme): string {
  const t = { ...DEFAULT_THEME, ...theme };
  const companyName = t.companyName || idea.title.split(" ")[0];
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

/** Inject concrete brand vibe values into the PM+UX step's prompt. */
function injectBrandVibe(plan: BuildPlan, idea: Idea, theme: Theme): BuildPlan {
  const brandSection = buildBrandVibeSection(idea, theme);
  const t = { ...DEFAULT_THEME, ...theme };
  const companyName = t.companyName || idea.title.split(" ")[0];

  const steps = plan.steps.map((step) => {
    if (step.role !== "PM+UX") return step;

    // Append brand vibe section to the PM+UX prompt
    const augmentedPrompt = step.cursorPrompt + "\n" + brandSection;

    // Update first doneLooksLike bullet with company name
    const augmentedDone = step.doneLooksLike.replace(
      /^(• .+)$/m,
      `$1 (styled for ${companyName})`
    );

    return { ...step, cursorPrompt: augmentedPrompt, doneLooksLike: augmentedDone };
  });

  return { ...plan, steps };
}

export async function generateBuildPlan(
  idea: Idea,
  context: CompanyContext,
  theme?: Theme
): Promise<BuildPlan> {
  const companyName = context.name || idea.title.split(" ")[0];
  const folderName = buildFolderName(companyName, idea.title);
  const terminalSetup = buildTerminalSetup(folderName);

  const userPrompt = `Generate build steps for this standalone prototype idea (the prototype lives in its own fresh Next.js app, main page is src/app/page.tsx):
Title: ${idea.title}
Summary: ${idea.summary}
Effort level: ${idea.effort}
Pages: ${idea.outline.pages.join(", ")}
Components: ${idea.outline.components.join(", ")}
Data: ${idea.outline.data.join(", ")}
Nice-to-have: ${idea.outline.niceToHave.join(", ")}

Company context:
${buildContextString(context)}`;

  let basePlan: BuildPlan;

  const raw = await callLLM(STEPS_SYSTEM, userPrompt, "steps");

  if (raw) {
    try {
      const parsed = JSON.parse(extractJSON(raw));
      if (parsed.steps && Array.isArray(parsed.steps) && parsed.steps.length >= 2) {
        basePlan = {
          ideaId: idea.id,
          bmadExplanation: parsed.bmadExplanation || "",
          terminalSetup,
          folderName,
          steps: parsed.steps.slice(0, 3), // max 3
        };
      } else {
        basePlan = generateMockBuildPlan(idea, companyName);
      }
    } catch {
      basePlan = generateMockBuildPlan(idea, companyName);
    }
  } else {
    basePlan = generateMockBuildPlan(idea, companyName);
  }

  // Inject brand vibe into the PM+UX step
  const resolvedTheme = theme ?? idea.theme ?? DEFAULT_THEME;
  return injectBrandVibe(basePlan, idea, resolvedTheme);
}

/* ══════════════════════════════════════════════
   Public: custom idea
   ══════════════════════════════════════════════ */

const CUSTOM_SYSTEM = `You are a creative product strategist. Given a custom idea description, generate a structured prototype plan using the BMAD prompt format.

IMPORTANT: The prototype lives in its OWN fresh Next.js app (not inside another app). The main page is src/app/page.tsx.

Output ONLY valid JSON with these fields:
- title (string, concise)
- summary (string, 1-2 sentences)
- effort (string, one of: "15min", "1hr", "4hr", "8hr", "1-3days")
- outline (object with: pages: string[], components: string[], data: string[], niceToHave: string[])
- bmadExplanation (string, 2-3 sentences about BMAD roles)
- steps (array of exactly 2-3 objects with: title, role, instruction, cursorPrompt, doneLooksLike)

CRITICAL: steps must follow the 2+1 format:
- Step 1: role "PM+UX", title "Brand + skeleton". Creates branded skeleton in src/app/page.tsx with CSS vars, TODO markers. cursorPrompt starts with "BMAD ROLE: PM+UX — ..."
- Step 2: role "FE", title "Make it real". Replaces TODOs in src/app/page.tsx with real interaction. cursorPrompt starts with "BMAD ROLE: FE — ..."
- Step 3 (optional): role "FE+QA", title "Fix + polish". Fix errors + one microinteraction. cursorPrompt starts with "BMAD ROLE: FE+QA — ..."
Each doneLooksLike: max 3 bullet lines with "• " prefix.
NEVER reference /p/<slug> routes. Use src/app/page.tsx directly.`;

export async function generateCustomIdeaPlan(
  text: string,
  context?: CompanyContext
): Promise<{ idea: Idea; plan: BuildPlan }> {
  const companyName = context?.name || "Your Company";
  const ctxStr = context ? `\n\nCompany context:\n${buildContextString(context)}` : "";
  const userPrompt = `Custom idea: ${text}${ctxStr}`;

  const raw = await callLLM(CUSTOM_SYSTEM, userPrompt, "steps");

  if (raw) {
    try {
      const parsed = JSON.parse(extractJSON(raw));
      if (parsed.title && parsed.steps && parsed.steps.length >= 2) {
        const idea: Idea = {
          id: `custom-${Date.now()}`,
          jobId: "custom",
          title: parsed.title,
          summary: parsed.summary || text,
          effort: parsed.effort || "4hr",
          outline: parsed.outline || { pages: [], components: [], data: [], niceToHave: [] },
        };
        const folderName = buildFolderName(companyName, idea.title);
        const plan: BuildPlan = {
          ideaId: idea.id,
          bmadExplanation: parsed.bmadExplanation || "",
          terminalSetup: buildTerminalSetup(folderName),
          folderName,
          steps: parsed.steps.slice(0, 3),
        };
        return { idea, plan };
      }
    } catch {
      /* fall through */
    }
  }

  return generateMockCustomPlan(text, companyName);
}
