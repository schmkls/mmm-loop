/** Pure rate-limit classification and wait computation (spec §6.3). */

import { afterEach, describe, expect, test } from "bun:test";
import { RATE_LIMIT } from "../scripts/mmm-loop/engine/defaults.ts";
import {
  computeWaitMs,
  detectRateLimit,
  effectiveRateLimitConfig,
} from "../scripts/mmm-loop/engine/lib/ratelimit.ts";

// A fixed "now" so epoch plausibility is deterministic: 2026-08-14T06:00:00Z.
const NOW = Date.UTC(2026, 7, 14, 6, 0, 0);
const NOW_S = Math.floor(NOW / 1000);

describe("detectRateLimit", () => {
  test("epoch format: `Claude AI usage limit reached|<epoch>` parses resetAt", () => {
    const reset = NOW_S + 42 * 60;
    const hit = detectRateLimit(`Claude AI usage limit reached|${reset}`, NOW);
    expect(hit).not.toBeNull();
    expect(hit!.resetAt).toEqual(new Date(reset * 1000));
  });

  test("epoch format tolerates spaces around the pipe and a ms epoch", () => {
    const resetMs = NOW + 5 * 60 * 1000;
    const hit = detectRateLimit(`Claude AI usage limit reached | ${resetMs}`, NOW);
    expect(hit!.resetAt).toEqual(new Date(resetMs));
  });

  test("timestamp-free `usage limit reached` (any case) → resetAt null", () => {
    for (const text of [
      "Usage limit reached",
      "Claude usage limit reached. Your limit will reset at 1pm (Etc/GMT+5).",
    ]) {
      expect(detectRateLimit(text, NOW)).toEqual({ resetAt: null });
    }
  });

  test("banner variants: hit-your-limit and windowed limit-reached wordings", () => {
    for (const text of [
      "You've hit your 5-hour limit",
      "You've hit your usage limit · resets 3pm",
      "5-hour limit reached ∙ resets 3am",
      "Weekly limit reached",
    ]) {
      expect(detectRateLimit(text, NOW)).toEqual({ resetAt: null });
    }
  });

  test("API-style errors: rate_limit_error / rate limit exceeded / bare 429", () => {
    for (const text of [
      'Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"..."}}',
      "Rate limit exceeded, please slow down",
      "hit a rate limit while calling the API",
      "API Error: 429",
    ]) {
      expect(detectRateLimit(text, NOW)).not.toBeNull();
    }
  });

  test("ANSI escapes around the message do not defeat detection", () => {
    const reset = NOW_S + 600;
    const hit = detectRateLimit(`\x1b[31mClaude AI usage limit reached|${reset}\x1b[0m`, NOW);
    expect(hit!.resetAt).toEqual(new Date(reset * 1000));
  });

  test("garbage after the pipe → matched, but resetAt null", () => {
    expect(detectRateLimit("Claude AI usage limit reached|soon-ish", NOW)).toEqual({
      resetAt: null,
    });
  });

  test("implausible epochs (>1 year out, or epoch-zero padding) → resetAt null", () => {
    const twoYearsOut = NOW_S + 2 * 365 * 24 * 60 * 60;
    expect(detectRateLimit(`Claude AI usage limit reached|${twoYearsOut}`, NOW)).toEqual({
      resetAt: null,
    });
    expect(detectRateLimit("Claude AI usage limit reached|000000000000", NOW)).toEqual({
      resetAt: null,
    });
  });

  test("a slightly past reset time is kept (limit already reset)", () => {
    const justPast = NOW_S - 5;
    const hit = detectRateLimit(`Claude AI usage limit reached|${justPast}`, NOW);
    expect(hit!.resetAt).toEqual(new Date(justPast * 1000));
  });

  test("unrelated failure text → null (existing §6.3 policy applies)", () => {
    for (const text of [
      "TypeError: undefined is not a function",
      "error: postcondition file missing",
      "fatal: not a git repository",
      "",
    ]) {
      expect(detectRateLimit(text, NOW)).toBeNull();
    }
  });

  test("429 needs word boundaries — 1429 or 4290 are not limits", () => {
    expect(detectRateLimit("processed 1429 rows", NOW)).toBeNull();
    expect(detectRateLimit("port 4290 unreachable", NOW)).toBeNull();
  });
});

describe("computeWaitMs", () => {
  const cfg = {
    defaultWaitMs: 30 * 60 * 1000,
    resetMarginMs: 60 * 1000,
    maxSingleWaitMs: 12 * 60 * 60 * 1000,
    maxConsecutiveWaits: 24,
  };

  test("future reset time → delta plus margin", () => {
    const hit = { resetAt: new Date(NOW + 42 * 60 * 1000) };
    expect(computeWaitMs(hit, NOW, cfg)).toBe(42 * 60 * 1000 + cfg.resetMarginMs);
  });

  test("past reset time → just the margin", () => {
    const hit = { resetAt: new Date(NOW - 5000) };
    expect(computeWaitMs(hit, NOW, cfg)).toBe(cfg.resetMarginMs);
  });

  test("no reset time → default wait", () => {
    expect(computeWaitMs({ resetAt: null }, NOW, cfg)).toBe(cfg.defaultWaitMs);
  });

  test("cap applies to a far-future reset time", () => {
    const hit = { resetAt: new Date(NOW + 13 * 60 * 60 * 1000) };
    expect(computeWaitMs(hit, NOW, cfg)).toBe(cfg.maxSingleWaitMs);
  });
});

describe("effectiveRateLimitConfig", () => {
  const KEYS = ["MMM_LOOP_RL_DEFAULT_WAIT_MS", "MMM_LOOP_RL_RESET_MARGIN_MS", "MMM_LOOP_RL_MAX_WAITS"];
  const saved = new Map(KEYS.map((k) => [k, process.env[k]]));

  afterEach(() => {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test("no env → the config.ts constants", () => {
    for (const k of KEYS) delete process.env[k];
    expect(effectiveRateLimitConfig()).toEqual(RATE_LIMIT);
  });

  test("env overrides win and are read at call time", () => {
    process.env.MMM_LOOP_RL_DEFAULT_WAIT_MS = "50";
    process.env.MMM_LOOP_RL_RESET_MARGIN_MS = "0";
    process.env.MMM_LOOP_RL_MAX_WAITS = "2";
    const cfg = effectiveRateLimitConfig();
    expect(cfg.defaultWaitMs).toBe(50);
    expect(cfg.resetMarginMs).toBe(0);
    expect(cfg.maxConsecutiveWaits).toBe(2);
    expect(cfg.maxSingleWaitMs).toBe(RATE_LIMIT.maxSingleWaitMs);
  });

  test("non-numeric or negative env values are ignored", () => {
    process.env.MMM_LOOP_RL_DEFAULT_WAIT_MS = "soon";
    process.env.MMM_LOOP_RL_RESET_MARGIN_MS = "-5";
    const cfg = effectiveRateLimitConfig();
    expect(cfg.defaultWaitMs).toBe(RATE_LIMIT.defaultWaitMs);
    expect(cfg.resetMarginMs).toBe(RATE_LIMIT.resetMarginMs);
  });
});
