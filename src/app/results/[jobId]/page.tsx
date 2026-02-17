"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Idea, AnalysisStep, CompanyContext, ContextBundle, JobEvidence } from "@/lib/types";
import { EFFORT_LEVELS } from "@/lib/effort";
import AppHeader from "@/components/AppHeader";

/* ── Default pipeline steps (mirrors buildInitialSteps in analyzer.ts) ── */
const DEFAULT_PIPELINE_STEPS: AnalysisStep[] = [
  { id: "resolve", label: "Resolving company identity", status: "pending" },
  { id: "website", label: "Finding official website", status: "pending" },
  { id: "pages", label: "Reading key pages", status: "pending" },
  { id: "brandstyle", label: "Sampling brand styles (colors + fonts)", status: "pending" },
  { id: "press", label: "Checking newsroom / press releases", status: "pending" },
  { id: "news", label: "Checking recent news", status: "pending" },
  { id: "producthunt", label: "Checking Product Hunt for inspiration", status: "pending" },
  { id: "generate", label: "Generating Amuse Bouchenator suggestions", status: "pending" },
];

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
   DEV-ONLY: Evidence Used panel
   ═══════════════════════════════════════════ */

function EvidenceUsedPanel({ bundle, evidence }: { bundle: ContextBundle; evidence?: JobEvidence | null }) {
  const [open, setOpen] = useState(false);

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      ok: "bg-emerald-100 text-emerald-700",
      blocked: "bg-red-100 text-red-700",
      timeout: "bg-amber-100 text-amber-700",
      not_found: "bg-zinc-100 text-zinc-500",
      error: "bg-red-100 text-red-600",
      empty: "bg-amber-100 text-amber-600",
    };
    return (
      <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-mono uppercase ${colors[status] ?? "bg-zinc-100 text-zinc-500"}`}>
        {status}
      </span>
    );
  };

  return (
    <div className="mt-8 rounded-xl border border-dashed border-amber-300 bg-amber-50/50 p-4">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-sm font-medium text-amber-700 hover:text-amber-900 transition-colors w-full text-left"
      >
        <span className="text-xs bg-amber-200 text-amber-800 rounded px-1.5 py-0.5 font-mono uppercase tracking-wider">DEV</span>
        Evidence passed to idea generation
        <svg className={`h-4 w-4 ml-auto transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="mt-4 space-y-4 text-xs text-zinc-700">
          {/* Company */}
          <div>
            <h4 className="font-semibold text-zinc-900 mb-1">Company identity</h4>
            <p>{bundle.company.name}{bundle.company.url ? ` — ${bundle.company.url}` : ""}</p>
            {bundle.company.description && <p className="text-zinc-500 mt-0.5">{bundle.company.description}</p>}
            {bundle.company.industryHints.length > 0 && (
              <p className="mt-0.5">Industry: {bundle.company.industryHints.join(", ")}</p>
            )}
            {evidence?.resolvedBaseUrl && (
              <p className="mt-0.5 text-zinc-500">Resolved base URL: <span className="font-mono">{evidence.resolvedBaseUrl}</span></p>
            )}
          </div>

          {/* Page fetch attempts */}
          {evidence?.pageFetchAttempts && evidence.pageFetchAttempts.length > 0 && (
            <div>
              <h4 className="font-semibold text-zinc-900 mb-1">
                Page fetch attempts ({evidence.pageFetchAttempts.length})
              </h4>
              <ul className="space-y-1">
                {evidence.pageFetchAttempts.map((a, i) => (
                  <li key={i} className="flex items-start gap-2">
                    {statusBadge(a.status)}
                    <span className="font-mono text-zinc-500 break-all">{a.url}</span>
                    {a.statusCode && <span className="text-zinc-400 flex-shrink-0">HTTP {a.statusCode}</span>}
                    {a.headingCount !== undefined && a.headingCount > 0 && (
                      <span className="text-zinc-400 flex-shrink-0">{a.headingCount} headings</span>
                    )}
                    {a.note && <span className="text-amber-600 flex-shrink-0">{a.note}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Pages read */}
          <div>
            <h4 className="font-semibold text-zinc-900 mb-1">
              Pages read ({bundle.pages.items.length})
              {bundle.pages.thinContent && <span className="ml-1 text-amber-600">(thin content)</span>}
            </h4>
            {bundle.pages.items.length > 0 ? (
              <ul className="space-y-1">
                {bundle.pages.items.map((p, i) => (
                  <li key={i}>
                    <span className="font-mono text-zinc-500">{p.url}</span>
                    {p.headings.length > 0 && (
                      <span className="ml-1 text-zinc-400">— {p.headings.slice(0, 3).join("; ")}{p.headings.length > 3 ? "…" : ""}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-zinc-400 italic">No pages successfully read</p>
            )}
            {bundle.pages.navLabels.length > 0 && (
              <p className="mt-1 text-zinc-500">Nav: {bundle.pages.navLabels.join(", ")}</p>
            )}
          </div>

          {/* Brand */}
          <div>
            <h4 className="font-semibold text-zinc-900 mb-1">
              Brand signals
              {bundle.brand.found
                ? <span className="ml-1 text-emerald-600">(found via {bundle.brand.source})</span>
                : <span className="ml-1 text-zinc-400">(not found)</span>}
            </h4>
            {bundle.brand.found ? (
              <div className="flex items-center gap-3">
                {bundle.brand.primary && (
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-4 w-4 rounded border border-zinc-200" style={{ backgroundColor: bundle.brand.primary }} />
                    <span className="font-mono">{bundle.brand.primary}</span>
                  </span>
                )}
                {bundle.brand.accent && (
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-4 w-4 rounded border border-zinc-200" style={{ backgroundColor: bundle.brand.accent }} />
                    <span className="font-mono">{bundle.brand.accent}</span>
                  </span>
                )}
                {bundle.brand.fontFamily && <span>Font: {bundle.brand.fontFamily}</span>}
              </div>
            ) : (
              <p className="text-zinc-400 italic">No brand colors/fonts detected</p>
            )}
          </div>

          {/* Press */}
          <div>
            <h4 className="font-semibold text-zinc-900 mb-1">Press/newsroom ({bundle.press.items.length} URLs, {bundle.press.headlines.length} headlines)</h4>
            {bundle.press.items.length > 0 ? (
              <ul className="space-y-0.5">
                {bundle.press.items.slice(0, 5).map((p, i) => (
                  <li key={i} className="font-mono text-zinc-500">{p.url}</li>
                ))}
              </ul>
            ) : (
              <p className="text-zinc-400 italic">No press URLs found</p>
            )}
            {bundle.press.headlines.length > 0 && (
              <p className="mt-1 text-zinc-500">Headlines: {bundle.press.headlines.slice(0, 5).join("; ")}</p>
            )}
          </div>

          {/* News sources attempted */}
          <div>
            <h4 className="font-semibold text-zinc-900 mb-1">
              News ({bundle.gdelt.items.length} GDELT
              {evidence?.newsFetchAttempts?.find((a) => a.source === "press-headlines")
                ? ` + ${evidence.newsFetchAttempts.find((a) => a.source === "press-headlines")?.count ?? 0} press headlines`
                : ""})
            </h4>
            {evidence?.newsFetchAttempts && evidence.newsFetchAttempts.length > 0 && (
              <ul className="space-y-1 mb-2">
                {evidence.newsFetchAttempts.map((a, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-mono uppercase ${a.count > 0 ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-500"}`}>
                      {a.source}
                    </span>
                    <span>{a.count} item(s)</span>
                    {a.note && <span className="text-zinc-400">— {a.note}</span>}
                  </li>
                ))}
              </ul>
            )}
            {bundle.gdelt.items.length > 0 ? (
              <ul className="space-y-0.5">
                {bundle.gdelt.items.slice(0, 5).map((n, i) => (
                  <li key={i}>
                    <span>{n.title}</span>
                    <span className="ml-1 text-zinc-400">({n.source}{n.date ? `, ${n.date}` : ""})</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-zinc-400 italic">No GDELT articles found</p>
            )}
          </div>

          {/* Product Hunt */}
          <div>
            <h4 className="font-semibold text-zinc-900 mb-1">
              Product Hunt ({bundle.productHunt.items.length})
              {bundle.productHunt.modeUsed && <span className="ml-1 text-zinc-400">mode: {bundle.productHunt.modeUsed}</span>}
            </h4>
            {bundle.productHunt.items.length > 0 ? (
              <>
                <ul className="space-y-0.5">
                  {bundle.productHunt.items.slice(0, 6).map((p, i) => (
                    <li key={i}>
                      <span className="font-medium">{p.name}</span>
                      <span className="ml-1 text-zinc-500">— {p.tagline}</span>
                    </li>
                  ))}
                </ul>
                {bundle.productHunt.commonPatterns.length > 0 && (
                  <div className="mt-2">
                    <p className="font-semibold text-zinc-600">Common patterns:</p>
                    <ul className="mt-0.5 space-y-0.5">
                      {bundle.productHunt.commonPatterns.map((pat, i) => (
                        <li key={i} className="text-zinc-500">{pat}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <p className="text-zinc-400 italic">No items found</p>
            )}
            {bundle.productHunt.keywords.length > 0 && (
              <p className="mt-1 text-zinc-500">Keywords: {bundle.productHunt.keywords.join(", ")}</p>
            )}
          </div>
        </div>
      )}
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
  const [contextBundle, setContextBundle] = useState<ContextBundle | null>(null);
  const [evidence, setEvidence] = useState<JobEvidence | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef<number>(Date.now());

  // Unwrap params
  useEffect(() => {
    params.then((p) => setJobId(p.jobId));
  }, [params]);

  // Poll job until done
  useEffect(() => {
    if (!jobId) return;
    let pollFailures = 0;
    startRef.current = Date.now();

    const poll = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok) {
          pollFailures++;
          if (pollFailures >= 5) {
            setStatus("error");
            if (pollRef.current) clearInterval(pollRef.current);
            if (timerRef.current) clearInterval(timerRef.current);
          }
          return;
        }
        pollFailures = 0;
        const data = await res.json();
        if (data.steps?.length) setSteps(data.steps);
        if (data.companyContext) setCompanyContext(data.companyContext);
        if (data.contextBundle) setContextBundle(data.contextBundle);
        if (data.evidence) setEvidence(data.evidence);

        if (data.status === "done") {
          setIdeas(data.ideas ?? []);
          setStatus("done");
          if (pollRef.current) clearInterval(pollRef.current);
          if (timerRef.current) clearInterval(timerRef.current);
        } else if (data.status === "failed") {
          setStatus("error");
          if (pollRef.current) clearInterval(pollRef.current);
          if (timerRef.current) clearInterval(timerRef.current);
        } else {
          setStatus("cooking");
        }
      } catch {
        pollFailures++;
        if (pollFailures >= 5) {
          setStatus("error");
          if (pollRef.current) clearInterval(pollRef.current);
          if (timerRef.current) clearInterval(timerRef.current);
        }
      }
    };

    poll();
    pollRef.current = setInterval(poll, 1200);
    timerRef.current = setInterval(() => {
      setElapsed(Math.round((Date.now() - startRef.current) / 1000));
    }, 1000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [jobId]);

  return (
    <div className="min-h-screen bg-zinc-50">
      <AppHeader />

      <main className="mx-auto max-w-5xl px-6 py-10">
        {/* Loading / cooking state */}
        {(status === "loading" || status === "cooking") && (() => {
          const displaySteps = steps.length > 0 ? steps : DEFAULT_PIPELINE_STEPS;
          const timedOut = elapsed >= 60;
          return (
          <div className="mx-auto max-w-md">
            <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
              <h2 className="text-lg font-semibold text-zinc-900 mb-1">
                {timedOut
                  ? `Still working${companyContext.name ? ` on ${companyContext.name}` : ""}...`
                  : status === "loading"
                    ? "Loading results..."
                    : `Cooking up ideas${companyContext.name ? ` for ${companyContext.name}` : ""}...`}
              </h2>
              <p className="text-sm text-zinc-500 mb-6">
                {timedOut
                  ? "This is taking longer than usual. You can keep waiting or start over."
                  : "This can take up to 60 seconds. We\u2019re gathering context and generating suggestions."}
              </p>
              <ul className="space-y-3">
                {displaySteps.map((step) => (
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
              {timedOut && (
                <div className="mt-6 pt-4 border-t border-zinc-100">
                  <Link
                    href="/"
                    className="block w-full rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 text-center hover:bg-zinc-50 transition-colors"
                  >
                    Start over
                  </Link>
                </div>
              )}
            </div>
          </div>
          );
        })()}

        {/* Error state */}
        {status === "error" && (
          <div className="mx-auto max-w-md">
            <div className="rounded-2xl border border-red-200 bg-white p-8 shadow-sm text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
                <svg className="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-zinc-900 mb-2">Something went wrong</h2>
              <p className="text-sm text-zinc-500 mb-6">
                Results not found or analysis failed. This can happen if the server restarted during analysis.
              </p>
              <Link
                href="/"
                className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 transition-colors"
              >
                Start over
              </Link>
            </div>
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

              {/* DEV-ONLY: Evidence Used panel */}
              {contextBundle && process.env.NODE_ENV !== "production" && (
                <EvidenceUsedPanel bundle={contextBundle} evidence={evidence} />
              )}
            </div>
          );
        })()}
      </main>
    </div>
  );
}
