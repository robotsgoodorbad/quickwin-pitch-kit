"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type {
  Idea,
  AnalysisStep,
  CompanyContext,
  DisambiguationOption,
  BuildStep,
  BuildPlan,
  JobEvidence,
} from "@/lib/types";
import { EFFORT_LEVELS } from "@/lib/effort";
import AppHeader from "@/components/AppHeader";

/* ═══════════════════════════════════════════
   State machine
   ═══════════════════════════════════════════ */

type AppState = "input" | "disambiguation" | "cooking" | "results";

/* ── Default pipeline steps (mirrors buildInitialSteps in analyzer.ts) ──
   Shown immediately so the checklist is never blank. */
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

/* Amuse UI uses a fixed theme — brand colors only flow into generated prompts */

/* ═══════════════════════════════════════════
   Sub-components
   ═══════════════════════════════════════════ */

function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin h-5 w-5 ${className}`}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}

function StepIcon({ status }: { status: AnalysisStep["status"] }) {
  if (status === "running")
    return <Spinner className="ab-spinner-themed" />;
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

/* ═══════════════════════════════════════════
   URL override (disambiguation fallback)
   ═══════════════════════════════════════════ */

function UrlOverride({
  submitting,
  onSubmit,
}: {
  submitting: boolean;
  onSubmit: (url: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [validationError, setValidationError] = useState("");

  const handleClick = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!/^https?:\/\/.+\..+/i.test(trimmed)) {
      setValidationError("Please enter a valid URL starting with http:// or https://");
      return;
    }
    setValidationError("");
    onSubmit(trimmed);
  };

  return (
    <div className="mt-6 pt-5 border-t border-zinc-100">
      <p className="text-sm text-zinc-600 mb-3">
        Don&apos;t see the right company? Add their website URL.
      </p>
      <div className="flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (validationError) setValidationError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleClick();
          }}
          placeholder="https://example.com"
          disabled={submitting}
          className="flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-300 disabled:opacity-50 transition-colors"
        />
        <button
          onClick={handleClick}
          disabled={submitting || !url.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
        >
          {submitting && <Spinner className="h-3.5 w-3.5" />}
          Use this website
        </button>
      </div>
      {validationError && (
        <p className="mt-1.5 text-xs text-red-500">{validationError}</p>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   Evidence panel (collapsed by default inside cooking UI)
   ═══════════════════════════════════════════ */

function CacheBadge({ hit, label }: { hit: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
        hit
          ? "bg-amber-50 text-amber-700 border border-amber-200"
          : "bg-zinc-50 text-zinc-500 border border-zinc-200"
      }`}
    >
      {hit ? "⚡" : "○"} {label} {hit ? "cached" : "fresh"}
    </span>
  );
}

function EvidencePanel({
  evidence,
  timingsSteps,
  companyContext,
}: {
  evidence: JobEvidence;
  timingsSteps: AnalysisStep[];
  companyContext: CompanyContext;
}) {
  const newsItems = evidence.news?.items ?? [];

  return (
    <div className="mt-4 space-y-4 text-xs">
      {/* Company identity (from Wikidata) */}
      {evidence.wikidata?.used && (
        <div>
          <p className="font-medium text-zinc-600 mb-1.5">Company identity</p>
          <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-3 space-y-1">
            <p className="text-zinc-800 font-medium">{companyContext.name}</p>
            {companyContext.description && (
              <p className="text-zinc-600">{companyContext.description}</p>
            )}
            <div className="flex flex-wrap gap-1.5 mt-1">
              {companyContext.url && (
                <a
                  href={companyContext.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-600 hover:underline"
                >
                  {companyContext.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                </a>
              )}
              {evidence.wikidata.selectedId && (
                <span className="text-zinc-400">
                  · Wikidata {evidence.wikidata.selectedId}
                </span>
              )}
            </div>
            {companyContext.industryHints && companyContext.industryHints.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {companyContext.industryHints.map((hint, i) => (
                  <span
                    key={i}
                    className="inline-block rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] text-indigo-700"
                  >
                    {hint}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Cache hits */}
      <div>
        <p className="font-medium text-zinc-600 mb-1.5">Cache</p>
        <div className="flex flex-wrap gap-1.5">
          <CacheBadge hit={evidence.cache.theme} label="Theme" />
          <CacheBadge hit={evidence.cache.news} label="News" />
          <CacheBadge hit={evidence.cache.productHunt} label="Product Hunt" />
        </div>
      </div>

      {/* Timings */}
      {Object.keys(evidence.timingsMs).length > 0 && (
        <div>
          <p className="font-medium text-zinc-600 mb-1.5">Timings</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {timingsSteps.map((s) => {
              const ms = evidence.timingsMs[s.id];
              if (ms === undefined) return null;
              return (
                <div key={s.id} className="flex items-center justify-between">
                  <span className="text-zinc-500 truncate mr-2">
                    {s.label.replace(/^(Checking|Resolving|Finding|Reading|Sampling|Generating)\s+/i, "")}
                  </span>
                  <span className="font-mono text-zinc-700 tabular-nums whitespace-nowrap">
                    {ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Key pages fetched */}
      {evidence.keyPages.length > 0 && (
        <div>
          <p className="font-medium text-zinc-600 mb-1">
            Key pages fetched ({evidence.keyPages.length})
          </p>
          <ul className="space-y-0.5 text-zinc-500">
            {evidence.keyPages.slice(0, 5).map((url, i) => (
              <li key={i} className="truncate">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-zinc-700 hover:underline"
                >
                  {url.replace(/^https?:\/\/(www\.)?/, "")}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Press/newsroom */}
      {evidence.pressLinks.length > 0 && (
        <div>
          <p className="font-medium text-zinc-600 mb-1">
            Press URLs discovered ({evidence.pressLinks.length})
          </p>
          <ul className="space-y-0.5 text-zinc-500">
            {evidence.pressLinks.slice(0, 5).map((url, i) => (
              <li key={i} className="truncate">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-zinc-700 hover:underline"
                >
                  {url.replace(/^https?:\/\/(www\.)?/, "")}
                </a>
              </li>
            ))}
            {evidence.pressLinks.length > 5 && (
              <li className="text-zinc-400">
                +{evidence.pressLinks.length - 5} more
              </li>
            )}
          </ul>
        </div>
      )}

      {/* News */}
      {newsItems.length > 0 && (
        <div>
          <p className="font-medium text-zinc-600 mb-1">
            Recent news via {evidence.news.provider} ({evidence.news.count})
          </p>
          <ul className="space-y-1.5">
            {newsItems.slice(0, 3).map((item, i) => (
              <li key={i}>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-zinc-700 hover:text-zinc-900 hover:underline leading-tight block"
                >
                  {item.title}
                </a>
                <span className="text-zinc-400">
                  {item.source}
                  {item.date ? ` · ${item.date}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Product Hunt */}
      {evidence.productHunt.length > 0 && (
        <div>
          <p className="font-medium text-zinc-600 mb-1">
            Product Hunt trending ({evidence.productHunt.length})
          </p>
          <ul className="space-y-1.5">
            {evidence.productHunt.slice(0, 3).map((item, i) => (
              <li key={i}>
                {item.url ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-zinc-700 hover:text-zinc-900 hover:underline font-medium"
                  >
                    {item.name}
                  </a>
                ) : (
                  <span className="text-zinc-700 font-medium">{item.name}</span>
                )}
                {item.tagline && (
                  <span className="text-zinc-400 ml-1">— {item.tagline}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Idea generation provider */}
      {evidence.usedGemini !== undefined && (
        <div>
          <p className="font-medium text-zinc-600 mb-1">Idea generation</p>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                evidence.usedGemini
                  ? "bg-blue-50 text-blue-700 border border-blue-200"
                  : "bg-zinc-50 text-zinc-600 border border-zinc-200"
              }`}
            >
              {evidence.usedGemini ? "✦ Gemini" : "Mock fallback"}
            </span>
            {evidence.geminiError && (
              <span className="text-zinc-400 truncate" title={evidence.geminiError}>
                {evidence.geminiError.length > 50
                  ? evidence.geminiError.slice(0, 50) + "…"
                  : evidence.geminiError}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {newsItems.length === 0 &&
        evidence.productHunt.length === 0 &&
        evidence.pressLinks.length === 0 &&
        evidence.keyPages.length === 0 &&
        !evidence.wikidata?.used &&
        evidence.usedGemini === undefined && (
          <p className="text-zinc-400 italic">No evidence collected yet — still running.</p>
        )}
    </div>
  );
}

function EffortBadge({ effort }: { effort: string }) {
  const meta = EFFORT_LEVELS.find((e) => e.key === effort) ?? EFFORT_LEVELS[0];
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.bg} ${meta.color}`}
    >
      {meta.label}
    </span>
  );
}

function IdeaCard({ idea }: { idea: Idea }) {
  return (
    <Link
      href={`/idea/${idea.id}`}
      className="group block rounded-xl border border-zinc-200 bg-white p-5 transition-all ab-card-hover hover:shadow-md"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-900 leading-snug ab-link-hover transition-colors">
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
   Custom Idea Builder
   ═══════════════════════════════════════════ */

interface CustomResult {
  idea: Idea;
  plan: BuildPlan;
}

function CustomIdeaBuilder({ companyContext }: { companyContext: CompanyContext }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CustomResult | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const handleGenerate = async () => {
    if (!text.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/custom-idea", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, companyContext }),
      });
      const data = await res.json();
      setResult(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setResult(null);
    setText("");
    setShowClearConfirm(false);
  };

  const copyPrompt = (prompt: string, idx: number) => {
    navigator.clipboard.writeText(prompt).catch(() => {});
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  return (
    <div className="mt-16 border-t border-zinc-200 pt-12">
      <h2 className="text-xl font-semibold text-zinc-900 mb-2">
        Didn&apos;t find what you were looking for?
      </h2>
      <p className="text-zinc-600 mb-6">
        You think you can do better? Describe your idea below and we&apos;ll
        generate a full build plan with Cursor prompts.
      </p>

      {!result ? (
        <div className="space-y-4">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Describe your prototype idea..."
            className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none resize-none"
            rows={4}
          />
          <button
            onClick={handleGenerate}
            disabled={!text.trim() || loading}
            className="ab-btn-primary inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium disabled:cursor-not-allowed"
          >
            {loading && <Spinner className="text-white" />}
            {loading ? "Generating..." : "Generate build steps"}
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Summary */}
          <div className="rounded-xl border border-zinc-200 bg-white p-6">
            <div className="flex items-start justify-between gap-3 mb-3">
              <h3 className="font-semibold text-zinc-900">{result.idea.title}</h3>
              <EffortBadge effort={result.idea.effort} />
            </div>
            <p className="text-sm text-zinc-600 mb-4">{result.idea.summary}</p>

            {/* Outline */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <h4 className="font-medium text-zinc-700 mb-1">Pages</h4>
                <ul className="list-disc list-inside text-zinc-600 space-y-0.5">
                  {result.idea.outline.pages.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="font-medium text-zinc-700 mb-1">Components</h4>
                <ul className="list-disc list-inside text-zinc-600 space-y-0.5">
                  {result.idea.outline.components.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* Build steps */}
          <div className="space-y-4">
            <p className="text-sm text-zinc-500 whitespace-pre-line">
              {result.plan.bmadExplanation}
            </p>

            {/* Step 1: Terminal Setup */}
            <div className="rounded-xl border-2 border-emerald-200 bg-white p-5">
              <div className="flex items-center gap-2 mb-2">
                <span className="flex items-center justify-center h-6 w-6 rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                  1
                </span>
                <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-xs font-medium text-emerald-700">
                  Terminal
                </span>
                <h4 className="text-sm font-semibold text-zinc-900 flex-1">
                  Create project &amp; start dev server
                </h4>
              </div>
              <p className="text-xs text-zinc-500 mb-3">
                Paste into Cursor&apos;s terminal:
              </p>
              <div className="relative rounded-lg bg-zinc-950 p-4 font-mono">
                <pre className="text-emerald-400 whitespace-pre-wrap text-xs leading-relaxed">
                  {result.plan.terminalSetup}
                </pre>
              </div>
              <button
                onClick={() => copyPrompt(result.plan.terminalSetup, -1)}
                className={`mt-2 w-full rounded-lg py-2.5 text-sm font-semibold transition-colors ${
                  copiedIdx === -1
                    ? "bg-emerald-600 text-white"
                    : "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
                }`}
              >
                {copiedIdx === -1 ? "✓ Copied" : "Copy Terminal Commands"}
              </button>
            </div>

            {/* Steps 2–N */}
            {result.plan.steps.map((step: BuildStep, i: number) => {
              const isOptional = i >= 2;
              return (
                <div
                  key={i}
                  className={`rounded-xl border bg-white p-5 ${
                    isOptional
                      ? "border-dashed border-zinc-300 opacity-80"
                      : "border-zinc-200"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="flex items-center justify-center h-6 w-6 rounded-full bg-zinc-100 text-xs font-bold text-zinc-600">
                      {i + 2}
                    </span>
                    <span className="ab-role-badge rounded-full px-2 py-0.5 text-xs font-medium">
                      {step.role}
                    </span>
                    <h4 className="text-sm font-semibold text-zinc-900 flex-1">
                      {step.title}
                    </h4>
                    {isOptional && (
                      <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium">
                        optional
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-zinc-600 mb-3">
                    <span className="font-semibold text-zinc-700">Goal: </span>
                    {step.instruction}
                  </p>
                  <div className="relative rounded-lg bg-zinc-950 p-4">
                    <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-mono pr-16">
                      {step.cursorPrompt}
                    </pre>
                  </div>
                  <button
                    onClick={() => copyPrompt(step.cursorPrompt, i)}
                    className={`mt-2 w-full rounded-lg py-2.5 text-sm font-semibold transition-colors ${
                      copiedIdx === i
                        ? "bg-emerald-600 text-white"
                        : isOptional
                        ? "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
                        : "ab-btn-primary"
                    }`}
                  >
                    {copiedIdx === i
                      ? "✓ Copied"
                      : isOptional
                      ? "Copy Fix + Polish prompt"
                      : `Copy Prompt ${i + 2}`}
                  </button>
                  <div className="mt-2 text-xs text-zinc-500">
                    <span className="font-medium">Done looks like:</span>
                    <p className="mt-1 whitespace-pre-line leading-relaxed">
                      {step.doneLooksLike}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Clear button */}
          <div className="flex justify-end">
            {showClearConfirm ? (
              <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2">
                <span className="text-sm text-red-700">Clear custom idea?</span>
                <button
                  onClick={handleClear}
                  className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
                >
                  Yes, clear
                </button>
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="rounded bg-white px-3 py-1 text-xs font-medium text-zinc-600 border hover:bg-zinc-50"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowClearConfirm(true)}
                className="text-sm text-zinc-500 hover:text-red-600 transition-colors"
              >
                Clear custom idea
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   Main HomePage
   ═══════════════════════════════════════════ */

export default function HomePage() {
  const router = useRouter();
  const [state, setState] = useState<AppState>("input");
  const [input, setInput] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [steps, setSteps] = useState<AnalysisStep[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [companyContext, setCompanyContext] = useState<CompanyContext>({ name: "" });
  const [evidence, setEvidence] = useState<JobEvidence | null>(null);
  const [disambiguationOptions, setDisambiguationOptions] = useState<DisambiguationOption[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cookingElapsed, setCookingElapsed] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cookingStartRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── Submit ── */
  const handleSubmit = useCallback(
    async (disambiguationChoice?: string, wikidataId?: string) => {
      setError("");
      setSubmitting(true);
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input,
            disambiguationChoice,
            wikidataId,
          }),
        });
        const data = await res.json();

        if (data.needsDisambiguation) {
          setDisambiguationOptions(data.options);
          setState("disambiguation");
        } else if (data.jobId) {
          setJobId(data.jobId);
          cookingStartRef.current = Date.now();
          setCookingElapsed(0);
          setState("cooking");
        } else {
          setError(data.error || "Something went wrong");
        }
      } catch {
        setError("Failed to connect to server");
      } finally {
        setSubmitting(false);
      }
    },
    [input]
  );

  /* ── Polling ── */
  useEffect(() => {
    if (state !== "cooking" || !jobId) return;
    let pollFailures = 0;

    const poll = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok) {
          pollFailures++;
          if (pollFailures >= 5) {
            setError("Lost connection to server. Please try again.");
            setState("input");
          }
          return;
        }
        pollFailures = 0;
        const data = await res.json();
        if (data.steps?.length) setSteps(data.steps);
        if (data.companyContext) setCompanyContext(data.companyContext);
        if (data.evidence) setEvidence(data.evidence);

        if (data.status === "done") {
          if (pollRef.current) clearInterval(pollRef.current);
          if (timerRef.current) clearInterval(timerRef.current);
          router.replace(`/results/${jobId}`);
          return;
        } else if (data.status === "failed") {
          setError("Analysis failed. Please try again.");
          setState("input");
        }
      } catch {
        pollFailures++;
        if (pollFailures >= 5) {
          setError("Lost connection to server. Please try again.");
          setState("input");
        }
      }
    };

    poll();
    pollRef.current = setInterval(poll, 1200);

    // Elapsed seconds timer for timeout UX
    timerRef.current = setInterval(() => {
      const elapsed = Math.round((Date.now() - cookingStartRef.current) / 1000);
      setCookingElapsed(elapsed);
    }, 1000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [state, jobId, router]);

  /* ── Reset ── */
  const reset = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    setState("input");
    setInput("");
    setJobId(null);
    setSteps([]);
    setIdeas([]);
    setCompanyContext({ name: "" });
    setEvidence(null);
    setError("");
    setCookingElapsed(0);
  };

  /* ── Render ── */
  return (
    <div className="min-h-screen bg-zinc-50">
      <AppHeader />

      <main className="mx-auto max-w-5xl px-6 py-10">
        {/* ── Input state ── */}
        {state === "input" && (
          <div className="mx-auto max-w-xl">
            <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
              <label
                htmlFor="company-input"
                className="block text-sm font-medium text-zinc-700 mb-2"
              >
                Enter a company name or website
              </label>
              <div className="flex gap-3">
                <input
                  id="company-input"
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && input.trim()) handleSubmit();
                  }}
                  placeholder="e.g. Stripe, notion.so, https://linear.app"
                  className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none"
                  autoFocus
                />
                <button
                  onClick={() => handleSubmit()}
                  disabled={!input.trim() || submitting}
                  className="ab-btn-primary inline-flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-medium disabled:cursor-not-allowed"
                >
                  {submitting && <Spinner className="text-white" />}
                  Analyze
                </button>
              </div>
              {error && (
                <p className="mt-3 text-sm text-red-600">{error}</p>
              )}
            </div>
          </div>
        )}

        {/* ── Disambiguation state ── */}
        {state === "disambiguation" && (
          <div className="mx-auto max-w-xl">
            <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
              <h2 className="text-lg font-semibold text-zinc-900 mb-1">
                Which company did you mean?
              </h2>
              <p className="text-sm text-zinc-500 mb-6">
                We found several matches for &quot;{input}&quot;. Select the
                right one so we can tailor our research:
              </p>
              <div className="space-y-3">
                {disambiguationOptions.map((opt, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      const choice = opt.domain
                        ? opt.domain
                        : opt.label;
                      handleSubmit(choice, opt.wikidataId);
                    }}
                    disabled={submitting}
                    className="w-full rounded-xl border border-zinc-200 bg-white p-4 text-left transition-all ab-card-hover hover:shadow-sm disabled:opacity-50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-zinc-900">
                          {opt.label}
                        </span>
                        {opt.description && (
                          <span className="block text-xs text-zinc-500 mt-0.5 leading-relaxed">
                            {opt.description}
                          </span>
                        )}
                      </div>
                      {opt.domain && (
                        <span className="flex-shrink-0 rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-mono text-zinc-600">
                          {opt.domain}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
              {/* ── URL override ── */}
              <UrlOverride
                submitting={submitting}
                onSubmit={(url) => handleSubmit(url)}
              />
            </div>
          </div>
        )}

        {/* ── Cooking state ── */}
        {state === "cooking" && (() => {
          const displaySteps = steps.length > 0 ? steps : DEFAULT_PIPELINE_STEPS;
          const timedOut = cookingElapsed >= 60;
          return (
            <div className="mx-auto max-w-md">
              <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
                <h2 className="text-lg font-semibold text-zinc-900 mb-1">
                  {timedOut ? "Still working" : "Cooking up ideas"}
                  {companyContext.name && companyContext.name !== input
                    ? ` for ${companyContext.name}`
                    : ""}
                  ...
                </h2>
                <p className="text-sm text-zinc-500 mb-6">
                  {timedOut
                    ? "This is taking longer than usual. You can keep waiting or start over."
                    : "This can take up to 60 seconds. We\u2019re gathering context and generating suggestions."}
                </p>
                <ul className="space-y-3">
                  {displaySteps.map((step) => (
                    <li key={step.id} className="flex items-start gap-3">
                      <span className="mt-0.5">
                        <StepIcon status={step.status} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <span
                          className={`text-sm ${
                            step.status === "running"
                              ? "font-medium text-zinc-900"
                              : step.status === "done"
                              ? "text-zinc-700"
                              : step.status === "skipped" || step.status === "failed"
                              ? "text-zinc-400 line-through"
                              : "text-zinc-500"
                          }`}
                        >
                          {step.label}
                        </span>
                        {step.note && (step.status === "done" || step.status === "skipped") && (
                          <span className="ml-2 text-xs text-zinc-400">
                            — {step.note}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                {timedOut && (
                  <div className="mt-6 pt-4 border-t border-zinc-100">
                    <button
                      onClick={reset}
                      className="w-full rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
                    >
                      Start over
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* ── Results state ── */}
        {state === "results" && (
          <div>
            <div className="mb-8">
              <h2 className="text-xl font-semibold text-zinc-900">
                {ideas.length} ideas for {companyContext.name || input}
              </h2>
              <p className="text-sm text-zinc-500 mt-1">
                Ordered from quickest to most ambitious. Click any card for
                details and Cursor build steps.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {ideas.map((idea) => (
                <IdeaCard key={idea.id} idea={idea} />
              ))}
            </div>

            <CustomIdeaBuilder companyContext={companyContext} />
          </div>
        )}
      </main>
    </div>
  );
}
