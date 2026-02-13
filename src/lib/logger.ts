/* ── Compact analysis logger ──
   Prefixes every line with [analyze][jobId-short].
   Never logs secrets. */

const GREY = "\x1b[90m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

function shortId(jobId: string): string {
  return jobId.slice(0, 8);
}

function ts(): string {
  return new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
}

export function createJobLogger(jobId: string) {
  const prefix = `${GREY}${ts()}${RESET} ${CYAN}[analyze]${RESET}[${shortId(jobId)}]`;

  return {
    info(step: string, msg: string) {
      console.log(`${prefix} ${GREEN}✓${RESET} ${step} ${GREY}— ${msg}${RESET}`);
    },
    warn(step: string, msg: string) {
      console.log(`${prefix} ${YELLOW}⚠${RESET} ${step} ${GREY}— ${msg}${RESET}`);
    },
    error(step: string, msg: string) {
      console.log(`${prefix} ${RED}✗${RESET} ${step} ${GREY}— ${msg}${RESET}`);
    },
    start(step: string) {
      console.log(`${prefix} ${GREY}→${RESET} ${step}`);
    },
    /** Format a duration in ms as a compact string. */
    ms(t0: number): string {
      return `${Math.round(performance.now() - t0)}ms`;
    },
  };
}

export type JobLogger = ReturnType<typeof createJobLogger>;
