/**
 * Phase derivation (spec §6.1): a pure function from a ProjectSnapshot to the
 * next phase. No state file exists anywhere — this is the crash-safety core.
 */

import type { ProjectSnapshot, SprintSnapshot } from "./snapshot.ts";
import { isClosed, isOpen, needsReview } from "./tickets.ts";

export type Phase =
  /** Step 2 with a brand-new sprint folder (also the "sprint complete" row). */
  | { step: "sprint-focus"; sprintNumber: string; reuseDirName: null }
  /** Step 2 reusing an existing folder that lacks sprint_focus.md. */
  | { step: "sprint-focus"; sprintNumber: string; reuseDirName: string }
  | { step: "spec"; sprint: SprintSnapshot }
  | { step: "tickets"; sprint: SprintSnapshot }
  | { step: "implement"; sprint: SprintSnapshot; ticketFilename: string }
  | { step: "review"; sprint: SprintSnapshot; ticketFilename: string }
  | { step: "report"; sprint: SprintSnapshot }
  | { step: "vision-status"; sprint: SprintSnapshot };

export function reportSectionMarker(sprintNumber: string): string {
  return `<section id="sprint-${sprintNumber}">`;
}

export function visionStatusStamp(sprintNumber: string): string {
  return `_Last updated: sprint ${sprintNumber}_`;
}

export function nextSprintNumber(snapshot: ProjectSnapshot): string {
  return String(snapshot.sprints.length + 1).padStart(2, "0");
}

export function derivePhase(snapshot: ProjectSnapshot): Phase {
  const latest = snapshot.sprints.at(-1);

  // No sprints at all → step 2, new folder.
  if (!latest) {
    return { step: "sprint-focus", sprintNumber: nextSprintNumber(snapshot), reuseDirName: null };
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

  // Inner loop: walk tickets in filename order; the first actionable one
  // wins. A done-but-unreviewed ticket earlier in the order is reviewed
  // before a later open ticket is implemented — its review may create a fix
  // ticket that must run first.
  for (const { filename, ticket } of latest.tickets) {
    if (needsReview(ticket)) {
      return { step: "review", sprint: latest, ticketFilename: filename };
    }
    if (isOpen(ticket)) {
      return { step: "implement", sprint: latest, ticketFilename: filename };
    }
  }

  // All tickets closed (done or blocked).
  if (!latest.tickets.every(({ ticket }) => isClosed(ticket))) {
    throw new Error("unreachable: non-closed ticket survived the walk");
  }
  if (!snapshot.reportHtml?.includes(reportSectionMarker(latest.number))) {
    return { step: "report", sprint: latest };
  }
  if (snapshot.visionStatusFirstLine !== visionStatusStamp(latest.number)) {
    return { step: "vision-status", sprint: latest };
  }

  // Latest sprint fully complete → step 2, new sprint (stop conditions are
  // the outer loop's job, not derivation's — spec §9).
  return { step: "sprint-focus", sprintNumber: nextSprintNumber(snapshot), reuseDirName: null };
}
