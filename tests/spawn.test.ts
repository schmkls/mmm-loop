import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgentStep } from "../scripts/mmm-loop/engine/lib/agent.ts";
import { LoopError } from "../scripts/mmm-loop/engine/lib/errors.ts";

const SPAWN_FAKE = join(import.meta.dir, "fixtures", "spawn-fake.ts");
const ENV_KEYS = [
  "MMM_LOOP_CLAUDE_BIN",
  "SPAWNTEST_DIR",
  "SPAWNTEST_OUT",
  "SPAWNTEST_MODE",
  "SCENARIO_RATE_LIMIT",
  "MMM_LOOP_RL_DEFAULT_WAIT_MS",
  "MMM_LOOP_RL_RESET_MARGIN_MS",
  "MMM_LOOP_RL_MAX_WAITS",
];
let saved: Map<string, string | undefined> | undefined;

function setup(mode: string, promptBody = "Test prompt body.") {
  const base = mkdtempSync(join(tmpdir(), "mmm-loop-spawn-"));
  const bundleDir = join(base, "bundle");
  mkdirSync(join(bundleDir, "prompts"), { recursive: true });
  writeFileSync(join(bundleDir, "prompts", "03-spec.md"), promptBody);
  const cwd = join(base, "proj");
  mkdirSync(cwd);
  const rec = join(base, "rec");
  mkdirSync(rec);
  const out = join(base, "out.txt");

  saved = new Map(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.MMM_LOOP_CLAUDE_BIN = SPAWN_FAKE;
  process.env.SPAWNTEST_DIR = rec;
  process.env.SPAWNTEST_OUT = out;
  process.env.SPAWNTEST_MODE = mode;

  const step = {
    stepId: "03-spec" as const,
    vars: {},
    cwd,
    bundleDir,
    check: () => (existsSync(out) ? null : "expected out.txt to be produced"),
  };
  const prompts = () =>
    readdirSync(rec)
      .sort()
      .map((f) => readFileSync(join(rec, f), "utf8"));
  return { step, prompts };
}

afterEach(() => {
  for (const [k, v] of saved ?? []) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  saved = undefined;
});

describe("runAgentStep (spawn wrapper)", () => {
  test("success on first try — no retry, correct argv incl. effort translation", async () => {
    const { step, prompts } = setup("succeed");
    await runAgentStep(step);
    const recorded = prompts();
    expect(recorded.length).toBe(1);
    expect(recorded[0]).toContain("Test prompt body.");
    expect(recorded[0]).not.toContain("PREVIOUS ATTEMPT FAILED");
    const argv = recorded[0]!.split("\n")[0]!;
    expect(argv).toContain("-p");
    expect(argv).toContain("--dangerously-skip-permissions");
    expect(argv).toContain("--model claude-fable-5");
    expect(argv).toContain("--max-turns 50");
    expect(argv).toContain("--effort max");
  });

  test("failure then success — retry prompt contains the check's message", async () => {
    const { step, prompts } = setup("fail-once");
    await runAgentStep(step);
    const recorded = prompts();
    expect(recorded.length).toBe(2);
    expect(recorded[1]).toContain("PREVIOUS ATTEMPT FAILED");
    expect(recorded[1]).toContain("expected out.txt to be produced");
  });

  test("failure twice — LoopError surfaces (exit 1 path), never a third attempt", async () => {
    const { step, prompts } = setup("fail-always");
    await expect(runAgentStep(step)).rejects.toThrow(LoopError);
    expect(prompts().length).toBe(2);
  });

  test("nonzero claude exit counts as failure and is retried", async () => {
    const { step, prompts } = setup("crash");
    await expect(runAgentStep(step)).rejects.toThrow(/exited with code 3/);
    expect(prompts().length).toBe(2);
  });

  test("unknown template variable — immediate error, no spawn", async () => {
    const { step, prompts } = setup("succeed", "Hello {{bogus}}");
    await expect(runAgentStep(step)).rejects.toThrow(/\{\{bogus\}\}/);
    expect(prompts().length).toBe(0);
  });
});

describe("runAgentStep — rate-limit waits (spec §6.3)", () => {
  /** setup() plus a faked limit and test-shrunk waits. */
  function setupRateLimited(mode: string, rateLimit: string, extra: Record<string, string> = {}) {
    const s = setup(mode);
    process.env.SCENARIO_RATE_LIMIT = rateLimit;
    process.env.MMM_LOOP_RL_DEFAULT_WAIT_MS = "50";
    process.env.MMM_LOOP_RL_RESET_MARGIN_MS = "0";
    Object.assign(process.env, extra);
    return s;
  }

  /** Spy on console.error, muted; returns the recorded wait lines. The
   * lines are accumulated eagerly — mockRestore() wipes spy.mock.calls. */
  function muteStderr() {
    const lines: string[] = [];
    const spy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
    return {
      spy,
      waitLines: () => lines.filter((l) => l.includes("usage limit reached; waiting")),
    };
  }

  test("limited once → same attempt re-spawned after one wait, step succeeds", async () => {
    const { step, prompts } = setupRateLimited("succeed", "1");
    const { spy, waitLines } = muteStderr();
    try {
      await runAgentStep(step);
    } finally {
      spy.mockRestore();
    }
    const recorded = prompts();
    expect(recorded.length).toBe(2);
    // The re-spawn is the SAME attempt — not the §6.3 retry.
    expect(recorded[1]).not.toContain("PREVIOUS ATTEMPT FAILED");
    expect(waitLines().length).toBe(1);
    expect(waitLines()[0]).toMatch(/^\[mmm-loop\] usage limit reached; waiting .+ — resuming at \d{2}:\d{2}$/);
  });

  test("parsed reset time ~2s out → waits for it, not the default", async () => {
    const epoch = Math.ceil(Date.now() / 1000) + 2;
    const { step, prompts } = setupRateLimited("succeed", `1:${epoch}`);
    const { spy } = muteStderr();
    const t0 = Date.now();
    try {
      await runAgentStep(step);
    } finally {
      spy.mockRestore();
    }
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1900); // default wait is 50ms here
    expect(prompts().length).toBe(2);
  }, 15000);

  test("non-limit non-zero exit → existing behavior, no wait line", async () => {
    const { step, prompts } = setupRateLimited("crash", "");
    const { spy, waitLines } = muteStderr();
    try {
      await expect(runAgentStep(step)).rejects.toThrow(/exited with code 3/);
    } finally {
      spy.mockRestore();
    }
    const recorded = prompts();
    expect(recorded.length).toBe(2);
    expect(recorded[1]).toContain("PREVIOUS ATTEMPT FAILED");
    expect(waitLines().length).toBe(0);
  });

  test("exit 0 printing limit-looking text → never classified, postcondition decides", async () => {
    const { step, prompts } = setupRateLimited("fail-once", "zero-exit");
    const { spy, waitLines } = muteStderr();
    try {
      await runAgentStep(step);
    } finally {
      spy.mockRestore();
    }
    const recorded = prompts();
    expect(recorded.length).toBe(2);
    expect(recorded[1]).toContain("PREVIOUS ATTEMPT FAILED"); // the ordinary retry, no waits
    expect(waitLines().length).toBe(0);
  });

  test("maxConsecutiveWaits exceeded → LoopError naming step and count", async () => {
    const { step, prompts } = setupRateLimited("succeed", "5", { MMM_LOOP_RL_MAX_WAITS: "2" });
    const { spy, waitLines } = muteStderr();
    try {
      await expect(runAgentStep(step)).rejects.toThrow(
        /Step 03-spec: still rate-limited after 2 waits/,
      );
    } finally {
      spy.mockRestore();
    }
    expect(prompts().length).toBe(3); // two waited-out attempts, then give up
    expect(waitLines().length).toBe(2);
  });

  test("a rate-limited attempt does not consume the §6.3 retry", async () => {
    // Limited once, then the first real attempt fails its postcondition —
    // the retry must still be available, so the step succeeds overall.
    const { step, prompts } = setupRateLimited("fail-once", "1");
    const { spy, waitLines } = muteStderr();
    try {
      await runAgentStep(step);
    } finally {
      spy.mockRestore();
    }
    const recorded = prompts();
    expect(recorded.length).toBe(3);
    expect(recorded[1]).not.toContain("PREVIOUS ATTEMPT FAILED"); // re-spawn of attempt 1
    expect(recorded[2]).toContain("PREVIOUS ATTEMPT FAILED"); // the intact retry
    expect(waitLines().length).toBe(1);
  });
});
