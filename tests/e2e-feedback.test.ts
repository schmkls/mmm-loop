/** End-to-end dry runs of feedback sprints: the real CLI against throwaway
 * git projects with the fake `claude` (spec §5, §6.1, §8.9). */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  currentBranch,
  feedbackFiles,
  invocations,
  invocationText,
  localBranches,
  logSubjects,
  makeProject,
  readTicket,
  runLoop,
  seedFeedback,
  writeTicketFile,
  type TestProject,
} from "./helpers.ts";

/** Pin the UX pass quiet where the test is about feedback, not UX. */
const quietUx = { SCENARIO_UX_TEST: "none", SCENARIO_UX_TICKETS: "zero" };

const phaseLines = (stdout: string) => stdout.split("\n").filter((l) => l.includes("phase:"));

const ITEMS: Record<string, string> = {
  "slow-cli.md": "# Slow CLI\n\nThe CLI takes 20 seconds to print help.\n",
  "wrong-product.md": "# Wrong product\n\nI never asked for a web UI.\n",
};

function withFeedback(items: Record<string, string> = ITEMS): TestProject {
  const p = makeProject();
  seedFeedback(p, items);
  return p;
}

describe("e2e feedback sprints", () => {
  test("a non-empty inbox turns the next sprint into a feedback sprint", () => {
    const p = withFeedback();
    const r = runLoop(p, ["run"], quietUx);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("sprint 01 will handle feedback (2 items)");

    // The folder is NN-feedback, and its focus carries the stamp.
    expect(readdirSync(join(p.root, ".working/sprints"))).toEqual(["01-feedback"]);
    const dir = join(p.root, ".working/sprints/01-feedback");
    const focus = readFileSync(join(dir, "sprint_focus.md"), "utf8");
    // Stamped by the agent, flipped to triaged=yes by the orchestrator.
    expect(focus).toStartWith("_Feedback: triaged=yes, actionable=yes, vision-change=no_");
    for (const name of Object.keys(ITEMS)) expect(focus).toContain(name);

    // The inbox is archived under the handling sprint's number.
    expect(feedbackFiles(p, "inbox")).toEqual([]);
    expect(feedbackFiles(p, "handled")).toEqual(["01-slow-cli.md", "01-wrong-product.md"]);
    expect(readFileSync(join(p.root, "docs/feedback/handled/01-slow-cli.md"), "utf8")).toBe(
      ITEMS["slow-cli.md"],
    );

    // Actionable feedback runs the normal spec → tickets → tail machinery.
    expect(existsSync(join(dir, "spec.md"))).toBe(true);
    expect(readdirSync(join(dir, "tickets")).length).toBeGreaterThan(0);
    expect(readFileSync(join(p.root, "docs/sprint_reports.html"), "utf8")).toContain(
      '<section id="sprint-01">',
    );
    expect(readFileSync(join(p.root, ".working/vision_status.md"), "utf8")).toStartWith(
      "_Last updated: sprint 01_",
    );

    // Step F2 replaced step 2; the sprint merged like any other.
    const phases = phaseLines(r.stdout);
    expect(phases.some((l) => l.includes("step F2 — triage feedback (sprint 01)"))).toBe(true);
    expect(phases.some((l) => l.includes("step 2 —"))).toBe(false);
    expect(localBranches(p)).toEqual(["main"]);
    const subjects = logSubjects(p, "main");
    expect(subjects).toContain("chore(loop): sprint 01 feedback focus");
    expect(subjects).toContain("chore(loop): sprint 01 spec");
    expect(subjects).toContain("chore(loop): merge sprint 01");
    expect(subjects).not.toContain("chore(loop): sprint 01 focus");
    // The triage outcome is reported to whoever is watching the run.
    expect(r.stdout).toContain("sprint 01 feedback: 2 in-vision");
  }, 60000);

  test("actionable=none skips spec and tickets but still reports", () => {
    const p = withFeedback();
    const r = runLoop(p, ["run"], { ...quietUx, SCENARIO_FEEDBACK: "none" });
    expect(r.exitCode).toBe(0);

    const dir = join(p.root, ".working/sprints/01-feedback");
    expect(existsSync(join(dir, "spec.md"))).toBe(false);
    expect(existsSync(join(dir, "tickets"))).toBe(false);
    expect(feedbackFiles(p, "handled")).toHaveLength(2);

    const phases = phaseLines(r.stdout);
    expect(phases.some((l) => l.includes("step 3 —"))).toBe(false);
    expect(phases.some((l) => l.includes("step 4 —"))).toBe(false);
    // The tail runs unchanged: UX pass, report, vision status.
    expect(phases.some((l) => l.includes("step 5.5.1"))).toBe(true);
    expect(readFileSync(join(p.root, "docs/sprint_reports.html"), "utf8")).toContain(
      '<section id="sprint-01">',
    );
    expect(readFileSync(join(p.root, ".working/vision_status.md"), "utf8")).toStartWith(
      "_Last updated: sprint 01_",
    );

    // The report agent is told what the triage decided — including the
    // vision change only a human can accept.
    const reportPrompt = invocationText(
      p,
      invocations(p).find((f) => f.includes("06-report"))!,
    );
    expect(reportPrompt).toContain("was a feedback sprint");
    expect(reportPrompt).toContain("2 vision-change");
    expect(reportPrompt).toContain("proposes a change to `docs/vision.md`");
    expect(reportPrompt).toContain("nothing actionable");
    expect(r.stdout).toContain("a vision change is proposed for you");
  }, 60000);

  test("feedback outranks --cleanup, which stays pending for the next sprint", () => {
    const p = withFeedback();
    const r = runLoop(p, ["run", "--max-sprints", "2", "--cleanup"], quietUx);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("sprint 01 will handle feedback");
    expect(r.stdout).toContain("sprint 02 will be a cleanup sprint");
    expect(readdirSync(join(p.root, ".working/sprints")).sort()).toEqual([
      "01-feedback",
      "02-cleanup",
    ]);
  }, 120000);

  test("the flag notice is accurate when feedback preempted the only sprint", () => {
    const p = withFeedback();
    const r = runLoop(p, ["run", "--cleanup"], quietUx);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("--cleanup had no effect: no cleanup sprint was created this run");
  }, 60000);

  test("non-items in the inbox never trigger a feedback sprint", () => {
    const p = makeProject();
    writeFileSync(join(p.root, "docs/feedback/inbox/notes.txt"), "not markdown");
    writeFileSync(join(p.root, "docs/feedback/inbox/empty.md"), "");
    const r = runLoop(p, ["run"], quietUx);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).not.toContain("will handle feedback");
    expect(readdirSync(join(p.root, ".working/sprints"))).toEqual(["01-toy-feature"]);
  }, 60000);

  test("feedback dropped after a sprint starts is picked up at the next boundary", () => {
    const p = makeProject();
    // Sprint 01 is a normal sprint (empty inbox at its boundary)...
    expect(runLoop(p, ["run"], quietUx).exitCode).toBe(0);
    expect(readdirSync(join(p.root, ".working/sprints"))).toEqual(["01-toy-feature"]);

    // ... the human then drops feedback, and the next run picks it up.
    seedFeedback(p, { "late.md": "The output is unreadable." });
    const r = runLoop(p, ["run"], quietUx);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("sprint 02 will handle feedback (1 item)");
    expect(feedbackFiles(p, "handled")).toEqual(["02-late.md"]);
    expect(readdirSync(join(p.root, ".working/sprints")).sort()).toEqual([
      "01-toy-feature",
      "02-feedback",
    ]);
  }, 120000);

  test("a killed run resumes into F2 with the inbox intact", () => {
    const p = withFeedback();
    // First run dies inside F2 (the fake writes nothing): the inbox is
    // untouched, so the rerun re-triages exactly the same items.
    const first = runLoop(p, ["run"], { ...quietUx, SCENARIO_FEEDBACK: "nothing" });
    expect(first.exitCode).toBe(1);
    expect(feedbackFiles(p, "inbox")).toEqual(["slow-cli.md", "wrong-product.md"]);
    expect(existsSync(join(p.root, ".working/sprints/01-feedback"))).toBe(true);

    const second = runLoop(p, ["run"], quietUx);
    expect(second.exitCode).toBe(0);
    expect(phaseLines(second.stdout)[0]).toContain("step F2");
    expect(feedbackFiles(p, "inbox")).toEqual([]);
    expect(feedbackFiles(p, "handled")).toHaveLength(2);
  }, 60000);

  test("a rerun after a rejected triage re-triages — it never walks past F2", () => {
    const p = withFeedback();
    // The agent stamps the focus before the postcondition judges it, so a
    // rejected triage leaves a stamped file on disk. Only the orchestrator's
    // triaged=yes flip may let derivation move on.
    const first = runLoop(p, ["run"], { ...quietUx, SCENARIO_FEEDBACK: "drop-item" });
    expect(first.exitCode).toBe(1);
    expect(
      readFileSync(join(p.root, ".working/sprints/01-feedback/sprint_focus.md"), "utf8"),
    ).toStartWith("_Feedback: triaged=no,");

    const second = runLoop(p, ["run"], quietUx);
    expect(second.exitCode).toBe(0);
    expect(phaseLines(second.stdout)[0]).toContain("step F2");
    expect(feedbackFiles(p, "handled")).toEqual(["01-slow-cli.md", "01-wrong-product.md"]);
    expect(logSubjects(p, "main")).toContain("chore(loop): sprint 01 feedback focus");
  }, 60000);

  test("an agent that stamps itself triaged does not make the next run skip F2", () => {
    const p = withFeedback();
    const first = runLoop(p, ["run"], { ...quietUx, SCENARIO_FEEDBACK: "triaged" });
    expect(first.exitCode).toBe(1);
    expect(feedbackFiles(p, "inbox")).toEqual(["slow-cli.md", "wrong-product.md"]);

    // Same feedback, same sprint: the rerun re-triages rather than walking
    // into step 3 on a focus the loop rejected.
    const second = runLoop(p, ["run"], quietUx);
    expect(second.exitCode).toBe(0);
    expect(phaseLines(second.stdout)[0]).toContain("step F2");
    expect(readdirSync(join(p.root, ".working/sprints"))).toEqual(["01-feedback"]);
    expect(feedbackFiles(p, "handled")).toEqual(["01-slow-cli.md", "01-wrong-product.md"]);
  }, 60000);

  test("a blocked feedback sprint exits 2 without re-triggering on its own feedback", () => {
    const p = withFeedback({ "one.md": "Fix the thing." });
    const first = runLoop(p, ["run"], {
      ...quietUx,
      SCENARIO_TICKETS_COUNT: "1",
      SCENARIO_IMPLEMENT: "blocked",
    });
    expect(first.exitCode).toBe(2);
    // Archived at triage, so the halted sprint cannot feed itself.
    expect(feedbackFiles(p, "inbox")).toEqual([]);
    expect(feedbackFiles(p, "handled")).toEqual(["01-one.md"]);
    expect(currentBranch(p)).toBe("sprint/01");

    // Rerunning while still blocked exits 2 again — no sprint 02, no
    // second triage of the same item.
    expect(runLoop(p, ["run"], { ...quietUx, SCENARIO_TICKETS_COUNT: "1" }).exitCode).toBe(2);
    expect(readdirSync(join(p.root, ".working/sprints"))).toEqual(["01-feedback"]);

    // A human unblocks; the sprint finishes and merges like any other.
    const blocked = readdirSync(join(p.root, ".working/sprints/01-feedback/tickets")).sort()[0]!;
    const ticket = readTicket(p, "01-feedback", blocked);
    writeTicketFile(p, "01-feedback", blocked, {
      ...ticket,
      needs_human_intervention: false,
      needs_human_intervention_reason: null,
      human_note: "Do it this way instead.",
    });
    const third = runLoop(p, ["run"], { ...quietUx, SCENARIO_TICKETS_COUNT: "1" });
    expect(third.exitCode).toBe(0);
    expect(localBranches(p)).toEqual(["main"]);
    expect(logSubjects(p, "main")).toContain("chore(loop): merge sprint 01");
  }, 120000);
});
