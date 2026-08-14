/**
 * SCENARIO_RATE_LIMIT pre-dispatch hook shared by the fake `claude` binaries
 * (fake-claude.ts and spawn-fake.ts). Value formats:
 *
 *   "<count>[:<epoch>]"  — the first <count> invocations (of any step) print
 *                          the canned Claude Code limit message to stderr and
 *                          exit 1. With <epoch>, the message carries it after
 *                          the pipe.
 *   "zero-exit[:<epoch>]" — print the message but continue normally (the
 *                          exit-0 false-positive guard).
 *
 * Invocation counting via a counter file in the project dir (cwd — the fakes
 * run with cwd = project root, the existing scenario-state convention).
 *
 * Returns how many invocations were rate-limited so far, so callers can
 * count "real" attempts for their own mode logic.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const COUNTER_FILE = ".rate-limit-count";

export function rateLimitHook(): number {
  const spec = process.env.SCENARIO_RATE_LIMIT;
  if (!spec) return 0;
  const [head = "", epoch] = spec.split(":");
  const message =
    epoch === undefined
      ? "Claude AI usage limit reached"
      : `Claude AI usage limit reached|${epoch}`;
  if (head === "zero-exit") {
    console.error(message);
    return 0;
  }
  const limit = Number(head);
  const seen = existsSync(COUNTER_FILE) ? Number(readFileSync(COUNTER_FILE, "utf8")) : 0;
  if (seen < limit) {
    writeFileSync(COUNTER_FILE, String(seen + 1));
    console.error(message);
    process.exit(1);
  }
  return seen;
}
