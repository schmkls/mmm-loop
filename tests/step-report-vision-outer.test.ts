import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LoopError } from "../scripts/mmm-loop/lib/errors.ts";
import { readSprint } from "../scripts/mmm-loop/lib/snapshot.ts";
import { stepReport, stepVisionStatus } from "../scripts/mmm-loop/lib/steps.ts";
import {
  BUNDLE_DIR,
  freshTicket,
  gitSubjects,
  invocationText,
  invocations,
  makeProject,
  makeSprint,
  runLoop,
  sh,
  withFakeClaude,
  type TestProject,
} from "./helpers.ts";

const ctx = (p: TestProject) => ({ root: p.root, bundleDir: BUNDLE_DIR });

function seedClosedSprint(p: TestProject, dirName = "01-toy"): void {
  makeSprint(p, {
    dirName,
    tickets: {
      "001-a.json": freshTicket("001", {
        done: true,
        reviewed: true,
        tests: [{ description: "works", passes: true }],
      }),
    },
  });
}

const reportPath = (p: TestProject) => join(p.root, "docs/sprint_reports.html");
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe("step 6 — report + quiz", () => {
  test("fresh report created with exactly one section, committed", async () => {
    const p = makeProject();
    seedClosedSprint(p);
    await withFakeClaude(p, {}, () => stepReport(ctx(p), readSprint(p.root, "01-toy")));
    const html = readFileSync(reportPath(p), "utf8");
    expect(count(html, '<section id="sprint-01">')).toBe(1);
    expect(gitSubjects(p)[0]).toBe("chore(loop): sprint 01 report");
  });

  test("second sprint appends its section without altering sprint 01's", async () => {
    const p = makeProject();
    seedClosedSprint(p);
    await withFakeClaude(p, {}, () => stepReport(ctx(p), readSprint(p.root, "01-toy")));
    const sprint01Section = /<section id="sprint-01">.*?<\/section>/s.exec(
      readFileSync(reportPath(p), "utf8"),
    )![0];

    seedClosedSprint(p, "02-more");
    await withFakeClaude(p, {}, () => stepReport(ctx(p), readSprint(p.root, "02-more")));
    const html = readFileSync(reportPath(p), "utf8");
    expect(count(html, '<section id="sprint-01">')).toBe(1);
    expect(count(html, '<section id="sprint-02">')).toBe(1);
    expect(html).toContain(sprint01Section);
  });

  test("rerun for the same sprint replaces its section, no duplicates", async () => {
    const p = makeProject();
    seedClosedSprint(p);
    await withFakeClaude(p, {}, () => stepReport(ctx(p), readSprint(p.root, "01-toy")));
    await withFakeClaude(p, {}, () => stepReport(ctx(p), readSprint(p.root, "01-toy")));
    expect(count(readFileSync(reportPath(p), "utf8"), '<section id="sprint-01">')).toBe(1);
  });

  test("no report produced → retry → error", async () => {
    const p = makeProject();
    seedClosedSprint(p);
    await expect(
      withFakeClaude(p, { SCENARIO_REPORT: "nothing" }, () =>
        stepReport(ctx(p), readSprint(p.root, "01-toy")),
      ),
    ).rejects.toThrow(LoopError);
    const logs = invocations(p);
    expect(logs.length).toBe(2);
    expect(invocationText(p, logs[1]!)).toContain("expected docs/sprint_reports.html to exist");
  });
});

describe("step 7 — vision status", () => {
  function seedThroughReport(p: TestProject): void {
    seedClosedSprint(p);
    writeFileSync(reportPath(p), '<main><section id="sprint-01">done</section></main>');
    sh(p.root, "git", "add", "-A");
    sh(p.root, "git", "commit", "-q", "-m", "test: seed report");
  }

  test("valid rewrite → stamped, headings present, committed", async () => {
    const p = makeProject();
    seedThroughReport(p);
    await withFakeClaude(p, {}, () => stepVisionStatus(ctx(p), readSprint(p.root, "01-toy")));
    const content = readFileSync(join(p.root, ".working/vision_status.md"), "utf8");
    expect(content.startsWith("_Last updated: sprint 01_")).toBe(true);
    for (const h of ["## What exists now", "## What works (verified)", "## Known gaps", "## Blocked on human"]) {
      expect(content).toContain(h);
    }
    expect(gitSubjects(p)[0]).toBe("chore(loop): sprint 01 vision status");
  });

  test("missing stamp → retry → error", async () => {
    const p = makeProject();
    seedThroughReport(p);
    await expect(
      withFakeClaude(p, { SCENARIO_VISION: "nostamp" }, () =>
        stepVisionStatus(ctx(p), readSprint(p.root, "01-toy")),
      ),
    ).rejects.toThrow(/first line/);
    expect(invocations(p).length).toBe(2);
  });
});

describe("outer loop stop conditions", () => {
  test("blocked ticket → exit 2, but report + vision status were still produced", () => {
    const p = makeProject();
    // UX scenarios pinned quiet — this test is about blocking, not the UX pass.
    const r = runLoop(p, ["run"], {
      SCENARIO_TICKETS_COUNT: "1",
      SCENARIO_IMPLEMENT: "blocked",
      SCENARIO_UX_TEST: "none",
      SCENARIO_UX_TICKETS: "zero",
    });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("human intervention");
    expect(readFileSync(reportPath(p), "utf8")).toContain('<section id="sprint-01">');
    expect(readFileSync(join(p.root, ".working/vision_status.md"), "utf8")).toStartWith(
      "_Last updated: sprint 01_",
    );
  }, 30000);

  test("--max-sprints 2 with a clean sprint → loop re-enters step 2 and runs sprint 02", () => {
    const p = makeProject();
    const r = runLoop(p, ["run", "--max-sprints", "2"]);
    expect(r.exitCode).toBe(0);
    expect(readdirSync(join(p.root, ".working/sprints")).sort()).toEqual([
      "01-toy-feature",
      "02-toy-feature",
    ]);
    expect(r.stdout).toContain("sprint 01 complete (1/2 this run)");
    expect(r.stdout).toContain("sprint 02 complete (2/2 this run)");
    const html = readFileSync(reportPath(p), "utf8");
    expect(count(html, '<section id="sprint-01">')).toBe(1);
    expect(count(html, '<section id="sprint-02">')).toBe(1);
    expect(readFileSync(join(p.root, ".working/vision_status.md"), "utf8")).toStartWith(
      "_Last updated: sprint 02_",
    );
  }, 60000);

  test("default --max-sprints 1, clean sprint → exit 0 after exactly one sprint", () => {
    const p = makeProject();
    const r = runLoop(p);
    expect(r.exitCode).toBe(0);
    expect(readdirSync(join(p.root, ".working/sprints"))).toEqual(["01-toy-feature"]);
    expect(r.stdout).toContain("sprint 01 complete (1/1 this run)");
  }, 30000);

  test("rerun on a fully completed project starts the next sprint (spec §6.1 table)", () => {
    const p = makeProject();
    expect(runLoop(p).exitCode).toBe(0);
    const r2 = runLoop(p);
    expect(r2.exitCode).toBe(0);
    expect(r2.stdout).toContain("phase: step 2 — sprint focus (new sprint 02)");
    expect(existsSync(join(p.root, ".working/sprints/02-toy-feature"))).toBe(true);
  }, 60000);
});
