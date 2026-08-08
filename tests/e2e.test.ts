/** Ticket 011: end-to-end dry runs of the whole loop against a toy project,
 * with the fake `claude` emitting canned outputs for every step. */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  gitSubjects,
  invocations,
  invocationText,
  makeProject,
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

    // The exact commit trail, oldest first (spec §6.4 conventions).
    expect(gitSubjects(p).reverse()).toEqual([
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
      "chore(loop): sprint 01 report",
      "chore(loop): sprint 01 vision status",
    ]);

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

  test("blocked ticket → exit 2 → human unblocks with a note → rerun resumes at step 5 and finishes", () => {
    const p = makeProject();

    // Run 1: the single ticket ends blocked.
    const r1 = runLoop(p, ["run"], { SCENARIO_TICKETS_COUNT: "1", SCENARIO_IMPLEMENT: "blocked" });
    expect(r1.exitCode).toBe(2);
    expect(r1.stderr).toContain("human intervention");
    const blocked = readTicket(p, "01-toy-feature", "001-toy-part-1.json");
    expect(blocked.needs_human_intervention).toBe(true);
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
    const r2 = runLoop(p, ["run"], { SCENARIO_TICKETS_COUNT: "1" });
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
  }, 60000);

  test("partially unblocked sprint: remaining blocked ticket still halts with exit 2", () => {
    const p = makeProject();
    const r1 = runLoop(p, ["run"], { SCENARIO_TICKETS_COUNT: "2", SCENARIO_IMPLEMENT: "blocked" });
    expect(r1.exitCode).toBe(2);

    // Human unblocks only ticket 001.
    const t1 = readTicket(p, "01-toy-feature", "001-toy-part-1.json");
    t1.needs_human_intervention = false;
    t1.needs_human_intervention_reason = null;
    t1.human_note = "Go ahead.";
    writeTicketFile(p, "01-toy-feature", "001-toy-part-1.json", t1);

    const r2 = runLoop(p, ["run"], { SCENARIO_TICKETS_COUNT: "2" });
    expect(r2.exitCode).toBe(2);
    expect(readTicket(p, "01-toy-feature", "001-toy-part-1.json").done).toBe(true);
    expect(existsSync(join(p.root, ".working/sprints/02-toy-feature"))).toBe(false);
  }, 60000);
});
