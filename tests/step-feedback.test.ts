/** Step F2 (triage feedback), run in-process against the fake `claude`
 * (scenario 02-feedback-focus) — spec §8.9. */

import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LoopError } from "../scripts/mmm-loop/lib/errors.ts";
import { parseFeedbackStamp } from "../scripts/mmm-loop/lib/feedback.ts";
import { derivePhase } from "../scripts/mmm-loop/lib/phases.ts";
import { readSnapshot, readSprint } from "../scripts/mmm-loop/lib/snapshot.ts";
import { stepFeedbackFocus } from "../scripts/mmm-loop/lib/steps.ts";
import {
  BUNDLE_DIR,
  feedbackFiles,
  gitSubjects,
  invocations,
  invocationText,
  makeProject,
  seedFeedback,
  sh,
  withFakeClaude,
  type TestProject,
} from "./helpers.ts";

const ctx = (p: TestProject) => ({ root: p.root, bundleDir: BUNDLE_DIR });

const ITEMS: Record<string, string> = {
  "a-slow-cli.md": "The CLI takes 20 seconds to print help. That is absurd.",
  "b-wrong-product.md": "I never asked for a web UI. Build the API instead.",
};

/** The orchestrator-made state: a bare NN-feedback folder, no agent ran yet,
 * with feedback waiting in the inbox. */
function seedFeedbackSprint(p: TestProject, items: Record<string, string> = ITEMS): void {
  mkdirSync(join(p.root, ".working/sprints/01-feedback"), { recursive: true });
  seedFeedback(p, items);
}

const focusText = (p: TestProject) =>
  readFileSync(join(p.root, ".working/sprints/01-feedback/sprint_focus.md"), "utf8");

const focusStamp = (p: TestProject) => parseFeedbackStamp(focusText(p).split("\n")[0]!);

const runF2 = (p: TestProject, env: Record<string, string> = {}) =>
  withFakeClaude(p, env, () => stepFeedbackFocus(ctx(p), readSprint(p.root, "01-feedback")));

describe("step F2 — triage feedback", () => {
  test("happy path: stamped focus, inbox archived, one commit, then step 3", async () => {
    const p = makeProject();
    seedFeedbackSprint(p);
    await runF2(p);

    // The orchestrator flipped triaged; the agent's own keys are untouched.
    expect(focusStamp(p)).toEqual({ triaged: "yes", actionable: "yes", visionChange: "no" });
    for (const name of Object.keys(ITEMS)) expect(focusText(p)).toContain(name);

    // The archive move is the orchestrator's, committed with the focus.
    expect(feedbackFiles(p, "inbox")).toEqual([]);
    expect(feedbackFiles(p, "handled")).toEqual(["01-a-slow-cli.md", "01-b-wrong-product.md"]);
    expect(readFileSync(join(p.root, "docs/feedback/handled/01-a-slow-cli.md"), "utf8")).toBe(
      ITEMS["a-slow-cli.md"]!,
    );
    expect(gitSubjects(p)[0]).toBe("chore(loop): sprint 01 feedback focus");
    expect(sh(p.root, "git", "status", "--porcelain").trim()).toBe("");

    expect(derivePhase(readSnapshot(p.root))).toMatchObject({ step: "spec" });
  });

  test("the prompt carries every item's path and full text", async () => {
    const p = makeProject();
    seedFeedbackSprint(p);
    await runF2(p);

    const prompt = invocationText(p, invocations(p)[0]!);
    for (const [name, text] of Object.entries(ITEMS)) {
      // Heading = bare filename (the form the focus must reuse), path below.
      expect(prompt).toContain(`### ${name}`);
      expect(prompt).toContain(`_docs/feedback/inbox/${name}_`);
      expect(prompt).toContain(text);
    }
    expect(prompt).toContain("Feedback items to triage: 2");
    // The triage is planned from feedback, not from the vision.
    expect(prompt).toContain("not** from `docs/vision.md`");
  });

  test("actionable=none skips spec and tickets — the tail takes over", async () => {
    const p = makeProject();
    seedFeedbackSprint(p);
    await runF2(p, { SCENARIO_FEEDBACK: "none" });
    expect(focusStamp(p)).toEqual({
      triaged: "yes",
      actionable: "none",
      visionChange: "proposed",
    });
    expect(feedbackFiles(p, "handled")).toHaveLength(2);
    expect(derivePhase(readSnapshot(p.root))).toMatchObject({ step: "ux-plan" });
  });

  test("a dropped item fails the postcondition twice → the inbox is left alone", async () => {
    const p = makeProject();
    seedFeedbackSprint(p);
    const run = runF2(p, { SCENARIO_FEEDBACK: "drop-item" });
    await expect(run).rejects.toThrow(LoopError);
    await expect(run).rejects.toThrow(/b-wrong-product\.md/);
    expect(invocations(p)).toHaveLength(2); // one retry, spec §6.3
    expect(feedbackFiles(p, "inbox")).toEqual(Object.keys(ITEMS).sort());
    expect(feedbackFiles(p, "handled")).toEqual([]);
    expect(gitSubjects(p)[0]).not.toBe("chore(loop): sprint 01 feedback focus");

    // ... and the rejected focus, stamped by the agent but never accepted,
    // must not let derivation walk past F2 (that would ship a "feedback
    // sprint" that triaged nothing).
    expect(focusStamp(p)!.triaged).toBe("no");
    expect(derivePhase(readSnapshot(p.root))).toMatchObject({ step: "feedback-focus" });
  });

  test("an agent-written triaged=yes is rejected and taken back off the file", async () => {
    const p = makeProject();
    seedFeedbackSprint(p);
    await expect(runF2(p, { SCENARIO_FEEDBACK: "triaged" })).rejects.toThrow(
      /"triaged" is orchestrator-owned/,
    );
    expect(feedbackFiles(p, "inbox")).toHaveLength(2);
    // The rejected focus survives for a human to read, but must not wear the
    // orchestrator's flip — or the next run would skip the failed triage.
    expect(focusStamp(p)!.triaged).toBe("no");
    expect(derivePhase(readSnapshot(p.root))).toMatchObject({ step: "feedback-focus" });
  });

  test("a triage that edits docs/vision.md fails the step", async () => {
    const p = makeProject();
    seedFeedbackSprint(p);
    await expect(runF2(p, { SCENARIO_FEEDBACK: "applies" })).rejects.toThrow(
      /docs\/vision\.md was modified; propose a vision change/,
    );
    expect(feedbackFiles(p, "handled")).toEqual([]);
  });

  test("actionable=yes with nothing in-vision is rejected as busywork", async () => {
    const p = makeProject();
    seedFeedbackSprint(p);
    await expect(runF2(p, { SCENARIO_FEEDBACK: "busywork" })).rejects.toThrow(
      /actionable=yes, but no item is dispositioned in-vision/,
    );
  });

  test("a project that gitignores its feedback still completes the step", async () => {
    const p = makeProject();
    seedFeedbackSprint(p);
    writeFileSync(join(p.root, ".gitignore"), "docs/feedback/\n");
    sh(p.root, "git", "rm", "-r", "-q", "--cached", "docs/feedback");
    sh(p.root, "git", "add", "-A");
    sh(p.root, "git", "commit", "-q", "-m", "test: keep feedback out of git");

    await runF2(p);
    expect(feedbackFiles(p, "handled")).toHaveLength(2); // archived on disk
    expect(gitSubjects(p)[0]).toBe("chore(loop): sprint 01 feedback focus");
    expect(sh(p.root, "git", "status", "--porcelain").trim()).toBe("");
  });

  test("a stamp that contradicts its own dispositions is rejected", async () => {
    const p = makeProject();
    seedFeedbackSprint(p);
    await expect(runF2(p, { SCENARIO_FEEDBACK: "liar" })).rejects.toThrow(
      /actionable=none, but an item is dispositioned in-vision/,
    );
  });

  test("an agent that writes into docs/feedback/ fails the step", async () => {
    const p = makeProject();
    seedFeedbackSprint(p);
    await expect(runF2(p, { SCENARIO_FEEDBACK: "meddle" })).rejects.toThrow(
      /agent-added\.md was created/,
    );
    // Nothing was archived, so the agent's file cannot hand it a sprint.
    expect(feedbackFiles(p, "handled")).toEqual([]);
  });

  test("an archive name already taken is kept, not overwritten", async () => {
    const p = makeProject();
    seedFeedbackSprint(p, { "only.md": "New words." });
    mkdirSync(join(p.root, "docs/feedback/handled"), { recursive: true });
    writeFileSync(join(p.root, "docs/feedback/handled/01-only.md"), "Older words.");
    await runF2(p);
    expect(feedbackFiles(p, "handled")).toEqual(["01-only-2.md", "01-only.md"]);
    expect(readFileSync(join(p.root, "docs/feedback/handled/01-only.md"), "utf8")).toBe(
      "Older words.",
    );
  });

  test("an inbox emptied after the sprint was created needs no agent at all", async () => {
    const p = makeProject();
    mkdirSync(join(p.root, ".working/sprints/01-feedback"), { recursive: true });
    await runF2(p);
    expect(invocations(p)).toEqual([]); // nothing to triage, nothing spawned
    expect(focusStamp(p)).toEqual({ triaged: "yes", actionable: "none", visionChange: "no" });
    expect(focusText(p)).toContain("inbox was empty");
    expect(gitSubjects(p)[0]).toBe("chore(loop): sprint 01 feedback focus");
    expect(derivePhase(readSnapshot(p.root))).toMatchObject({ step: "ux-plan" });
  });

  test("a garbled stamp is fixed on the retry, and the archive still happens", async () => {
    const p = makeProject();
    seedFeedbackSprint(p);
    await runF2(p, { SCENARIO_FEEDBACK: "retry-ok" });
    expect(invocations(p)).toHaveLength(2);
    expect(invocationText(p, invocations(p)[1]!)).toContain("PREVIOUS ATTEMPT FAILED");
    expect(feedbackFiles(p, "inbox")).toEqual([]);
    expect(feedbackFiles(p, "handled")).toHaveLength(2);
  });

  test("one item is triaged and archived just the same", async () => {
    const p = makeProject();
    seedFeedbackSprint(p, { "only.md": "Please make the errors readable." });
    await runF2(p);
    expect(invocationText(p, invocations(p)[0]!)).toContain("Feedback items to triage: 1");
    expect(feedbackFiles(p, "handled")).toEqual(["01-only.md"]);
  });
});
