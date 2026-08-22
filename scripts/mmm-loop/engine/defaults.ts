/**
 * Engine defaults (spec §7): per-step models, effort, max-turns, and the
 * permission flags passed to `claude`.
 *
 * This file is upstream — an update overwrites it, so do not edit it per
 * project. Put project overrides in the overlay `../config.ts`, which
 * `./config.ts` deep-merges over these defaults. `LoopConfig` at the bottom
 * is the shape of that overlay.
 */

export type StepId =
  | "02-sprint-focus"
  | "02-feedback-focus"
  | "03-spec"
  | "03-cleanup-identify"
  | "04-tickets"
  | "04-cleanup-tickets"
  | "05-implement"
  | "05-review"
  | "05.5-ux-plan"
  | "05.5-ux-test"
  | "05.5-ux-tickets"
  | "06-report"
  | "07-vision-status";

/**
 * "extra" = the highest reasoning effort the installed Claude Code offers.
 * The spawn wrapper (lib/agent.ts) owns the translation to a CLI flag.
 * "default" passes no effort flag.
 */
export type Effort = "extra" | "default";

export interface StepConfig {
  model: string;
  effort: Effort;
  maxTurns: number;
}

export const STEP_CONFIG: Record<StepId, StepConfig> = {
  "02-sprint-focus": { model: "claude-fable-5", effort: "extra", maxTurns: 50 },
  "02-feedback-focus": { model: "claude-fable-5", effort: "extra", maxTurns: 50 },
  "03-spec": { model: "claude-fable-5", effort: "extra", maxTurns: 50 },
  "03-cleanup-identify": { model: "claude-fable-5", effort: "extra", maxTurns: 75 },
  "04-tickets": { model: "claude-fable-5", effort: "extra", maxTurns: 50 },
  "04-cleanup-tickets": { model: "claude-fable-5", effort: "extra", maxTurns: 50 },
  "05-implement": { model: "claude-fable-5", effort: "extra", maxTurns: 150 },
  "05-review": { model: "claude-fable-5", effort: "extra", maxTurns: 75 },
  "05.5-ux-plan": { model: "claude-fable-5", effort: "extra", maxTurns: 50 },
  "05.5-ux-test": { model: "claude-fable-5", effort: "extra", maxTurns: 100 },
  "05.5-ux-tickets": { model: "claude-fable-5", effort: "default", maxTurns: 30 },
  "06-report": { model: "claude-fable-5", effort: "default", maxTurns: 75 },
  "07-vision-status": { model: "claude-haiku-4-5", effort: "default", maxTurns: 30 },
};

/**
 * Every Nth *created* sprint is a cleanup sprint (spec §5; the spec calls
 * this `cleanupCadence`). Default 3 = sprints 03, 06, 09, …; 0 = disabled.
 */
export const CLEANUP_CADENCE = 3;

/** Sprint branches are created from and merged into this branch (spec §6.4). */
export const BASE_BRANCH = "main";

/**
 * Only run when the logged-in Claude account has this email address
 * (case-insensitive). null = accept any account. Overridable with the
 * MMM_LOOP_ALLOWED_CLAUDE_USER env var (env wins; used by tests).
 */
export const ALLOWED_CLAUDE_USER: string | null = null;

/**
 * Autonomous means autonomous (spec §7). If that is too spicy for a given
 * project, replace with e.g. ["--permission-mode", "acceptEdits",
 * "--allowedTools", "..."].
 */
export const PERMISSION_ARGS: string[] = ["--dangerously-skip-permissions"];

/**
 * Rate/usage-limit handling (spec §6.3): when a `claude` run exits non-zero
 * because the account hit its usage window, the loop waits out the limit and
 * re-runs the same attempt instead of failing the step. The env vars
 * MMM_LOOP_RL_DEFAULT_WAIT_MS and MMM_LOOP_RL_RESET_MARGIN_MS override the
 * two wait values (env wins — same idiom as MMM_LOOP_CLAUDE_BIN; used by
 * tests and one-off runs), and MMM_LOOP_RL_MAX_WAITS overrides
 * maxConsecutiveWaits.
 */
export const RATE_LIMIT: RateLimitSettings = {
  /** Wait when the error carries no parseable reset time. */
  defaultWaitMs: 30 * 60 * 1000,
  /** Safety margin added on top of a parsed reset time. */
  resetMarginMs: 60 * 1000,
  /** Sanity cap for one wait. */
  maxSingleWaitMs: 12 * 60 * 60 * 1000,
  /** Consecutive rate-limited attempts of one step before giving up. */
  maxConsecutiveWaits: 24,
};

export interface RateLimitSettings {
  defaultWaitMs: number;
  resetMarginMs: number;
  maxSingleWaitMs: number;
  maxConsecutiveWaits: number;
}

/**
 * The full configuration surface of the loop: every value above, plus the
 * `source` pin recorded at install time so `update` knows where this engine
 * came from. A project's `../config.ts` exports a `Partial<LoopConfig>` that
 * `./config.ts` deep-merges over `DEFAULTS`.
 */
export interface LoopConfig {
  STEP_CONFIG: Record<StepId, StepConfig>;
  CLEANUP_CADENCE: number;
  BASE_BRANCH: string;
  ALLOWED_CLAUDE_USER: string | null;
  PERMISSION_ARGS: string[];
  RATE_LIMIT: RateLimitSettings;
  /** Where `engine/` was installed from; written by install, read by update. */
  source?: { from: string; ref?: string };
}

/** Recursively optional — what a deep merge actually accepts. */
export type DeepPartial<T> = T extends (infer U)[]
  ? U[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/**
 * Overlay shape. Identical to `Partial<LoopConfig>` except that nested
 * objects may also be partial — widen `../config.ts` to this when you want
 * to override a single step or a single RATE_LIMIT value.
 */
export type LoopConfigOverlay = DeepPartial<LoopConfig>;

/** The defaults as one object; `./config.ts` merges the overlay over this. */
export const DEFAULTS: LoopConfig = {
  STEP_CONFIG,
  CLEANUP_CADENCE,
  BASE_BRANCH,
  ALLOWED_CLAUDE_USER,
  PERMISSION_ARGS,
  RATE_LIMIT,
};
