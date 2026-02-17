/* ── Analysis orchestrator ──
   Runs steps sequentially, updates the in-memory job, and stores results.
   Collects evidence (timings, cache hits, discovered data) for observability. */

import type { Job, AnalysisStep, CompanyContext, JobEvidence } from "./types";
import { getJob, storeIdea, persistJob } from "./jobStore";
import {
  isUrl,
  normalizeUrl,
  extractDomainName,
  domainToName,
  fetchSiteData,
  discoverPressUrls,
} from "./siteFetch";
import { readKeyPages } from "./pageReader";
import { fetchProductHuntByKeywords, isProductHuntCacheWarm, lastPHError } from "./producthunt";
import { deriveKeywords } from "./keywords";
import { buildInspirationPack } from "./inspirationPack";
import { fetchGdeltNews } from "./gdelt";
import { generateIdeas } from "./ai";
import type { GenerateIdeasResult } from "./ai";
import { buildContextBundle } from "./contextBundle";
import { getCompanyTheme } from "./themeSampler";
import { isThemeCached } from "./themeSampler";
import { getWikidataProfile } from "./enrichment/wikidata";
import { createJobLogger } from "./logger";
import type { JobLogger } from "./logger";

/* ── helpers ── */

function step(id: string, label: string): AnalysisStep {
  return { id, label, status: "pending" };
}

function setStep(job: Job, id: string, status: AnalysisStep["status"], note?: string) {
  const s = job.steps.find((s) => s.id === id);
  if (s) {
    s.status = status;
    if (note !== undefined) s.note = note;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Enforce minimum step duration for demo pacing (env: DEMO_MIN_STEP_MS). */
const DEMO_MIN_MS = Math.max(0, parseInt(process.env.DEMO_MIN_STEP_MS ?? "0", 10) || 0);

async function enforceMinDuration(startMs: number): Promise<void> {
  if (DEMO_MIN_MS <= 0) return;
  const elapsed = performance.now() - startMs;
  if (elapsed < DEMO_MIN_MS) {
    await sleep(DEMO_MIN_MS - elapsed);
  }
}

/** Extract domain from URL for GDELT query. */
function domainFromUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function emptyEvidence(): JobEvidence {
  return {
    cache: { theme: false, news: false, productHunt: false },
    timingsMs: {},
    keyPages: [],
    pressLinks: [],
    news: { provider: "GDELT", count: 0, items: [] },
    productHunt: [],
    usedGemini: false,
    wikidata: { used: false },
  };
}

/* ── Public: kick off analysis ── */

export function buildInitialSteps(): AnalysisStep[] {
  return [
    step("resolve", "Resolving company identity"),
    step("website", "Finding official website"),
    step("pages", "Reading key pages"),
    step("brandstyle", "Sampling brand styles (colors + fonts)"),
    step("press", "Checking newsroom / press releases"),
    step("news", "Checking recent news"),
    step("producthunt", "Checking Product Hunt for inspiration"),
    step("generate", "Generating Amuse Bouchenator suggestions"),
  ];
}

export async function runAnalysis(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job) return;

  job.status = "running";
  const ctx: CompanyContext = { name: job.input };
  const ev = emptyEvidence();
  job.evidence = ev;
  const log: JobLogger = createJobLogger(jobId);

  log.start(`Pipeline starting for "${job.input}"`);

  try {
    /* ── Step 1: Resolve identity (+ Wikidata enrichment) ── */
    let t0 = performance.now();
    setStep(job, "resolve", "running");
    log.start("resolve");
    await sleep(200); // small visual tick

    const rawInput = job.disambiguationChoice || job.input;
    if (isUrl(rawInput)) {
      ctx.url = normalizeUrl(rawInput);
      ctx.name = domainToName(extractDomainName(ctx.url));
    } else {
      ctx.name = rawInput.replace(/\s*\(.*?\)\s*$/, "").trim();
    }

    // ── Wikidata enrichment ──
    if (job.wikidataProfile) {
      ctx.name = job.wikidataProfile.label;
      ctx.description = job.wikidataProfile.description;
      ctx.wikidataId = job.wikidataProfile.id;
      ctx.industryHints = job.wikidataProfile.industryHints;
      if (job.wikidataProfile.website && !ctx.url) {
        ctx.url = job.wikidataProfile.website;
      }
      ev.wikidata = {
        used: true,
        selectedId: job.wikidataProfile.id,
        candidatesCount: 1,
      };
      setStep(job, "resolve", "done", `${ctx.name} (Wikidata: ${ctx.wikidataId})`);
      log.info("resolve", `${log.ms(t0)} → ${ctx.name} (Wikidata: ${ctx.wikidataId})`);
    } else if (!isUrl(rawInput)) {
      try {
        const { searchWikidata } = await import("./enrichment/wikidata");
        const candidates = await searchWikidata(ctx.name);
        ev.wikidata.candidatesCount = candidates.length;
        if (candidates.length >= 1) {
          const top = candidates[0];
          const profile = await getWikidataProfile(top.id);
          if (profile) {
            ctx.name = profile.label;
            ctx.description = profile.description;
            ctx.wikidataId = profile.id;
            ctx.industryHints = profile.industryHints;
            if (profile.website && !ctx.url) {
              ctx.url = profile.website;
            }
            ev.wikidata = {
              used: true,
              selectedId: profile.id,
              candidatesCount: candidates.length,
            };
          }
        }
      } catch {
        /* Wikidata not available — continue */
      }
      setStep(job, "resolve", "done",
        ev.wikidata.used
          ? `${ctx.name} (Wikidata: ${ctx.wikidataId})`
          : undefined
      );
      log.info("resolve", `${log.ms(t0)} → ${ctx.name}${ev.wikidata.used ? ` (Wikidata: ${ctx.wikidataId})` : " (no Wikidata match)"}`);
    } else {
      setStep(job, "resolve", "done");
      log.info("resolve", `${log.ms(t0)} → URL input: ${ctx.url}`);
    }

    job.companyContext = ctx;
    await enforceMinDuration(t0);
    ev.timingsMs.resolve = Math.round(performance.now() - t0);

    /* ── Step 2: Find website ── */
    t0 = performance.now();
    setStep(job, "website", "running");
    log.start("website");
    if (!ctx.url) {
      const slug = ctx.name.toLowerCase().replace(/[^a-z0-9]+/g, "");
      const guessUrl = `https://www.${slug}.com`;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch(guessUrl, {
          method: "HEAD",
          signal: ctrl.signal,
          redirect: "follow",
        });
        clearTimeout(timer);
        if (res.ok) ctx.url = guessUrl;
      } catch {
        /* no luck */
      }
    }
    setStep(job, "website", ctx.url ? "done" : "skipped",
      ctx.url ? domainFromUrl(ctx.url) : undefined
    );
    if (ctx.url) {
      log.info("website", `${log.ms(t0)} → ${domainFromUrl(ctx.url)}`);
    } else {
      log.warn("website", `${log.ms(t0)} → no website found`);
    }
    await enforceMinDuration(t0);
    ev.timingsMs.website = Math.round(performance.now() - t0);

    /* ── Step 3: Read key pages (2-stage: fetch + Playwright fallback) ── */
    t0 = performance.now();
    setStep(job, "pages", "running");
    log.start("pages");
    ev.resolvedBaseUrl = ctx.url;
    if (ctx.url) {
      try {
        const result = await readKeyPages(ctx.url);
        ev.pageFetchAttempts = result.attempts;

        if (result.homepage) {
          if (!ctx.description) {
            ctx.description = result.homepage.metaDescription;
          }
          ctx.headings = [
            ...result.homepage.headings,
            ...result.keyPages.flatMap((p) => p.headings),
          ].slice(0, 25);
          ctx.navLabels = result.homepage.navLabels;
          ev.keyPages = [
            result.homepage.url,
            ...result.keyPages.map((p) => p.url),
          ];
        }

        const methodNote = result.playwrightUsed
          ? "Playwright fallback"
          : "fetch";
        const okCount = result.attempts.filter((a) => a.status === "ok").length;
        const blockedCount = result.attempts.filter((a) => a.status === "blocked").length;
        const countNote = `${result.totalPages} page(s), ${result.totalHeadings} heading(s)`;

        if (result.thinContent && result.thinNote) {
          const stepNote = result.totalPages > 0
            ? `${countNote} via ${methodNote} — ${result.thinNote}`
            : result.thinNote;
          setStep(job, "pages", result.totalPages > 0 ? "done" : "done", stepNote);
          log.warn("pages", `${log.ms(t0)} → ${stepNote}`);
        } else if (ctx.headings?.length) {
          setStep(job, "pages", "done", `${countNote} via ${methodNote}`);
          log.info("pages", `${log.ms(t0)} → ${countNote} via ${methodNote}`);
        } else {
          setStep(job, "pages", "done", `${countNote} via ${methodNote} (no headings found)`);
          log.warn("pages", `${log.ms(t0)} → ${countNote} via ${methodNote} (no headings)`);
        }
        log.info("pages", `attempted=${result.attempts.length} ok=${okCount} blocked=${blockedCount} thinContent=${result.thinContent}`);
      } catch (err) {
        setStep(job, "pages", "skipped", "Page read failed");
        log.warn("pages", `${log.ms(t0)} → failed: ${err instanceof Error ? err.message : "unknown"}`);
      }
    } else {
      setStep(job, "pages", "skipped", "No website URL");
      log.warn("pages", `${log.ms(t0)} → skipped (no URL)`);
    }
    await enforceMinDuration(t0);
    ev.timingsMs.pages = Math.round(performance.now() - t0);

    /* ── Step 4: Brand style sampling ── */
    t0 = performance.now();
    setStep(job, "brandstyle", "running");
    log.start("brand");
    ev.cache.theme = ctx.url ? isThemeCached(ctx.url) : false;
    try {
      const theme = await getCompanyTheme(ctx.url, ctx.name);
      job.theme = theme;
      if (theme.source !== "default") {
        setStep(
          job,
          "brandstyle",
          "done",
          `Applied theme (${theme.source})${ev.cache.theme ? " [cached]" : ""}`
        );
        log.info("brand", `${log.ms(t0)} → source=${theme.source} primary=${theme.primary}${ev.cache.theme ? " [cached]" : ""}`);
      } else {
        const hasDeterministic = theme.note?.includes("name-derived");
        setStep(
          job,
          "brandstyle",
          hasDeterministic ? "done" : "skipped",
          hasDeterministic
            ? `Name-derived palette${ev.cache.theme ? " [cached]" : ""}`
            : `Using neutral theme${theme.note ? " — " + theme.note : ""}`
        );
        log.info("brand", `${log.ms(t0)} → ${hasDeterministic ? "name-derived" : "neutral"} primary=${theme.primary}`);
      }
    } catch {
      setStep(job, "brandstyle", "skipped", "Using neutral theme — extraction error");
      log.error("brand", `${log.ms(t0)} → extraction error, using neutral`);
    }
    await enforceMinDuration(t0);
    ev.timingsMs.brandstyle = Math.round(performance.now() - t0);

    /* ── Step 5: Press releases / newsroom ── */
    t0 = performance.now();
    setStep(job, "press", "running");
    log.start("press");
    if (ctx.url) {
      try {
        const pressUrls = await discoverPressUrls(ctx.url);
        ev.pressLinks = pressUrls;

        const siteData = await fetchSiteData(ctx.url);
        const pressHeadings = siteData.pressPages
          .flatMap((p) => p.headings)
          .slice(0, 10);

        for (const pp of siteData.pressPages) {
          if (!ev.pressLinks.includes(pp.url)) ev.pressLinks.push(pp.url);
        }

        // Filter out non-HTML asset URLs from pressLinks
        const assetRe = /\.(css|js|woff2?|ttf|otf|eot|png|jpe?g|gif|svg|ico|webp|avif|mp4|mp3|pdf|zip)(\?|$)/i;
        ev.pressLinks = ev.pressLinks.filter((u) => {
          try { return !assetRe.test(new URL(u).pathname); } catch { return true; }
        });

        if (pressHeadings.length) {
          ctx.pressHeadlines = pressHeadings;
        }

        const headlineCount = pressHeadings.length;
        setStep(
          job,
          "press",
          ev.pressLinks.length > 0 ? "done" : "skipped",
          ev.pressLinks.length > 0
            ? `${ev.pressLinks.length} URL(s), ${headlineCount} headline(s)`
            : undefined
        );
        log.info("press", `${log.ms(t0)} → ${ev.pressLinks.length} URL(s), ${headlineCount} headline(s)`);
      } catch {
        setStep(job, "press", "skipped");
        log.warn("press", `${log.ms(t0)} → fetch failed`);
      }
    } else {
      setStep(job, "press", "skipped");
      log.warn("press", `${log.ms(t0)} → skipped (no URL)`);
    }
    await enforceMinDuration(t0);
    ev.timingsMs.press = Math.round(performance.now() - t0);

    /* ── Step 6: External news (GDELT + press headline fallback) ── */
    t0 = performance.now();
    setStep(job, "news", "running");
    log.start("news");

    const newsAttempts: import("./types").NewsFetchAttempt[] = [];
    let gdeltCount = 0;
    const pressHeadlineCount = ctx.pressHeadlines?.length ?? 0;

    try {
      const domain = domainFromUrl(ctx.url);
      const articles = await fetchGdeltNews(ctx.name, domain);
      gdeltCount = articles.length;
      newsAttempts.push({ source: "gdelt", count: gdeltCount, note: gdeltCount > 0 ? undefined : "No articles matched" });

      if (articles.length > 0) {
        ev.news = { provider: "GDELT", count: articles.length, items: articles };
        ctx.newsItems = articles.map((a) => a.title);
      } else {
        ev.news = { provider: "GDELT", count: 0, items: [] };
      }

      // Fallback: if GDELT returned 0, use press headlines as news items
      if (articles.length === 0 && pressHeadlineCount > 0) {
        ctx.newsItems = ctx.pressHeadlines!.slice(0, 5);
        newsAttempts.push({ source: "press-headlines", count: pressHeadlineCount, note: "Used as GDELT fallback" });
      }

      // Determine status note
      const totalNews = (ctx.newsItems?.length ?? 0);
      if (totalNews > 0) {
        const sourceNote = gdeltCount > 0
          ? `${gdeltCount} article(s) via GDELT`
          : `${pressHeadlineCount} headline(s) from press pages (GDELT returned 0)`;
        setStep(job, "news", "done", sourceNote);
        log.info("news", `${log.ms(t0)} → ${sourceNote}`);
      } else {
        const triedDomain = domain ? ` (domain: ${domain})` : "";
        setStep(job, "news", "done", `0 found — tried GDELT${triedDomain}${pressHeadlineCount > 0 ? " + press" : ""}`);
        log.warn("news", `${log.ms(t0)} → 0 articles — GDELT=0${triedDomain}, pressHeadlines=${pressHeadlineCount}`);
      }
    } catch (err) {
      newsAttempts.push({ source: "gdelt", count: 0, note: `Failed: ${err instanceof Error ? err.message : "unknown"}` });
      // Still try press headlines
      if (pressHeadlineCount > 0) {
        ctx.newsItems = ctx.pressHeadlines!.slice(0, 5);
        newsAttempts.push({ source: "press-headlines", count: pressHeadlineCount, note: "GDELT failed, using press" });
        setStep(job, "news", "done", `${pressHeadlineCount} headline(s) from press (GDELT failed)`);
        log.warn("news", `${log.ms(t0)} → GDELT failed, using ${pressHeadlineCount} press headlines`);
      } else {
        setStep(job, "news", "done", "0 found — GDELT failed, no press headlines available");
        log.error("news", `${log.ms(t0)} → GDELT failed, no press fallback`);
      }
    }
    ev.newsFetchAttempts = newsAttempts;
    await enforceMinDuration(t0);
    ev.timingsMs.news = Math.round(performance.now() - t0);

    /* ── Step 7: Product Hunt (keyword search + inspiration pack) ── */
    t0 = performance.now();
    setStep(job, "producthunt", "running");
    ev.cache.productHunt = isProductHuntCacheWarm();

    const phKeywords = deriveKeywords(ctx);
    const hasToken = Boolean(process.env.PRODUCT_HUNT_TOKEN);

    log.start(`PH — token=${hasToken}, keywords=${phKeywords.length} [${phKeywords.slice(0, 3).join(", ")}${phKeywords.length > 3 ? "…" : ""}]`);

    if (!hasToken) {
      setStep(job, "producthunt", "skipped",
        "No PH token configured (set PRODUCT_HUNT_TOKEN in .env.local)"
      );
      log.warn("PH", `${log.ms(t0)} → skipped: no token`);
    } else {
      try {
        const phResult = await fetchProductHuntByKeywords(phKeywords);
        const ph = phResult.products;

        if (ph.length > 0) {
          ctx.productHuntInspiration = ph;
          ev.productHunt = ph.map((p) => ({
            name: p.name,
            tagline: p.tagline || undefined,
            url: p.url || undefined,
          }));

          const pack = buildInspirationPack(ph, phResult.keywords, phResult.modeUsed);
          ev.inspirationPack = pack;

          setStep(
            job,
            "producthunt",
            "done",
            `${ph.length} product(s) via ${phResult.modeUsed} (${phResult.keywords.slice(0, 3).join(", ")})${ev.cache.productHunt ? " [cached]" : ""}`
          );
          log.info("PH", `${log.ms(t0)} → ${ph.length} product(s), mode=${phResult.modeUsed}, keywords=[${phResult.keywords.join(", ")}]${ev.cache.productHunt ? " [cached]" : ""}`);
        } else {
          const errDetail = lastPHError
            ? `HTTP ${lastPHError.status} ${lastPHError.message}`
            : "empty results";
          setStep(job, "producthunt", "skipped",
            "API returned no results — using other context"
          );
          log.warn("PH", `${log.ms(t0)} → 0 products (${errDetail})`);
        }
      } catch (err) {
        const errDetail = lastPHError
          ? `HTTP ${lastPHError.status} ${lastPHError.message}`
          : err instanceof Error ? err.message : "unknown error";
        setStep(job, "producthunt", "skipped", "API call failed — using other context");
        log.error("PH", `${log.ms(t0)} → fetch failed: ${errDetail}`);
      }
    }
    await enforceMinDuration(t0);
    ev.timingsMs.producthunt = Math.round(performance.now() - t0);

    /* ── Step 8: Generate ideas (via ContextBundle — single source of truth) ── */
    t0 = performance.now();
    setStep(job, "generate", "running");
    log.start("generate");
    job.companyContext = ctx;

    const bundle = buildContextBundle(ctx, ev, job.theme);
    job.contextBundle = bundle;

    const genResult: GenerateIdeasResult = await generateIdeas(jobId, bundle);
    const ideas = genResult.ideas;

    ev.usedGemini = genResult.provider === "gemini";
    if (genResult.geminiError) ev.geminiError = genResult.geminiError;

    for (const idea of ideas) {
      idea.theme = job.theme;
    }

    job.ideas = ideas;

    for (const idea of ideas) {
      storeIdea(idea);
    }

    const providerLabel =
      genResult.provider === "gemini"
        ? "Gemini"
        : genResult.provider === "openai"
        ? "OpenAI"
        : "Mock fallback";
    setStep(job, "generate", "done", `${ideas.length} ideas via ${providerLabel}`);
    log.info("generate", `${log.ms(t0)} → ${ideas.length} ideas via ${providerLabel}`);
    await enforceMinDuration(t0);
    ev.timingsMs.generate = Math.round(performance.now() - t0);

    job.status = "done";
    persistJob(job.id);
    const totalMs = Object.values(ev.timingsMs).reduce((a, b) => a + b, 0);
    const pagesOk = ev.pageFetchAttempts?.filter((a) => a.status === "ok").length ?? ev.keyPages.length;
    const pagesBlocked = ev.pageFetchAttempts?.filter((a) => a.status === "blocked").length ?? 0;
    const pagesAttempted = ev.pageFetchAttempts?.length ?? ev.keyPages.length;
    console.log(`[analyze] keyPages attempted=${pagesAttempted} ok=${pagesOk} blocked=${pagesBlocked} thinContent=${(ctx.headings?.length ?? 0) < 3} news gdelt=${ev.news.count} pressHeadlines=${ctx.pressHeadlines?.length ?? 0}`);
    log.info("done", `Pipeline complete — ${totalMs}ms total`);
  } catch (err) {
    job.status = "failed";
    for (const s of job.steps) {
      if (s.status === "running") s.status = "failed";
    }
    log.error("FATAL", err instanceof Error ? err.message : String(err));
    console.error("Analysis failed:", err);
  }
}
