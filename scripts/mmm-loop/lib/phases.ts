/**
 * Phase derivation (spec §6.1): a pure function from a ProjectSnapshot to the
 * next phase. No state file exists anywhere — this is the crash-safety core.
 */

import { firstMissingCategory, parseCandidatesStamp, type CleanupCategory } from "./cleanup.ts";
import { LoopError } from "./errors.ts";
import type { ProjectSnapshot, SprintSnapshot, TicketFile } from "./snapshot.ts";
import { isClosed, isOpen, needsReview } from "./tickets.ts";

export type Phase =
  /** Step 2 with a brand-new sprint folder (also the "sprint complete" row). */
  | { step: "sprint-focus"; sprintNumber: string; reuseDirName: null }
  /** Step 2 reusing an existing folder that lacks sprint_focus.md. */
  | { step: "sprint-focus"; sprintNumber: string; reuseDirName: string }
  | { step: "spec"; sprint: SprintSnapshot }
  | { step: "tickets"; sprint: SprintSnapshot }
  | { step: "cleanup-identify"; sprint: SprintSnapshot }
  | { step: "cleanup-tickets"; sprint: SprintSnapshot; category: CleanupCategory }
  | { step: "implement"; sprint: SprintSnapshot; ticketFilename: string }
  | { step: "review"; sprint: SprintSnapshot; ticketFilename: string }
  | { step: "ux-plan"; sprint: SprintSnapshot }
  | { step: "ux-test"; sprint: SprintSnapshot }
  | { step: "ux-tickets"; sprint: SprintSnapshot }
  | { step: "report"; sprint: SprintSnapshot }
  | { step: "vision-status"; sprint: SprintSnapshot };

export function reportSectionMarker(sprintNumber: string): string {
  return `<section id="sprint-${sprintNumber}">`;
}

export function visionStatusStamp(sprintNumber: string): string {
  return `_Last updated: sprint ${sprintNumber}_`;
}

/** First line of ux_findings.md before/after the orchestrator's flip (§8.5.3). */
export const UX_TICKETIZED_NO = "_Ticketized: no_";
export const UX_TICKETIZED_YES = "_Ticketized: yes_";

export function nextSprintNumber(snapshot: ProjectSnapshot): string {
  return String(snapshot.sprints.length + 1).padStart(2, "0");
}

export function derivePhase(snapshot: ProjectSnapshot): Phase {
  const latest = snapshot.sprints.at(-1);

  // No sprints at all → step 2, new folder.
  if (!latest) {
    return { step: "sprint-focus", sprintNumber: nextSprintNumber(snapshot), reuseDirName: null };
  }

  // Cleanup branch (spec §6.1): no sprint_focus.md — the folder name is the
  // focus. C3 writes the spec, C4 one ticket per yes-category; then both
  // sprint types share the same tail.
  if (latest.isCleanup) {
    if (!latest.hasSpec) {
      return { step: "cleanup-identify", sprint: latest };
    }
    const stamp = parseCandidatesStamp(latest.specFirstLine);
    // Malformed stamp = failed C3 postcondition, not a derivation crash:
    // re-run identify; its own check plus the §6.3 retry policy handle a
    // persistently garbled spec.
    if (!stamp) {
      return { step: "cleanup-identify", sprint: latest };
    }
    const missing = firstMissingCategory(stamp, latest.tickets ?? []);
    if (missing) {
      return { step: "cleanup-tickets", sprint: latest, category: missing.key };
    }
    return deriveTail(snapshot, latest, latest.tickets ?? []);
  }

  if (!latest.hasFocus) {
    return { step: "sprint-focus", sprintNumber: latest.number, reuseDirName: latest.dirName };
  }
  if (!latest.hasSpec) {
    return { step: "spec", sprint: latest };
  }
  if (latest.tickets === null || latest.tickets.length === 0) {
    return { step: "tickets", sprint: latest };
  }
  return deriveTail(snapshot, latest, latest.tickets);
}

/** The shared tail (ticket walk → UX rows → report → vision status → next
 * sprint). An all-`none` cleanup sprint passes an empty ticket array and
 * lands directly on the UX rows — the UX pass runs even on empty sprints. */
function deriveTail(
  snapshot: ProjectSnapshot,
  latest: SprintSnapshot,
  tickets: TicketFile[],
): Phase {
  // Inner loop: walk tickets in filename order; the first actionable one
  // wins. A done-but-unreviewed ticket earlier in the order is reviewed
  // before a later open ticket is implemented — its review may create a fix
  // ticket that must run first.
  for (const { filename, ticket } of tickets) {
    if (needsReview(ticket)) {
      return { step: "review", sprint: latest, ticketFilename: filename };
    }
    if (isOpen(ticket)) {
      return { step: "implement", sprint: latest, ticketFilename: filename };
    }
  }

  // All tickets closed (done or blocked).
  if (!tickets.every(({ ticket }) => isClosed(ticket))) {
    throw new Error("unreachable: non-closed ticket survived the walk");
  }

  // Step 5.5 (UX pass) sits between the implement loop and the report. Its
  // rows apply only while the sprint's report section is missing — so a
  // pre-feature sprint (report already present, no UX files) skips them and
  // still counts as complete, and once findings are stamped "yes" no row can
  // return a ux-* step again (the single-pass bound).
  if (!snapshot.reportHtml?.includes(reportSectionMarker(latest.number))) {
    if (!latest.hasUxPlan) {
      return { step: "ux-plan", sprint: latest };
    }
    if (latest.uxFindingsFirstLine === null) {
      return { step: "ux-test", sprint: latest };
    }
    if (latest.uxFindingsFirstLine === UX_TICKETIZED_NO) {
      return { step: "ux-tickets", sprint: latest };
    }
    if (latest.uxFindingsFirstLine !== UX_TICKETIZED_YES) {
      throw new LoopError(
        `ux_findings.md in ${latest.dirName} has a malformed first line: expected exactly ` +
          `"${UX_TICKETIZED_NO}" or "${UX_TICKETIZED_YES}", got "${latest.uxFindingsFirstLine}"`,
      );
    }
    return { step: "report", sprint: latest };
  }
  if (snapshot.visionStatusFirstLine !== visionStatusStamp(latest.number)) {
    return { step: "vision-status", sprint: latest };
  }

  // Latest sprint fully complete → step 2, new sprint (stop conditions are
  // the outer loop's job, not derivation's — spec §9).
  return { step: "sprint-focus", sprintNumber: nextSprintNumber(snapshot), reuseDirName: null };
}
