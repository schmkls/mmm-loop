/** Steps C3 (identify) and C4 (ticketize) plus the reserved-slug guard, run
 * in-process against the fake `claude` (scenarios 03-cleanup-identify /
 * 04-cleanup-tickets). */

import { describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCandidatesStamp } from "../scripts/mmm-loop/lib/cleanup.ts";
import { LoopError } from "../scripts/mmm-loop/lib/errors.ts";
import { derivePhase } from "../scripts/mmm-loop/lib/phases.ts";
import { readSnapshot, readSprint } from "../scripts/mmm-loop/lib/snapshot.ts";
import {
  stepCleanupIdentify,
  stepCleanupTickets,
  stepSprintFocus,
} from "../scripts/mmm-loop/lib/steps.ts";
import {
  BUNDLE_DIR,
  gitSubjects,
  invocations,
  invocationText,
  makeProject,
  makeSprint,
  withFakeClaude,
  type TestProject,
} from "./helpers.ts";

const ctx = (p: TestProject) => ({ root: p.root, bundleDir: BUNDLE_DIR });

const STAMP_ALL = "_Candidates: architecture=yes, clean-code=yes, docs=yes_";
const STAMP_DOCS_ONLY = "_Candidates: architecture=none, clean-code=none, docs=yes_";

/** The orchestrator-made state: a bare NN-cleanup folder, no agent ran yet. */
function seedCleanupDir(p: TestProject, dirName = "01-cleanup"): void {
  mkdirSync(join(p.root, ".working/sprints", dirName), { recursive: true });
}

/** Cleanup sprint with a committed spec, ready for C4. */
function seedCleanupSpec(p: TestProject, specFirstLine: string): void {
  makeSprint(p, {
    dirName: "01-cleanup",
    focus: false,
    specContent: `${specFirstLine}\n\n# Cleanup spec — seeded\n`,
  });
}

const ticketsDir = (p: TestProject) => join(p.root, ".working/sprints/01-cleanup/tickets");

describe("step C3 — identify cleanup candidates", () => {
  test("happy path: 3-candidate stamp + body sections, committed as the sprint spec", async () => {
    const p = makeProject();
    seedCleanupDir(p);
    await withFakeClaude(p, {}, () =>
      stepCleanupIdentify(ctx(p), readSprint(p.root, "01-cleanup")),
    );
    const spec = readFileSync(join(p.root, ".working/sprints/01-cleanup/spec.md"), "utf8");
    expect(parseCandidatesStamp(spec.split("\n")[0]!)).toEqual({
      architecture: "yes",
      "clean-code": "yes",
      docs: "yes",
    });
    expect(spec).toContain("## architecture");
    expect(gitSubjects(p)[0]).toBe("chore(loop): sprint 01 spec");
    expect(derivePhase(readSnapshot(p.root))).toMatchObject({
      step: "cleanup-tickets",
      category: "architecture",
    });
  });

  test("1-candidate and 0-candidate stamps are valid outcomes", async () => {
    const docsOnly = makeProject();
    seedCleanupDir(docsOnly);
    await withFakeClaude(docsOnly, { SCENARIO_CLEANUP_IDENTIFY: "docs-only" }, () =>
      stepCleanupIdentify(ctx(docsOnly), readSprint(docsOnly.root, "01-cleanup")),
    );
    expect(derivePhase(readSnapshot(docsOnly.root))).toMatchObject({
      step: "cleanup-tickets",
      category: "docs",
    });

    const none = makeProject();
    seedCleanupDir(none);
    await withFakeClaude(none, { SCENARIO_CLEANUP_IDENTIFY: "none" }, () =>
      stepCleanupIdentify(ctx(none), readSprint(none.root, "01-cleanup")),
    );
    // Zero candidates → straight to the shared tail's UX rows, zero tickets.
    expect(derivePhase(readSnapshot(none.root))).toMatchObject({ step: "ux-plan" });
  });

  test("garbled stamp → one retry quoting the expected format → error", async () => {
    const p = makeProject();
    seedCleanupDir(p);
    await expect(
      withFakeClaude(p, { SCENARIO_CLEANUP_IDENTIFY: "garbled" }, () =>
        stepCleanupIdentify(ctx(p), readSprint(p.root, "01-cleanup")),
      ),
    ).rejects.toThrow(LoopError);
    const logs = invocations(p);
    expect(logs.length).toBe(2);
    const retry = invocationText(p, logs[1]!);
    expect(retry).toContain("PREVIOUS ATTEMPT FAILED");
    expect(retry).toContain("candidates stamp");
    expect(retry).toContain('got "# Cleanup spec"');
  });

  test("garbled then correct on the retry works", async () => {
    const p = makeProject();
    seedCleanupDir(p);
    await withFakeClaude(p, { SCENARIO_CLEANUP_IDENTIFY: "retry-ok" }, () =>
      stepCleanupIdentify(ctx(p), readSprint(p.root, "01-cleanup")),
    );
    expect(invocations(p).length).toBe(2);
    expect(derivePhase(readSnapshot(p.root))).toMatchObject({ step: "cleanup-tickets" });
  });
});

describe("step C4 — cleanup ticketize", () => {
  test("one fixed-ID ticket per category, committed with the category suffix", async () => {
    const p = makeProject();
    seedCleanupSpec(p, STAMP_ALL);
    await withFakeClaude(p, {}, () =>
      stepCleanupTickets(ctx(p), readSprint(p.root, "01-cleanup"), "architecture"),
    );
    expect(readdirSync(ticketsDir(p))).toEqual(["001-architecture-cleanup.json"]);
    expect(gitSubjects(p)[0]).toBe("chore(loop): sprint 01 tickets (architecture)");

    await withFakeClaude(p, {}, () =>
      stepCleanupTickets(ctx(p), readSprint(p.root, "01-cleanup"), "clean-code"),
    );
    expect(readdirSync(ticketsDir(p)).sort()).toEqual([
      "001-architecture-cleanup.json",
      "002-clean-code-cleanup.json",
    ]);
    expect(gitSubjects(p)[0]).toBe("chore(loop): sprint 01 tickets (clean-code)");
  });

  test("docs-only stamp: gap in IDs is legal — only 003- is created, then the walk runs", async () => {
    const p = makeProject();
    seedCleanupSpec(p, STAMP_DOCS_ONLY);
    expect(derivePhase(readSnapshot(p.root))).toMatchObject({
      step: "cleanup-tickets",
      category: "docs",
    });
    await withFakeClaude(p, {}, () =>
      stepCleanupTickets(ctx(p), readSprint(p.root, "01-cleanup"), "docs"),
    );
    expect(readdirSync(ticketsDir(p))).toEqual(["003-docs-cleanup.json"]);
    expect(derivePhase(readSnapshot(p.root))).toMatchObject({
      step: "implement",
      ticketFilename: "003-docs-cleanup.json",
    });
  });

  test("nothing then the ticket on the retry works", async () => {
    const p = makeProject();
    seedCleanupSpec(p, STAMP_ALL);
    await withFakeClaude(p, { SCENARIO_CLEANUP_TICKETS: "retry-ok" }, () =>
      stepCleanupTickets(ctx(p), readSprint(p.root, "01-cleanup"), "architecture"),
    );
    const logs = invocations(p);
    expect(logs.length).toBe(2);
    // The retry carries C4's own failure text, naming the id the handler
    // derived from the category — the unit tests stub that id.
    expect(invocationText(p, logs[1]!)).toContain(
      "expected exactly one new ticket file 001-<kebab-slug>.json",
    );
    expect(readdirSync(ticketsDir(p))).toEqual(["001-architecture-cleanup.json"]);
  });
});

describe("reserved slug (spec §6.1)", () => {
  test("step 2 rejects a normal sprint folder named NN-cleanup", async () => {
    const p = makeProject();
    await expect(
      withFakeClaude(p, { SCENARIO_FOCUS: "cleanup-slug" }, () =>
        stepSprintFocus(ctx(p), "01", null),
      ),
    ).rejects.toThrow(/reserved for cleanup sprints/);
  });
});
