/* POST /api/ideas/custom/regenerate — Re-generate a custom idea in-place */

import { NextResponse } from "next/server";
import { getIdea, getJob, storeIdea } from "@/lib/jobStore";
import { generateCustomIdea } from "@/lib/customIdea";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const ideaId: string = (body.ideaId ?? "").trim();
    const description: string = (body.description ?? "").trim();

    if (!ideaId || !description) {
      return NextResponse.json(
        { error: "ideaId and description are required" },
        { status: 400 }
      );
    }

    if (description.length < 40) {
      return NextResponse.json(
        { error: "Description must be at least 40 characters. Include who it's for, what it does, and a key constraint." },
        { status: 400 }
      );
    }

    if (description.length > 600) {
      return NextResponse.json(
        { error: "Description must be 600 characters or fewer." },
        { status: 400 }
      );
    }

    const idea = getIdea(ideaId);
    if (!idea) {
      return NextResponse.json({ error: "Idea not found" }, { status: 404 });
    }

    const job = getJob(idea.jobId);
    const ctx = job?.companyContext ?? { name: "Unknown" };
    const evidence = job?.evidence;

    const { ideaFields, usedGemini } = await generateCustomIdea(
      description,
      ctx,
      evidence
    );

    // Update idea in-place
    idea.title = ideaFields.title;
    idea.summary = ideaFields.summary;
    idea.effort = ideaFields.effort;
    idea.outline = ideaFields.outline;
    idea.inspiredAngle = ideaFields.inspiredAngle;
    idea.originalPrompt = description;

    // Re-store (updates the in-memory map)
    storeIdea(idea);

    console.log(
      `[custom-regen] ideaId=${ideaId} gemini=${usedGemini} title="${idea.title}"`
    );

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to regenerate idea" },
      { status: 500 }
    );
  }
}
