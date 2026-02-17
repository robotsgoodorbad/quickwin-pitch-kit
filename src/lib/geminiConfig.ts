/* ── Centralized Gemini model selection + logging (server-only) ──
   Single source of truth for which model to use per stage.
   Reads env vars with graceful fallback chain:
     GEMINI_IDEAS_MODEL → GEMINI_MODEL → hardcoded default
     GEMINI_STEPS_MODEL → GEMINI_MODEL → hardcoded default            */

export type GeminiStage = "ideas" | "steps" | "custom";

const STAGE_DEFAULTS: Record<GeminiStage, string> = {
  ideas: "gemini-3-flash-preview",
  steps: "gemini-3-pro-preview",
  custom: "gemini-3-pro-preview",
};

/** Return the model ID for a given pipeline stage. */
export function getGeminiModel(stage: GeminiStage): string {
  switch (stage) {
    case "ideas":
      return (
        process.env.GEMINI_IDEAS_MODEL ||
        process.env.GEMINI_MODEL ||
        STAGE_DEFAULTS.ideas
      );
    case "steps":
    case "custom":
      return (
        process.env.GEMINI_STEPS_MODEL ||
        process.env.GEMINI_MODEL ||
        STAGE_DEFAULTS.steps
      );
  }
}

/** Return the API version (shared across all stages). */
export function getGeminiApiVersion(): string {
  return process.env.GEMINI_API_VERSION || "v1beta";
}

/** Emit a compact, no-secrets log line after each Gemini call. */
export function logGeminiCall(
  stage: GeminiStage,
  opts: {
    durationMs: number;
    used: string;
    fallback: boolean;
  }
): void {
  const model = getGeminiModel(stage);
  const apiVersion = getGeminiApiVersion();
  console.log(
    `[gemini] stage=${stage} model=${model} apiVersion=${apiVersion} durationMs=${opts.durationMs} used=${opts.used} fallback=${opts.fallback}`
  );
}
