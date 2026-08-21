import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LoopError } from "../scripts/mmm-loop/lib/errors.ts";
import { derivePhase, UX_TICKETIZED_NO, UX_TICKETIZED_YES } from "../scripts/mmm-loop/lib/phases.ts";
import {
  readSnapshot,
  type ProjectSnapshot,
  type SprintSnapshot,
  type TicketFile,
} from "../scripts/mmm-loop/lib/snapshot.ts";
import type { Ticket } from "../scripts/mmm-loop/lib/tickets.ts";
import { freshTicket } from "./helpers.ts";

/** Ticket file for in-memory snapshots; id derived from the filename. */
function tf(filename: string, overrides: Partial<Ticket> = {}): TicketFile {
  const id = /^(\d{3}(?:\.\d)?)/.exec(filename)![1]!;
  return { filename, ticket: freshTicket(id, overrides) };
}

function sprint(dirName: string, o: Partial<SprintSnapshot> = {}): SprintSnapshot {
  return {
    dirName,
    number: dirName.slice(0, 2),
    isCleanup: /^\d{2}-cleanup$/.test(dirName),
    isFeedback: /^\d{2}-feedback$/.test(dirName),
    hasFocus: true,
    focusFirstLine: "# Sprint",
    hasSpec: true,
    specFirstLine: "# Spec",
    hasUxPlan: false,
    uxFindingsFirstLine: null,
    tickets: null,
    ...o,
  };
}

/** Spread into a sprint to mark its UX pass (step 5.5) complete. */
const uxDone = { hasUxPlan: true, uxFindingsFirstLine: UX_TICKETIZED_YES };

function snap(
  sprints: SprintSnapshot[],
  o: { report?: string | null; visionLine?: string | null } = {},
): ProjectSnapshot {
  return {
    sprints,
    reportHtml: o.report ?? null,
    visionStatusFirstLine: o.visionLine ?? "_Last updated: sprint 00_",
  };
}

describe("derivePhase — spec §6.1 table", () => {
  test("no sprints at all → step 2, new sprint 01", () => {
    expect(derivePhase(snap([]))).toEqual({
      step: "sprint-focus",
      sprintNumber: "01",
      reuseDirName: null,
    });
  });

  test("sprint folder without sprint_focus.md → step 2 reusing that folder", () => {
    const phase = derivePhase(snap([sprint("01-mvp", { hasFocus: false })]));
    expect(phase).toEqual({ step: "sprint-focus", sprintNumber: "01", reuseDirName: "01-mvp" });
  });

  test("focus but no spec → step 3", () => {
    const phase = derivePhase(snap([sprint("01-mvp", { hasSpec: false })]));
    expect(phase.step).toBe("spec");
  });

  test("spec but no tickets dir → step 4", () => {
    expect(derivePhase(snap([sprint("01-mvp")])).step).toBe("tickets");
  });

  test("spec but empty tickets dir → step 4", () => {
    expect(derivePhase(snap([sprint("01-mvp", { tickets: [] })])).step).toBe("tickets");
  });

  test("open ticket → step 5 implement, first by filename order", () => {
    const s = sprint("01-mvp", {
      tickets: [tf("001-a.json", { done: true, reviewed: true }), tf("002-b.json"), tf("003-c.json")],
    });
    const phase = derivePhase(snap([s]));
    expect(phase).toMatchObject({ step: "implement", ticketFilename: "002-b.json" });
  });

  test("open fix ticket NNN.1 is picked before NNN+1", () => {
    const s = sprint("01-mvp", {
      tickets: [
        tf("003-x.json", { done: true, reviewed: true }),
        tf("003.1-fix-x.json"),
        tf("004-y.json"),
      ],
    });
    expect(derivePhase(snap([s]))).toMatchObject({
      step: "implement",
      ticketFilename: "003.1-fix-x.json",
    });
  });

  test("done-but-unreviewed ticket → step 5 review of that ticket", () => {
    const s = sprint("01-mvp", { tickets: [tf("001-a.json", { done: true })] });
    expect(derivePhase(snap([s]))).toMatchObject({ step: "review", ticketFilename: "001-a.json" });
  });

  test("earlier review-pending wins over later open ticket (crash resume)", () => {
    const s = sprint("01-mvp", { tickets: [tf("001-a.json", { done: true }), tf("002-b.json")] });
    expect(derivePhase(snap([s]))).toMatchObject({ step: "review", ticketFilename: "001-a.json" });
  });

  test("blocked ticket is skipped; next open one is implemented", () => {
    const s = sprint("01-mvp", {
      tickets: [
        tf("001-a.json", {
          needs_human_intervention: true,
          needs_human_intervention_reason: "stuck",
        }),
        tf("002-b.json"),
      ],
    });
    expect(derivePhase(snap([s]))).toMatchObject({ step: "implement", ticketFilename: "002-b.json" });
  });

  test("all tickets closed + UX pass done, no report section → step 6", () => {
    const s = sprint("01-mvp", {
      tickets: [tf("001-a.json", { done: true, reviewed: true })],
      ...uxDone,
    });
    expect(derivePhase(snap([s], { report: null })).step).toBe("report");
    expect(derivePhase(snap([s], { report: "<html></html>" })).step).toBe("report");
  });

  test("all-blocked tickets count as closed → step 6 (after the UX pass)", () => {
    const s = sprint("01-mvp", {
      tickets: [
        tf("001-a.json", {
          needs_human_intervention: true,
          needs_human_intervention_reason: "stuck",
        }),
      ],
      ...uxDone,
    });
    expect(derivePhase(snap([s])).step).toBe("report");
  });

  test("report present but stale vision stamp → step 7", () => {
    const s = sprint("01-mvp", { tickets: [tf("001-a.json", { done: true, reviewed: true })] });
    const phase = derivePhase(
      snap([s], { report: '<section id="sprint-01">…</section>', visionLine: "_Last updated: sprint 00_" }),
    );
    expect(phase.step).toBe("vision-status");
  });

  test("fully complete sprint → step 2, new sprint NN+1", () => {
    const s = sprint("01-mvp", { tickets: [tf("001-a.json", { done: true, reviewed: true })] });
    const phase = derivePhase(
      snap([s], { report: '<section id="sprint-01">…</section>', visionLine: "_Last updated: sprint 01_" }),
    );
    expect(phase).toEqual({ step: "sprint-focus", sprintNumber: "02", reuseDirName: null });
  });

  test("only the latest sprint is considered", () => {
    const done = sprint("01-mvp", { tickets: [tf("001-a.json", { done: true, reviewed: true })] });
    const fresh = sprint("02-next", { hasFocus: false, hasSpec: false });
    expect(derivePhase(snap([done, fresh]))).toEqual({
      step: "sprint-focus",
      sprintNumber: "02",
      reuseDirName: "02-next",
    });
  });
});

describe("derivePhase — step 5.5 UX rows (spec §8.5.3)", () => {
  const closedTickets = [tf("001-a.json", { done: true, reviewed: true })];

  test("all closed, no plan → 5.5.1; plan but no findings → 5.5.2; findings 'no' → 5.5.3", () => {
    const noPlan = sprint("01-mvp", { tickets: closedTickets });
    expect(derivePhase(snap([noPlan]))).toMatchObject({ step: "ux-plan" });

    const noFindings = sprint("01-mvp", { tickets: closedTickets, hasUxPlan: true });
    expect(derivePhase(snap([noFindings]))).toMatchObject({ step: "ux-test" });

    const unticketized = sprint("01-mvp", {
      tickets: closedTickets,
      hasUxPlan: true,
      uxFindingsFirstLine: UX_TICKETIZED_NO,
    });
    expect(derivePhase(snap([unticketized]))).toMatchObject({ step: "ux-tickets" });
  });

  test("open UX ticket takes precedence over every UX row → implement", () => {
    const s = sprint("01-mvp", {
      tickets: [...closedTickets, tf("004-ux-x.json")],
      ...uxDone,
    });
    expect(derivePhase(snap([s]))).toMatchObject({
      step: "implement",
      ticketFilename: "004-ux-x.json",
    });
  });

  test("open UX fix ticket (004.1) takes precedence → implement", () => {
    const s = sprint("01-mvp", {
      tickets: [
        ...closedTickets,
        tf("004-ux-x.json", { done: true, reviewed: true }),
        tf("004.1-fix-x.json"),
      ],
      ...uxDone,
    });
    expect(derivePhase(snap([s]))).toMatchObject({
      step: "implement",
      ticketFilename: "004.1-fix-x.json",
    });
  });

  test("done-but-unreviewed UX ticket takes precedence → review", () => {
    const s = sprint("01-mvp", {
      tickets: [...closedTickets, tf("004-ux-x.json", { done: true })],
      ...uxDone,
    });
    expect(derivePhase(snap([s]))).toMatchObject({
      step: "review",
      ticketFilename: "004-ux-x.json",
    });
  });

  test("never re-enters 5.5: findings 'yes' + report + current stamp → new sprint", () => {
    const s = sprint("01-mvp", { tickets: closedTickets, ...uxDone });
    const phase = derivePhase(
      snap([s], { report: '<section id="sprint-01">…</section>', visionLine: "_Last updated: sprint 01_" }),
    );
    expect(phase).toEqual({ step: "sprint-focus", sprintNumber: "02", reuseDirName: null });
  });

  test("pre-feature complete sprint (report + stamp, no UX files) → new sprint", () => {
    const s = sprint("01-mvp", { tickets: closedTickets });
    const phase = derivePhase(
      snap([s], { report: '<section id="sprint-01">…</section>', visionLine: "_Last updated: sprint 01_" }),
    );
    expect(phase).toEqual({ step: "sprint-focus", sprintNumber: "02", reuseDirName: null });
  });

  test("pre-feature crashed sprint (report, stale stamp, no UX files) → vision-status, not 5.5", () => {
    const s = sprint("01-mvp", { tickets: closedTickets });
    const phase = derivePhase(
      snap([s], { report: '<section id="sprint-01">…</section>', visionLine: "_Last updated: sprint 00_" }),
    );
    expect(phase.step).toBe("vision-status");
  });

  test("malformed findings stamp → LoopError", () => {
    for (const firstLine of ["_Ticketized: No_", "_ticketized: no_", ""]) {
      const s = sprint("01-mvp", {
        tickets: closedTickets,
        hasUxPlan: true,
        uxFindingsFirstLine: firstLine,
      });
      expect(() => derivePhase(snap([s]))).toThrow(LoopError);
      expect(() => derivePhase(snap([s]))).toThrow(/malformed first line/);
    }
  });

  test("blocked-only sprint with no UX files still gets its UX pass → 5.5.1 (R3 quirk)", () => {
    const s = sprint("01-mvp", {
      tickets: [
        tf("001-a.json", {
          needs_human_intervention: true,
          needs_human_intervention_reason: "stuck",
        }),
      ],
    });
    expect(derivePhase(snap([s]))).toMatchObject({ step: "ux-plan" });
  });
});

describe("derivePhase — cleanup sprints (spec §6.1 cleanup rows)", () => {
  const stamp = (a: string, c: string, d: string) =>
    `_Candidates: architecture=${a}, clean-code=${c}, docs=${d}_`;

  /** A cleanup sprint has no sprint_focus.md; the folder name is the focus. */
  function cleanup(o: Partial<SprintSnapshot> = {}): SprintSnapshot {
    return sprint("03-cleanup", {
      hasFocus: false,
      specFirstLine: stamp("yes", "yes", "yes"),
      ...o,
    });
  }

  test("no spec.md → step C3 (identify), never sprint-focus despite hasFocus false", () => {
    const s = cleanup({ hasSpec: false, specFirstLine: null });
    expect(derivePhase(snap([s]))).toEqual({ step: "cleanup-identify", sprint: s });
  });

  test("malformed stamp → step C3 again (failed postcondition), not a throw", () => {
    for (const firstLine of [
      "# Cleanup spec",
      "_Candidates: architecture=yes_",
      "_Candidates: clean-code=yes, architecture=yes, docs=yes_",
      stamp("yes", "maybe", "none"),
    ]) {
      const s = cleanup({ specFirstLine: firstLine });
      expect(derivePhase(snap([s]))).toEqual({ step: "cleanup-identify", sprint: s });
    }
  });

  test("yes-category without its ticket → step C4 for the first missing, in ID order", () => {
    const noTickets = cleanup({ tickets: [] });
    expect(derivePhase(snap([noTickets]))).toMatchObject({
      step: "cleanup-tickets",
      category: "architecture",
    });

    // Gap case: only 002- exists → architecture (001) is the first missing.
    const gap = cleanup({ tickets: [tf("002-simplify.json")] });
    expect(derivePhase(snap([gap]))).toMatchObject({
      step: "cleanup-tickets",
      category: "architecture",
    });

    const archDone = cleanup({ tickets: [tf("001-restructure.json")] });
    expect(derivePhase(snap([archDone]))).toMatchObject({
      step: "cleanup-tickets",
      category: "clean-code",
    });
  });

  test("a fix ticket (001.1-) does not satisfy its parent category", () => {
    const s = cleanup({
      specFirstLine: stamp("yes", "none", "none"),
      tickets: [tf("001.1-fix.json")],
    });
    expect(derivePhase(snap([s]))).toMatchObject({
      step: "cleanup-tickets",
      category: "architecture",
    });
  });

  test("skipped categories leave gaps: docs-only stamp needs only 003-", () => {
    const missing = cleanup({ specFirstLine: stamp("none", "none", "yes"), tickets: [] });
    expect(derivePhase(snap([missing]))).toMatchObject({
      step: "cleanup-tickets",
      category: "docs",
    });

    const present = cleanup({
      specFirstLine: stamp("none", "none", "yes"),
      tickets: [tf("003-prune-docs.json")],
    });
    expect(derivePhase(snap([present]))).toMatchObject({
      step: "implement",
      ticketFilename: "003-prune-docs.json",
    });
  });

  test("all candidate tickets exist → normal ticket walk (implement/review)", () => {
    const open = cleanup({
      specFirstLine: stamp("yes", "none", "none"),
      tickets: [tf("001-restructure.json")],
    });
    expect(derivePhase(snap([open]))).toMatchObject({
      step: "implement",
      ticketFilename: "001-restructure.json",
    });

    const unreviewed = cleanup({
      specFirstLine: stamp("yes", "none", "none"),
      tickets: [tf("001-restructure.json", { done: true })],
    });
    expect(derivePhase(snap([unreviewed]))).toMatchObject({
      step: "review",
      ticketFilename: "001-restructure.json",
    });
  });

  test("all candidate tickets closed → shared tail: UX pass first, then report", () => {
    const s = cleanup({
      specFirstLine: stamp("yes", "none", "none"),
      tickets: [tf("001-restructure.json", { done: true, reviewed: true })],
    });
    expect(derivePhase(snap([s]))).toMatchObject({ step: "ux-plan" });
    expect(derivePhase(snap([{ ...s, ...uxDone }]))).toMatchObject({ step: "report" });
  });

  test("all-none stamp with zero tickets → UX pass (runs even on empty sprints)", () => {
    const s = cleanup({ specFirstLine: stamp("none", "none", "none"), tickets: [] });
    expect(derivePhase(snap([s]))).toMatchObject({ step: "ux-plan" });
  });

  test("report section present but stale vision stamp → step 7", () => {
    const s = cleanup({ specFirstLine: stamp("none", "none", "none"), tickets: [], ...uxDone });
    const phase = derivePhase(
      snap([s], { report: '<section id="sprint-03">…</section>', visionLine: "_Last updated: sprint 02_" }),
    );
    expect(phase.step).toBe("vision-status");
  });

  test("fully complete cleanup sprint → step 2, new sprint NN+1", () => {
    const s = cleanup({
      specFirstLine: stamp("yes", "none", "none"),
      tickets: [tf("001-restructure.json", { done: true, reviewed: true })],
      ...uxDone,
    });
    const phase = derivePhase(
      snap([sprint("01-a"), sprint("02-b"), s], {
        report: '<section id="sprint-03">…</section>',
        visionLine: "_Last updated: sprint 03_",
      }),
    );
    expect(phase).toEqual({ step: "sprint-focus", sprintNumber: "04", reuseDirName: null });
  });
});

describe("derivePhase — feedback sprints (spec §6.1 feedback rows)", () => {
  const stamp = (actionable: string, visionChange = "no", triaged = "yes") =>
    `_Feedback: triaged=${triaged}, actionable=${actionable}, vision-change=${visionChange}_`;

  /** A feedback sprint's focus file carries the stamp F2 wrote. */
  function feedback(o: Partial<SprintSnapshot> = {}): SprintSnapshot {
    return sprint("01-feedback", { focusFirstLine: stamp("yes"), hasSpec: false, ...o });
  }

  test("no sprint_focus.md → step F2, never sprint-focus", () => {
    const s = feedback({ hasFocus: false, focusFirstLine: null });
    expect(derivePhase(snap([s]))).toEqual({ step: "feedback-focus", sprint: s });
  });

  test("malformed stamp → step F2 again (failed postcondition), not a throw", () => {
    for (const firstLine of [
      "# Sprint 01 — feedback",
      "_Feedback: triaged=no, actionable=yes_",
      "_Feedback: actionable=yes, vision-change=no_",
      stamp("maybe"),
      "_Candidates: architecture=yes, clean-code=none, docs=yes_",
    ]) {
      const s = feedback({ focusFirstLine: firstLine });
      expect(derivePhase(snap([s]))).toEqual({ step: "feedback-focus", sprint: s });
    }
  });

  test("a stamp the orchestrator never accepted (triaged=no) → step F2 again", () => {
    // The agent writes the stamp before the postcondition runs and before
    // the archive, so triaged=no is the only proof F2 finished.
    const s = feedback({ focusFirstLine: stamp("yes", "no", "no") });
    expect(derivePhase(snap([s]))).toEqual({ step: "feedback-focus", sprint: s });
  });

  test("actionable=yes → the normal spec → tickets → tail path", () => {
    const noSpec = feedback();
    expect(derivePhase(snap([noSpec]))).toEqual({ step: "spec", sprint: noSpec });

    const noTickets = feedback({ hasSpec: true });
    expect(derivePhase(snap([noTickets]))).toEqual({ step: "tickets", sprint: noTickets });

    const withTickets = feedback({ hasSpec: true, tickets: [tf("001-fix-it.json")] });
    expect(derivePhase(snap([withTickets]))).toMatchObject({
      step: "implement",
      ticketFilename: "001-fix-it.json",
    });
  });

  test("actionable=none skips spec and tickets → straight to the UX rows", () => {
    const none = feedback({ focusFirstLine: stamp("none", "proposed") });
    expect(derivePhase(snap([none]))).toEqual({ step: "ux-plan", sprint: none });

    // ... and on through the shared tail, exactly like an all-none cleanup.
    const uxTested = feedback({
      focusFirstLine: stamp("none", "proposed"),
      hasUxPlan: true,
      uxFindingsFirstLine: UX_TICKETIZED_YES,
    });
    expect(derivePhase(snap([uxTested]))).toEqual({ step: "report", sprint: uxTested });
  });

  test("a feedback sprint with tickets still reaches the tail after they close", () => {
    const s = feedback({
      hasSpec: true,
      tickets: [tf("001-fix-it.json", { done: true, reviewed: true })],
    });
    expect(derivePhase(snap([s]))).toEqual({ step: "ux-plan", sprint: s });
  });

  test("a completed feedback sprint hands over to a new sprint", () => {
    const s = feedback({
      hasSpec: true,
      tickets: [tf("001-fix-it.json", { done: true, reviewed: true })],
      ...uxDone,
    });
    expect(
      derivePhase(
        snap([s], { report: '<section id="sprint-01">', visionLine: "_Last updated: sprint 01_" }),
      ),
    ).toEqual({ step: "sprint-focus", sprintNumber: "02", reuseDirName: null });
  });
});

describe("readSnapshot", () => {
  test("malformed ticket JSON → LoopError naming the file, never a silent skip", () => {
    const root = mkdtempSync(join(tmpdir(), "mmm-loop-snap-"));
    const dir = join(root, ".working", "sprints", "01-mvp", "tickets");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(root, ".working", "sprints", "01-mvp", "sprint_focus.md"), "x");
    writeFileSync(join(dir, "001-bad.json"), "{ not json");
    expect(() => readSnapshot(root)).toThrow(LoopError);
    expect(() => readSnapshot(root)).toThrow(/001-bad\.json/);
  });

  test("schema-invalid ticket → LoopError naming the file", () => {
    const root = mkdtempSync(join(tmpdir(), "mmm-loop-snap-"));
    const dir = join(root, ".working", "sprints", "01-mvp", "tickets");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "001-bad.json"), JSON.stringify({ id: "001" }));
    expect(() => readSnapshot(root)).toThrow(/001-bad\.json/);
  });

  test("sprints and tickets are sorted; non-matching entries ignored", () => {
    const root = mkdtempSync(join(tmpdir(), "mmm-loop-snap-"));
    for (const d of ["02-second", "01-first", "not-a-sprint"]) {
      mkdirSync(join(root, ".working", "sprints", d), { recursive: true });
    }
    const snapshot = readSnapshot(root);
    expect(snapshot.sprints.map((s) => s.dirName)).toEqual(["01-first", "02-second"]);
  });
});
