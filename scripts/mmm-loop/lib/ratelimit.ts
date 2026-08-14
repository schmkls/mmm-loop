/**
 * Rate/usage-limit classification of failed `claude` runs and wait
 * computation (spec §6.3). This module is the only place allowed to
 * pattern-match `claude` output. Pure: no IO, the clock is a parameter.
 *
 * The caller must only consult `detectRateLimit` for runs that exited
 * non-zero — agent conversation text can legitimately mention "rate limit",
 * so a zero exit is never classified (the main false-positive guard).
 */

import { RATE_LIMIT } from "../config.ts";

export type RateLimitConfig = typeof RATE_LIMIT;

export interface RateLimitHit {
  /** Parsed reset time when the message carried a usable one, else null. */
  resetAt: Date | null;
}

/**
 * Pattern table, first match wins. Sources (researched 2026-08, community
 * auto-resume projects + anthropics/claude-code issues; knowledge copied,
 * no packages):
 * - terryso/claude-auto-resume — greps `Claude AI usage limit reached|` and
 *   splits on `|` for the epoch.
 * - FusionCube18712/claude-codex-auto-resume — `limit\s+reached\s*\|\s*(\d{10,13})`,
 *   plus `weekly limit reached` and "out of extra usage" variants.
 * - saaranshM/unsnooze — TUI banners `5-hour limit reached ∙ resets 3am`,
 *   `You've hit your 5-hour limit`, `API Error: 429`.
 * - anthropics/claude-code issues #2087/#5085/#6457/#11429/#50473 — real
 *   samples of the epoch format, the prose "Claude usage limit reached.
 *   Your limit will reset at 1pm (Etc/GMT+5).", the bare status-bar
 *   "Usage limit reached", and the raw 429 `rate_limit_error` JSON.
 */
const PATTERNS: { re: RegExp; epochGroup?: number }[] = [
  // `Claude AI usage limit reached|<epoch>` — what `claude -p` prints (exit 1)
  // on a subscription-window limit; the epoch is unix seconds (defensively
  // also accepted: 13 digits = milliseconds).
  { re: /usage limit reached\s*\|\s*(\d{9,13})/i, epochGroup: 1 },
  // Timestamp-free variants: "Claude usage limit reached. Your limit will
  // reset at 1pm (Etc/GMT+5).", bare "Usage limit reached". Wall-clock reset
  // prose with a named timezone is deliberately not parsed — the default
  // wait covers it without timezone arithmetic.
  { re: /usage limit reached/i },
  // Newer banner wording: "You've hit your 5-hour limit", "hit your usage
  // limit"; windowed variants "5-hour limit reached ∙ resets 3am",
  // "weekly limit reached".
  { re: /hit your .{0,30}limit/i },
  { re: /\b(?:\d+-hour|weekly|monthly) limit reached/i },
  // API-style errors: `"type":"rate_limit_error"`, "Rate limit exceeded",
  // plain "rate limit" prose (spec §2.2 starting set).
  { re: /rate[_ ]limit(?:_error| exceeded)?/i },
  // Bare HTTP 429, e.g. `API Error: 429 {...}`.
  { re: /\b429\b/ },
];

/** Epochs further than this from now are garbage, not reset times. */
const PLAUSIBLE_EPOCH_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

function parseEpoch(digits: string, nowMs: number): Date | null {
  const n = Number(digits);
  if (!Number.isFinite(n)) return null;
  const ms = digits.length >= 13 ? n : n * 1000;
  // Implausible (>1 year away from now) degrades to "no reset time known";
  // never throw — the default wait then applies.
  if (Math.abs(ms - nowMs) > PLAUSIBLE_EPOCH_WINDOW_MS) return null;
  return new Date(ms);
}

/** Terminal escapes (CSI/OSC) that could interleave with the message. */
const ANSI_RE = /\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\))/g;

/**
 * Non-null when the failed run's output tail looks like a rate/usage limit.
 * `nowMs` only anchors the epoch-plausibility window (tests pin it).
 */
export function detectRateLimit(outputTail: string, nowMs = Date.now()): RateLimitHit | null {
  const text = outputTail.replace(ANSI_RE, "");
  for (const { re, epochGroup } of PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const digits = epochGroup === undefined ? undefined : m[epochGroup];
    return { resetAt: digits === undefined ? null : parseEpoch(digits, nowMs) };
  }
  return null;
}

/** How long to sleep for a detected hit (spec §6.3): reset time plus margin
 * when known, the default wait otherwise, always capped. */
export function computeWaitMs(hit: RateLimitHit, nowMs: number, cfg: RateLimitConfig): number {
  const raw = hit.resetAt
    ? Math.max(0, hit.resetAt.getTime() - nowMs) + cfg.resetMarginMs
    : cfg.defaultWaitMs;
  return Math.min(raw, cfg.maxSingleWaitMs);
}

/**
 * RATE_LIMIT with env overrides applied. Resolved at call time on purpose:
 * Bun snapshots process.env at startup, but tests (and wrappers) mutate it
 * in-process — same reason agent.ts passes `env: process.env` to Bun.spawn.
 */
export function effectiveRateLimitConfig(): RateLimitConfig {
  return {
    ...RATE_LIMIT,
    defaultWaitMs: envNumber("MMM_LOOP_RL_DEFAULT_WAIT_MS") ?? RATE_LIMIT.defaultWaitMs,
    resetMarginMs: envNumber("MMM_LOOP_RL_RESET_MARGIN_MS") ?? RATE_LIMIT.resetMarginMs,
    maxConsecutiveWaits: envNumber("MMM_LOOP_RL_MAX_WAITS") ?? RATE_LIMIT.maxConsecutiveWaits,
  };
}

function envNumber(name: string): number | null {
  const raw = process.env[name];
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
