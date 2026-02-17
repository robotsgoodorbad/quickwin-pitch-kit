/* ── Gemini-powered idea generation (server-only) ──
   Uses the official @google/generative-ai SDK.
   Reads GEMINI_API_KEY from process.env — never exposed to the browser.
   Accepts a ContextBundle as the SOLE source of context.
   Throws on any failure so the caller can fall back gracefully. */

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Idea, ContextBundle } from "./types";
import { contextBundleToPrompt } from "./contextBundle";
import { getGeminiModel, getGeminiApiVersion, logGeminiCall } from "./geminiConfig";

/* ── System prompt ── */

const IDEAS_SYSTEM = `You are a creative product strategist and prototype ideation expert.
Generate exactly 15 quick-win prototype ideas for the company described below.
The ideas should be web-app prototypes buildable with Next.js + Tailwind CSS.

IMPORTANT RULES:
- Exactly 3 ideas per effort level: "15min", "1hr", "4hr", "8hr", "1-3days"
- Order from easiest (15min) to most ambitious (1-3days)
- Each idea must be specific to the company's domain, products, and current news
- Use the gathered context (site content, press, news) to make ideas hyper-relevant
- If an Inspiration Pack is provided, use its common patterns to ground ideas in proven product patterns
- Each idea MUST include an "inspiredAngle" field: ONE sentence explaining the creative angle (do NOT name "Product Hunt")
- If no Inspiration Pack was provided, base inspiredAngle on the company's own context
- Each idea should be a distinct, buildable, demo-worthy prototype

Output ONLY valid JSON — an array of 15 objects with these exact fields:
- title (string, concise and catchy)
- summary (string, 1-2 sentences describing the prototype)
- effort (string, one of: "15min", "1hr", "4hr", "8hr", "1-3days")
- outline (object with: pages: string[], components: string[], data: string[], niceToHave: string[])
- inspiredAngle (string, 1 sentence: the creative angle inspired by a common pattern or company context)

Do NOT include any markdown formatting, code fences, or extra text — just the raw JSON array.`;

/* ── Public API ── */

export async function generateIdeasWithGemini(
  jobId: string,
  bundle: ContextBundle
): Promise<Idea[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not configured");

  const modelId = getGeminiModel("ideas");
  const apiVersion = getGeminiApiVersion();
  const t0 = performance.now();

  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel(
    {
      model: modelId,
      generationConfig: {
        temperature: 0.85,
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
      },
    },
    { apiVersion }
  );

  const contextText = contextBundleToPrompt(bundle);
  const prompt = `${IDEAS_SYSTEM}\n\n--- COMPANY CONTEXT ---\n${contextText}`;

  let text: string;
  try {
    const result = await model.generateContent(prompt);
    text = result.response.text();
  } catch (err) {
    const durationMs = Math.round(performance.now() - t0);
    logGeminiCall("ideas", { durationMs, used: "error", fallback: true });
    throw err;
  }

  const durationMs = Math.round(performance.now() - t0);
  logGeminiCall("ideas", { durationMs, used: "gemini", fallback: false });

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
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
