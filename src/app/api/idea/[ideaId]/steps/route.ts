import { NextResponse } from "next/server";
import { getIdea, getJob, getBuildPlan, storeBuildPlan } from "@/lib/jobStore";
import { generateBuildPlan } from "@/lib/ai";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ ideaId: string }> }
) {
  const { ideaId } = await params;

  // Check cache first
  const cached = getBuildPlan(ideaId);
  if (cached) return NextResponse.json(cached);

  const idea = getIdea(ideaId);
  if (!idea) {
    return NextResponse.json({ error: "Idea not found" }, { status: 404 });
  }

  const job = getJob(idea.jobId);
  const context = job?.companyContext ?? { name: "Unknown" };
  const theme = idea.theme ?? job?.theme ?? undefined;

  const plan = await generateBuildPlan(idea, context, theme);
  storeBuildPlan(plan);

  return NextResponse.json(plan);
}
