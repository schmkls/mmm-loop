import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LoopError } from "../scripts/mmm-loop/engine/lib/errors.ts";
import { UX_TICKETIZED_NO, UX_TICKETIZED_YES } from "../scripts/mmm-loop/engine/lib/phases.ts";
import { readSprint } from "../scripts/mmm-loop/engine/lib/snapshot.ts";
import { stepUxPlan, stepUxTest, stepUxTickets } from "../scripts/mmm-loop/engine/lib/steps.ts";
import {
  ENGINE_DIR,
  freshTicket,
  gitSubjects,
  invocations,
  invocationText,
  makeProject,
  makeSprint,
  readTicket,
  sh,
  withFakeClaude,
  type TestProject,
} from "./helpers.ts";

const ctx = (p: TestProject) => ({ root: p.root, bundleDir: ENGINE_DIR });

const closedTicket = (id: string) =>
  freshTicket(id, {
    done: true,
    reviewed: true,
    tests: [{ description: `ticket ${id} works`, passes: true }],
  });

const findingsPath = (p: TestProject) => join(p.root, ".working/sprints/01-toy/ux_findings.md");
const firstLine = (p: TestProject) =>
  (readFileSync(findingsPath(p), "utf8").split("\n")[0] ?? "").trim();
const ticketFiles = (p: TestProject) =>
  readdirSync(join(p.root, ".working/sprints/01-toy/tickets")).sort();

describe("step 5.5.1 — ux plan", () => {
  test("happy path: non-empty plan written and committed", async () => {
    const p = makeProject();
    makeSprint(p, { tickets: { "001-a.json": closedTicket("001") } });
    await withFakeClaude(p, {}, () => stepUxPlan(ctx(p), readSprint(p.root, "01-toy")));
    const plan = join(p.root, ".working/sprints/01-toy/ux_test_plan.md");
    expect(readFileSync(plan, "utf8")).toContain("## Tests");
    expect(gitSubjects(p)[0]).toBe("chore(loop): sprint 01 ux plan");
  });

  test("nothing produced → retry carries the check's message → LoopError", async () => {
    const p = makeProject();
    makeSprint(p, { tickets: { "001-a.json": closedTicket("001") } });
    await expect(
      withFakeClaude(p, { SCENARIO_UX_PLAN: "nothing" }, () =>
        stepUxPlan(ctx(p), readSprint(p.root, "01-toy")),
      ),
    ).rejects.toThrow(LoopError);
    const logs = invocations(p);
    expect(logs.length).toBe(2);
    expect(invocationText(p, logs[1]!)).toContain("PREVIOUS ATTEMPT FAILED");
    expect(invocationText(p, logs[1]!)).toContain("ux_test_plan.md");
  });

  test("failure then success on the retry works", async () => {
    const p = makeProject();
    makeSprint(p, { tickets: { "001-a.json": closedTicket("001") } });
    await withFakeClaude(p, { SCENARIO_UX_PLAN: "retry-ok" }, () =>
      stepUxPlan(ctx(p), readSprint(p.root, "01-toy")),
    );
    expect(existsSync(join(p.root, ".working/sprints/01-toy/ux_test_plan.md"))).toBe(true);
    expect(invocations(p).length).toBe(2);
  });
});

describe("step 5.5.2 — ux test", () => {
  const seed = (p: TestProject) =>
    makeSprint(p, { tickets: { "001-a.json": closedTicket("001") }, ux: { plan: true } });

  test("happy path: findings stamped 'no', committed, commit contains only the findings file", async () => {
    const p = makeProject();
    seed(p);
    await withFakeClaude(p, {}, () => stepUxTest(ctx(p), readSprint(p.root, "01-toy")));
    expect(firstLine(p)).toBe(UX_TICKETIZED_NO);
    expect(gitSubjects(p)[0]).toBe("chore(loop): sprint 01 ux findings");
    const files = sh(p.root, "git", "show", "--name-only", "--format=", "HEAD").trim().split("\n");
    expect(files).toEqual([".working/sprints/01-toy/ux_findings.md"]);
  });

  test("bad stamp (agent wrote 'yes') → postcondition fails twice → LoopError", async () => {
    const p = makeProject();
    seed(p);
    await expect(
      withFakeClaude(p, { SCENARIO_UX_TEST: "bad-stamp" }, () =>
        stepUxTest(ctx(p), readSprint(p.root, "01-toy")),
      ),
    ).rejects.toThrow(/first line/);
    expect(invocations(p).length).toBe(2);
  });

  test("nothing produced → retry names the expected stamp → LoopError", async () => {
    const p = makeProject();
    seed(p);
    await expect(
      withFakeClaude(p, { SCENARIO_UX_TEST: "nothing" }, () =>
        stepUxTest(ctx(p), readSprint(p.root, "01-toy")),
      ),
    ).rejects.toThrow(LoopError);
    const logs = invocations(p);
    expect(logs.length).toBe(2);
    expect(invocationText(p, logs[1]!)).toContain("ux_findings.md");
  });

  test("failure then success on the retry works", async () => {
    const p = makeProject();
    seed(p);
    await withFakeClaude(p, { SCENARIO_UX_TEST: "retry-ok" }, () =>
      stepUxTest(ctx(p), readSprint(p.root, "01-toy")),
    );
    expect(firstLine(p)).toBe(UX_TICKETIZED_NO);
    expect(invocations(p).length).toBe(2);
  });
});

describe("step 5.5.3 — ux ticketize", () => {
  const seed = (p: TestProject, tickets: Record<string, ReturnType<typeof freshTicket>>) =>
    makeSprint(p, { tickets, ux: { plan: true, findings: "no" } });

  test("from-findings: valid ux ticket created, stamp flipped, committed", async () => {
    const p = makeProject();
    seed(p, { "001-a.json": closedTicket("001") });
    await withFakeClaude(p, {}, () => stepUxTickets(ctx(p), readSprint(p.root, "01-toy")));
    expect(ticketFiles(p)).toEqual(["001-a.json", "002-ux-toy-output-confusing.json"]);
    const t = readTicket(p, "01-toy", "002-ux-toy-output-confusing.json");
    expect(t).toMatchObject({ id: "002", done: false, reviewed: false, commits: [] });
    expect(firstLine(p)).toBe(UX_TICKETIZED_YES);
    expect(gitSubjects(p)[0]).toBe("chore(loop): sprint 01 ux tickets");
  });

  test("zero tickets is valid: stamp still flipped and committed", async () => {
    const p = makeProject();
    seed(p, { "001-a.json": closedTicket("001") });
    await withFakeClaude(p, { SCENARIO_UX_TICKETS: "zero" }, () =>
      stepUxTickets(ctx(p), readSprint(p.root, "01-toy")),
    );
    expect(ticketFiles(p)).toEqual(["001-a.json"]);
    expect(firstLine(p)).toBe(UX_TICKETIZED_YES);
    expect(gitSubjects(p)[0]).toBe("chore(loop): sprint 01 ux tickets");
  });

  test("numbering continues after fix tickets: 003 + 003.1 present → new ticket is 004", async () => {
    const p = makeProject();
    seed(p, {
      "001-a.json": closedTicket("001"),
      "002-b.json": closedTicket("002"),
      "003-c.json": closedTicket("003"),
      "003.1-fix-c.json": closedTicket("003.1"),
    });
    await withFakeClaude(p, {}, () => stepUxTickets(ctx(p), readSprint(p.root, "01-toy")));
    expect(ticketFiles(p)).toContain("004-ux-toy-output-confusing.json");
    expect(readTicket(p, "01-toy", "004-ux-toy-output-confusing.json").id).toBe("004");
  });

  test("missing ux- infix in the filename → rejected, stamp NOT flipped", async () => {
    const p = makeProject();
    seed(p, { "001-a.json": closedTicket("001") });
    await expect(
      withFakeClaude(p, { SCENARIO_UX_TICKETS: "bad-name" }, () =>
        stepUxTickets(ctx(p), readSprint(p.root, "01-toy")),
      ),
    ).rejects.toThrow(/NNN-ux-kebab-slug/);
    expect(firstLine(p)).toBe(UX_TICKETIZED_NO);
  });
});
