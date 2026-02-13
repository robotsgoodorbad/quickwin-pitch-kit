import { NextResponse } from "next/server";
import { getIdea, getJob } from "@/lib/jobStore";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ideaId: string }> }
) {
  const { ideaId } = await params;
  const idea = getIdea(ideaId);

  if (!idea) {
    return NextResponse.json({ error: "Idea not found" }, { status: 404 });
  }

  // Theme lives directly on the idea (set during analysis) or falls back to job
  const job = getJob(idea.jobId);
  const theme = idea.theme ?? job?.theme ?? null;

  return NextResponse.json({ ...idea, theme });
}
