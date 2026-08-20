import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LoopError } from "../scripts/mmm-loop/lib/errors.ts";
import { readSprint } from "../scripts/mmm-loop/lib/snapshot.ts";
import { stepSpec, stepSprintFocus, stepTickets } from "../scripts/mmm-loop/lib/steps.ts";
import {
  BUNDLE_DIR,
  gitSubjects,
  invocations,
  invocationText,
  makeProject,
  makeSprint,
  runLoop,
  sh,
  withFakeClaude,
  type TestProject,
} from "./helpers.ts";

const ctx = (p: TestProject) => ({ root: p.root, bundleDir: BUNDLE_DIR });

describe("step 2 — sprint focus", () => {
  test("happy path: folder + focus created, name validated, committed", async () => {
    const p = makeProject();
    await withFakeClaude(p, {}, () => stepSprintFocus(ctx(p), "01", null));
    const focus = join(p.root, ".working/sprints/01-toy-feature/sprint_focus.md");
    expect(existsSync(focus)).toBe(true);
    expect(readFileSync(focus, "utf8")).toContain("## What");
    expect(gitSubjects(p)[0]).toBe("chore(loop): sprint 01 focus");
    expect(invocations(p).length).toBe(1);
  });

  test("agent produces nothing → one retry with failure description → error", async () => {
    const p = makeProject();
    await expect(
      withFakeClaude(p, { SCENARIO_FOCUS: "nothing" }, () => stepSprintFocus(ctx(p), "01", null)),
    ).rejects.toThrow(LoopError);
    const logs = invocations(p);
    expect(logs.length).toBe(2);
    const retry = invocationText(p, logs[1]!);
    expect(retry).toContain("PREVIOUS ATTEMPT FAILED");
    expect(retry).toContain("expected exactly one new sprint folder");
  });

  test("resume: pre-existing empty sprint folder is reused, not duplicated", async () => {
    const p = makeProject();
    mkdirSync(join(p.root, ".working/sprints/01-existing"), { recursive: true });
    await withFakeClaude(p, {}, () => stepSprintFocus(ctx(p), "01", "01-existing"));
    expect(readdirSync(join(p.root, ".working/sprints"))).toEqual(["01-existing"]);
    expect(existsSync(join(p.root, ".working/sprints/01-existing/sprint_focus.md"))).toBe(true);
  });
});

describe("step 3 — spec", () => {
  test("happy path: spec.md written and committed", async () => {
    const p = makeProject();
    makeSprint(p, { spec: false });
    await withFakeClaude(p, {}, () => stepSpec(ctx(p), readSprint(p.root, "01-toy")));
    expect(existsSync(join(p.root, ".working/sprints/01-toy/spec.md"))).toBe(true);
    expect(gitSubjects(p)[0]).toBe("chore(loop): sprint 01 spec");
  });

  test("no spec produced → retry → error", async () => {
    const p = makeProject();
    makeSprint(p, { spec: false });
    await expect(
      withFakeClaude(p, { SCENARIO_SPEC: "nothing" }, () =>
        stepSpec(ctx(p), readSprint(p.root, "01-toy")),
      ),
    ).rejects.toThrow(/spec\.md/);
    expect(invocations(p).length).toBe(2);
  });

  test("failure then success on the retry works", async () => {
    const p = makeProject();
    makeSprint(p, { spec: false });
    await withFakeClaude(p, { SCENARIO_SPEC: "retry-ok" }, () =>
      stepSpec(ctx(p), readSprint(p.root, "01-toy")),
    );
    expect(existsSync(join(p.root, ".working/sprints/01-toy/spec.md"))).toBe(true);
    expect(invocations(p).length).toBe(2);
  });

  test("orchestrator resumes at step 3 when focus exists but spec does not", () => {
    const p = makeProject();
    makeSprint(p, { spec: false });
    const r = runLoop(p, ["run"], { SCENARIO_TICKETS_MODE: "nothing" });
    expect(r.stdout).toContain("phase: step 3");
    expect(r.stdout).not.toContain("phase: step 2");
    expect(r.exitCode).toBe(1); // dies later, at step 4 (by design)
  }, 30000);
});

describe("step 4 — tickets", () => {
  test("happy path: valid tickets written, contiguous, committed", async () => {
    const p = makeProject();
    makeSprint(p);
    await withFakeClaude(p, {}, () => stepTickets(ctx(p), readSprint(p.root, "01-toy")));
    const dir = join(p.root, ".working/sprints/01-toy/tickets");
    expect(readdirSync(dir).sort()).toEqual(["001-toy-part-1.json", "002-toy-part-2.json"]);
    const t1 = JSON.parse(readFileSync(join(dir, "001-toy-part-1.json"), "utf8"));
    expect(t1).toMatchObject({ id: "001", done: false, reviewed: false, commits: [] });
    expect(gitSubjects(p)[0]).toBe("chore(loop): sprint 01 tickets");
  });

  test("invalid ticket JSON → retry carries the validator's message → error", async () => {
    const p = makeProject();
    makeSprint(p);
    await expect(
      withFakeClaude(p, { SCENARIO_TICKETS_MODE: "invalid" }, () =>
        stepTickets(ctx(p), readSprint(p.root, "01-toy")),
      ),
    ).rejects.toThrow(LoopError);
    const logs = invocations(p);
    expect(logs.length).toBe(2);
    expect(invocationText(p, logs[1]!)).toContain('"title" must be a non-empty string');
  });
});
