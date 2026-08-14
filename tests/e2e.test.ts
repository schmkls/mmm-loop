/** Ticket 011: end-to-end dry runs of the whole loop against a toy project,
 * with the fake `claude` emitting canned outputs for every step. */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  currentBranch,
  freshTicket,
  invocations,
  invocationText,
  localBranches,
  logSubjects,
  makeProject,
  makeSprint,
  readTicket,
  runLoop,
  sh,
  writeTicketFile,
} from "./helpers.ts";

describe("e2e dry run", () => {
  test("full clean sprint → exit 0 with the complete artifact trail", () => {
    const p = makeProject();
    const r = runLoop(p);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("[mmm-loop] done.");

    // Sprint folder + focus + spec.
    const sprints = readdirSync(join(p.root, ".working/sprints"));
    expect(sprints).toEqual(["01-toy-feature"]);
    const dir = join(p.root, ".working/sprints/01-toy-feature");
    expect(readFileSync(join(dir, "sprint_focus.md"), "utf8")).toContain("## Why");
    expect(existsSync(join(dir, "spec.md"))).toBe(true);

    // Tickets: done, reviewed, tests passing, commits recorded.
    for (const filename of ["001-toy-part-1.json", "002-toy-part-2.json"]) {
      const t = readTicket(p, "01-toy-feature", filename);
      expect(t.done).toBe(true);
      expect(t.reviewed).toBe(true);
      expect(t.tests.every((x) => x.passes)).toBe(true);
      expect(t.commits.length).toBe(1);
      const subject = sh(p.root, "git", "show", "--no-patch", "--format=%s", t.commits[0]!).trim();
      expect(subject).toBe(`feat(s01/${t.id}): implement toy part ${Number(t.id)}`);
    }

    // The UX pass: plan + findings (stamped by the orchestrator) + one UX
    // ticket that was implemented and reviewed in the same sprint.
    expect(readFileSync(join(dir, "ux_test_plan.md"), "utf8")).toContain("## Tests");
    expect(readFileSync(join(dir, "ux_findings.md"), "utf8")).toStartWith("_Ticketized: yes_");
    const ticketFiles = readdirSync(join(dir, "tickets")).sort();
    expect(ticketFiles).toEqual([
      "001-toy-part-1.json",
      "002-toy-part-2.json",
      "003-ux-toy-output-confusing.json",
    ]);
    expect(ticketFiles.at(-1)).toMatch(/^\d{3}-ux-[a-z0-9-]+\.json$/);
    const ux = readTicket(p, "01-toy-feature", "003-ux-toy-output-confusing.json");
    expect(ux.done).toBe(true);
    expect(ux.reviewed).toBe(true);

    // Single pass (R3): each UX prompt was invoked exactly once.
    for (const step of ["05.5-ux-plan", "05.5-ux-test", "05.5-ux-tickets"]) {
      expect(invocations(p).filter((f) => f.includes(step)).length).toBe(1);
    }

    // The exact commit trail, oldest first (spec §6.4 conventions). The
    // sprint ran on sprint/01 and was merged back: the --no-ff merge commit
    // closes the trail, and all sprint work is reachable from main.
    expect(logSubjects(p, "main").reverse()).toEqual([
      "chore: scaffold",
      "chore(loop): sprint 01 focus",
      "chore(loop): sprint 01 spec",
      "chore(loop): sprint 01 tickets",
      "feat(s01/001): implement toy part 1",
      "chore(loop): sprint 01 ticket 001 status",
      "chore(loop): sprint 01 ticket 001 reviewed",
      "feat(s01/002): implement toy part 2",
      "chore(loop): sprint 01 ticket 002 status",
      "chore(loop): sprint 01 ticket 002 reviewed",
      "chore(loop): sprint 01 ux plan",
      "chore(loop): sprint 01 ux findings",
      "chore(loop): sprint 01 ux tickets",
      "feat(s01/003): implement toy output confusing",
      "chore(loop): sprint 01 ticket 003 status",
      "chore(loop): sprint 01 ticket 003 reviewed",
      "chore(loop): sprint 01 report",
      "chore(loop): sprint 01 vision status",
      "chore(loop): merge sprint 01",
    ]);

    // Sprint-branch lifecycle (spec §6.4): a real --no-ff merge commit sits
    // on main and no sprint/* branch remains.
    expect(currentBranch(p)).toBe("main");
    expect(localBranches(p)).toEqual(["main"]);
    expect(sh(p.root, "git", "rev-list", "--parents", "-n1", "main").trim().split(" ").length).toBe(
      3,
    );

    // The ux findings commit contains exactly the findings file — the test
    // agent's scratch artifacts must never be committed.
    const findingsCommit = sh(p.root, "git", "log", "--format=%H", "--grep", "ux findings").trim();
    const committed = sh(p.root, "git", "show", "--name-only", "--format=", findingsCommit)
      .trim()
      .split("\n");
    expect(committed).toEqual([".working/sprints/01-toy-feature/ux_findings.md"]);

    // Report + vision status.
    const html = readFileSync(join(p.root, "docs/sprint_reports.html"), "utf8");
    expect(html.split('<section id="sprint-01">').length - 1).toBe(1);
    expect(html).toContain("quiz");
    expect(readFileSync(join(p.root, ".working/vision_status.md"), "utf8")).toStartWith(
      "_Last updated: sprint 01_",
    );

    // Nothing left dirty: the loop commits all its artifacts.
    expect(sh(p.root, "git", "status", "--porcelain").trim()).toBe("");
  }, 60000);

  test("rate-limited step mid-run → one wait, then the identical artifact trail (spec §6.3)", () => {
    const p = makeProject();
    // First claude invocation fakes the usage-limit death (exit 1); waits
    // shrunk so the run sleeps 50ms instead of 30 minutes.
    const r = runLoop(p, ["run"], {
      SCENARIO_RATE_LIMIT: "1",
      MMM_LOOP_RL_DEFAULT_WAIT_MS: "50",
      MMM_LOOP_RL_RESET_MARGIN_MS: "0",
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("[mmm-loop] done.");

    // Exactly one wait line, on stderr.
    const waitLines = r.stderr.split("\n").filter((l) => l.includes("usage limit reached; waiting"));
    expect(waitLines.length).toBe(1);
    expect(waitLines[0]).toMatch(/^\[mmm-loop\] usage limit reached; waiting .+ — resuming at \d{2}:\d{2}$/);

    // The limited attempt was re-spawned: step 2 ran twice, and the run's
    // artifact trail is byte-identical to the plain happy path's — same
    // commits on main, closed by the same sprint merge (spec §6.4).
    expect(invocations(p).filter((f) => f.includes("02-sprint-focus")).length).toBe(2);
    expect(logSubjects(p, "main").reverse()).toEqual([
      "chore: scaffold",
      "chore(loop): sprint 01 focus",
      "chore(loop): sprint 01 spec",
      "chore(loop): sprint 01 tickets",
      "feat(s01/001): implement toy part 1",
      "chore(loop): sprint 01 ticket 001 status",
      "chore(loop): sprint 01 ticket 001 reviewed",
      "feat(s01/002): implement toy part 2",
      "chore(loop): sprint 01 ticket 002 status",
      "chore(loop): sprint 01 ticket 002 reviewed",
      "chore(loop): sprint 01 ux plan",
      "chore(loop): sprint 01 ux findings",
      "chore(loop): sprint 01 ux tickets",
      "feat(s01/003): implement toy output confusing",
      "chore(loop): sprint 01 ticket 003 status",
      "chore(loop): sprint 01 ticket 003 reviewed",
      "chore(loop): sprint 01 report",
      "chore(loop): sprint 01 vision status",
      "chore(loop): merge sprint 01",
    ]);
    expect(readFileSync(join(p.root, "docs/sprint_reports.html"), "utf8")).toContain(
      '<section id="sprint-01">',
    );
  }, 60000);

  test("blocked ticket → exit 2 → human unblocks with a note → rerun resumes at step 5 and finishes", () => {
    const p = makeProject();

    // Run 1: the single ticket ends blocked. UX scenarios pinned to "quiet"
    // so this test stays about blocking, not the UX pass.
    const quietUx = { SCENARIO_UX_TEST: "none", SCENARIO_UX_TICKETS: "zero" };
    const r1 = runLoop(p, ["run"], {
      SCENARIO_TICKETS_COUNT: "1",
      SCENARIO_IMPLEMENT: "blocked",
      ...quietUx,
    });
    expect(r1.exitCode).toBe(2);
    expect(r1.stderr).toContain("human intervention");
    const blocked = readTicket(p, "01-toy-feature", "001-toy-part-1.json");
    expect(blocked.needs_human_intervention).toBe(true);
    // The blocked sprint's branch is left checked out, nothing merged: main
    // has none of the sprint's commits (spec §6.4).
    expect(currentBranch(p)).toBe("sprint/01");
    expect(localBranches(p)).toEqual(["main", "sprint/01"]);
    expect(logSubjects(p, "main")).toEqual(["chore: scaffold"]);
    // Report and vision status were still produced (spec §9).
    expect(readFileSync(join(p.root, "docs/sprint_reports.html"), "utf8")).toContain(
      '<section id="sprint-01">',
    );
    expect(readFileSync(join(p.root, ".working/vision_status.md"), "utf8")).toStartWith(
      "_Last updated: sprint 01_",
    );

    // The human edit (spec §10): unblock + guidance, no commit needed.
    blocked.needs_human_intervention = false;
    blocked.needs_human_intervention_reason = null;
    blocked.human_note = "Please use approach X for the toy.";
    writeTicketFile(p, "01-toy-feature", "001-toy-part-1.json", blocked);

    // Run 2: resumes at step 5.1, does not start a new sprint, exits 0.
    const r2 = runLoop(p, ["run"], { SCENARIO_TICKETS_COUNT: "1", ...quietUx });
    expect(r2.exitCode).toBe(0);
    expect(r2.stdout).toContain("phase: step 5.1 — implement 001-toy-part-1.json");
    expect(r2.stdout).not.toContain("phase: step 2");
    expect(r2.stdout).toContain("sprint 01 complete (1/1 this run)");
    expect(existsSync(join(p.root, ".working/sprints/02-toy-feature"))).toBe(false);

    // The implement prompt carried the human note.
    const implementLogs = invocations(p).filter((f) => f.includes("05-implement"));
    const lastImplement = invocationText(p, implementLogs.at(-1)!);
    expect(lastImplement).toContain("Please use approach X for the toy.");

    const t = readTicket(p, "01-toy-feature", "001-toy-part-1.json");
    expect(t.done).toBe(true);
    expect(t.reviewed).toBe(true);

    // The finished sprint was merged and its branch deleted (spec §6.4).
    expect(currentBranch(p)).toBe("main");
    expect(localBranches(p)).toEqual(["main"]);
    expect(logSubjects(p, "main")).toContain("chore(loop): merge sprint 01");
  }, 60000);

  test("partially unblocked sprint: remaining blocked ticket still halts with exit 2", () => {
    const p = makeProject();
    const quietUx = { SCENARIO_UX_TEST: "none", SCENARIO_UX_TICKETS: "zero" };
    const r1 = runLoop(p, ["run"], {
      SCENARIO_TICKETS_COUNT: "2",
      SCENARIO_IMPLEMENT: "blocked",
      ...quietUx,
    });
    expect(r1.exitCode).toBe(2);

    // Human unblocks only ticket 001.
    const t1 = readTicket(p, "01-toy-feature", "001-toy-part-1.json");
    t1.needs_human_intervention = false;
    t1.needs_human_intervention_reason = null;
    t1.human_note = "Go ahead.";
    writeTicketFile(p, "01-toy-feature", "001-toy-part-1.json", t1);

    const r2 = runLoop(p, ["run"], { SCENARIO_TICKETS_COUNT: "2", ...quietUx });
    expect(r2.exitCode).toBe(2);
    expect(readTicket(p, "01-toy-feature", "001-toy-part-1.json").done).toBe(true);
    expect(existsSync(join(p.root, ".working/sprints/02-toy-feature"))).toBe(false);
  }, 60000);

  test("nothing to test: empty plan → no findings → zero UX tickets → report still runs", () => {
    const p = makeProject();
    const r = runLoop(p, ["run"], {
      SCENARIO_UX_PLAN: "empty",
      SCENARIO_UX_TEST: "none",
      SCENARIO_UX_TICKETS: "zero",
    });
    expect(r.exitCode).toBe(0);
    const dir = join(p.root, ".working/sprints/01-toy-feature");
    expect(readFileSync(join(dir, "ux_findings.md"), "utf8")).toStartWith("_Ticketized: yes_");
    expect(readdirSync(join(dir, "tickets")).some((f) => f.includes("-ux-"))).toBe(false);
    expect(readFileSync(join(p.root, "docs/sprint_reports.html"), "utf8")).toContain(
      '<section id="sprint-01">',
    );
  }, 60000);

  test("crash-resume: findings committed but stamp not flipped → rerun lands in 5.5.3", () => {
    const p = makeProject();
    makeSprint(p, {
      tickets: {
        "001-a.json": freshTicket("001", {
          done: true,
          reviewed: true,
          tests: [{ description: "works", passes: true }],
        }),
      },
      ux: { plan: true, findings: "no" },
    });
    const r = runLoop(p);
    expect(r.exitCode).toBe(0);
    const firstPhase = r.stdout.split("\n").find((l) => l.includes("phase:"));
    expect(firstPhase).toContain("step 5.5.3 — ux ticketize");
    const uxFiles = readdirSync(join(p.root, ".working/sprints/01-toy/tickets")).filter((f) =>
      f.includes("-ux-"),
    );
    expect(uxFiles).toEqual(["002-ux-toy-output-confusing.json"]);
    expect(readFileSync(join(p.root, ".working/sprints/01-toy/ux_findings.md"), "utf8")).toStartWith(
      "_Ticketized: yes_",
    );
  }, 60000);

  test("crash-resume after tickets were created: rerun does not duplicate them", () => {
    const p = makeProject();
    makeSprint(p, {
      tickets: {
        "001-a.json": freshTicket("001", {
          done: true,
          reviewed: true,
          tests: [{ description: "works", passes: true }],
        }),
        // The state after a kill right after 5.5.3 created its ticket but
        // before the orchestrator flipped the stamp.
        "002-ux-toy-output-confusing.json": freshTicket("002", { title: "Toy output confusing" }),
      },
      ux: { plan: true, findings: "no" },
    });
    const r = runLoop(p);
    expect(r.exitCode).toBe(0);
    const uxFiles = readdirSync(join(p.root, ".working/sprints/01-toy/tickets")).filter((f) =>
      f.includes("-ux-"),
    );
    expect(uxFiles).toEqual(["002-ux-toy-output-confusing.json"]);
    expect(readTicket(p, "01-toy", "002-ux-toy-output-confusing.json").done).toBe(true);
  }, 60000);

  test("UX step failing its postcondition twice → exit 1, exactly two attempts", () => {
    const p = makeProject();
    const r = runLoop(p, ["run"], { SCENARIO_UX_PLAN: "nothing" });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("05.5-ux-plan");
    expect(invocations(p).filter((f) => f.includes("05.5-ux-plan")).length).toBe(2);
  }, 60000);

  test("blocked UX ticket → report + vision status still produced → exit 2", () => {
    const p = makeProject();
    const r = runLoop(p, ["run"], { SCENARIO_IMPLEMENT: "blocked-ux" });
    expect(r.exitCode).toBe(2);
    const ux = readTicket(p, "01-toy-feature", "003-ux-toy-output-confusing.json");
    expect(ux.needs_human_intervention).toBe(true);
    expect(ux.needs_human_intervention_reason).toBeTruthy();
    expect(readFileSync(join(p.root, "docs/sprint_reports.html"), "utf8")).toContain(
      '<section id="sprint-01">',
    );
    expect(readFileSync(join(p.root, ".working/vision_status.md"), "utf8")).toStartWith(
      "_Last updated: sprint 01_",
    );
  }, 60000);
});

/** Sprint branches (spec §6.4): each sprint runs on its own `sprint/NN`
 * branch, merged back into main when clean, left checked out when blocked. */
describe("e2e sprint branches", () => {
  const quietUx = { SCENARIO_UX_TEST: "none", SCENARIO_UX_TICKETS: "zero" };

  const phaseLines = (stdout: string) => stdout.split("\n").filter((l) => l.includes("phase:"));

  test("rerun while blocked, without unblocking → exit 2 again, not a new sprint (spec §6.4 merge-or-leave)", () => {
    const p = makeProject();
    const r1 = runLoop(p, ["run"], {
      SCENARIO_TICKETS_COUNT: "1",
      SCENARIO_IMPLEMENT: "blocked",
      ...quietUx,
    });
    expect(r1.exitCode).toBe(2);

    // Rerun with nothing unblocked: the completed-but-blocked sprint must
    // not fall through to new-sprint creation.
    const r2 = runLoop(p, ["run"], { SCENARIO_TICKETS_COUNT: "1", ...quietUx });
    expect(r2.exitCode).toBe(2);
    expect(r2.stdout).not.toContain("phase: step 2");
    // The message offers both options: unblock+rerun, or merge/delete manually.
    expect(r2.stderr).toContain("sprint/01");
    expect(r2.stderr).toContain("unblock");
    expect(r2.stderr).toContain("abandon");
    expect(readdirSync(join(p.root, ".working/sprints"))).toEqual(["01-toy-feature"]);
    expect(currentBranch(p)).toBe("sprint/01");
    expect(logSubjects(p, "main")).toEqual(["chore: scaffold"]);
  }, 60000);

  test("chained --max-sprints 2: two merge commits in order, sprint 02 branched from post-merge main", () => {
    const p = makeProject();
    const r = runLoop(p, ["run", "--max-sprints", "2"], quietUx);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("sprint 01 complete (1/2 this run)");
    expect(r.stdout).toContain("sprint 02 complete (2/2 this run)");

    const subjects = logSubjects(p, "main");
    const merge01 = subjects.indexOf("chore(loop): merge sprint 01");
    const merge02 = subjects.indexOf("chore(loop): merge sprint 02");
    expect(merge01).toBeGreaterThan(-1);
    expect(merge02).toBeGreaterThan(-1);
    expect(merge02).toBeLessThan(merge01); // newest first: 02's merge is later
    expect(subjects.filter((s) => s.startsWith("chore(loop): merge sprint")).length).toBe(2);

    // sprint/02 branched from post-merge main: sprint 01's files are in
    // sprint 02's history (main's second parent is sprint/02's tip).
    expect(
      sh(p.root, "git", "show", "main^2:.working/sprints/01-toy-feature/spec.md"),
    ).toContain("Spec");

    expect(currentBranch(p)).toBe("main");
    expect(localBranches(p)).toEqual(["main"]);
  }, 120000);

  test("resume mid-sprint from main: preflight checks out the sprint branch and the sprint completes", () => {
    const p = makeProject();
    // Run 1 dies mid-sprint (UX plan fails its postcondition twice → exit 1)
    // with focus/spec/tickets/implement/review done on sprint/01.
    const r1 = runLoop(p, ["run"], { SCENARIO_UX_PLAN: "nothing" });
    expect(r1.exitCode).toBe(1);
    expect(currentBranch(p)).toBe("sprint/01");

    // The human (or a fresh shell) is back on main; rerun from there.
    sh(p.root, "git", "checkout", "main");
    const r2 = runLoop(p, ["run"], quietUx);
    expect(r2.exitCode).toBe(0);
    // Preflight checked out sprint/01 and derivation resumed mid-sprint.
    expect(phaseLines(r2.stdout)[0]).toContain("step 5.5.1 — ux plan");
    expect(r2.stdout).not.toContain("phase: step 2");
    expect(logSubjects(p, "main")).toContain("chore(loop): merge sprint 01");
    expect(localBranches(p)).toEqual(["main"]);
  }, 60000);

  test("crash between merge and branch-delete: rerun cleans up with no duplicate merge commit", () => {
    const p = makeProject();
    expect(runLoop(p, ["run"], quietUx).exitCode).toBe(0);
    // Simulate the crash window: the merge landed but the branch survived.
    sh(p.root, "git", "branch", "sprint/01", "main^2");

    // Rerun: preflight checks out the fully-merged branch, the merge re-runs
    // as a no-op, delete proceeds, and the run continues into sprint 02.
    const r = runLoop(p, ["run"], quietUx);
    expect(r.exitCode).toBe(0);
    const subjects = logSubjects(p, "main");
    expect(subjects.filter((s) => s === "chore(loop): merge sprint 01").length).toBe(1);
    expect(subjects.filter((s) => s === "chore(loop): merge sprint 02").length).toBe(1);
    expect(localBranches(p)).toEqual(["main"]);
  }, 120000);

  test("preflight refusal: on a feature branch with no sprint branch → exit 1", () => {
    const p = makeProject();
    sh(p.root, "git", "checkout", "-b", "feature/x");
    const r = runLoop(p);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('"feature/x"');
    expect(r.stderr).toContain('"main"');
    expect(existsSync(join(p.root, ".working/sprints"))).toBe(false);
  }, 60000);

  test("preflight refusal: two sprint branches → exit 1 listing both", () => {
    const p = makeProject();
    sh(p.root, "git", "branch", "sprint/01");
    sh(p.root, "git", "branch", "sprint/02");
    const r = runLoop(p);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("sprint/01");
    expect(r.stderr).toContain("sprint/02");
    expect(existsSync(join(p.root, ".working/sprints"))).toBe(false);
  }, 60000);

  test("preflight refusal: missing BASE_BRANCH → exit 1", () => {
    const p = makeProject();
    sh(p.root, "git", "branch", "-m", "main", "trunk");
    const r = runLoop(p);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('BASE_BRANCH "main"');
  }, 60000);

  test("adoption: pre-feature in-progress sprint on main → sprint/NN created at HEAD, finished there", () => {
    const p = makeProject();
    // A pre-feature project: the in-progress sprint's state lives on main.
    makeSprint(p, { tickets: { "001-a.json": freshTicket("001") } });
    const r = runLoop(p, ["run"], quietUx);
    expect(r.exitCode).toBe(0);
    // Resumed mid-sprint (no step 2) and moved onto a branch from here on.
    expect(phaseLines(r.stdout)[0]).toContain("step 5.1 — implement 001-a.json");
    expect(r.stdout).not.toContain("phase: step 2");
    const subjects = logSubjects(p, "main");
    expect(subjects).toContain("chore(loop): merge sprint 01");
    // The remaining work really went through the branch: the merge commit
    // has two parents.
    expect(sh(p.root, "git", "rev-list", "--parents", "-n1", "main").trim().split(" ").length).toBe(
      3,
    );
    expect(currentBranch(p)).toBe("main");
    expect(localBranches(p)).toEqual(["main"]);
  }, 60000);

  test("merge conflict with a human commit on main → exit 1, merge aborted, nothing half-merged", () => {
    const p = makeProject();
    // A completed, clean sprint on sprint/01 …
    sh(p.root, "git", "checkout", "-b", "sprint/01");
    makeSprint(p, {
      tickets: {
        "001-a.json": freshTicket("001", {
          done: true,
          reviewed: true,
          tests: [{ description: "works", passes: true }],
        }),
      },
      ux: { plan: true, findings: "yes" },
    });
    writeFileSync(
      join(p.root, "docs/sprint_reports.html"),
      '<main><section id="sprint-01">x</section></main>',
    );
    writeFileSync(
      join(p.root, ".working/vision_status.md"),
      "_Last updated: sprint 01_\n\n# Vision status\n\n## What exists now\n\nx\n",
    );
    writeFileSync(join(p.root, "shared.txt"), "sprint version\n");
    sh(p.root, "git", "add", "-A");
    sh(p.root, "git", "commit", "-q", "-m", "test: complete sprint 01 on its branch");
    // … and a colliding human commit on main.
    sh(p.root, "git", "checkout", "main");
    writeFileSync(join(p.root, "shared.txt"), "human version\n");
    sh(p.root, "git", "add", "-A");
    sh(p.root, "git", "commit", "-q", "-m", "human: conflicting change");

    const r = runLoop(p);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("conflict");
    expect(r.stderr).toContain("manually");
    // The abort ran: no merge in progress, clean tree, branch left for the human.
    expect(existsSync(join(p.root, ".git/MERGE_HEAD"))).toBe(false);
    expect(sh(p.root, "git", "status", "--porcelain").trim()).toBe("");
    expect(currentBranch(p)).toBe("main");
    expect(localBranches(p)).toEqual(["main", "sprint/01"]);
  }, 60000);
});
