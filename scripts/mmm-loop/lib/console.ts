/**
 * Console output formatting: step banners, outcome lines, and a tiny in-repo
 * ANSI helper — no dependencies. The format functions are pure (description,
 * step config, attempt, and a `color` flag in; string out); `colorEnabled`
 * is the single once-computed environment read. Strictly cosmetic by
 * contract: nothing here touches prompts, agent output, or timing.
 */

import type { StepConfig, StepId } from "../config.ts";

// -------------------------------------------------------------- ANSI helper

const CODES = {
  bold: "1",
  dim: "2",
  red: "31",
  green: "32",
  yellow: "33",
  cyan: "36",
} as const;

export type StyleName = keyof typeof CODES;

/** Wrap `text` in an ANSI style when `color` is on; identity otherwise. */
export function style(name: StyleName, text: string, color: boolean): string {
  return color ? `\u001b[${CODES[name]}m${text}\u001b[0m` : text;
}

/**
 * Checked once: colors (and the `──` banner rules) degrade to plain text
 * when stdout is not a TTY or NO_COLOR is set (any value, per the informal
 * no-color standard) — piped/CI/test output sees stable uncolored text.
 */
export const colorEnabled: boolean =
  Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;

// ---------------------------------------------------------------- emoji map

/**
 * One fixed emoji per step. Typed as Record<StepId, string> so adding a step
 * without an emoji is a compile error, not a blank banner.
 */
export const STEP_EMOJI: Record<StepId, string> = {
  "02-sprint-focus": "🎯",
  "02-feedback-focus": "📮",
  "03-spec": "📝",
  "03-cleanup-identify": "🧹",
  "04-tickets": "🎫",
  "04-cleanup-tickets": "🧹",
  "05-implement": "🔨",
  "05-review": "🔍",
  "05.5-ux-plan": "🧪",
  "05.5-ux-test": "🧪",
  "05.5-ux-tickets": "🧪",
  "06-report": "📊",
  "07-vision-status": "🧭",
};

// ------------------------------------------------------------------ banners

const RULE = "─".repeat(56);

export interface BannerInput {
  stepId: StepId;
  /**
   * The describe() phase text, printed verbatim after "phase: " — e2e tests
   * grep `phase: <describe text>` and must keep passing unmodified.
   */
  description: string;
  config: StepConfig;
  /** 1 on the first run; 2 on the §6.3 retry, which reprints the banner. */
  attempt: 1 | 2;
  color: boolean;
}

/**
 * The step banner printed before each agent spawn. With color: dim `──`
 * rules frame a bold title and dim metadata, so the agent's own (untouched)
 * output visually dominates between banners. Without color the rules are
 * dropped — piped output stays line-oriented and grep-friendly.
 */
export function formatStepBanner({ stepId, description, config, attempt, color }: BannerInput): string {
  // Display the effective CLI effort; agent.ts owns the flag translation
  // ("extra" → `--effort max`, "default" → no flag).
  const effort = config.effort === "extra" ? "max" : "default";
  const title =
    `${STEP_EMOJI[stepId]} ${style("bold", `phase: ${description}`, color)}` +
    (attempt > 1 ? ` ${style("yellow", "· attempt 2/2", color)}` : "");
  const lines = [
    title,
    `   ${style("dim", `agent: ${config.model} · effort ${effort} · ≤${config.maxTurns} turns`, color)}`,
    `   ${style("dim", `prompt: scripts/mmm-loop/prompts/${stepId}.md`, color)}`,
  ];
  if (color) {
    const rule = style("dim", RULE, color);
    return [rule, ...lines, rule].join("\n");
  }
  return lines.join("\n");
}

/** "step 5.1" out of "step 5.1 — implement …" (every describe() string). */
function stepLabel(description: string): string {
  return description.split(" — ")[0]!;
}

/** The one-line outcome after a successful agent step: `✓ step 5.1 done (4m 12s)`. */
export function formatStepDone(description: string, elapsedMs: number, color: boolean): string {
  return `${style("green", "✓", color)} ${stepLabel(description)} done (${formatDuration(elapsedMs)})`;
}

/** Wall-clock duration, rounded to seconds: "12s", "4m 12s", "1h 2m 5s". */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
