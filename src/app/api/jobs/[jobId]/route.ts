import { NextResponse } from "next/server";
import { getJob } from "@/lib/jobStore";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const job = getJob(jobId);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: job.id,
    status: job.status,
    steps: job.steps,
    ideas: job.status === "done" ? job.ideas : [],
    companyContext: job.companyContext,
    theme: job.theme ?? null,
    evidence: job.evidence ?? null,
    contextBundle: job.contextBundle ?? null,
  });
}
