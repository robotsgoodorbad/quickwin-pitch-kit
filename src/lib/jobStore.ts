import type { Job, Idea, BuildPlan } from "./types";

const jobs = new Map<string, Job>();
const ideas = new Map<string, Idea>();
const buildPlans = new Map<string, BuildPlan>();

/* ── Jobs ── */
export function createJob(job: Job): void {
  jobs.set(job.id, job);
}
export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}
export function updateJob(id: string, update: Partial<Job>): void {
  const job = jobs.get(id);
  if (job) Object.assign(job, update);
}

/* ── Ideas ── */
export function storeIdea(idea: Idea): void {
  ideas.set(idea.id, idea);
}
export function getIdea(id: string): Idea | undefined {
  return ideas.get(id);
}

/* ── Build Plans ── */
export function storeBuildPlan(plan: BuildPlan): void {
  buildPlans.set(plan.ideaId, plan);
}
export function getBuildPlan(ideaId: string): BuildPlan | undefined {
  return buildPlans.get(ideaId);
}
