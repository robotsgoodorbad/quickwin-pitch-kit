/* ── Custom idea generator (Gemini + deterministic fallback) ──
   Generates ONE idea from a user's description + existing job context. */

import type { Idea, CompanyContext, JobEvidence, EffortLevel } from "./types";
import { getGeminiModel, getGeminiApiVersion, logGeminiCall } from "./geminiConfig";

/* ── Context builder (reuses same shape as gemini.ts) ── */

function buildContext(ctx: CompanyContext, evidence?: JobEvidence): string {
  const parts: string[] = [`Company: ${ctx.name}`];
  if (ctx.url) parts.push(`Website: ${ctx.url}`);
  if (ctx.description) parts.push(`Description: ${ctx.description}`);
  if (ctx.industryHints?.length)
    parts.push(`Industry: ${ctx.industryHints.join(", ")}`);
  if (ctx.headings?.length)
    parts.push(`Key headings:\n  ${ctx.headings.slice(0, 10).join("\n  ")}`);
  if (ctx.pressHeadlines?.length)
    parts.push(`Press topics:\n  ${ctx.pressHeadlines.slice(0, 5).join("\n  ")}`);

  const news = evidence?.news?.items;
  if (news?.length) {
    parts.push(
      `Recent news:\n  ${news.slice(0, 3).map((n) => `• ${n.title}`).join("\n  ")}`
    );
  }

  const pack = evidence?.inspirationPack;
  if (pack?.commonPatterns?.length) {
    parts.push(
      `Product inspiration patterns:\n  ${pack.commonPatterns.slice(0, 4).join("\n  ")}`
    );
  }

  return parts.join("\n\n");
}

/* ── System prompt ── */

const SYSTEM = `You are a creative product strategist. Given a user's custom prototype idea description and a company context, generate ONE structured idea.

Output ONLY valid JSON with these exact fields:
- title (string, concise and catchy, max 8 words)
- summary (string, 2-3 sentences describing the prototype)
- effort (string, one of: "15min", "1hr", "4hr", "8hr", "1-3days")
- outline (object with: pages: string[], components: string[], data: string[], niceToHave: string[])
- inspiredAngle (string, 1 sentence: the creative angle for this idea)

Make the idea specific to the company and the user's description. Keep it demo-friendly and buildable.
Output ONLY the JSON object. No markdown, no fences.`;

/* ── Gemini call ── */

async function callGeminiForCustom(
  description: string,
  contextBlock: string
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any> | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  const modelId = getGeminiModel("custom");
  const apiVersion = getGeminiApiVersion();
  const t0 = performance.now();

  try {
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel(
      {
        model: modelId,
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
        },
      },
      { apiVersion }
    );

    const prompt = `${SYSTEM}\n\n--- COMPANY CONTEXT ---\n${contextBlock}\n\n--- USER'S IDEA DESCRIPTION ---\n${description}`;

    const result = await Promise.race([
      model.generateContent(prompt),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 20000)
      ),
    ]);

    const text = result.response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      parsed = JSON.parse(m ? m[1].trim() : text.trim());
    }

    if (parsed.title && parsed.summary) {
      const durationMs = Math.round(performance.now() - t0);
      logGeminiCall("custom", { durationMs, used: "gemini", fallback: false });
      return parsed;
    }
    const durationMs = Math.round(performance.now() - t0);
    logGeminiCall("custom", { durationMs, used: "invalid_json", fallback: true });
    return null;
  } catch {
    const durationMs = Math.round(performance.now() - t0);
    logGeminiCall("custom", { durationMs, used: "error", fallback: true });
    return null;
  }
}

/* ── Deterministic fallback ── */

const EFFORTS: EffortLevel[] = ["15min", "1hr", "4hr", "8hr", "1-3days"];

function fallbackIdea(
  description: string,
  companyName: string
): Omit<Idea, "id" | "jobId" | "theme" | "source" | "originalPrompt"> {
  // Pick effort based on description length
  const effortIdx = Math.min(Math.floor(description.length / 50), 4);
  const words = description.trim().split(/\s+/).slice(0, 6);
  const title = words.length >= 3
    ? words.slice(0, 5).join(" ")
    : `Custom prototype for ${companyName}`;

  return {
    title: title.charAt(0).toUpperCase() + title.slice(1),
    summary: description.slice(0, 200),
    effort: EFFORTS[effortIdx],
    outline: {
      pages: ["src/app/page.tsx"],
      components: ["MainSection", "InteractiveWidget", "ResultsDisplay"],
      data: ["Mock data array", "User input state"],
      niceToHave: ["Loading skeleton", "Share button"],
    },
    inspiredAngle: `A lightweight ${companyName} prototype exploring: ${description.slice(0, 60)}…`,
  };
}

/* ── Public API ── */

export async function generateCustomIdea(
  description: string,
  ctx: CompanyContext,
  evidence?: JobEvidence
): Promise<{
  ideaFields: Omit<Idea, "id" | "jobId" | "theme" | "source" | "originalPrompt">;
  usedGemini: boolean;
}> {
  const contextBlock = buildContext(ctx, evidence);
  const geminiResult = await callGeminiForCustom(description, contextBlock);

  if (geminiResult) {
    return {
      ideaFields: {
        title: geminiResult.title || "Custom idea",
        summary: geminiResult.summary || description,
        effort: (EFFORTS.includes(geminiResult.effort) ? geminiResult.effort : "4hr") as EffortLevel,
        outline: geminiResult.outline || {
          pages: [], components: [], data: [], niceToHave: [],
        },
        inspiredAngle: geminiResult.inspiredAngle || undefined,
      },
      usedGemini: true,
    };
  }

  return {
    ideaFields: fallbackIdea(description, ctx.name),
    usedGemini: false,
  };
}
