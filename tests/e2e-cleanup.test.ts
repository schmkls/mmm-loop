/** End-to-end dry runs of cleanup sprints: the real CLI against throwaway
 * git projects with the fake `claude` (spec §6.1, §8.8). */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  freshTicket,
  gitSubjects,
  invocations,
  invocationText,
  makeProject,
  makeSprint,
  runLoop,
  sh,
  type TestProject,
} from "./helpers.ts";

/** Pin the UX pass quiet where the test is about cleanup, not UX. */
const quietUx = { SCENARIO_UX_TEST: "none", SCENARIO_UX_TICKETS: "zero" };

const phaseLines = (stdout: string) =>
  stdout.split("\n").filter((l) => l.includes("phase:"));

function seedCompletedSprint(p: TestProject, dirName: string): void {
  makeSprint(p, {
    dirName,
    tickets: {
      "001-a.json": freshTicket("001", {
        done: true,
        reviewed: true,
        tests: [{ description: "works", passes: true }],
      }),
    },
    ux: { plan: true, findings: "yes" },
  });
}

describe("e2e cleanup sprints", () => {
  test("run --cleanup: full 3-candidate cleanup sprint → exit 0, complete artifact trail", () => {
    const p = makeProject();
    const r = runLoop(p, ["run", "--cleanup"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("sprint 01 will be a cleanup sprint");

    // The folder is NN-cleanup with no sprint_focus.md; spec starts with the stamp.
    expect(readdirSync(join(p.root, ".working/sprints"))).toEqual(["01-cleanup"]);
    const dir = join(p.root, ".working/sprints/01-cleanup");
    expect(existsSync(join(dir, "sprint_focus.md"))).toBe(false);
    expect(readFileSync(join(dir, "spec.md"), "utf8")).toStartWith("_Candidates:");

    // The UX pass ran unchanged (default scenarios: one finding → one ticket).
    expect(existsSync(join(dir, "ux_test_plan.md"))).toBe(true);
    expect(readFileSync(join(dir, "ux_findings.md"), "utf8")).toStartWith("_Ticketized: yes_");

    // Report section + vision stamp.
    expect(readFileSync(join(p.root, "docs/sprint_reports.html"), "utf8")).toContain(
      '<section id="sprint-01">',
    );
    expect(readFileSync(join(p.root, ".working/vision_status.md"), "utf8")).toStartWith(
      "_Last updated: sprint 01_",
    );

    // Commit conventions: refactor/docs for category tickets, feat for the
    // UX ticket, chore(loop) trail with per-category suffixes.
    const subjects = gitSubjects(p);
    for (const prefix of [
      "refactor(s01/001): ",
      "refactor(s01/002): ",
      "docs(s01/003): ",
      "feat(s01/004): ",
      "chore(loop): sprint 01 spec",
      "chore(loop): sprint 01 tickets (architecture)",
      "chore(loop): sprint 01 tickets (clean-code)",
      "chore(loop): sprint 01 tickets (docs)",
      "chore(loop): sprint 01 ux plan",
      "chore(loop): sprint 01 ux findings",
      "chore(loop): sprint 01 ux tickets",
      "chore(loop): sprint 01 report",
      "chore(loop): sprint 01 vision status",
    ]) {
      expect(subjects.some((s) => s.startsWith(prefix))).toBe(true);
    }

    // Nothing left dirty.
    expect(sh(p.root, "git", "status", "--porcelain").trim()).toBe("");
  }, 60000);

  test("zero-candidate cleanup sprint: no ticketize/implement/review, UX trio still runs", () => {
    const p = makeProject();
    const r = runLoop(p, ["run", "--cleanup"], {
      SCENARIO_CLEANUP_IDENTIFY: "none",
      ...quietUx,
    });
    expect(r.exitCode).toBe(0);

    const inv = invocations(p);
    expect(inv.some((f) => f.includes("04-cleanup-tickets"))).toBe(false);
    expect(inv.some((f) => f.includes("05-implement"))).toBe(false);
    expect(inv.some((f) => f.includes("05-review"))).toBe(false);
    for (const step of ["05.5-ux-plan", "05.5-ux-test", "05.5-ux-tickets"]) {
      expect(inv.filter((f) => f.includes(step)).length).toBe(1);
    }

    // The report prompt tells the agent the empty result IS the summary.
    const reportPrompt = invocationText(p, inv.find((f) => f.includes("06-report"))!);
    expect(reportPrompt).toContain("nothing worth cleaning");
    expect(readFileSync(join(p.root, "docs/sprint_reports.html"), "utf8")).toContain(
      '<section id="sprint-01">',
    );
  }, 60000);

  test("resume (a): bare NN-cleanup dir → rerun without --cleanup lands on C3", () => {
    const p = makeProject();
    mkdirSync(join(p.root, ".working/sprints/01-cleanup"), { recursive: true });
    const r = runLoop(p, ["run"], quietUx);
    expect(r.exitCode).toBe(0);
    expect(phaseLines(r.stdout)[0]).toContain("step C3 — identify cleanup candidates (sprint 01)");
    expect(r.stdout).not.toContain("step 2");
  }, 60000);

  test("resume (b): spec with 2-yes stamp, no tickets → lands on C4/architecture", () => {
    const p = makeProject();
    makeSprint(p, {
      dirName: "01-cleanup",
      focus: false,
      specContent: "_Candidates: architecture=yes, clean-code=none, docs=yes_\n\n# Cleanup\n",
    });
    const r = runLoop(p, ["run"], quietUx);
    expect(r.exitCode).toBe(0);
    const phases = phaseLines(r.stdout);
    expect(phases[0]).toContain("step C4 — cleanup ticket: architecture");
    // No identify re-run, and clean-code (none) is never ticketized.
    expect(r.stdout).not.toContain("step C3");
    expect(r.stdout).not.toContain("cleanup ticket: clean-code");
    const files = readdirSync(join(p.root, ".working/sprints/01-cleanup/tickets")).sort();
    expect(files).toContain("001-architecture-cleanup.json");
    expect(files).toContain("003-docs-cleanup.json");
    expect(files.some((f) => f.startsWith("002-"))).toBe(false);
  }, 60000);

  test("resume (c): spec + 001- ticket only → lands on C4/docs, 001 not re-run or duplicated", () => {
    const p = makeProject();
    makeSprint(p, {
      dirName: "01-cleanup",
      focus: false,
      specContent: "_Candidates: architecture=yes, clean-code=none, docs=yes_\n\n# Cleanup\n",
      tickets: { "001-architecture-cleanup.json": freshTicket("001") },
    });
    const r = runLoop(p, ["run"], quietUx);
    expect(r.exitCode).toBe(0);
    expect(phaseLines(r.stdout)[0]).toContain("step C4 — cleanup ticket: docs");
    expect(r.stdout).not.toContain("cleanup ticket: architecture");
    const files = readdirSync(join(p.root, ".working/sprints/01-cleanup/tickets"))
      .filter((f) => f.startsWith("001-"));
    expect(files).toEqual(["001-architecture-cleanup.json"]);
  }, 60000);

  test("cadence: two completed sprints on disk → sprint 03 runs as cleanup, 04 as normal", () => {
    const p = makeProject();
    seedCompletedSprint(p, "01-one");
    seedCompletedSprint(p, "02-two");
    writeFileSync(
      join(p.root, "docs/sprint_reports.html"),
      '<main><section id="sprint-01">x</section><section id="sprint-02">x</section></main>',
    );
    writeFileSync(
      join(p.root, ".working/vision_status.md"),
      "_Last updated: sprint 02_\n\n# Vision status\n\n## What exists now\n\nx\n\n" +
        "## What works (verified)\n\nx\n\n## Known gaps\n\nx\n\n## Blocked on human\n\nNothing.\n",
    );
    sh(p.root, "git", "add", "-A");
    sh(p.root, "git", "commit", "-q", "-m", "test: seed completed sprints");

    const r = runLoop(p, ["run", "--max-sprints", "2"], quietUx);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("sprint 03 will be a cleanup sprint");
    const sprints = readdirSync(join(p.root, ".working/sprints")).sort();
    expect(sprints).toContain("03-cleanup");
    expect(sprints).toContain("04-toy-feature");
    expect(r.stdout).toContain("sprint 03 complete (1/2 this run)");
    expect(r.stdout).toContain("sprint 04 complete (2/2 this run)");
  }, 120000);

  test("blocked cleanup ticket → exit 2, remaining sprints halted, report still written", () => {
    const p = makeProject();
    const r = runLoop(p, ["run", "--max-sprints", "2", "--cleanup"], {
      SCENARIO_IMPLEMENT: "blocked",
      ...quietUx,
    });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("human intervention");
    // Halted: no second sprint was started.
    expect(readdirSync(join(p.root, ".working/sprints"))).toEqual(["01-cleanup"]);
    // Report (with its blocked banner input) and vision status were produced.
    expect(readFileSync(join(p.root, "docs/sprint_reports.html"), "utf8")).toContain(
      '<section id="sprint-01">',
    );
    expect(readFileSync(join(p.root, ".working/vision_status.md"), "utf8")).toStartWith(
      "_Last updated: sprint 01_",
    );
  }, 60000);

  test("--cleanup no-op notice: run only finishes an in-progress sprint", () => {
    const p = makeProject();
    // An in-progress normal sprint: one open ticket, nothing else missing.
    makeSprint(p, { tickets: { "001-a.json": freshTicket("001") } });
    const r = runLoop(p, ["run", "--cleanup"], quietUx);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("--cleanup had no effect: no cleanup sprint was created this run");
    expect(readdirSync(join(p.root, ".working/sprints")).some((d) => d.endsWith("-cleanup"))).toBe(
      false,
    );
  }, 60000);
});
