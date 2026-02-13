"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Idea, AnalysisStep, CompanyContext } from "@/lib/types";
import { EFFORT_LEVELS } from "@/lib/effort";

/* ── Sub-components ── */

function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`animate-spin h-5 w-5 ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

function StepIcon({ status }: { status: AnalysisStep["status"] }) {
  if (status === "running") return <Spinner className="text-indigo-500" />;
  if (status === "done")
    return (
      <svg className="h-5 w-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    );
  if (status === "skipped" || status === "failed")
    return (
      <svg className="h-5 w-5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
      </svg>
    );
  return <span className="h-5 w-5 rounded-full border-2 border-zinc-300 block" />;
}

function EffortBadge({ effort }: { effort: string }) {
  const meta = EFFORT_LEVELS.find((e) => e.key === effort) ?? EFFORT_LEVELS[0];
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.bg} ${meta.color}`}>
      {meta.label}
    </span>
  );
}

function IdeaCard({ idea }: { idea: Idea }) {
  return (
    <Link
      href={`/idea/${idea.id}`}
      className="group block rounded-xl border border-zinc-200 bg-white p-5 transition-all hover:border-zinc-300 hover:shadow-md"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-900 leading-snug group-hover:text-indigo-600 transition-colors">
          {idea.title}
        </h3>
        <EffortBadge effort={idea.effort} />
      </div>
      <p className="text-sm text-zinc-600 leading-relaxed line-clamp-2">
        {idea.summary}
      </p>
    </Link>
  );
}

/* ═══════════════════════════════════════════
   Custom idea builder
   ═══════════════════════════════════════════ */

import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

function CustomIdeaSection({
  jobId,
  router,
}: {
  jobId: string;
  router: AppRouterInstance;
}) {
  const [text, setText] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const trimLen = text.trim().length;
  const isValid = trimLen >= 40;
  const counterLabel = trimLen <= 120
    ? `${trimLen} / 120 recommended`
    : `${trimLen} / 600 max`;

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed || generating) return;
    if (trimmed.length < 40) {
      setError("Please enter at least 40 characters.");
      return;
    }
    setGenerating(true);
    setError("");

    try {
      const res = await fetch("/api/ideas/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, description: trimmed }),
      });
      const data = await res.json();

      if (data.ideaId) {
        router.push(`/idea/${data.ideaId}`);
      } else {
        setError(data.error || "Something went wrong");
      }
    } catch {
      setError("Failed to connect to server");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="mt-12 pt-10 border-t border-zinc-200">
      <div className="mx-auto max-w-xl">
        <h3 className="text-lg font-semibold text-zinc-900 mb-1">
          Think you can do better?
        </h3>
        <p className="text-sm text-zinc-500 mb-4">
          Describe your prototype idea and we&apos;ll generate a full build plan
          with Cursor prompts.
        </p>
        <textarea
          value={text}
          onChange={(e) => {
            if (e.target.value.length <= 600) setText(e.target.value);
          }}
          placeholder="Describe your prototype idea…"
          rows={4}
          disabled={generating}
          className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none disabled:opacity-50 resize-none"
        />
        <div className="mt-1 flex items-center justify-between">
          <p className="text-xs text-zinc-400">
            Include: who it&apos;s for + what it does + any key constraint.
          </p>
          <span className={`text-xs tabular-nums ${trimLen >= 120 ? "text-emerald-600" : trimLen >= 40 ? "text-zinc-500" : "text-zinc-400"}`}>
            {counterLabel}
          </span>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <button
          onClick={handleSubmit}
          disabled={!isValid || generating}
          className="mt-3 inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {generating && <Spinner className="h-4 w-4 text-white" />}
          {generating ? "Generating…" : "Generate Details"}
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   Results page — /results/[jobId]
   ═══════════════════════════════════════════ */

export default function ResultsPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const router = useRouter();
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("loading");
  const [steps, setSteps] = useState<AnalysisStep[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [companyContext, setCompanyContext] = useState<CompanyContext>({ name: "" });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Unwrap params
  useEffect(() => {
    params.then((p) => setJobId(p.jobId));
  }, [params]);

  // Poll job until done
  useEffect(() => {
    if (!jobId) return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok) { setStatus("error"); return; }
        const data = await res.json();
        setSteps(data.steps ?? []);
        if (data.companyContext) setCompanyContext(data.companyContext);


        if (data.status === "done") {
          setIdeas(data.ideas ?? []);
          setStatus("done");
          if (pollRef.current) clearInterval(pollRef.current);
        } else if (data.status === "failed") {
          setStatus("error");
          if (pollRef.current) clearInterval(pollRef.current);
        } else {
          setStatus("cooking");
        }
      } catch {
        /* retry */
      }
    };

    poll();
    pollRef.current = setInterval(poll, 1000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [jobId]);

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-5xl px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
                Amuse Bouchenator
              </h1>
              <p className="mt-1 text-sm text-zinc-500">
                Taster-menu generator for quick-win prototypes — with Cursor-ready build steps
              </p>
            </div>
            <Link
              href="/"
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 transition-colors"
            >
              Start over
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        {/* Loading / cooking state */}
        {(status === "loading" || status === "cooking") && (
          <div className="mx-auto max-w-md">
            <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
              <h2 className="text-lg font-semibold text-zinc-900 mb-1">
                {status === "loading" ? "Loading results" : `Cooking up ideas${companyContext.name ? ` for ${companyContext.name}` : ""}`}...
              </h2>
              <p className="text-sm text-zinc-500 mb-6">
                This can take up to 60 seconds.
              </p>
              <ul className="space-y-3">
                {steps.map((step) => (
                  <li key={step.id} className="flex items-start gap-3">
                    <span className="mt-0.5"><StepIcon status={step.status} /></span>
                    <div className="flex-1 min-w-0">
                      <span className={`text-sm ${
                        step.status === "running" ? "font-medium text-zinc-900"
                        : step.status === "done" ? "text-zinc-700"
                        : step.status === "skipped" || step.status === "failed" ? "text-zinc-400 line-through"
                        : "text-zinc-500"
                      }`}>{step.label}</span>
                      {step.note && (step.status === "done" || step.status === "skipped") && (
                        <span className="ml-2 text-xs text-zinc-400">— {step.note}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Error state */}
        {status === "error" && (
          <div className="mx-auto max-w-md text-center">
            <p className="text-zinc-500 mb-4">Results not found or analysis failed.</p>
            <Link href="/" className="text-indigo-600 hover:underline text-sm">&larr; Start over</Link>
          </div>
        )}

        {/* Results grid */}
        {status === "done" && (() => {
          const recommended = ideas.filter((i) => i.source !== "custom");
          const custom = ideas.filter((i) => i.source === "custom");
          return (
            <div>
              {/* Custom ideas (separate section above recommendations) */}
              {custom.length > 0 && (
                <div className="mb-8">
                  <h3 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-3">
                    Your custom {custom.length === 1 ? "idea" : "ideas"}
                  </h3>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {custom.map((idea) => (
                      <IdeaCard key={idea.id} idea={idea} />
                    ))}
                  </div>
                </div>
              )}

              <div className="mb-8">
                <h2 className="text-xl font-semibold text-zinc-900">
                  {recommended.length} ideas for {companyContext.name || "your company"}
                </h2>
                <p className="text-sm text-zinc-500 mt-1">
                  Ordered from quickest to most ambitious. Click any card for details and Cursor build steps.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {recommended.map((idea) => (
                  <IdeaCard key={idea.id} idea={idea} />
                ))}
              </div>

              {/* Custom idea builder */}
              {jobId && (
                <CustomIdeaSection jobId={jobId} router={router} />
              )}
            </div>
          );
        })()}
      </main>
    </div>
  );
}
