/**
 * Cleanup sprints (spec §8.8): pure helpers — the fixed category table, the
 * candidates-stamp parser, the cadence rule, and the commit-type mapping.
 * No IO; all filesystem state reaches these through the snapshot.
 */

import { LoopError } from "./errors.ts";
import type { TicketFile } from "./snapshot.ts";

/** A cleanup sprint's folder is exactly `NN-cleanup` (spec §6.1). */
export const CLEANUP_DIRNAME_RE = /^\d{2}-cleanup$/;

/** Fixed categories, in ticketize/execution order (spec §8.8): structural
 * change first; docs last, so they document the post-cleanup state. */
export const CLEANUP_CATEGORIES = [
  { key: "architecture", ticketId: "001", commitType: "refactor" },
  { key: "clean-code", ticketId: "002", commitType: "refactor" },
  { key: "docs", ticketId: "003", commitType: "docs" },
] as const;

export type CleanupCategory = (typeof CLEANUP_CATEGORIES)[number]["key"];

const STAMP_RE =
  /^_Candidates: architecture=(yes|none), clean-code=(yes|none), docs=(yes|none)_$/;

export const CANDIDATES_STAMP_SHAPE =
  "_Candidates: architecture=<yes|none>, clean-code=<yes|none>, docs=<yes|none>_";

export const CANDIDATES_STAMP_EXAMPLE =
  "_Candidates: architecture=yes, clean-code=none, docs=yes_";

/**
 * Parse the candidates stamp step C3 writes as spec.md's first line:
 * `_Candidates: architecture=yes, clean-code=none, docs=yes_` — the three
 * keys in that order, each valued yes|none. Any deviation → null.
 */
export function parseCandidatesStamp(
  line: string | null,
): Record<CleanupCategory, "yes" | "none"> | null {
  if (line === null) return null;
  const m = STAMP_RE.exec(line.trim());
  if (!m) return null;
  return {
    architecture: m[1] as "yes" | "none",
    "clean-code": m[2] as "yes" | "none",
    docs: m[3] as "yes" | "none",
  };
}

/**
 * First `yes` category (in table order) with no ticket whose filename starts
 * with `NNN-`. The `-` in the prefix keeps fix tickets (`001.1-...`) from
 * satisfying `001`. Null = no category is missing a ticket.
 */
export function firstMissingCategory(
  stamp: Record<CleanupCategory, "yes" | "none">,
  tickets: TicketFile[],
): (typeof CLEANUP_CATEGORIES)[number] | null {
  for (const category of CLEANUP_CATEGORIES) {
    if (stamp[category.key] !== "yes") continue;
    if (!tickets.some(({ filename }) => filename.startsWith(`${category.ticketId}-`))) {
      return category;
    }
  }
  return null;
}

/** Cadence rule (spec §5): a newly *created* sprint NN is a cleanup sprint
 * iff the cadence is on and NN is a multiple of it. */
export function isCadenceCleanup(sprintNumber: string, cadence: number): boolean {
  return cadence > 0 && Number(sprintNumber) % cadence === 0;
}

/**
 * feat-replacement for cleanup category commits: 001/002 → refactor, 003 →
 * docs, keyed off the integer part of the id. Only called for category
 * tickets — the call site excludes fix and UX tickets first; any other id on
 * a cleanup sprint is malformed state.
 */
export function cleanupCommitType(ticketId: string): "refactor" | "docs" {
  const integerPart = ticketId.split(".")[0];
  const category = CLEANUP_CATEGORIES.find((c) => c.ticketId === integerPart);
  if (!category) {
    throw new LoopError(
      `Ticket id ${ticketId} on a cleanup sprint matches no cleanup category (001/002/003)`,
    );
  }
  return category.commitType;
}
