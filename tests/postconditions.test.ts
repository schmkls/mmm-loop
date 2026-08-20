/**
 * The step postconditions judged directly — no temp repo, no git, no
 * subprocess. These are the rules the loop actually enforces; the step tests
 * next door prove each handler wires its rule in and derives its opts.
 */

import { describe, expect, test } from "bun:test";
import { UX_TICKETIZED_NO } from "../scripts/mmm-loop/lib/phases.ts";
import {
  checkCandidatesStamp,
  checkCleanupTickets,
  checkImplement,
  checkInitialTickets,
  checkNonEmpty,
  checkReport,
  checkReview,
  checkSprintFocus,
  checkStamped,
  checkUxTickets,
  checkVisionStatus,
  parseTicket,
  type FilesDelta,
} from "../scripts/mmm-loop/lib/postconditions.ts";
import type { Ticket } from "../scripts/mmm-loop/lib/tickets.ts";
import { freshTicket } from "./helpers.ts";

const files = (entries: Record<string, Ticket | string>): Map<string, string> =>
  new Map(
    Object.entries(entries).map(([f, v]) => [
      f,
      typeof v === "string" ? v : JSON.stringify(v, null, 2) + "\n",
    ]),
  );
const delta = (
  before: Record<string, Ticket | string>,
  after: Record<string, Ticket | string>,
): FilesDelta => ({ before: files(before), after: files(after) });

const REVIEW = {
  ticketFilename: "001-a.json",
  ticketId: "001",
  isFix: false,
  fixAlreadyExists: false,
};
const CLEANUP = {
  category: "docs" as const,
  ticketId: "003",
  relTicketsDir: ".working/sprints/02-cleanup/tickets",
};

// The five arms no scenario fixture can reach: each needs the agent to delete
// or clobber a file the fake claude binary has no mode for.
describe("arms no fixture can reach", () => {
  test("malformed ticket JSON is reported, not thrown", () => {
    expect(parseTicket("{ not json", "001-a.json").error).toContain("001-a.json is not valid JSON");
  });

  test("C4: deleting an existing ticket is rejected", () => {
    const d = delta({ "001-a.json": freshTicket("001") }, { "003-b.json": freshTicket("003") });
    expect(checkCleanupTickets(d, CLEANUP)).toContain(
      "001-a.json was deleted; ticketizing must not delete tickets",
    );
  });

  test("review: deleting an existing ticket is rejected", () => {
    const d = delta({ "001-a.json": freshTicket("001", { done: true }) }, {});
    expect(checkReview(d, REVIEW)).toContain(
      "001-a.json was deleted; reviews must not delete tickets",
    );
  });

  test("5.5.3: deleting an existing ticket is rejected", () => {
    const d = delta({ "001-a.json": freshTicket("001") }, { "002-ux-b.json": freshTicket("002") });
    expect(checkUxTickets(d, { maxExisting: 1, nextTicketNumber: "002" })).toContain(
      "001-a.json was deleted; ticketizing must not delete tickets",
    );
  });

  test("step 6: another sprint's section may not be dropped", () => {
    const before = '<section id="sprint-01">a</section><section id="sprint-02">b</section>';
    const after = '<section id="sprint-02">b2</section>';
    expect(
      checkReport({ before, after }, { sprintNumber: "02", relPath: "docs/sprint_reports.html" }),
    ).toBe('other sprints\' sections must not be removed; missing: <section id="sprint-01">');
  });
});

describe("step 2 — sprint folder shape", () => {
  const obs = (created: string, withFocus = true) => ({
    before: [] as string[],
    after: [created],
    withFocus: withFocus ? [created] : [],
  });

  test("happy path", () =>
    expect(checkSprintFocus(obs("01-mvp"), { sprintNumber: "01", reuseDirName: null })).toBeNull());
  test("bad slug", () =>
    expect(checkSprintFocus(obs("Sprint One"), { sprintNumber: "01", reuseDirName: null })).toMatch(
      /does not match NN-kebab-case-slug/,
    ));
  test("wrong number", () =>
    expect(checkSprintFocus(obs("02-mvp"), { sprintNumber: "01", reuseDirName: null })).toMatch(
      /must be numbered 01/,
    ));
  test("reserved cleanup slug", () =>
    expect(checkSprintFocus(obs("02-cleanup"), { sprintNumber: "02", reuseDirName: null })).toMatch(
      /reserved for cleanup sprints/,
    ));
  test("empty focus file", () =>
    expect(
      checkSprintFocus(obs("01-mvp", false), { sprintNumber: "01", reuseDirName: null }),
    ).toMatch(/non-empty sprint_focus\.md/));
  test("two folders", () =>
    expect(
      checkSprintFocus(
        { before: [], after: ["01-a", "01-b"], withFocus: [] },
        { sprintNumber: "01", reuseDirName: null },
      ),
    ).toMatch(/found 2 \(01-a, 01-b\)/));
  test("no folder at all names none", () =>
    expect(
      checkSprintFocus(
        { before: [], after: [], withFocus: [] },
        { sprintNumber: "01", reuseDirName: null },
      ),
    ).toMatch(/found 0 \(none\)/));
  test("reuse: happy path", () =>
    expect(
      checkSprintFocus(
        { before: ["01-x"], after: ["01-x"], withFocus: ["01-x"] },
        { sprintNumber: "01", reuseDirName: "01-x" },
      ),
    ).toBeNull());
  test("reuse: a new folder appearing is rejected", () =>
    expect(
      checkSprintFocus(
        { before: ["01-x"], after: ["01-x", "01-y"], withFocus: ["01-x"] },
        { sprintNumber: "01", reuseDirName: "01-x" },
      ),
    ).toMatch(/to be reused, but new entries appeared/));
  test("reuse: focus file still missing", () =>
    expect(
      checkSprintFocus(
        { before: ["01-x"], after: ["01-x"], withFocus: [] },
        { sprintNumber: "01", reuseDirName: "01-x" },
      ),
    ).toMatch(/non-empty sprint_focus\.md in \.working\/sprints\/01-x\//));
});

describe("step 3 / 5.5.1 — checkNonEmpty", () => {
  // One case per call-site noun: the message is derived from the basename, so
  // both call sites are pinned here rather than in the step tests.
  test("spec.md", () =>
    expect(checkNonEmpty(null, ".working/sprints/01-mvp/spec.md")).toBe(
      "expected a non-empty spec.md at .working/sprints/01-mvp/spec.md",
    ));
  test("ux_test_plan.md", () =>
    expect(checkNonEmpty(null, ".working/sprints/01-mvp/ux_test_plan.md")).toBe(
      "expected a non-empty ux_test_plan.md at .working/sprints/01-mvp/ux_test_plan.md",
    ));
  test("empty string is not enough", () =>
    expect(checkNonEmpty("", "d/spec.md")).toMatch(/non-empty spec\.md/));
  test("content passes", () => expect(checkNonEmpty("# Spec\n", "d/spec.md")).toBeNull());
});

describe("step 5.5.2 — checkStamped", () => {
  test("exact stamp passes", () =>
    expect(checkStamped(`${UX_TICKETIZED_NO}\n# Findings`, "d/f.md", UX_TICKETIZED_NO)).toBeNull());
  test("surrounding whitespace is trimmed", () =>
    expect(checkStamped(`  ${UX_TICKETIZED_NO}  \n`, "d/f.md", UX_TICKETIZED_NO)).toBeNull());
  test("wrong first line reports both sides", () =>
    expect(checkStamped("# Findings\n", "d/f.md", UX_TICKETIZED_NO)).toBe(
      `expected the first line of d/f.md to be exactly "${UX_TICKETIZED_NO}", got "# Findings"`,
    ));
  test("missing file", () =>
    expect(checkStamped(null, "d/f.md", UX_TICKETIZED_NO)).toBe("expected d/f.md to exist"));
});

describe("step 4 — ticket numbering", () => {
  test("contiguous from 001 passes", () =>
    expect(
      checkInitialTickets(
        files({ "001-a.json": freshTicket("001"), "002-b.json": freshTicket("002") }),
        "d/tickets",
      ),
    ).toBeNull());
  test("gap is rejected", () =>
    expect(
      checkInitialTickets(
        files({ "001-a.json": freshTicket("001"), "003-c.json": freshTicket("003") }),
        "d/tickets",
      ),
    ).toMatch(/must start at 001 and be contiguous; found 003 at position 2/));
  test("not starting at 001 is rejected", () =>
    expect(checkInitialTickets(files({ "002-b.json": freshTicket("002") }), "d/tickets")).toMatch(
      /found 002 at position 1/,
    ));
  test("a fix-ticket name is not an initial ticket name", () =>
    expect(
      checkInitialTickets(files({ "001.1-a.json": freshTicket("001.1") }), "d/tickets"),
    ).toMatch(/filename must match NNN-kebab-slug\.json/));
  test("non-initial values are rejected", () =>
    expect(
      checkInitialTickets(
        files({ "001-a.json": freshTicket("001", { done: true, commits: ["abc"] }) }),
        "d/tickets",
      ),
    ).toBe('001-a.json: "done" must start as false\n001-a.json: "commits" must start empty'));
  test("empty dir names the dir", () =>
    expect(checkInitialTickets(new Map(), "d/tickets")).toBe(
      "expected at least one ticket file in d/tickets/",
    ));
});

describe("step C3 — candidates stamp", () => {
  const STAMP = "_Candidates: architecture=yes, clean-code=none, docs=yes_";
  test("well-formed stamp passes", () =>
    expect(checkCandidatesStamp(`${STAMP}\n\n# Cleanup spec`, "d/spec.md")).toBeNull());
  test("a spec without the stamp is rejected, quoting the line found", () =>
    expect(checkCandidatesStamp("# Cleanup spec\n", "d/spec.md")).toMatch(
      /candidates stamp .* got "# Cleanup spec"$/,
    ));
  test("a malformed category value is rejected", () =>
    expect(
      checkCandidatesStamp("_Candidates: architecture=maybe, clean-code=none, docs=yes_", "d/spec.md"),
    ).toMatch(/candidates stamp/));
  test("an absent spec falls through to the non-empty message", () =>
    expect(checkCandidatesStamp(null, "d/spec.md")).toBe("expected a non-empty spec.md at d/spec.md"));
});

describe("step C4 — cleanup ticketizing", () => {
  const existing = { "001-a.json": freshTicket("001") };
  test("exactly one correctly-named ticket passes", () =>
    expect(
      checkCleanupTickets(
        delta(existing, { ...existing, "003-fix-docs.json": freshTicket("003") }),
        CLEANUP,
      ),
    ).toBeNull());
  test("no ticket created", () =>
    expect(checkCleanupTickets(delta(existing, existing), CLEANUP)).toMatch(
      /expected exactly one new ticket file 003-<kebab-slug>\.json in .*, found 0$/,
    ));
  test("two created are named in the message", () =>
    expect(
      checkCleanupTickets(
        delta(existing, {
          ...existing,
          "003-a.json": freshTicket("003"),
          "004-b.json": freshTicket("004"),
        }),
        CLEANUP,
      ),
    ).toMatch(/found 2 \(003-a\.json, 004-b\.json\)/));
  test("the category's ticket id is fixed", () =>
    expect(
      checkCleanupTickets(delta(existing, { ...existing, "007-x.json": freshTicket("007") }), CLEANUP),
    ).toMatch(/the docs ticket must be named 003-<kebab-slug>\.json — its id is fixed/));
  test("non-initial values on the new ticket are rejected", () =>
    expect(
      checkCleanupTickets(
        delta(existing, { ...existing, "003-a.json": freshTicket("003", { reviewed: true }) }),
        CLEANUP,
      ),
    ).toMatch(/"reviewed" must start as false/));
  test("modifying an existing ticket is rejected", () =>
    expect(
      checkCleanupTickets(
        delta(existing, {
          "001-a.json": freshTicket("001", { title: "edited" }),
          "003-a.json": freshTicket("003"),
        }),
        CLEANUP,
      ),
    ).toBe("001-a.json was modified; ticketizing must not modify existing tickets"));
});

describe("step 5.1 — implement", () => {
  const done = freshTicket("001", { done: true });
  test("done passes", () => expect(checkImplement(JSON.stringify(done), "001-a.json")).toBeNull());
  test("both flags", () =>
    expect(
      checkImplement(
        JSON.stringify({
          ...done,
          needs_human_intervention: true,
          needs_human_intervention_reason: "x",
        }),
        "001-a.json",
      ),
    ).toMatch(/exactly one of/));
  test("neither flag", () =>
    expect(checkImplement(JSON.stringify(freshTicket("001")), "001-a.json")).toMatch(
      /changed neither/,
    ));
  test("blocked without a reason", () =>
    expect(
      checkImplement(
        JSON.stringify(freshTicket("001", { needs_human_intervention: true })),
        "001-a.json",
      ),
    ).toMatch(/reason" is empty/));
  test("agent set reviewed", () =>
    expect(checkImplement(JSON.stringify({ ...done, reviewed: true }), "001-a.json")).toMatch(
      /orchestrator-owned/,
    ));
  test("missing file", () =>
    expect(checkImplement(null, "001-a.json")).toBe("expected ticket file 001-a.json to exist"));
});

describe("step 5.2 — review", () => {
  const parent = { "001-a.json": freshTicket("001", { done: true }) };
  test("no change passes", () => expect(checkReview(delta(parent, parent), REVIEW)).toBeNull());
  test("one well-formed fix ticket passes", () =>
    expect(
      checkReview(delta(parent, { ...parent, "001.1-fix.json": freshTicket("001.1") }), REVIEW),
    ).toBeNull());
  test("two created", () =>
    expect(
      checkReview(
        delta(parent, {
          ...parent,
          "001.1-a.json": freshTicket("001.1"),
          "001.2-b.json": freshTicket("001.2"),
        }),
        REVIEW,
      ),
    ).toMatch(/at most one fix ticket/));
  test("misnamed fix ticket", () =>
    expect(
      checkReview(delta(parent, { ...parent, "002-nope.json": freshTicket("002") }), REVIEW),
    ).toMatch(/must be named 001\.1-<kebab-slug>\.json, got 002-nope\.json/));
  test("a review of a fix ticket may not create one", () =>
    expect(
      checkReview(delta(parent, { ...parent, "001.1-a.json": freshTicket("001.1") }), {
        ...REVIEW,
        isFix: true,
      }),
    ).toMatch(/reviews of fix tickets must never create tickets/));
  test("a fix ticket that already exists blocks another", () =>
    expect(
      checkReview(delta(parent, { ...parent, "001.1-a.json": freshTicket("001.1") }), {
        ...REVIEW,
        fixAlreadyExists: true,
      }),
    ).toMatch(/already exists/));
  test("non-initial values on the fix ticket are rejected", () =>
    expect(
      checkReview(
        delta(parent, { ...parent, "001.1-a.json": freshTicket("001.1", { done: true }) }),
        REVIEW,
      ),
    ).toMatch(/"done" must start as false/));
  test("review of a fix ticket may only flag human intervention", () => {
    const fix = freshTicket("001.1", { done: true });
    const flagged = {
      ...fix,
      needs_human_intervention: true,
      needs_human_intervention_reason: "why",
    };
    const opts = {
      ticketFilename: "001.1-f.json",
      ticketId: "001.1",
      isFix: true,
      fixAlreadyExists: false,
    };
    expect(checkReview(delta({ "001.1-f.json": fix }, { "001.1-f.json": flagged }), opts)).toBeNull();
    expect(
      checkReview(delta({ "001.1-f.json": fix }, { "001.1-f.json": { ...fix, title: "edited" } }), opts),
    ).toMatch(/the only allowed change/);
  });
  test("modifying an unrelated ticket", () =>
    expect(
      checkReview(
        delta(
          { ...parent, "002-b.json": freshTicket("002") },
          { ...parent, "002-b.json": freshTicket("002", { title: "x" }) },
        ),
        REVIEW,
      ),
    ).toContain("002-b.json was modified"));
});

describe("step 5.5.3 — UX ticketizing", () => {
  const existing = { "001-a.json": freshTicket("001") };
  const OPTS = { maxExisting: 1, nextTicketNumber: "002" };
  test("creating nothing passes — the findings may hold no UX work", () =>
    expect(checkUxTickets(delta(existing, existing), OPTS)).toBeNull());
  test("contiguous continuation passes", () =>
    expect(
      checkUxTickets(
        delta(existing, {
          ...existing,
          "002-ux-a.json": freshTicket("002"),
          "003-ux-b.json": freshTicket("003"),
        }),
        OPTS,
      ),
    ).toBeNull());
  test("a missing ux- infix is rejected", () =>
    expect(
      checkUxTickets(delta(existing, { ...existing, "002-a.json": freshTicket("002") }), OPTS),
    ).toMatch(/filename must match NNN-ux-kebab-slug\.json \(e\.g\. 002-ux-fix-help\.json\)/));
  test("numbering that does not continue from next is rejected", () =>
    expect(
      checkUxTickets(delta(existing, { ...existing, "005-ux-a.json": freshTicket("005") }), OPTS),
    ).toMatch(/must continue contiguously from 002; found 005 at position 1/));
  test("non-initial values are rejected", () =>
    expect(
      checkUxTickets(
        delta(existing, { ...existing, "002-ux-a.json": freshTicket("002", { done: true }) }),
        OPTS,
      ),
    ).toMatch(/"done" must start as false/));
  test("modifying an existing ticket is rejected", () =>
    expect(
      checkUxTickets(
        delta(existing, { "001-a.json": freshTicket("001", { title: "edited" }) }),
        OPTS,
      ),
    ).toBe("001-a.json was modified; ticketizing must not modify existing tickets"));
});

describe("step 6 — report", () => {
  const REPORT = { sprintNumber: "02", relPath: "docs/sprint_reports.html" };
  test("one section for this sprint, others intact, passes", () =>
    expect(
      checkReport(
        {
          before: '<section id="sprint-01">a</section>',
          after: '<section id="sprint-01">a</section><section id="sprint-02">b</section>',
        },
        REPORT,
      ),
    ).toBeNull());
  test("missing file", () =>
    expect(checkReport({ before: null, after: null }, REPORT)).toBe(
      "expected docs/sprint_reports.html to exist",
    ));
  test("no section for this sprint", () =>
    expect(checkReport({ before: null, after: "<html></html>" }, REPORT)).toBe(
      'expected docs/sprint_reports.html to contain <section id="sprint-02">',
    ));
  test("duplicated section", () =>
    expect(
      checkReport(
        { before: null, after: '<section id="sprint-02">a</section><section id="sprint-02">b</section>' },
        REPORT,
      ),
    ).toMatch(/found 2 — replace the sprint's own section, never duplicate it/));
});

describe("step 7 — vision status", () => {
  const OPTS = { relPath: ".working/vision_status.md", stamp: "_Last updated: sprint 02_" };
  const body = [
    "## What exists now",
    "## What works (verified)",
    "## Known gaps",
    "## Blocked on human",
  ].join("\n\n");

  test("stamp plus all four headings passes", () =>
    expect(checkVisionStatus(`${OPTS.stamp}\n\n${body}`, OPTS)).toBeNull());
  test("a wrong stamp is reported before the headings are looked at", () =>
    expect(checkVisionStatus(`_Last updated: sprint 01_\n\n${body}`, OPTS)).toMatch(
      /to be exactly "_Last updated: sprint 02_", got "_Last updated: sprint 01_"/,
    ));
  test("missing headings are listed", () =>
    expect(checkVisionStatus(`${OPTS.stamp}\n\n## What exists now\n`, OPTS)).toBe(
      "expected .working/vision_status.md to contain the template headings; " +
        "missing: ## What works (verified), ## Known gaps, ## Blocked on human",
    ));
  test("missing file", () =>
    expect(checkVisionStatus(null, OPTS)).toBe("expected .working/vision_status.md to exist"));
});
