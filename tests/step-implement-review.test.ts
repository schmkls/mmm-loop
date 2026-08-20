import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { LoopError } from "../scripts/mmm-loop/lib/errors.ts";
import { derivePhase } from "../scripts/mmm-loop/lib/phases.ts";
import { readSnapshot, readSprint } from "../scripts/mmm-loop/lib/snapshot.ts";
import { stepImplement, stepReview } from "../scripts/mmm-loop/lib/steps.ts";
import type { Ticket } from "../scripts/mmm-loop/lib/tickets.ts";
import {
  BUNDLE_DIR,
  freshTicket,
  gitSubjects,
  invocations,
  invocationText,
  makeProject,
  makeSprint,
  readTicket,
  runLoop,
  sh,
  withFakeClaude,
  writeTicketFile,
  type TestProject,
} from "./helpers.ts";

const ctx = (p: TestProject) => ({ root: p.root, bundleDir: BUNDLE_DIR });

function seedOpenTickets(p: TestProject): void {
  makeSprint(p, {
    tickets: { "001-a.json": freshTicket("001"), "002-b.json": freshTicket("002") },
  });
}

/** A committed code change + a ticket that claims it, ready for review. */
function seedImplemented(p: TestProject, extra: Record<string, Ticket> = {}): string {
  mkdirSync(join(p.root, "src"), { recursive: true });
  appendFileSync(join(p.root, "src/feature-001.txt"), "code\n");
  sh(p.root, "git", "add", "src");
  sh(p.root, "git", "commit", "-q", "-m", "feat(s01/001): implement ticket 001");
  const sha = sh(p.root, "git", "rev-parse", "HEAD").trim();
  makeSprint(p, {
    tickets: {
      "001-a.json": freshTicket("001", {
        done: true,
        tests: [{ description: "ticket 001 works", passes: true }],
        commits: [sha],
      }),
      ...extra,
    },
  });
  return sha;
}

describe("step 5.1 — implement", () => {
  test("happy path: SHAs recorded, status commit, next phase is review", async () => {
    const p = makeProject();
    seedOpenTickets(p);
    await withFakeClaude(p, {}, () =>
      stepImplement(ctx(p), readSprint(p.root, "01-toy"), "001-a.json"),
    );
    const t = readTicket(p, "01-toy", "001-a.json");
    expect(t.done).toBe(true);
    expect(t.tests.every((x) => x.passes)).toBe(true);
    expect(t.commits.length).toBe(1);
    const featSha = sh(p.root, "git", "rev-parse", "HEAD~1").trim();
    expect(t.commits[0]).toBe(featSha);
    const subjects = gitSubjects(p);
    expect(subjects[0]).toBe("chore(loop): sprint 01 ticket 001 status");
    expect(subjects[1]).toBe("feat(s01/001): implement ticket 001");
    expect(derivePhase(readSnapshot(p.root))).toMatchObject({
      step: "review",
      ticketFilename: "001-a.json",
    });
  });

  test("agent flags needs_human_intervention → ticket skipped, loop moves on", async () => {
    const p = makeProject();
    seedOpenTickets(p);
    await withFakeClaude(p, { SCENARIO_IMPLEMENT: "blocked" }, () =>
      stepImplement(ctx(p), readSprint(p.root, "01-toy"), "001-a.json"),
    );
    const t = readTicket(p, "01-toy", "001-a.json");
    expect(t.needs_human_intervention).toBe(true);
    expect(t.needs_human_intervention_reason).toBeTruthy();
    expect(t.done).toBe(false);
    expect(derivePhase(readSnapshot(p.root))).toMatchObject({
      step: "implement",
      ticketFilename: "002-b.json",
    });
  });

  test("agent changes nothing → one retry → error", async () => {
    const p = makeProject();
    seedOpenTickets(p);
    await expect(
      withFakeClaude(p, { SCENARIO_IMPLEMENT: "nothing" }, () =>
        stepImplement(ctx(p), readSprint(p.root, "01-toy"), "001-a.json"),
      ),
    ).rejects.toThrow(LoopError);
    const logs = invocations(p);
    expect(logs.length).toBe(2);
    expect(invocationText(p, logs[1]!)).toContain("changed neither");
  });

  test("human_note appears in the filled prompt", async () => {
    const p = makeProject();
    makeSprint(p, {
      tickets: { "001-a.json": freshTicket("001", { human_note: "USE THE BLUE KEY approach" }) },
    });
    await withFakeClaude(p, {}, () =>
      stepImplement(ctx(p), readSprint(p.root, "01-toy"), "001-a.json"),
    );
    expect(invocationText(p, invocations(p)[0]!)).toContain("USE THE BLUE KEY approach");
  });

  test("cleanup sprint commit types: refactor/docs for category tickets; fix and ux unchanged", async () => {
    const p = makeProject();
    makeSprint(p, {
      dirName: "01-cleanup",
      focus: false,
      specContent: "_Candidates: architecture=yes, clean-code=yes, docs=yes_\n\n# Cleanup\n",
      tickets: {
        "001-restructure.json": freshTicket("001"),
        "001.1-fix-restructure.json": freshTicket("001.1"),
        "002-simplify.json": freshTicket("002"),
        "003-prune-docs.json": freshTicket("003"),
        "004-ux-clearer-output.json": freshTicket("004"),
      },
    });
    const expected: Record<string, string> = {
      "001-restructure.json": "refactor(s01/001)",
      "001.1-fix-restructure.json": "fix(s01/001.1)",
      "002-simplify.json": "refactor(s01/002)",
      "003-prune-docs.json": "docs(s01/003)",
      "004-ux-clearer-output.json": "feat(s01/004)",
    };
    for (const [filename, prefix] of Object.entries(expected)) {
      await withFakeClaude(p, {}, () =>
        stepImplement(ctx(p), readSprint(p.root, "01-cleanup"), filename),
      );
      const t = readTicket(p, "01-cleanup", filename);
      const subject = sh(p.root, "git", "show", "--no-patch", "--format=%s", t.commits[0]!).trim();
      expect(subject).toStartWith(`${prefix}: `);
    }
  });

  test("multiple commits by the agent → all SHAs recorded", async () => {
    const p = makeProject();
    seedOpenTickets(p);
    await withFakeClaude(p, { SCENARIO_IMPLEMENT: "multi" }, () =>
      stepImplement(ctx(p), readSprint(p.root, "01-toy"), "001-a.json"),
    );
    const t = readTicket(p, "01-toy", "001-a.json");
    expect(t.commits.length).toBe(2);
    expect(t.commits).toEqual([
      sh(p.root, "git", "rev-parse", "HEAD~2").trim(),
      sh(p.root, "git", "rev-parse", "HEAD~1").trim(),
    ]);
  });
});

describe("step 5.2 — review", () => {
  test("no findings → reviewed set by orchestrator, nothing else changed", async () => {
    const p = makeProject();
    seedImplemented(p);
    await withFakeClaude(p, {}, () =>
      stepReview(ctx(p), readSprint(p.root, "01-toy"), "001-a.json"),
    );
    const t = readTicket(p, "01-toy", "001-a.json");
    expect(t.reviewed).toBe(true);
    expect(gitSubjects(p)[0]).toBe("chore(loop): sprint 01 ticket 001 reviewed");
    expect(readdirSync(join(p.root, ".working/sprints/01-toy/tickets"))).toEqual(["001-a.json"]);
  });

  test("the recorded diff is in the prompt", async () => {
    const p = makeProject();
    const sha = seedImplemented(p);
    await withFakeClaude(p, {}, () =>
      stepReview(ctx(p), readSprint(p.root, "01-toy"), "001-a.json"),
    );
    const prompt = invocationText(p, invocations(p)[0]!);
    expect(prompt).toContain(sha.slice(0, 7));
    expect(prompt).toContain("feature-001.txt");
  });

  test("fix ticket created → valid, sorts after parent, picked up next", async () => {
    const p = makeProject();
    seedImplemented(p, { "002-b.json": freshTicket("002") });
    await withFakeClaude(p, { SCENARIO_REVIEW: "fix" }, () =>
      stepReview(ctx(p), readSprint(p.root, "01-toy"), "001-a.json"),
    );
    const files = readdirSync(join(p.root, ".working/sprints/01-toy/tickets")).sort();
    expect(files).toEqual(["001-a.json", "001.1-cleanup.json", "002-b.json"]);
    const fix = readTicket(p, "01-toy", "001.1-cleanup.json");
    expect(fix).toMatchObject({ id: "001.1", done: false, reviewed: false });
    expect(derivePhase(readSnapshot(p.root))).toMatchObject({
      step: "implement",
      ticketFilename: "001.1-cleanup.json",
    });
  });

  test("fix ticket already exists → creating another one fails", async () => {
    const p = makeProject();
    seedImplemented(p, { "001.1-cleanup.json": freshTicket("001.1") });
    await expect(
      withFakeClaude(p, { SCENARIO_REVIEW: "always-fix" }, () =>
        stepReview(ctx(p), readSprint(p.root, "01-toy"), "001-a.json"),
      ),
    ).rejects.toThrow(/already exists/);
  });

  test("review of a fix ticket creating a ticket → postcondition fails", async () => {
    const p = makeProject();
    seedImplemented(p, {
      "001.1-cleanup.json": freshTicket("001.1", { done: true }),
    });
    // Parent already reviewed; the fix ticket is the one under review.
    const parent = readTicket(p, "01-toy", "001-a.json");
    parent.reviewed = true;
    writeTicketFile(p, "01-toy", "001-a.json", parent);
    await expect(
      withFakeClaude(p, { SCENARIO_REVIEW: "always-fix" }, () =>
        stepReview(ctx(p), readSprint(p.root, "01-toy"), "001.1-cleanup.json"),
      ),
    ).rejects.toThrow(/must never create/);
  });

  test("review of a fix ticket flagging needs_human_intervention → accepted", async () => {
    const p = makeProject();
    seedImplemented(p, {
      "001.1-cleanup.json": freshTicket("001.1", { done: true }),
    });
    await withFakeClaude(p, { SCENARIO_REVIEW: "flag" }, () =>
      stepReview(ctx(p), readSprint(p.root, "01-toy"), "001.1-cleanup.json"),
    );
    const fix = readTicket(p, "01-toy", "001.1-cleanup.json");
    expect(fix.needs_human_intervention).toBe(true);
    expect(fix.needs_human_intervention_reason).toBeTruthy();
    expect(fix.reviewed).toBe(true);
  });

  test("crash simulation: done+unreviewed on disk → resume runs review, not implement", () => {
    const p = makeProject();
    seedImplemented(p);
    // UX scenarios pinned quiet so no UX ticket triggers a step 5.1 of its own.
    const r = runLoop(p, ["run"], { SCENARIO_UX_TEST: "none", SCENARIO_UX_TICKETS: "zero" });
    expect(r.stdout).toContain("phase: step 5.2 — review 001-a.json");
    expect(r.stdout).not.toContain("phase: step 5.1");
    expect(r.exitCode).toBe(0);
  }, 30000);
});
