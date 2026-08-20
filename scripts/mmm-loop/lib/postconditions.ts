/**
 * The programmatic postconditions for the agent steps (spec §8.2–§8.7): the
 * rules that decide whether a step's output is acceptable.
 *
 * Every function here is IO-free — it takes plain before/after data read by
 * lib/snapshot.ts and returns null (the step produced what was expected) or
 * the text the retry prompt carries back. It judges *untrusted agent output*:
 * absent, malformed and misnamed are all expected outcomes to be reported,
 * never thrown. (The trusted counterpart is snapshot.ts's readTicketFile /
 * readRequiredTextFile, which throw. See docs ADR 0002 — do not merge them.)
 *
 * Two tiers, distinguished by name:
 *   check*  → Failure (string | null) — wire into AgentStep["check"]
 *   *Errors → string[]                — fragments other checks compose
 *
 * The module imports SPRINT_DIRNAME_RE from snapshot.ts. That constant's real
 * home is a pure artifacts module (architecture review, candidate 3); it is
 * not rehomed here to keep this commit a pure extraction.
 */

import { basename } from "node:path";
import { CLEANUP_DIRNAME_RE, parseCandidatesStamp, type CleanupCategory } from "./cleanup.ts";
import { SPRINT_DIRNAME_RE } from "./snapshot.ts";
import {
  INITIAL_TICKET_FILENAME_RE,
  UX_TICKET_FILENAME_RE,
  validateTicket,
  type Ticket,
} from "./tickets.ts";

/** null = the step produced what was expected; otherwise the failure text. */
export type Failure = string | null;

/** One directory's files before and after the agent ran. A filename present in
 * `before` and absent from `after` was deleted. */
export interface FilesDelta {
  before: Map<string, string>;
  after: Map<string, string>;
}

export function createdIn(d: FilesDelta): string[] {
  return [...d.after.keys()].filter((f) => !d.before.has(f));
}

// ------------------------------------------------------------------ tickets

/** Parse + schema-validate, returning an error string instead of throwing —
 * postconditions report, the retry policy decides. `undefined`/`null` content
 * means the file is absent. */
export function parseTicket(
  content: string | null | undefined,
  filename: string,
): { ticket?: Ticket; error?: string } {
  if (content === null || content === undefined)
    return { error: `expected ticket file ${filename} to exist` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return { error: `${filename} is not valid JSON: ${(e as Error).message}` };
  }
  const errors = validateTicket(parsed, filename);
  if (errors.length > 0) return { error: errors.join("\n") };
  return { ticket: parsed as Ticket };
}

export function initialValueErrors(t: Ticket, filename: string): string[] {
  const errors: string[] = [];
  if (t.done) errors.push(`${filename}: "done" must start as false`);
  if (t.reviewed) errors.push(`${filename}: "reviewed" must start as false`);
  if (t.needs_human_intervention)
    errors.push(`${filename}: "needs_human_intervention" must start as false`);
  if (t.needs_human_intervention_reason !== null)
    errors.push(`${filename}: "needs_human_intervention_reason" must start as null`);
  if (t.human_note !== null) errors.push(`${filename}: "human_note" must start as null`);
  if (t.commits.length > 0) errors.push(`${filename}: "commits" must start empty`);
  if (t.tests.some((test) => test.passes))
    errors.push(`${filename}: every "tests[].passes" must start as false`);
  return errors;
}

/** Ticketizing (steps C4 and 5.5.3) may only add files. */
export function ticketsUntouchedErrors(d: FilesDelta): string[] {
  const errors: string[] = [];
  for (const [filename, contentBefore] of d.before) {
    const contentAfter = d.after.get(filename);
    if (contentAfter === undefined) {
      errors.push(`${filename} was deleted; ticketizing must not delete tickets`);
    } else if (contentAfter !== contentBefore) {
      errors.push(`${filename} was modified; ticketizing must not modify existing tickets`);
    }
  }
  return errors;
}

// -------------------------------------------------------------- file shapes

/** Steps 3 and 5.5.1: the agent's whole job is to leave a non-empty file. The
 * message noun is the file's own basename — no second way to name it. */
export function checkNonEmpty(content: string | null, relPath: string): Failure {
  return content !== null && content.length > 0
    ? null
    : `expected a non-empty ${basename(relPath)} at ${relPath}`;
}

/** Steps 5.5.2 and 7: the file exists and its first line is exactly `expected`. */
export function checkStamped(content: string | null, relPath: string, expected: string): Failure {
  if (content === null) return `expected ${relPath} to exist`;
  const firstLine = (content.split("\n")[0] ?? "").trim();
  return firstLine === expected
    ? null
    : `expected the first line of ${relPath} to be exactly "${expected}", got "${firstLine}"`;
}

// ------------------------------------------------------------------- step 2

export interface SprintDirsObservation {
  /** Sprint folder names before the agent ran. */
  before: string[];
  /** Sprint folder names after. */
  after: string[];
  /** Of `after`, the folders holding a non-empty sprint_focus.md. */
  withFocus: string[];
}

export function checkSprintFocus(
  obs: SprintDirsObservation,
  opts: { sprintNumber: string; reuseDirName: string | null },
): Failure {
  if (opts.reuseDirName) {
    const extra = obs.after.filter((d) => !obs.before.includes(d));
    if (extra.length > 0)
      return `expected the existing folder ${opts.reuseDirName} to be reused, but new entries appeared in .working/sprints/: ${extra.join(", ")}`;
    if (!obs.withFocus.includes(opts.reuseDirName))
      return `expected a non-empty sprint_focus.md in .working/sprints/${opts.reuseDirName}/`;
    return null;
  }
  const created = obs.after.filter((d) => !obs.before.includes(d));
  if (created.length !== 1)
    return `expected exactly one new sprint folder in .working/sprints/, found ${created.length} (${created.join(", ") || "none"})`;
  const dirName = created[0]!;
  const m = SPRINT_DIRNAME_RE.exec(dirName);
  if (!m)
    return `new sprint folder "${dirName}" does not match NN-kebab-case-slug (e.g. "${opts.sprintNumber}-mvp")`;
  if (m[1] !== opts.sprintNumber)
    return `new sprint folder "${dirName}" must be numbered ${opts.sprintNumber}`;
  if (CLEANUP_DIRNAME_RE.test(dirName))
    return `"${dirName}" is reserved for cleanup sprints; pick a different slug`;
  if (!obs.withFocus.includes(dirName))
    return `expected a non-empty sprint_focus.md in .working/sprints/${dirName}/`;
  return null;
}

// ------------------------------------------------------------------- step 4

export function checkInitialTickets(files: Map<string, string>, relTicketsDir: string): Failure {
  if (files.size === 0) return `expected at least one ticket file in ${relTicketsDir}/`;
  const errors: string[] = [];
  const numbers: number[] = [];
  for (const [filename, content] of files) {
    const m = INITIAL_TICKET_FILENAME_RE.exec(filename);
    if (!m) {
      errors.push(`${filename}: filename must match NNN-kebab-slug.json (e.g. 001-first-thing.json)`);
      continue;
    }
    numbers.push(Number(m[1]));
    const { ticket, error } = parseTicket(content, filename);
    if (error) errors.push(error);
    else errors.push(...initialValueErrors(ticket!, filename));
  }
  numbers.sort((a, b) => a - b);
  numbers.forEach((n, i) => {
    if (n !== i + 1)
      errors.push(`ticket numbers must start at 001 and be contiguous; found ${String(n).padStart(3, "0")} at position ${i + 1}`);
  });
  return errors.length > 0 ? errors.join("\n") : null;
}

// ------------------------------------------------------------------ step C3

export function checkCandidatesStamp(content: string | null, relPath: string): Failure {
  const empty = checkNonEmpty(content, relPath);
  if (empty) return empty;
  const firstLine = (content!.split("\n")[0] ?? "").trim();
  if (!parseCandidatesStamp(firstLine))
    return (
      `expected the first line of ${relPath} to be exactly the candidates stamp ` +
      `"_Candidates: architecture=<yes|none>, clean-code=<yes|none>, docs=<yes|none>_" ` +
      `(e.g. "_Candidates: architecture=yes, clean-code=none, docs=yes_"), got "${firstLine}"`
    );
  return null;
}

// ------------------------------------------------------------------ step C4

export function checkCleanupTickets(
  d: FilesDelta,
  opts: { category: CleanupCategory; ticketId: string; relTicketsDir: string },
): Failure {
  const created = createdIn(d);
  const errors: string[] = [];
  if (created.length !== 1) {
    errors.push(
      `expected exactly one new ticket file ${opts.ticketId}-<kebab-slug>.json in ` +
        `${opts.relTicketsDir}/, found ${created.length}` +
        (created.length > 0 ? ` (${created.join(", ")})` : ""),
    );
  } else {
    const filename = created[0]!;
    if (!new RegExp(`^${opts.ticketId}-[a-z0-9-]+\\.json$`).test(filename)) {
      errors.push(
        `${filename}: the ${opts.category} ticket must be named ${opts.ticketId}-<kebab-slug>.json — its id is fixed`,
      );
    } else {
      const { ticket, error } = parseTicket(d.after.get(filename), filename);
      if (error) errors.push(error);
      else errors.push(...initialValueErrors(ticket!, filename));
    }
  }
  errors.push(...ticketsUntouchedErrors(d));
  return errors.length > 0 ? errors.join("\n") : null;
}

// ----------------------------------------------------------------- step 5.1

export function checkImplement(content: string | null, filename: string): Failure {
  const { ticket, error } = parseTicket(content, filename);
  if (error) return error;
  const t = ticket!;
  if (t.done && t.needs_human_intervention)
    return `${filename}: exactly one of "done" / "needs_human_intervention" may be true, not both`;
  if (!t.done && !t.needs_human_intervention)
    return `${filename}: the run changed neither "done" nor "needs_human_intervention" — set "done": true, or "needs_human_intervention": true with a concrete reason`;
  if (t.needs_human_intervention && !t.needs_human_intervention_reason)
    return `${filename}: "needs_human_intervention" is true but "needs_human_intervention_reason" is empty`;
  if (t.reviewed)
    return `${filename}: "reviewed" is orchestrator-owned and must not be set by the implement agent`;
  return null;
}

// ----------------------------------------------------------------- step 5.2

export function checkReview(
  d: FilesDelta,
  opts: { ticketFilename: string; ticketId: string; isFix: boolean; fixAlreadyExists: boolean },
): Failure {
  const created = createdIn(d);
  const errors: string[] = [];

  if (created.length > 1) {
    errors.push(`at most one fix ticket may be created per review; found ${created.length}: ${created.join(", ")}`);
  } else if (created.length === 1) {
    const filename = created[0]!;
    if (opts.isFix) {
      errors.push(`reviews of fix tickets must never create tickets, but ${filename} was created`);
    } else if (opts.fixAlreadyExists) {
      errors.push(`a fix ticket for ${opts.ticketId} already exists; ${filename} must not be created`);
    } else if (!new RegExp(`^${opts.ticketId}\\.1-[a-z0-9-]+\\.json$`).test(filename)) {
      errors.push(`fix ticket must be named ${opts.ticketId}.1-<kebab-slug>.json, got ${filename}`);
    } else {
      const { ticket, error } = parseTicket(d.after.get(filename), filename);
      if (error) errors.push(error);
      else errors.push(...initialValueErrors(ticket!, filename));
    }
  }

  // Existing tickets must be untouched — except the reviewed fix ticket,
  // which may have needs_human_intervention flagged on it. (Not
  // ticketsUntouchedErrors: the messages and the exemption both differ.)
  for (const [filename, contentBefore] of d.before) {
    const contentAfter = d.after.get(filename);
    if (contentAfter === undefined) {
      errors.push(`${filename} was deleted; reviews must not delete tickets`);
      continue;
    }
    if (contentAfter === contentBefore) continue;
    if (filename === opts.ticketFilename && opts.isFix) {
      const { ticket, error } = parseTicket(contentAfter, filename);
      if (error) errors.push(error);
      else if (!ticket!.needs_human_intervention || !ticket!.needs_human_intervention_reason)
        errors.push(
          `${filename}: the only allowed change to a reviewed fix ticket is setting "needs_human_intervention": true with a concrete reason`,
        );
    } else {
      errors.push(`${filename} was modified; the review must not modify existing tickets`);
    }
  }

  return errors.length > 0 ? errors.join("\n") : null;
}

// --------------------------------------------------------------- step 5.5.3

export function checkUxTickets(
  d: FilesDelta,
  opts: { maxExisting: number; nextTicketNumber: string },
): Failure {
  const errors: string[] = [];
  const numbers: number[] = [];
  for (const filename of createdIn(d)) {
    const m = UX_TICKET_FILENAME_RE.exec(filename);
    if (!m) {
      errors.push(
        `${filename}: filename must match NNN-ux-kebab-slug.json (e.g. ${opts.nextTicketNumber}-ux-fix-help.json)`,
      );
      continue;
    }
    numbers.push(Number(m[1]));
    const { ticket, error } = parseTicket(d.after.get(filename), filename);
    if (error) errors.push(error);
    else errors.push(...initialValueErrors(ticket!, filename));
  }
  numbers.sort((a, b) => a - b);
  numbers.forEach((n, i) => {
    if (n !== opts.maxExisting + 1 + i)
      errors.push(
        `UX ticket numbers must continue contiguously from ${opts.nextTicketNumber}; found ${String(n).padStart(3, "0")} at position ${i + 1}`,
      );
  });
  errors.push(...ticketsUntouchedErrors(d));
  return errors.length > 0 ? errors.join("\n") : null;
}

// ------------------------------------------------------------------- step 6

const SPRINT_SECTION_RE = /<section id="sprint-(\d{2})">/g;

export function checkReport(
  html: { before: string | null; after: string | null },
  opts: { sprintNumber: string; relPath: string },
): Failure {
  const marker = `<section id="sprint-${opts.sprintNumber}">`;
  const after = html.after;
  if (after === null) return `expected ${opts.relPath} to exist`;
  const count = after.split(marker).length - 1;
  if (count === 0) return `expected ${opts.relPath} to contain ${marker}`;
  if (count > 1)
    return `expected exactly one ${marker} in ${opts.relPath}, found ${count} — replace the sprint's own section, never duplicate it`;
  // Sections other sprints already have must survive the edit.
  const lost = [...(html.before ?? "").matchAll(SPRINT_SECTION_RE)]
    .map((m) => m[0])
    .filter((m) => m !== marker && !after.includes(m));
  if (lost.length > 0)
    return `other sprints' sections must not be removed; missing: ${lost.join(", ")}`;
  return null;
}

// ------------------------------------------------------------------- step 7

const VISION_STATUS_HEADINGS = [
  "## What exists now",
  "## What works (verified)",
  "## Known gaps",
  "## Blocked on human",
];

export function checkVisionStatus(
  content: string | null,
  opts: { relPath: string; stamp: string },
): Failure {
  const stamp = checkStamped(content, opts.relPath, opts.stamp);
  if (stamp) return stamp;
  const missing = VISION_STATUS_HEADINGS.filter((h) => !content!.includes(h));
  return missing.length > 0
    ? `expected ${opts.relPath} to contain the template headings; missing: ${missing.join(", ")}`
    : null;
}
