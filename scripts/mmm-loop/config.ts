/**
 * Per-step agent configuration (spec §7). This file is yours to edit per
 * project: models, effort, max-turns, and the permission flags passed to
 * `claude`.
 */

export type StepId =
  | "02-sprint-focus"
  | "03-spec"
  | "04-tickets"
  | "05-implement"
  | "05-review"
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
  "03-spec": { model: "claude-fable-5", effort: "extra", maxTurns: 50 },
  "04-tickets": { model: "claude-fable-5", effort: "extra", maxTurns: 50 },
  "05-implement": { model: "claude-fable-5", effort: "extra", maxTurns: 150 },
  "05-review": { model: "claude-fable-5", effort: "extra", maxTurns: 75 },
  "06-report": { model: "claude-fable-5", effort: "default", maxTurns: 75 },
  "07-vision-status": { model: "claude-haiku-4-5", effort: "default", maxTurns: 30 },
};

/**
 * Autonomous means autonomous (spec §7). If that is too spicy for a given
 * project, replace with e.g. ["--permission-mode", "acceptEdits",
 * "--allowedTools", "..."].
 */
export const PERMISSION_ARGS: string[] = ["--dangerously-skip-permissions"];
