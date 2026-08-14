/** Pure sprint-branch decisions (spec §6.4): name derivation and the startup
 * preflight decision table — no repos, no IO. */

import { describe, expect, test } from "bun:test";
import {
  preflightAction,
  SPRINT_BRANCH_RE,
  sprintBranch,
} from "../scripts/mmm-loop/lib/branches.ts";

describe("SPRINT_BRANCH_RE", () => {
  test("accepts exactly sprint/NN", () => {
    expect(SPRINT_BRANCH_RE.test("sprint/07")).toBe(true);
    expect(SPRINT_BRANCH_RE.exec("sprint/07")![1]).toBe("07");
  });

  test.each([
    ["sprint/7", "one digit"],
    ["sprint/007", "three digits"],
    ["sprint/07-mvp", "slug suffix"],
    ["sprints/07", "wrong prefix"],
    ["sprint/", "no number"],
    ["main", "unrelated branch"],
    ["feature/sprint/07", "nested prefix"],
  ])("rejects %s (%s)", (name) => {
    expect(SPRINT_BRANCH_RE.test(name)).toBe(false);
  });
});

describe("sprintBranch", () => {
  test("derives the branch name from the sprint number alone", () => {
    expect(sprintBranch("01")).toBe("sprint/01");
    expect(sprintBranch("12")).toBe("sprint/12");
  });

  test("round-trips through the regex", () => {
    expect(SPRINT_BRANCH_RE.exec(sprintBranch("05"))![1]).toBe("05");
  });
});

describe("preflightAction — the spec §6.4 decision table", () => {
  test("exactly one sprint branch, not current → checkout", () => {
    expect(preflightAction("main", ["main", "sprint/03"], "main")).toEqual({
      kind: "checkout",
      branch: "sprint/03",
    });
  });

  test("exactly one sprint branch, already current → proceed", () => {
    expect(preflightAction("sprint/03", ["main", "sprint/03"], "main")).toEqual({
      kind: "proceed",
    });
  });

  test("one sprint branch wins even when current is neither it nor base", () => {
    expect(preflightAction("feature/x", ["main", "feature/x", "sprint/02"], "main")).toEqual({
      kind: "checkout",
      branch: "sprint/02",
    });
  });

  test("no sprint branch, on base → proceed", () => {
    expect(preflightAction("main", ["main", "feature/x"], "main")).toEqual({ kind: "proceed" });
  });

  test("no sprint branch, on some other branch → error naming the base", () => {
    const action = preflightAction("feature/x", ["main", "feature/x"], "main");
    expect(action.kind).toBe("error");
    if (action.kind === "error") {
      expect(action.message).toContain('"main"');
      expect(action.message).toContain('"feature/x"');
      expect(action.message).toContain("BASE_BRANCH");
    }
  });

  test("more than one sprint branch → error listing them all", () => {
    const action = preflightAction("main", ["main", "sprint/01", "sprint/02"], "main");
    expect(action.kind).toBe("error");
    if (action.kind === "error") {
      expect(action.message).toContain("sprint/01");
      expect(action.message).toContain("sprint/02");
    }
  });

  test("non-reserved names never count as sprint branches", () => {
    // sprint/7 and sprint/01-mvp are outside the reserved namespace; only
    // sprint/04 matches, so the single-branch row applies.
    expect(
      preflightAction("main", ["main", "sprint/7", "sprint/01-mvp", "sprint/04"], "main"),
    ).toEqual({ kind: "checkout", branch: "sprint/04" });
  });

  test("respects a non-default base branch", () => {
    expect(preflightAction("trunk", ["trunk"], "trunk")).toEqual({ kind: "proceed" });
    expect(preflightAction("main", ["main", "trunk"], "trunk").kind).toBe("error");
  });
});
