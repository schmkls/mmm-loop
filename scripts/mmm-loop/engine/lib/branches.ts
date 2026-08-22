/**
 * Sprint-branch decisions (spec §6.4): pure functions only — name derivation
 * and the startup-preflight decision table. All git IO lives in git.ts; the
 * call sites live in run.ts.
 */

/** The reserved branch namespace: exactly `sprint/NN` (cleanup sprints
 * included — the branch name carries no slug). Humans must not create
 * branches matching this. */
export const SPRINT_BRANCH_RE = /^sprint\/(\d{2})$/;

export function sprintBranch(sprintNumber: string): string {
  return `sprint/${sprintNumber}`;
}

/** The sprint branches among `branches` — "is a sprint in flight?", asked by
 * the startup preflight and by `update`, which refuses while one exists. */
export function sprintBranches(branches: string[]): string[] {
  return branches.filter((b) => SPRINT_BRANCH_RE.test(b));
}

export type PreflightAction =
  | { kind: "proceed" }
  | { kind: "checkout"; branch: string }
  | { kind: "error"; message: string };

/**
 * The startup decision table (spec §6.4): phase derivation reads the
 * checked-out tree, so the right branch must be checked out before the first
 * readSnapshot. Invariant: at most one `sprint/NN` branch exists at any time
 * — it is the in-progress (or completed-but-unmerged) sprint.
 *
 * The caller checks `base` exists (that needs IO) before calling this.
 */
export function preflightAction(
  current: string,
  branches: string[],
  base: string,
): PreflightAction {
  const sprints = sprintBranches(branches);
  if (sprints.length > 1) {
    return {
      kind: "error",
      message:
        `Branch invariant broken: more than one sprint branch exists ` +
        `(${sprints.join(", ")}); at most one may exist at a time. ` +
        `Merge or delete all but one and rerun.`,
    };
  }
  const only = sprints[0];
  if (only !== undefined) {
    return only === current ? { kind: "proceed" } : { kind: "checkout", branch: only };
  }
  if (current === base) {
    return { kind: "proceed" };
  }
  return {
    kind: "error",
    message:
      `On branch "${current}" with no sprint branch; check out "${base}" ` +
      `(or change BASE_BRANCH in scripts/mmm-loop/config.ts) and rerun.`,
  };
}
