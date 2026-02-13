import { NextResponse } from "next/server";
import { resolveDisambiguation } from "@/lib/disambiguate";
import { getWikidataProfile } from "@/lib/enrichment/wikidata";
import { createJob } from "@/lib/jobStore";
import { buildInitialSteps, runAnalysis } from "@/lib/analyzer";
import type { Job, WikidataProfile } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input: string = (body.input ?? "").trim();
    const disambiguationChoice: string | undefined = body.disambiguationChoice;
    const wikidataId: string | undefined = body.wikidataId;

    if (!input) {
      return NextResponse.json({ error: "Input is required" }, { status: 400 });
    }

    let wikidataProfile: WikidataProfile | undefined;

    // ── If user already picked a disambiguation option ──
    if (disambiguationChoice) {
      // If a Wikidata ID was passed alongside the choice, fetch the profile
      if (wikidataId) {
        const profile = await getWikidataProfile(wikidataId);
        if (profile) wikidataProfile = profile;
      }
    } else {
      // ── First submission: try async disambiguation ──
      const result = await resolveDisambiguation(input);

      if (result.needed && result.options) {
        return NextResponse.json({
          needsDisambiguation: true,
          options: result.options,
        });
      }

      // Single auto-resolved Wikidata match — fetch full profile
      if (result.autoResolved) {
        const profile = await getWikidataProfile(result.autoResolved.wikidataId);
        if (profile) wikidataProfile = profile;
      }
    }

    // ── Create job and start analysis ──
    const jobId = crypto.randomUUID();
    const job: Job = {
      id: jobId,
      input,
      disambiguationChoice,
      wikidataProfile,
      steps: buildInitialSteps(),
      status: "pending",
      ideas: [],
      companyContext: { name: input },
    };

    createJob(job);

    // Fire-and-forget: run analysis in background
    runAnalysis(jobId).catch(console.error);

    return NextResponse.json({ jobId, needsDisambiguation: false });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
