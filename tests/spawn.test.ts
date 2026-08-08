import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgentStep } from "../scripts/mmm-loop/lib/agent.ts";
import { LoopError } from "../scripts/mmm-loop/lib/errors.ts";

const SPAWN_FAKE = join(import.meta.dir, "fixtures", "spawn-fake.ts");
const ENV_KEYS = ["MMM_LOOP_CLAUDE_BIN", "SPAWNTEST_DIR", "SPAWNTEST_OUT", "SPAWNTEST_MODE"];
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
