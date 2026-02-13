"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import type { Idea, BuildPlan, BuildStep, AnalysisStep, Theme } from "@/lib/types";
import { EFFORT_LEVELS } from "@/lib/effort";

/* ── Helpers ── */

/** Check if a BuildPlan has a valid steps array. */
function isValidPlan(p: unknown): p is BuildPlan {
  if (!p || typeof p !== "object") return false;
  const plan = p as BuildPlan;
  return Array.isArray(plan.steps) && plan.steps.length >= 1;
}

/* ── Sub-components ── */

function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`animate-spin h-5 w-5 ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

function EffortBadge({ effort }: { effort: string }) {
  const meta = EFFORT_LEVELS.find((e) => e.key === effort) ?? EFFORT_LEVELS[0];
  return (
    <span className={`inline-block rounded-full border px-3 py-1 text-xs font-medium ${meta.bg} ${meta.color}`}>
      {meta.label}
    </span>
  );
}

function StepIcon({ status }: { status: AnalysisStep["status"] }) {
  if (status === "running") return <Spinner className="ab-spinner-themed" />;
  if (status === "done")
    return (
      <svg className="h-5 w-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    );
  return <span className="h-5 w-5 rounded-full border-2 border-zinc-300 block" />;
}

/* ── Cooking steps for build-plan generation ── */
const COOK_STEPS: AnalysisStep[] = [
  { id: "context", label: "Assembling context", status: "pending" },
  { id: "prompt1", label: "Drafting Prompt 1", status: "pending" },
  { id: "prompt2", label: "Drafting Prompt 2", status: "pending" },
  { id: "prompt3", label: "Drafting Prompt 3", status: "pending" },
  { id: "wrapup", label: "Wrapping Up", status: "pending" },
];

const MIN_COOK_MS = 6000; // minimum visible cooking time

/* ═══════════════════════════════════════════
   Main component
   ═══════════════════════════════════════════ */

export default function IdeaDetailView({ ideaId }: { ideaId: string }) {
  const [idea, setIdea] = useState<Idea | null>(null);
  const [theme, setTheme] = useState<Theme | null>(null);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<BuildPlan | null>(null);
  const [generating, setGenerating] = useState(false);
  const [cookSteps, setCookSteps] = useState<AnalysisStep[]>(COOK_STEPS);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [copiedTerminal, setCopiedTerminal] = useState(false);
  const [copiedTheme, setCopiedTheme] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [usedProvider, setUsedProvider] = useState<"gemini" | "fallback" | "cache" | null>(null);
  const [planError, setPlanError] = useState(false);
  const [regenPrompt, setRegenPrompt] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [justUpdated, setJustUpdated] = useState(false);
  const stepsRef = useRef<HTMLDivElement>(null);
  const cookSectionRef = useRef<HTMLDivElement>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Fetch idea + theme ── */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/idea/${ideaId}`);
        if (!res.ok) {
          setNotFound(true);
          return;
        }
        const data = await res.json();
        setIdea(data);
        if (data.theme) setTheme(data.theme);
        if (data.originalPrompt) setRegenPrompt(data.originalPrompt);
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [ideaId]);

  /* ── Auto-scroll to cooking section when generation starts ── */
  useEffect(() => {
    if (generating) {
      // Small delay so the DOM has time to mount the checklist
      const t = setTimeout(() => {
        cookSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 40);
      return () => clearTimeout(t);
    }
  }, [generating]);

  /* ── Generate build steps ── */
  const handleGenerate = async () => {
    setGenerating(true);
    setUsedProvider(null);
    setPlanError(false);
    setPlan(null);
    const cookStart = Date.now();

    // Reset all steps to pending
    setCookSteps(COOK_STEPS.map((s) => ({ ...s, status: "pending" as const })));

    // Progressive checklist: spinner advances through steps on a schedule.
    // Steps before the active one get green checks; steps after stay pending.
    // "Wrapping Up" (last) keeps spinning until the API actually returns.
    const stepTimings = [0, 1200, 2800, 4200, 5400];
    const timers: ReturnType<typeof setTimeout>[] = [];

    for (let i = 0; i < COOK_STEPS.length; i++) {
      timers.push(
        setTimeout(() => {
          setCookSteps((prev) =>
            prev.map((s, j) => ({
              ...s,
              status: j < i ? "done" : j === i ? "running" : "pending",
            }))
          );
        }, stepTimings[i])
      );
    }

    try {
      const res = await fetch("/api/steps/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ideaId }),
      });

      const data = res.ok ? await res.json() : null;

      // Enforce minimum cooking time
      const elapsed = Date.now() - cookStart;
      if (elapsed < MIN_COOK_MS) {
        await new Promise((r) => setTimeout(r, MIN_COOK_MS - elapsed));
      }

      // Clear animation timers
      timers.forEach(clearTimeout);

      // Validate plan before marking complete
      if (isValidPlan(data)) {
        // Flip all steps (including Wrapping Up) to green checks
        setCookSteps(COOK_STEPS.map((s) => ({ ...s, status: "done" })));
        await new Promise((r) => setTimeout(r, 400));

        setPlan(data);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const provider = (data as any).used as string | undefined;
        setUsedProvider((provider as "gemini" | "fallback" | "cache") ?? null);
        setTimeout(() => stepsRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
      } else {
        setPlanError(true);
      }
    } catch {
      // On error, keep whatever checks are already shown — don't reset them
      timers.forEach(clearTimeout);
      setPlanError(true);
    } finally {
      setGenerating(false);
    }
  };

  const copyPrompt = (prompt: string, idx: number) => {
    navigator.clipboard.writeText(prompt).catch(() => {});
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const copyTerminal = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedTerminal(true);
    setTimeout(() => setCopiedTerminal(false), 2000);
  };

  /* ── Re-generate custom idea ── */
  const handleRegenerate = async () => {
    if (!regenPrompt.trim() || regenerating) return;
    setRegenerating(true);
    try {
      const res = await fetch("/api/ideas/custom/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ideaId, description: regenPrompt.trim() }),
      });
      if (res.ok) {
        // Re-fetch idea to get updated fields
        const ideaRes = await fetch(`/api/idea/${ideaId}`);
        if (ideaRes.ok) {
          const data = await ideaRes.json();
          setIdea(data);
          if (data.theme) setTheme(data.theme);
          setPlan(null);

          // Trigger highlight
          if (highlightTimer.current) clearTimeout(highlightTimer.current);
          setJustUpdated(true);
          highlightTimer.current = setTimeout(() => setJustUpdated(false), 900);
        }
      }
    } catch {
      /* ignore */
    } finally {
      setRegenerating(false);
    }
  };

  /* ── Loading state ── */
  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <Spinner className="text-zinc-400 h-8 w-8" />
      </div>
    );
  }

  if (notFound || !idea) {
    return (
      <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-center gap-4">
        <p className="text-zinc-500">Idea not found. It may have expired from the in-memory store.</p>
        <Link href="/" className="text-indigo-600 hover:underline text-sm">
          &larr; Back to home
        </Link>
      </div>
    );
  }

  /* ── Render ── */
  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-3xl px-6 py-6">
          <Link
            href={idea.jobId ? `/results/${idea.jobId}` : "/"}
            className="inline-flex items-center gap-1 text-sm text-zinc-500 ab-link-hover transition-colors mb-4"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to results
          </Link>
          <div
            className={`flex items-start gap-3 rounded-lg -mx-2 px-2 -my-1 py-1 transition-[background-color,opacity,box-shadow] duration-500 ease-out ${
              justUpdated
                ? "bg-yellow-50/70 opacity-[0.98] shadow-[0_0_0_1px_rgba(250,204,21,0.35)]"
                : "bg-transparent opacity-100 shadow-none"
            }`}
          >
            <div className="flex-1">
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
                {idea.title}
              </h1>
              <p className="mt-2 text-zinc-600 leading-relaxed">{idea.summary}</p>
              {idea.inspiredAngle && (
                <p className="mt-2 text-sm text-indigo-600/70 italic leading-relaxed">
                  {idea.inspiredAngle}
                </p>
              )}
            </div>
            <EffortBadge effort={idea.effort} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10 space-y-8">
        {/* Edit & re-generate (custom ideas only) */}
        {idea.source === "custom" && (
          <section className="rounded-xl border border-zinc-200 bg-white p-6">
            <h3 className="text-sm font-semibold text-zinc-700 mb-1">
              Refine this idea
            </h3>
            <p className="text-xs text-zinc-500 mb-3">
              Edit the description below and re-generate.
            </p>
            <textarea
              value={regenPrompt}
              onChange={(e) => setRegenPrompt(e.target.value)}
              rows={3}
              disabled={regenerating}
              placeholder="Describe your prototype idea…"
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-300 disabled:opacity-50 resize-none"
            />
            <button
              onClick={handleRegenerate}
              disabled={!regenPrompt.trim() || regenerating}
              className="mt-2 inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {regenerating && <Spinner className="h-3.5 w-3.5 text-white" />}
              {regenerating ? "Re-generating…" : "Re-generate this idea"}
            </button>
          </section>
        )}

        {/* Brand Vibe Pack */}
        {theme && (
          <section className="rounded-xl border border-zinc-200 bg-white p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-zinc-900">
                Brand Vibe Pack
              </h2>
              <button
                onClick={() => {
                  const snippet = JSON.stringify(
                    {
                      primary: theme.primary,
                      accent: theme.accent,
                      bg: theme.bg,
                      text: theme.text,
                      fontFamily: theme.fontFamily ?? "system-ui, -apple-system, sans-serif",
                      radiusPx: theme.radiusPx ?? 12,
                      companyName: theme.companyName ?? idea.title.split(" ")[0],
                      faviconUrl: theme.faviconUrl ?? null,
                    },
                    null,
                    2
                  );
                  navigator.clipboard.writeText(snippet).catch(() => {});
                  setCopiedTheme(true);
                  setTimeout(() => setCopiedTheme(false), 2000);
                }}
                className="ab-btn-primary rounded-lg px-3 py-1.5 text-xs font-medium"
              >
                {copiedTheme ? "Copied!" : "Copy theme values"}
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              {/* Primary */}
              <div className="flex items-center gap-2">
                <span
                  className="h-8 w-8 rounded-lg border border-zinc-200 flex-shrink-0"
                  style={{ backgroundColor: theme.primary }}
                />
                <div>
                  <p className="text-xs text-zinc-500">Primary</p>
                  <p className="font-mono text-xs text-zinc-800">{theme.primary}</p>
                </div>
              </div>

              {/* Accent */}
              <div className="flex items-center gap-2">
                <span
                  className="h-8 w-8 rounded-lg border border-zinc-200 flex-shrink-0"
                  style={{ backgroundColor: theme.accent }}
                />
                <div>
                  <p className="text-xs text-zinc-500">Accent</p>
                  <p className="font-mono text-xs text-zinc-800">{theme.accent}</p>
                </div>
              </div>

              {/* Font */}
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-xs font-bold text-zinc-600">
                  Aa
                </span>
                <div>
                  <p className="text-xs text-zinc-500">Font</p>
                  <p className="text-xs text-zinc-800 truncate max-w-[140px]">
                    {theme.fontFamily ?? "system fallback"}
                  </p>
                </div>
              </div>

              {/* Source */}
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50">
                  <svg className="h-4 w-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </span>
                <div>
                  <p className="text-xs text-zinc-500">Source</p>
                  <p className="text-xs text-zinc-800">{theme.source}</p>
                </div>
              </div>

              {/* Radius */}
              <div className="flex items-center gap-2">
                <span
                  className="flex h-8 w-8 items-center justify-center border border-zinc-200 bg-zinc-50 text-xs font-mono text-zinc-600"
                  style={{ borderRadius: `${theme.radiusPx ?? 12}px` }}
                >
                  {theme.radiusPx ?? 12}
                </span>
                <div>
                  <p className="text-xs text-zinc-500">Radius</p>
                  <p className="text-xs text-zinc-800">{theme.radiusPx ?? 12}px</p>
                </div>
              </div>

              {/* Favicon */}
              {theme.faviconUrl && (
                <div className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={theme.faviconUrl}
                    alt="Favicon"
                    className="h-8 w-8 rounded-lg border border-zinc-200 object-contain bg-white"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                  <div>
                    <p className="text-xs text-zinc-500">Favicon</p>
                    <p className="text-xs text-zinc-800 truncate max-w-[140px]">detected</p>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Generate steps CTA / cooking / error / results */}
        <div ref={stepsRef}>
          {!plan && !generating && !planError && (
            <button
              onClick={handleGenerate}
              className="ab-btn-primary w-full rounded-xl py-4 text-sm font-semibold"
            >
              Generate Cursor Steps
            </button>
          )}

          {/* Error state with retry */}
          {planError && !generating && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
              <p className="text-sm text-amber-800 mb-3">
                Step generation didn&apos;t return valid data. This can happen with slow connections or temporary API issues.
              </p>
              <button
                onClick={handleGenerate}
                className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 transition-colors"
              >
                Try again
              </button>
            </div>
          )}

          {generating && (
            <div
              ref={cookSectionRef}
              className="rounded-xl border border-zinc-200 bg-white p-8"
              style={{ scrollMarginTop: "2rem" }}
            >
              <h3 className="text-base font-semibold text-zinc-900 mb-4">
                Generating build steps...
              </h3>
              <ul className="space-y-3">
                {cookSteps.map((step) => (
                  <li key={step.id} className="flex items-center gap-3">
                    <StepIcon status={step.status} />
                    <span
                      className={`text-sm ${
                        step.status === "running"
                          ? "font-medium text-zinc-900"
                          : step.status === "done"
                          ? "text-zinc-700"
                          : "text-zinc-500"
                      }`}
                    >
                      {step.label}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {plan && isValidPlan(plan) && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-zinc-900 mb-2">
                  Cursor Steps
                </h2>
                {plan.bmadExplanation && (
                  <p className="text-sm text-zinc-500 whitespace-pre-line">
                    {plan.bmadExplanation}
                  </p>
                )}
                {usedProvider === "fallback" && (
                  <p className="mt-2 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    Used fast fallback prompts (Gemini was unavailable).
                  </p>
                )}
                {usedProvider === "gemini" && (
                  <p className="mt-2 text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                    Prompts tailored by Gemini based on your company research.
                  </p>
                )}
              </div>

              {/* ── Prompt 0: Terminal Setup ── */}
              {plan.terminalSetup && (
              <div className="rounded-xl border-2 border-emerald-200 bg-white p-6">
                <div className="flex items-center gap-2 mb-3">
                  <span className="flex items-center justify-center h-7 w-7 rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                    0
                  </span>
                  <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                    Terminal
                  </span>
                  <h3 className="text-sm font-semibold text-zinc-900 flex-1">
                    Create project &amp; start dev server
                  </h3>
                </div>

                <p className="text-sm text-zinc-600 mb-1">
                  <span className="font-semibold text-zinc-700">Goal: </span>
                  Create a new Next.js app in{" "}
                  <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-mono text-zinc-800">
                    ~/Desktop/cursor-prototypes/{plan.folderName ?? "prototype"}
                  </code>
                </p>

                <p className="text-xs text-zinc-500 mb-4">
                  Open Cursor&apos;s built-in terminal (<kbd className="rounded border border-zinc-300 bg-zinc-100 px-1 py-0.5 text-[10px]">Ctrl+`</kbd> or <kbd className="rounded border border-zinc-300 bg-zinc-100 px-1 py-0.5 text-[10px]">Cmd+`</kbd>) and paste this block:
                </p>

                {/* Terminal block */}
                <div className="relative rounded-lg bg-zinc-950 p-4 font-mono text-sm">
                  <div className="flex items-center gap-2 mb-3 text-zinc-500 text-xs">
                    <span className="h-3 w-3 rounded-full bg-red-500/60" />
                    <span className="h-3 w-3 rounded-full bg-yellow-500/60" />
                    <span className="h-3 w-3 rounded-full bg-green-500/60" />
                    <span className="ml-2">Terminal</span>
                  </div>
                  <pre className="text-emerald-400 whitespace-pre-wrap leading-relaxed text-xs">
                    {plan.terminalSetup}
                  </pre>
                </div>

                <button
                  onClick={() => copyTerminal(plan.terminalSetup)}
                  className={`mt-3 w-full rounded-lg py-3 text-sm font-semibold transition-colors ${
                    copiedTerminal
                      ? "bg-emerald-600 text-white"
                      : "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
                  }`}
                >
                  {copiedTerminal ? "✓ Copied to clipboard" : "Copy Terminal Commands"}
                </button>

                <div className="mt-3 text-xs text-zinc-500">
                  <span className="font-semibold text-zinc-600">Done looks like:</span>
                  <p className="mt-1 leading-relaxed">
                    • Dev server running at http://localhost:3000<br />
                    • You see the default Next.js welcome page<br />
                    • Open the new folder in Cursor (File → Open Folder)
                  </p>
                </div>

                <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
                  <p className="text-xs text-amber-800">
                    <span className="font-semibold">Note:</span> If <code className="font-mono">create-next-app</code> asks interactive questions, answer: TypeScript → Yes, ESLint → Yes, Tailwind → Yes, <code className="font-mono">src/</code> directory → Yes, App Router → Yes, import alias → <code className="font-mono">@/*</code>
                  </p>
                </div>
              </div>
              )}

              {/* ── Prompts 1-3: Cursor chat prompts ── */}
              {Array.isArray(plan.steps) && plan.steps.map((step: BuildStep, i: number) => {
                const isOptional = i >= 2;
                const promptText = step?.cursorPrompt ?? "";
                const roleLabel = step?.role ?? "FE";
                const titleLabel = step?.title ?? `Step ${i + 1}`;
                const goalLabel = step?.instruction ?? "";
                const doneLabel = step?.doneLooksLike ?? "";
                return (
                  <div
                    key={i}
                    className={`rounded-xl border bg-white p-6 ${
                      isOptional
                        ? "border-dashed border-zinc-300 opacity-80"
                        : "border-zinc-200"
                    }`}
                  >
                    {/* Header row */}
                    <div className="flex items-center gap-2 mb-3">
                      <span className="flex items-center justify-center h-7 w-7 rounded-full bg-zinc-100 text-xs font-bold text-zinc-600">
                        {i + 1}
                      </span>
                      <span className="ab-role-badge rounded-full px-2.5 py-0.5 text-xs font-medium">
                        {roleLabel}
                      </span>
                      <h3 className="text-sm font-semibold text-zinc-900 flex-1">
                        {titleLabel}
                      </h3>
                      {isOptional && (
                        <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium">
                          optional
                        </span>
                      )}
                    </div>

                    {/* Goal */}
                    {goalLabel && (
                      <p className="text-sm text-zinc-600 mb-1">
                        <span className="font-semibold text-zinc-700">Goal: </span>
                        {goalLabel}
                      </p>
                    )}

                    <p className="text-xs text-zinc-500 mb-4">
                      Paste into Cursor chat (<kbd className="rounded border border-zinc-300 bg-zinc-100 px-1 py-0.5 text-[10px]">Cmd+L</kbd> / <kbd className="rounded border border-zinc-300 bg-zinc-100 px-1 py-0.5 text-[10px]">Ctrl+L</kbd>):
                    </p>

                    {/* Prompt code block */}
                    <div className="relative rounded-lg bg-zinc-950 p-4">
                      <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-mono leading-relaxed pr-20">
                        {promptText || "(No prompt text available)"}
                      </pre>
                    </div>

                    {/* Big copy button */}
                    <button
                      onClick={() => copyPrompt(promptText, i)}
                      disabled={!promptText}
                      className={`mt-3 w-full rounded-lg py-3 text-sm font-semibold transition-colors ${
                        copiedIdx === i
                          ? "bg-emerald-600 text-white"
                          : isOptional
                          ? "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
                          : "ab-btn-primary"
                      }`}
                    >
                      {copiedIdx === i
                        ? "✓ Copied to clipboard"
                        : isOptional
                        ? "Copy Fix + Polish prompt"
                        : `Copy Prompt ${i + 1}`}
                    </button>

                    {/* Done looks like */}
                    {doneLabel && (
                      <div className="mt-3 text-xs text-zinc-500">
                        <span className="font-semibold text-zinc-600">
                          Done looks like:
                        </span>
                        <p className="mt-1 whitespace-pre-line leading-relaxed">
                          {doneLabel}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* ── Optional: Host it accordion ── */}
              <details className="group rounded-xl border border-zinc-200 bg-white">
                <summary className="cursor-pointer px-6 py-4 text-sm font-medium text-zinc-700 hover:text-zinc-900 transition-colors list-none flex items-center justify-between">
                  <span>Optional: Host it (share a link)</span>
                  <svg
                    className="h-5 w-5 text-zinc-400 transition-transform group-open:rotate-180"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </summary>
                <div className="border-t border-zinc-100 px-6 py-5 space-y-8">
                  {/* Vercel (recommended) */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <h4 className="text-sm font-semibold text-zinc-800">Vercel</h4>
                      <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-medium text-emerald-700 uppercase tracking-wider">
                        recommended
                      </span>
                    </div>
                    <ol className="space-y-3">
                      {[
                        {
                          title: "Install Vercel CLI",
                          body: "npm i -g vercel",
                        },
                        {
                          title: "Deploy",
                          body: "vercel",
                        },
                        {
                          title: "Follow the prompts",
                          body: "Select your scope → Link to existing project? No → Project name? (accept default) → Directory? ./ → Done!",
                        },
                        {
                          title: "Get your link",
                          body: "Vercel prints a URL like https://your-project.vercel.app — share it!",
                        },
                      ].map((step, i) => (
                        <li key={i} className="flex gap-3">
                          <span className="flex-shrink-0 flex items-center justify-center h-6 w-6 rounded-full bg-zinc-100 text-xs font-bold text-zinc-500">
                            {i + 1}
                          </span>
                          <div>
                            <p className="text-sm font-medium text-zinc-800">{step.title}</p>
                            <p className="text-sm text-zinc-600 mt-0.5">
                              {step.body.includes("npm") || step.body === "vercel" ? (
                                <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-mono">{step.body}</code>
                              ) : (
                                step.body
                              )}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>

                  {/* Firebase (optional) */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <h4 className="text-sm font-semibold text-zinc-800">Firebase Hosting</h4>
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 uppercase tracking-wider">
                        alternative
                      </span>
                    </div>
                    <ol className="space-y-3">
                      {[
                        {
                          title: "Install Firebase CLI",
                          cmd: "npm i -g firebase-tools",
                        },
                        {
                          title: "Log in",
                          cmd: "firebase login",
                        },
                        {
                          title: "Initialize hosting",
                          cmd: "firebase init hosting",
                          note: 'When asked for the public directory, enter "out". Configure as single-page app? Yes.',
                        },
                        {
                          title: "Build a static export",
                          cmd: 'Add "output": "export" to next.config.ts, then run: npm run build',
                        },
                        {
                          title: "Deploy",
                          cmd: "firebase deploy --only hosting",
                          note: "Firebase prints your live URL — share it!",
                        },
                      ].map((step, i) => (
                        <li key={i} className="flex gap-3">
                          <span className="flex-shrink-0 flex items-center justify-center h-6 w-6 rounded-full bg-zinc-100 text-xs font-bold text-zinc-500">
                            {i + 1}
                          </span>
                          <div>
                            <p className="text-sm font-medium text-zinc-800">{step.title}</p>
                            <code className="block rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-mono text-zinc-700 mt-0.5">
                              {step.cmd}
                            </code>
                            {step.note && (
                              <p className="text-xs text-zinc-500 mt-1">{step.note}</p>
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              </details>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
