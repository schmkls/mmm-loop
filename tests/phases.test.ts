import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LoopError } from "../scripts/mmm-loop/lib/errors.ts";
import { derivePhase } from "../scripts/mmm-loop/lib/phases.ts";
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
  return { dirName, number: dirName.slice(0, 2), hasFocus: true, hasSpec: true, tickets: null, ...o };
}

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

  test("all tickets closed, no report section → step 6", () => {
    const s = sprint("01-mvp", { tickets: [tf("001-a.json", { done: true, reviewed: true })] });
    expect(derivePhase(snap([s], { report: null })).step).toBe("report");
    expect(derivePhase(snap([s], { report: "<html></html>" })).step).toBe("report");
  });

  test("all-blocked tickets count as closed → step 6", () => {
    const s = sprint("01-mvp", {
      tickets: [
        tf("001-a.json", {
          needs_human_intervention: true,
          needs_human_intervention_reason: "stuck",
        }),
      ],
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
