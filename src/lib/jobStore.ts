import type { Job, Idea, BuildPlan } from "./types";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

/* ── In-memory caches ── */

const jobs = new Map<string, Job>();
const ideas = new Map<string, Idea>();
const buildPlans = new Map<string, BuildPlan>();

/* ── Disk persistence paths ── */

const DATA_DIR = join(process.cwd(), ".data");
const JOBS_DIR = join(DATA_DIR, "jobs");
const PLANS_DIR = join(DATA_DIR, "plans");

function ensureDirs() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(JOBS_DIR)) mkdirSync(JOBS_DIR, { recursive: true });
  if (!existsSync(PLANS_DIR)) mkdirSync(PLANS_DIR, { recursive: true });
}

function writeDiskJob(job: Job): void {
  try {
    ensureDirs();
    writeFileSync(join(JOBS_DIR, `${job.id}.json`), JSON.stringify(job), "utf-8");
  } catch {
    /* disk write is best-effort */
  }
}

function readDiskJob(id: string): Job | undefined {
  try {
    const path = join(JOBS_DIR, `${id}.json`);
    if (!existsSync(path)) return undefined;
    return JSON.parse(readFileSync(path, "utf-8")) as Job;
  } catch {
    return undefined;
  }
}

function writeDiskPlan(plan: BuildPlan): void {
  try {
    ensureDirs();
    writeFileSync(join(PLANS_DIR, `${plan.ideaId}.json`), JSON.stringify(plan), "utf-8");
  } catch {
    /* best-effort */
  }
}

function readDiskPlan(ideaId: string): BuildPlan | undefined {
  try {
    const path = join(PLANS_DIR, `${ideaId}.json`);
    if (!existsSync(path)) return undefined;
    return JSON.parse(readFileSync(path, "utf-8")) as BuildPlan;
  } catch {
    return undefined;
  }
}

/* ── Idea ID parsing ── */

export function parseIdeaId(ideaId: string): { jobId: string; ideaIndex: number } | null {
  const lastDash = ideaId.lastIndexOf("-");
  if (lastDash === -1) return null;
  const index = Number(ideaId.slice(lastDash + 1));
  if (Number.isNaN(index)) return null;
  return { jobId: ideaId.slice(0, lastDash), ideaIndex: index };
}

/** Hydrate in-memory maps from a disk-loaded job. */
function hydrateFromJob(job: Job): void {
  jobs.set(job.id, job);
  if (Array.isArray(job.ideas)) {
    for (const idea of job.ideas) {
      ideas.set(idea.id, idea);
    }
  }
}

/* ── Jobs ── */

export function createJob(job: Job): void {
  jobs.set(job.id, job);
  writeDiskJob(job);
}

export function getJob(id: string): Job | undefined {
  const mem = jobs.get(id);
  if (mem) return mem;

  // Disk fallback
  const disk = readDiskJob(id);
  if (disk) {
    hydrateFromJob(disk);
    return disk;
  }
  return undefined;
}

export function updateJob(id: string, update: Partial<Job>): void {
  const job = jobs.get(id);
  if (job) {
    Object.assign(job, update);
    writeDiskJob(job);
  }
}

/** Persist the current in-memory state of a job to disk (call after mutations). */
export function persistJob(id: string): void {
  const job = jobs.get(id);
  if (job) writeDiskJob(job);
}

/* ── Ideas ── */

export function storeIdea(idea: Idea): void {
  ideas.set(idea.id, idea);
  // Also persist the parent job (which contains the ideas array)
  const job = jobs.get(idea.jobId);
  if (job) writeDiskJob(job);
}

export function getIdea(id: string): Idea | undefined {
  const mem = ideas.get(id);
  if (mem) return mem;

  // Fallback: parse ideaId → load job from disk → find idea
  const parsed = parseIdeaId(id);
  if (!parsed) return undefined;

  const job = getJob(parsed.jobId); // triggers disk fallback
  if (!job) return undefined;

  // Try direct lookup (hydrateFromJob already populated the map)
  const hydrated = ideas.get(id);
  if (hydrated) return hydrated;

  // Fallback: index into ideas array
  if (Array.isArray(job.ideas) && parsed.ideaIndex < job.ideas.length) {
    const idea = job.ideas[parsed.ideaIndex];
    ideas.set(idea.id, idea);
    return idea;
  }

  return undefined;
}

/* ── Build Plans ── */

export function storeBuildPlan(plan: BuildPlan): void {
  buildPlans.set(plan.ideaId, plan);
  writeDiskPlan(plan);
}

export function getBuildPlan(ideaId: string): BuildPlan | undefined {
  const mem = buildPlans.get(ideaId);
  if (mem) return mem;

  // Disk fallback
  const disk = readDiskPlan(ideaId);
  if (disk) {
    buildPlans.set(disk.ideaId, disk);
    return disk;
  }
  return undefined;
}
