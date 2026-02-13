/* POST /api/ideas/custom — Create a custom idea for an existing job */

import { NextResponse } from "next/server";
import { getJob, storeIdea } from "@/lib/jobStore";
import { generateCustomIdea } from "@/lib/customIdea";
import type { Idea } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const jobId: string = (body.jobId ?? "").trim();
    const description: string = (body.description ?? "").trim();

    if (!jobId || !description) {
      return NextResponse.json(
        { error: "jobId and description are required" },
        { status: 400 }
      );
    }

    const job = getJob(jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const { ideaFields, usedGemini } = await generateCustomIdea(
      description,
      job.companyContext,
      job.evidence
    );

    const ideaId = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const idea: Idea = {
      id: ideaId,
      jobId,
      ...ideaFields,
      theme: job.theme,
      source: "custom",
      originalPrompt: description,
    };

    // Store idea + append to job
    storeIdea(idea);
    job.ideas.push(idea);

    console.log(
      `[custom-idea] jobId=${jobId.slice(0, 8)} ideaId=${ideaId} gemini=${usedGemini} title="${idea.title}"`
    );

    return NextResponse.json({ ideaId });
  } catch {
    return NextResponse.json({ error: "Failed to create idea" }, { status: 500 });
  }
}
