"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import type { Idea, BuildPlan, BuildStep, Theme } from "@/lib/types";
import { EFFORT_LEVELS } from "@/lib/effort";
import AppHeader from "@/components/AppHeader";

/* ── Helpers ── */

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

function expandRole(role: string): string {
  switch (role) {
    case "PM+UX": return "Product Manager + UX";
    case "FE": return "Front End";
    case "FE+QA": return "Front End + Quality";
    case "QA": return "Quality Assurance";
    default: return role;
  }
}

/* ── Spinner status messages (shown IN ORDER, ~3 s each) ── */

const STATUS_LINES = [
  "Good things come to those who wait",
  "And you might have to wait 30 seconds",
  "Gemini Pro takes a bit more time",
  "But it\u2019s worth it for the quality results",
  "So you want to build an app\u2026",
  "And the good news is\u2026",
  "You are in the right place!",
  "Remember not to quit",
  "There are no dead ends with AI",
  "Just hang in there and be patient",
  "Speaking of patience\u2026",
  "Almost done",
  "I said\u2026 almost done!",
  "The power of AI compels me!",
];

const MIN_COOK_MS = 6000;

/* ═══════════════════════════════════════════
   Main component
   ═══════════════════════════════════════════ */

export default function IdeaDetailView({ ideaId }: { ideaId: string }) {
  const [idea, setIdea] = useState<Idea | null>(null);
  const [theme, setTheme] = useState<Theme | null>(null);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<BuildPlan | null>(null);
  const [generating, setGenerating] = useState(false);
  const [statusLine, setStatusLine] = useState("");
  const msgIdxRef = useRef(0);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [copiedTerminal, setCopiedTerminal] = useState(false);
  const [copiedTheme, setCopiedTheme] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [bmadOpen, setBmadOpen] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [usedProvider, setUsedProvider] = useState<"gemini" | "fallback" | "cache" | null>(null);
  const [planError, setPlanError] = useState(false);
  const [errorInfo, setErrorInfo] = useState<{ code?: string; message?: string; requestId?: string } | null>(null);
  const [rationale, setRationale] = useState("");
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
        if (!res.ok) { setNotFound(true); return; }
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

  /* ── Auto-scroll to spinner section when generation starts ── */
  useEffect(() => {
    if (generating) {
      const t = setTimeout(() => {
        cookSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 40);
      return () => clearTimeout(t);
    }
  }, [generating]);

  /* ── Rotating status line: sequential, 3 s cadence, holds last line ── */
  useEffect(() => {
    if (!generating) return;
    msgIdxRef.current = 0;
    setStatusLine("");

    let iv: ReturnType<typeof setInterval> | null = null;
    const delay = setTimeout(() => {
      setStatusLine(STATUS_LINES[0]);
      iv = setInterval(() => {
        const next = msgIdxRef.current + 1;
        if (next < STATUS_LINES.length) {
          msgIdxRef.current = next;
          setStatusLine(STATUS_LINES[next]);
        }
      }, 3000);
    }, 600);

    return () => { clearTimeout(delay); if (iv) clearInterval(iv); };
  }, [generating]);

  /* ── Generate build steps (with one silent auto-retry) ── */
  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setUsedProvider(null);
    setPlanError(false);
    setErrorInfo(null);
    setPlan(null);
    setRationale("");
    const cookStart = Date.now();

    const attemptFetch = async (): Promise<{ ok: boolean; data: unknown; errInfo?: { code?: string; message?: string; requestId?: string } }> => {
      try {
        const res = await fetch("/api/steps/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ideaId }),
        });
        if (res.ok) {
          const data = await res.json();
          return { ok: true, data };
        }
        // Parse structured error from server
        try {
          const errBody = await res.json();
          const err = errBody?.error ?? errBody;
          return { ok: false, data: null, errInfo: { code: err?.code, message: err?.message, requestId: err?.requestId } };
        } catch {
          return { ok: false, data: null, errInfo: { message: `Server error (${res.status})` } };
        }
      } catch {
        return { ok: false, data: null, errInfo: { message: "Could not connect to server" } };
      }
    };

    // First attempt
    let result = await attemptFetch();

    // Auto-retry once on transient errors (not IDEA_NOT_FOUND)
    if (!result.ok && result.errInfo?.code !== "IDEA_NOT_FOUND") {
      result = await attemptFetch();
    }

    const elapsed = Date.now() - cookStart;
    if (elapsed < MIN_COOK_MS) {
      await new Promise((r) => setTimeout(r, MIN_COOK_MS - elapsed));
    }

    if (result.ok && isValidPlan(result.data)) {
      setPlan(result.data as BuildPlan);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const provider = (result.data as any).used as string | undefined;
      setUsedProvider((provider as "gemini" | "fallback" | "cache") ?? null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setRationale((result.data as any).rationaleForPromptCount || "");
      setTimeout(() => stepsRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } else {
      setPlanError(true);
      setErrorInfo(result.errInfo ?? { message: "Received an unexpected response" });
    }

    setGenerating(false);
  }, [ideaId]);

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

  const copyCmd = (text: string, key: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedCmd(key);
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  /* ── Re-generate custom idea ── */
  const [regenError, setRegenError] = useState("");

  const handleRegenerate = async () => {
    const trimmed = regenPrompt.trim();
    if (!trimmed || regenerating) return;
    if (trimmed.length < 40) { setRegenError("Please enter at least 40 characters."); return; }
    setRegenerating(true);
    setRegenError("");
    try {
      const res = await fetch("/api/ideas/custom/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ideaId, description: trimmed }),
      });
      const resData = await res.json();
      if (!res.ok) { setRegenError(resData.error || "Regeneration failed"); return; }
      const ideaRes = await fetch(`/api/idea/${ideaId}`);
      if (ideaRes.ok) {
        const data = await ideaRes.json();
        setIdea(data);
        setTheme(data.theme ?? null);
        setPlan(null);
        setUsedProvider(null);
        setPlanError(false);
        if (highlightTimer.current) clearTimeout(highlightTimer.current);
        setJustUpdated(true);
        highlightTimer.current = setTimeout(() => setJustUpdated(false), 900);
      }
    } catch {
      setRegenError("Failed to connect to server");
    } finally {
      setRegenerating(false);
    }
  };

  /* ── Loading / not found states ── */
  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50">
        <AppHeader />
        <div className="flex items-center justify-center py-32">
          <Spinner className="text-zinc-400 h-8 w-8" />
        </div>
      </div>
    );
  }

  if (notFound || !idea) {
    const parsedJobId = (() => {
      const lastDash = ideaId.lastIndexOf("-");
      return lastDash > 0 ? ideaId.slice(0, lastDash) : null;
    })();
    return (
      <div className="min-h-screen bg-zinc-50">
        <AppHeader />
        <div className="flex flex-col items-center justify-center gap-4 py-32 text-center px-6">
          <svg className="h-10 w-10 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <p className="text-zinc-700 font-medium">Looks like the server restarted</p>
          <p className="text-sm text-zinc-500 max-w-md">
            The data for this idea could not be found. This usually happens after a dev server restart. You can go back to results and try again.
          </p>
          <div className="flex items-center gap-3 mt-2">
            {parsedJobId && (
              <Link
                href={`/results/${parsedJobId}`}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 transition-colors"
              >
                Back to results
              </Link>
            )}
            <Link
              href="/"
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50 transition-colors"
            >
              Start over
            </Link>
          </div>
        </div>
      </div>
    );
  }


  /* ═══════════════════════════════════════════
     Render
     ═══════════════════════════════════════════ */
  return (
    <div className="min-h-screen bg-zinc-50">
      <AppHeader />

      {/* Back to results + idea title */}
      <div className="mx-auto max-w-3xl px-6 pt-6 pb-2">
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
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900">{idea.title}</h1>
              <p className="mt-2 text-zinc-600 leading-relaxed">{idea.summary}</p>
            </div>
            <EffortBadge effort={idea.effort} />
          </div>
      </div>

      <main className="mx-auto max-w-3xl px-6 py-10 space-y-8">
        {/* Edit & re-generate (custom ideas only) */}
        {idea.source === "custom" && (() => {
          const trimLen = regenPrompt.trim().length;
          const isValid = trimLen >= 40;
          const counterLabel = trimLen <= 200
            ? `${trimLen} / 200 recommended`
            : `${trimLen} / 600 max`;
          return (
            <section className="rounded-xl border border-zinc-200 bg-white p-6">
              <h3 className="text-sm font-semibold text-zinc-700 mb-1">Refine this idea</h3>
              <p className="text-xs text-zinc-500 mb-3">Edit the description below and re-generate.</p>
              <textarea
                value={regenPrompt}
                onChange={(e) => { if (e.target.value.length <= 600) setRegenPrompt(e.target.value); }}
                rows={3}
                disabled={regenerating}
                placeholder="Describe your prototype idea…"
                className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-300 disabled:opacity-50 resize-none"
              />
              <div className="mt-1 flex items-center justify-between">
                <p className="text-xs text-zinc-400">Include: who it&apos;s for + what it does + any key constraint.</p>
                <span className={`text-xs tabular-nums ${trimLen >= 200 ? "text-emerald-600" : trimLen >= 40 ? "text-zinc-500" : "text-zinc-400"}`}>
                  {counterLabel}
                </span>
              </div>
              {regenError && <p className="mt-2 text-sm text-red-600">{regenError}</p>}
              <button
                onClick={handleRegenerate}
                disabled={!isValid || regenerating}
                className="mt-2 inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {regenerating && <Spinner className="h-3.5 w-3.5 text-white" />}
                {regenerating ? "Re-generating\u2026" : "Re-generate this idea"}
              </button>
            </section>
          );
        })()}

        {/* Brand Vibe Pack */}
        {theme && (
          <section className="rounded-xl border border-zinc-200 bg-white p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-zinc-900">Brand Vibe Pack</h2>
              <button
                onClick={() => {
                  const snippet = JSON.stringify(
                    {
                      primary: theme.primary, accent: theme.accent, bg: theme.bg, text: theme.text,
                      fontFamily: theme.fontFamily ?? "system-ui, -apple-system, sans-serif",
                      radiusPx: theme.radiusPx ?? 12,
                      companyName: theme.companyName ?? idea.title.split(" ")[0],
                      faviconUrl: theme.faviconUrl ?? null,
                    },
                    null, 2
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
              <div className="flex items-center gap-2">
                <span className="h-8 w-8 rounded-lg border border-zinc-200 flex-shrink-0" style={{ backgroundColor: theme.primary }} />
                <div><p className="text-xs text-zinc-500">Primary</p><p className="font-mono text-xs text-zinc-800">{theme.primary}</p></div>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-8 w-8 rounded-lg border border-zinc-200 flex-shrink-0" style={{ backgroundColor: theme.accent }} />
                <div><p className="text-xs text-zinc-500">Accent</p><p className="font-mono text-xs text-zinc-800">{theme.accent}</p></div>
              </div>
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-xs font-bold text-zinc-600">Aa</span>
                <div><p className="text-xs text-zinc-500">Font</p><p className="text-xs text-zinc-800 truncate max-w-[140px]">{theme.fontFamily ?? "system fallback"}</p></div>
              </div>
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50">
                  <svg className="h-4 w-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </span>
                <div><p className="text-xs text-zinc-500">Source</p><p className="text-xs text-zinc-800">{theme.source}</p></div>
              </div>
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center border border-zinc-200 bg-zinc-50 text-xs font-mono text-zinc-600" style={{ borderRadius: `${theme.radiusPx ?? 12}px` }}>{theme.radiusPx ?? 12}</span>
                <div><p className="text-xs text-zinc-500">Radius</p><p className="text-xs text-zinc-800">{theme.radiusPx ?? 12}px</p></div>
              </div>
              {theme.faviconUrl && (
                <div className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={theme.faviconUrl} alt="Favicon" className="h-8 w-8 rounded-lg border border-zinc-200 object-contain bg-white" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  <div><p className="text-xs text-zinc-500">Favicon</p><p className="text-xs text-zinc-800 truncate max-w-[140px]">detected</p></div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Generate steps CTA / cooking / error / workshop */}
        <div ref={stepsRef}>
          {!plan && !generating && !planError && (
            <button
              onClick={handleGenerate}
              className="ab-btn-primary w-full rounded-xl py-4 text-sm font-semibold"
            >
              Generate Workshop Steps
            </button>
          )}

          {planError && !generating && (() => {
            const parsedJobId = (() => {
              const lastDash = ideaId.lastIndexOf("-");
              return lastDash > 0 ? ideaId.slice(0, lastDash) : null;
            })();
            return (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center space-y-3">
                <div className="flex justify-center mb-1">
                  <svg className="h-8 w-8 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                </div>
                <p className="text-sm text-amber-800 font-medium">
                  {errorInfo?.code === "IDEA_NOT_FOUND"
                    ? "Looks like the server restarted."
                    : "Step generation hit a snag."}
                </p>
                <p className="text-xs text-amber-700/80">
                  {errorInfo?.code === "IDEA_NOT_FOUND"
                    ? "The data for this idea could not be recovered. Go back to results to reselect it."
                    : "This can happen with slow connections or temporary API issues. Give it another shot."}
                </p>
                <div className="flex items-center justify-center gap-3 pt-1">
                  {errorInfo?.code === "IDEA_NOT_FOUND" ? (
                    <>
                      {parsedJobId && (
                        <Link
                          href={`/results/${parsedJobId}`}
                          className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 transition-colors"
                        >
                          Back to results
                        </Link>
                      )}
                      <Link
                        href="/"
                        className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50 transition-colors"
                      >
                        Start over
                      </Link>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={handleGenerate}
                        disabled={generating}
                        className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        Try again
                      </button>
                      <Link
                        href="/"
                        className="text-xs text-amber-700 hover:text-amber-900 hover:underline transition-colors"
                      >
                        If this keeps happening &mdash; start over
                      </Link>
                    </>
                  )}
                </div>
                {errorInfo?.requestId && process.env.NODE_ENV !== "production" && (
                  <p className="text-[10px] text-amber-500/60 font-mono select-all">{errorInfo.requestId}</p>
                )}
              </div>
            );
          })()}

          {/* ── Spinner (single line, ordered messages, 3 s cadence) ── */}
          {generating && (
            <div
              ref={cookSectionRef}
              className="rounded-xl border border-zinc-200 bg-white py-14 px-6 text-center"
              style={{ scrollMarginTop: "2rem" }}
            >
              <div className="flex justify-center mb-5">
                <Spinner className="h-7 w-7 text-zinc-400" />
              </div>
              <p className="text-sm sm:text-base font-medium text-zinc-600 min-h-[1.5rem] transition-opacity duration-300 ease-out">
                {statusLine}
              </p>
            </div>
          )}

          {/* ════════════════════════════════════════
             Workshop output
             ════════════════════════════════════════ */}
          {plan && isValidPlan(plan) && (
            <div className="space-y-8">
              {/* ── Intro block ── */}
              <section className="rounded-xl border border-zinc-200 bg-white p-6 sm:p-8">
                <h2 className="text-xl font-bold text-zinc-900 mb-3">
                  Let&apos;s build this app together
                </h2>
                <p className="text-sm text-zinc-600 leading-relaxed mb-2">
                  By the end, you&apos;ll have a working Next.js prototype you can show to anyone.
                </p>
                <p className="text-sm text-zinc-600 leading-relaxed">
                  Here&apos;s how it works: follow the steps below. For each prompt, copy the text and paste it into Cursor AI.
                  Cursor will write the code for you. You just guide it, step by step.
                </p>
                {usedProvider === "fallback" && (
                  <p className="mt-3 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    Using fast fallback prompts (Gemini was unavailable).
                  </p>
                )}

                {/* Powered by Gemini + rationale */}
                <div className="mt-5 pt-4 border-t border-zinc-100">
                  <span className="text-[11px] text-zinc-400 italic">Powered by Gemini</span>
                  <p className="mt-0.5 text-[11px] text-zinc-400 leading-relaxed">
                    {rationale || "Your steps are chosen based on the build milestones for this idea."}
                  </p>
                </div>
              </section>

              {/* ── Meet your BMAD team ── */}
              <section className="rounded-xl border border-zinc-200 bg-white p-6">
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-base font-semibold text-zinc-900">Meet your BMAD team</h3>
                  <div
                    className="relative"
                    onMouseEnter={() => setBmadOpen(true)}
                    onMouseLeave={() => setBmadOpen(false)}
                  >
                    <button
                      onClick={() => setBmadOpen((v) => !v)}
                      className="flex items-center justify-center h-5 w-5 rounded-full bg-zinc-100 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-200 transition-colors text-[10px] font-bold leading-none"
                      aria-label="What is BMAD?"
                    >
                      ?
                    </button>
                    {bmadOpen && (
                      <div className="absolute left-1/2 -translate-x-1/2 top-7 z-20 w-64 rounded-lg bg-white border border-zinc-200 shadow-lg p-3 text-xs text-zinc-600 leading-relaxed">
                        <p className="font-semibold text-zinc-700 mb-1">BMAD = Build &middot; Measure &middot; Architect &middot; Deliver</p>
                        <p>This is your structured build team. Each role represents a different mindset guiding your app from idea to production.</p>
                      </div>
                    )}
                  </div>
                </div>
                <p className="text-sm text-zinc-600 mb-4 leading-relaxed">
                  Each step below uses a &quot;BMAD role&quot; — it tells Cursor what kind of expert to be. Here&apos;s who&apos;s who:
                </p>
                <div className="space-y-3">
                  <div className="flex gap-3 items-start">
                    <span className="flex-shrink-0 rounded-full bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">PM+UX</span>
                    <p className="text-sm text-zinc-600"><span className="font-medium text-zinc-800">Product Manager + UX</span> — decides structure, layout, and branding.</p>
                  </div>
                  <div className="flex gap-3 items-start">
                    <span className="flex-shrink-0 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">Front End</span>
                    <p className="text-sm text-zinc-600"><span className="font-medium text-zinc-800">Front End</span> — builds functionality and interactivity.</p>
                  </div>
                  <div className="flex gap-3 items-start">
                    <span className="flex-shrink-0 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-xs font-semibold text-amber-700">QA</span>
                    <p className="text-sm text-zinc-600"><span className="font-medium text-zinc-800">Quality Assurance</span> — polish, fix errors, and tighten details.</p>
                  </div>
                </div>
              </section>

              {/* ── Pre-step: Get your laptop ready ── */}
              <section className="rounded-xl border-2 border-emerald-200 bg-white p-6 space-y-6">
                <div className="flex items-center gap-2">
                  <span className="flex items-center justify-center h-7 w-7 rounded-full bg-emerald-100 text-emerald-700">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4" width="18" height="12" rx="2" />
                      <path d="M2 20h20" />
                    </svg>
                  </span>
                  <h3 className="text-base font-semibold text-zinc-900">Get your laptop ready</h3>
                </div>

                {/* ── A: Create Your Project Folder ── */}
                <div>
                  <h4 className="text-sm font-semibold text-zinc-800 mb-2">Create your project folder</h4>
                  <p className="text-sm text-zinc-600 leading-relaxed mb-3">
                    Manually create a folder on your Desktop called:
                  </p>
                  <div className="rounded-lg bg-zinc-950 px-4 py-3 flex items-center justify-between gap-3">
                    <code className="text-emerald-400 text-sm font-mono">{idea.title}</code>
                    <button
                      onClick={() => copyCmd(idea.title, "folder")}
                      className={`flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                        copiedCmd === "folder" ? "bg-emerald-600 text-white" : "ab-btn-primary"
                      }`}
                    >
                      {copiedCmd === "folder" ? "\u2713 Copied!" : "Copy"}
                    </button>
                  </div>
                  <div className="mt-3 text-sm text-zinc-600 space-y-1.5">
                    <p>Open <strong>Cursor</strong> &rarr; <strong>Open Folder</strong> &rarr; select that folder.</p>
                    <p>Then open the terminal: <strong>View &rarr; Terminal</strong></p>
                  </div>
                </div>

                <hr className="border-zinc-200" />

                {/* ── B: Node Installation ── */}
                <div>
                  <h4 className="text-sm font-semibold text-zinc-800 mb-3">Install Node.js</h4>

                  {/* Accordion: Already have Node? */}
                  <details className="group rounded-lg border border-zinc-200 bg-zinc-50 mb-4">
                    <summary className="cursor-pointer select-none list-none px-4 py-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-zinc-700">Already have Node installed?</span>
                        <svg className="h-4 w-4 text-zinc-400 transition-transform group-open:rotate-180 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </summary>
                    <div className="px-4 pb-4 space-y-3">
                      <p className="text-xs font-medium text-zinc-500">Let&apos;s check if Node is already installed</p>
                      <p className="text-xs text-zinc-500 leading-relaxed">
                        If you see a version number, you can skip the install steps below and proceed to &quot;Create your project.&quot; If you get &quot;command not found,&quot; follow the Homebrew + Node install steps below.
                      </p>
                      <div className="rounded-lg bg-zinc-950 px-4 py-3 flex items-center justify-between gap-3">
                        <code className="text-emerald-400 text-sm font-mono">node -v</code>
                        <button
                          onClick={() => copyCmd("node -v", "node-check")}
                          className={`flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                            copiedCmd === "node-check" ? "bg-emerald-600 text-white" : "ab-btn-primary"
                          }`}
                        >
                          {copiedCmd === "node-check" ? "\u2713 Copied!" : "Copy"}
                        </button>
                      </div>
                    </div>
                  </details>

                  {/* Default install flow */}
                  <div className="space-y-4">
                    {/* 1. Install Homebrew */}
                    <div>
                      <p className="text-sm font-medium text-zinc-700 mb-2">1. Install Homebrew</p>
                      <div className="rounded-lg bg-zinc-950 px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <code className="text-emerald-400 text-xs font-mono leading-relaxed break-all">
                            {'/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'}
                          </code>
                          <button
                            onClick={() => copyCmd('/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"', "brew-install")}
                            className={`flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                              copiedCmd === "brew-install" ? "bg-emerald-600 text-white" : "ab-btn-primary"
                            }`}
                          >
                            {copiedCmd === "brew-install" ? "\u2713 Copied!" : "Copy"}
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-zinc-500 mt-2">You may be asked for your Mac password. That&apos;s normal.</p>
                      <p className="text-xs text-zinc-500 mt-1">Homebrew may prompt you to install Apple Command Line Tools &mdash; click <strong>Install</strong>, then come back here.</p>
                    </div>

                    {/* 2. Activate Homebrew */}
                    <div>
                      <p className="text-sm font-medium text-zinc-700 mb-2">2. Activate Homebrew</p>
                      <div className="rounded-lg bg-zinc-950 px-4 py-3 flex items-center justify-between gap-3">
                        <code className="text-emerald-400 text-sm font-mono break-all">{'eval "$(/opt/homebrew/bin/brew shellenv)"'}</code>
                        <button
                          onClick={() => copyCmd('eval "$(/opt/homebrew/bin/brew shellenv)"', "brew-activate")}
                          className={`flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                            copiedCmd === "brew-activate" ? "bg-emerald-600 text-white" : "ab-btn-primary"
                          }`}
                        >
                          {copiedCmd === "brew-activate" ? "\u2713 Copied!" : "Copy"}
                        </button>
                      </div>
                      <p className="text-xs text-zinc-500 mt-2">If the first command fails, your Mac may be Intel &mdash; try this instead:</p>
                      <div className="mt-1.5 rounded-lg bg-zinc-950 px-4 py-3 flex items-center justify-between gap-3">
                        <code className="text-emerald-400 text-sm font-mono break-all">{'eval "$(/usr/local/bin/brew shellenv)"'}</code>
                        <button
                          onClick={() => copyCmd('eval "$(/usr/local/bin/brew shellenv)"', "brew-activate-intel")}
                          className={`flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                            copiedCmd === "brew-activate-intel" ? "bg-emerald-600 text-white" : "ab-btn-primary"
                          }`}
                        >
                          {copiedCmd === "brew-activate-intel" ? "\u2713 Copied!" : "Copy"}
                        </button>
                      </div>
                    </div>

                    {/* 3. Install Node */}
                    <div>
                      <p className="text-sm font-medium text-zinc-700 mb-2">3. Install Node</p>
                      <div className="rounded-lg bg-zinc-950 px-4 py-3 flex items-center justify-between gap-3">
                        <code className="text-emerald-400 text-sm font-mono">brew install node</code>
                        <button
                          onClick={() => copyCmd("brew install node", "brew-node")}
                          className={`flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                            copiedCmd === "brew-node" ? "bg-emerald-600 text-white" : "ab-btn-primary"
                          }`}
                        >
                          {copiedCmd === "brew-node" ? "\u2713 Copied!" : "Copy"}
                        </button>
                      </div>
                    </div>

                    {/* 4. Confirm installation */}
                    <div>
                      <p className="text-sm font-medium text-zinc-700 mb-2">4. Confirm installation</p>
                      <div className="rounded-lg bg-zinc-950 px-4 py-3 flex items-center justify-between gap-3">
                        <code className="text-emerald-400 text-sm font-mono">node -v</code>
                        <button
                          onClick={() => copyCmd("node -v", "node-confirm")}
                          className={`flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                            copiedCmd === "node-confirm" ? "bg-emerald-600 text-white" : "ab-btn-primary"
                          }`}
                        >
                          {copiedCmd === "node-confirm" ? "\u2713 Copied!" : "Copy"}
                        </button>
                      </div>
                      <p className="text-xs text-zinc-500 mt-2">If a version number appears, you&apos;re ready to build.</p>
                    </div>
                  </div>
                </div>

                <hr className="border-zinc-200" />

                {/* ── Create your project ── */}
                <div>
                  <h4 className="text-sm font-semibold text-zinc-800 mb-2">Create your project</h4>
                  <p className="text-sm text-zinc-600 mb-3">Paste this into Cursor&apos;s terminal:</p>

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
                        : "ab-btn-primary"
                    }`}
                  >
                    {copiedTerminal ? "\u2713 Copied to clipboard" : "Copy Terminal Commands"}
                  </button>

                  <p className="mt-3 text-sm text-zinc-600">
                    If create-next-app asks &quot;Would you like to use React Compiler?&quot;, choose No.
                  </p>

                  <div className="mt-2 text-xs text-zinc-500">
                    <span className="font-semibold text-zinc-600">Done looks like:</span>
                    <p className="mt-1 leading-relaxed">
                      &bull; Dev server running at a local URL (shown in your terminal &mdash; usually http://localhost:3000, or the next available port)<br />
                      &bull; You see the default Next.js welcome page
                    </p>
                  </div>
                </div>
              </section>

              {/* ── Steps 1–N: Cursor prompts ── */}
              {Array.isArray(plan.steps) && plan.steps.map((step: BuildStep, i: number) => {
                const promptText = step?.cursorPrompt ?? "";
                const roleLabel = step?.role ?? "FE";
                const titleLabel = step?.title ?? `Step ${i + 1}`;
                const goalLabel = step?.instruction ?? "";
                const doneLabel = step?.doneLooksLike ?? "";
                const stepNumber = i + 1;
                return (
                  <section
                    key={i}
                    className="rounded-xl border border-zinc-200 bg-white p-6"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <span className="flex items-center justify-center h-7 w-7 rounded-full bg-zinc-100 text-xs font-bold text-zinc-600">
                        {stepNumber}
                      </span>
                      <span className="ab-role-badge rounded-full px-2.5 py-0.5 text-xs font-medium">{expandRole(roleLabel)}</span>
                      <h3 className="text-sm font-semibold text-zinc-900 flex-1">{titleLabel}</h3>
                    </div>

                    {goalLabel && (
                      <p className="text-sm text-zinc-600 mb-3">{goalLabel}</p>
                    )}

                    <p className="text-xs text-zinc-500 mb-3">
                      Paste into Cursor chat (<kbd className="rounded border border-zinc-300 bg-zinc-100 px-1 py-0.5 text-[10px]">Cmd+L</kbd> / <kbd className="rounded border border-zinc-300 bg-zinc-100 px-1 py-0.5 text-[10px]">Ctrl+L</kbd>):
                    </p>

                    <div className="relative rounded-lg bg-zinc-950 p-4">
                      <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-mono leading-relaxed pr-20">
                        {promptText || "(No prompt text available)"}
                      </pre>
                    </div>

                    <button
                      onClick={() => copyPrompt(promptText, i)}
                      disabled={!promptText}
                      className={`mt-3 w-full rounded-lg py-3 text-sm font-semibold transition-colors ${
                        copiedIdx === i
                          ? "bg-emerald-600 text-white"
                          : "ab-btn-primary"
                      }`}
                    >
                      {copiedIdx === i
                        ? "\u2713 Copied to clipboard"
                        : `Copy Prompt ${stepNumber}`}
                    </button>

                    {doneLabel && (
                      <div className="mt-3 text-xs text-zinc-500">
                        <span className="font-semibold text-zinc-600">Done looks like:</span>
                        <p className="mt-1 whitespace-pre-line leading-relaxed">{doneLabel}</p>
                      </div>
                    )}
                  </section>
                );
              })}

              {/* ── Share your prototype (optional) — collapsed accordion ── */}
              <section className="rounded-xl border border-zinc-200 bg-white">
                <details className="group">
                  <summary className="cursor-pointer select-none list-none p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-base font-semibold text-zinc-900">Share your prototype (optional)</h3>
                        <p className="text-sm text-zinc-500 mt-1">
                          Deploying is optional. When you&apos;re ready, choose Vercel or Firebase.
                        </p>
                      </div>
                      <svg className="h-5 w-5 text-zinc-400 transition-transform group-open:rotate-180 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </summary>

                  <div className="px-6 pb-6 space-y-6">
                    {/* Intro */}
                    <div className="rounded-lg bg-indigo-50 border border-indigo-100 p-4">
                      <p className="text-sm text-indigo-800 leading-relaxed">
                        <strong>What does &quot;deploy&quot; mean?</strong> Right now your app only runs on your computer.
                        Deploying puts it on the internet so anyone with the link can use it — like sharing a Google Doc, but for your app.
                        Both options below are free for small projects.
                      </p>
                    </div>

                    {/* ── Vercel (recommended) ── */}
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="text-sm font-semibold text-zinc-800">Vercel (recommended)</h4>
                        <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-medium text-emerald-700 uppercase tracking-wider">easiest</span>
                      </div>
                      <p className="text-sm text-zinc-600 mb-2">
                        <strong>What you&apos;ll end up with:</strong> A live URL like <code className="text-xs bg-zinc-100 px-1 rounded">your-app.vercel.app</code> that anyone can visit.
                      </p>

                      {/* Before you start */}
                      <div className="rounded-lg bg-zinc-50 border border-zinc-200 p-3 mb-3 text-sm text-zinc-600">
                        <p className="font-medium text-zinc-700 mb-1">Before you start:</p>
                        <ul className="space-y-1 text-xs text-zinc-600">
                          <li className="flex gap-1.5">
                            <span className="text-zinc-400">•</span>
                            Create a free account at <a href="https://vercel.com" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline font-medium">vercel.com</a>
                          </li>
                          <li className="flex gap-1.5">
                            <span className="text-zinc-400">•</span>
                            Make sure your app runs locally with <code className="bg-zinc-100 px-1 rounded text-[11px]">npm run dev</code>
                          </li>
                        </ul>
                      </div>

                      <ol className="space-y-2 text-sm text-zinc-600 mb-4">
                        <li className="flex gap-2">
                          <span className="text-zinc-400 font-mono text-xs mt-0.5 flex-shrink-0">1.</span>
                          <span>Open Cursor&apos;s terminal and run: <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-mono">npm i -g vercel</code></span>
                        </li>
                        <li className="flex gap-2">
                          <span className="text-zinc-400 font-mono text-xs mt-0.5 flex-shrink-0">2.</span>
                          <span>Type <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-mono">vercel</code> and press Enter. It&apos;ll open a browser to log you in.</span>
                        </li>
                        <li className="flex gap-2">
                          <span className="text-zinc-400 font-mono text-xs mt-0.5 flex-shrink-0">3.</span>
                          <span>Answer the prompts (accept all defaults). When it finishes, you&apos;ll see your live URL.</span>
                        </li>
                        <li className="flex gap-2">
                          <span className="text-zinc-400 font-mono text-xs mt-0.5 flex-shrink-0">4.</span>
                          <span>Add your environment variables in the <a href="https://vercel.com/dashboard" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">Vercel dashboard</a> → Project → Settings → Environment Variables. Never commit <code className="bg-zinc-100 px-1 rounded text-[11px]">.env</code> files.</span>
                        </li>
                      </ol>

                      {/* Optional Cursor prompt */}
                      <div className="rounded-lg border border-dashed border-indigo-200 bg-indigo-50/50 p-4">
                        <p className="text-xs font-semibold text-indigo-700 mb-2">Optional: Ask Cursor to deploy on Vercel</p>
                        <div className="relative rounded-lg bg-zinc-950 p-3">
                          <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-mono leading-relaxed">{`Install the Vercel CLI globally (npm i -g vercel) if not already installed.\nRun "vercel" in my project root to deploy.\nFollow the interactive prompts — accept all defaults.\nWhen done, show me the live URL.\nDo NOT commit any .env or secret files.`}</pre>
                        </div>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(`Install the Vercel CLI globally (npm i -g vercel) if not already installed.\nRun "vercel" in my project root to deploy.\nFollow the interactive prompts — accept all defaults.\nWhen done, show me the live URL.\nDo NOT commit any .env or secret files.`).catch(() => {});
                          }}
                          className="mt-2 rounded-lg px-3 py-1.5 text-xs font-medium ab-btn-primary"
                        >
                          Copy Cursor prompt
                        </button>
                      </div>
                    </div>

                    {/* ── Firebase Hosting (alternative) ── */}
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="text-sm font-semibold text-zinc-800">Firebase Hosting (alternative)</h4>
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 uppercase tracking-wider">alternative</span>
                      </div>
                      <p className="text-sm text-zinc-600 mb-2">
                        <strong>What you&apos;ll end up with:</strong> A live URL like <code className="text-xs bg-zinc-100 px-1 rounded">your-app.web.app</code>.
                      </p>

                      {/* Before you start */}
                      <div className="rounded-lg bg-zinc-50 border border-zinc-200 p-3 mb-3 text-sm text-zinc-600">
                        <p className="font-medium text-zinc-700 mb-1">Before you start:</p>
                        <ul className="space-y-1 text-xs text-zinc-600">
                          <li className="flex gap-1.5">
                            <span className="text-zinc-400">•</span>
                            Create a free <a href="https://console.firebase.google.com" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline font-medium">Firebase project</a>
                          </li>
                          <li className="flex gap-1.5">
                            <span className="text-zinc-400">•</span>
                            Make sure your app builds with <code className="bg-zinc-100 px-1 rounded text-[11px]">npm run build</code>
                          </li>
                        </ul>
                      </div>

                      <ol className="space-y-2 text-sm text-zinc-600 mb-4">
                        <li className="flex gap-2">
                          <span className="text-zinc-400 font-mono text-xs mt-0.5 flex-shrink-0">1.</span>
                          <span>Install Firebase CLI: <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-mono">npm i -g firebase-tools</code></span>
                        </li>
                        <li className="flex gap-2">
                          <span className="text-zinc-400 font-mono text-xs mt-0.5 flex-shrink-0">2.</span>
                          <span>Log in: <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-mono">firebase login</code> (opens a browser).</span>
                        </li>
                        <li className="flex gap-2">
                          <span className="text-zinc-400 font-mono text-xs mt-0.5 flex-shrink-0">3.</span>
                          <span>Initialize hosting: <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-mono">firebase init hosting</code>. Select your project and accept defaults.</span>
                        </li>
                        <li className="flex gap-2">
                          <span className="text-zinc-400 font-mono text-xs mt-0.5 flex-shrink-0">4.</span>
                          <span>Build your app: <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-mono">npm run build</code></span>
                        </li>
                        <li className="flex gap-2">
                          <span className="text-zinc-400 font-mono text-xs mt-0.5 flex-shrink-0">5.</span>
                          <span>Deploy: <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-mono">firebase deploy --only hosting</code>. Your live URL will appear in the output.</span>
                        </li>
                      </ol>

                      <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 mb-4">
                        <p className="text-xs text-amber-800">
                          <strong>Tip:</strong> Set environment variables in the Firebase console (Project settings → Service accounts or Cloud Functions → Environment). Keep <code className="font-mono">.env.local</code> local-only.
                        </p>
                      </div>

                      {/* Optional Cursor prompt */}
                      <div className="rounded-lg border border-dashed border-indigo-200 bg-indigo-50/50 p-4">
                        <p className="text-xs font-semibold text-indigo-700 mb-2">Optional: Ask Cursor to deploy on Firebase</p>
                        <div className="relative rounded-lg bg-zinc-950 p-3">
                          <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-mono leading-relaxed">{`Install firebase-tools globally (npm i -g firebase-tools) if not already installed.\nRun "firebase login" so I'm authenticated.\nRun "firebase init hosting" — select my Firebase project and accept defaults.\nBuild my app with "npm run build".\nDeploy with "firebase deploy --only hosting".\nShow me the live URL when done.\nDo NOT commit any .env or secret files.`}</pre>
                        </div>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(`Install firebase-tools globally (npm i -g firebase-tools) if not already installed.\nRun "firebase login" so I'm authenticated.\nRun "firebase init hosting" — select my Firebase project and accept defaults.\nBuild my app with "npm run build".\nDeploy with "firebase deploy --only hosting".\nShow me the live URL when done.\nDo NOT commit any .env or secret files.`).catch(() => {});
                          }}
                          className="mt-2 rounded-lg px-3 py-1.5 text-xs font-medium ab-btn-primary"
                        >
                          Copy Cursor prompt
                        </button>
                      </div>
                    </div>
                  </div>
                </details>
              </section>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
