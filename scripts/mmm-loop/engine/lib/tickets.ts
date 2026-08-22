/** Ticket schema (spec §8.4) and its validator — hand-rolled so the copied
 * bundle has zero dependencies. */

export interface TicketTest {
  description: string;
  passes: boolean;
}

export interface Ticket {
  id: string;
  title: string;
  description: string;
  tests: TicketTest[];
  done: boolean;
  reviewed: boolean;
  needs_human_intervention: boolean;
  needs_human_intervention_reason: string | null;
  human_note: string | null;
  commits: string[];
}

/** `NNN-slug.json` or `NNN.1-slug.json` (spec §4). Group 1 = ticket id. */
export const TICKET_FILENAME_RE = /^(\d{3}(?:\.\d)?)-[a-z0-9-]+\.json$/;

/** Initial ticket filenames only — fix tickets (`NNN.1`) are review-created. */
export const INITIAL_TICKET_FILENAME_RE = /^(\d{3})-[a-z0-9-]+\.json$/;

/** UX ticket filenames created by step 5.5.3 (spec §8.5.3). */
export const UX_TICKET_FILENAME_RE = /^(\d{3})-ux-[a-z0-9-]+\.json$/;

/**
 * Numbering continues after the highest existing NNN; fix tickets count via
 * their integer part (after 003 and 003.1, the next is 004).
 */
export function nextTicketNumber(filenames: Iterable<string>): {
  maxExisting: number;
  next: string;
} {
  const maxExisting = Math.max(
    0,
    ...[...filenames]
      .map((f) => TICKET_FILENAME_RE.exec(f)?.[1])
      .filter((id): id is string => id !== undefined)
      .map((id) => Number(id.split(".")[0])),
  );
  return { maxExisting, next: String(maxExisting + 1).padStart(3, "0") };
}

/** A fix ticket for `ticketId` other than `self` already exists. Step 5.2
 * computes this once and feeds both the prompt prose and the postcondition,
 * so the two cannot disagree. */
export function hasFixTicketFor(
  filenames: Iterable<string>,
  ticketId: string,
  self: string,
): boolean {
  return [...filenames].some((f) => f !== self && f.startsWith(`${ticketId}.`));
}

export function isFixTicketId(id: string): boolean {
  return id.includes(".");
}

/** Parent id of a fix ticket: "003.1" → "003". */
export function parentId(fixId: string): string {
  return fixId.split(".")[0]!;
}

/**
 * Validate one parsed ticket object against the schema. Returns error
 * messages naming `filename`; empty array = valid.
 */
export function validateTicket(obj: unknown, filename: string): string[] {
  const errors: string[] = [];
  const err = (msg: string) => errors.push(`${filename}: ${msg}`);

  const nameMatch = TICKET_FILENAME_RE.exec(filename);
  if (!nameMatch) {
    err(`filename does not match NNN-slug.json or NNN.1-slug.json`);
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    err(`ticket is not a JSON object`);
    return errors;
  }
  const t = obj as Record<string, unknown>;

  const requireString = (field: string) => {
    if (typeof t[field] !== "string" || (t[field] as string).length === 0) {
      err(`"${field}" must be a non-empty string`);
    }
  };
  const requireBool = (field: string) => {
    if (typeof t[field] !== "boolean") err(`"${field}" must be a boolean`);
  };
  const requireStringOrNull = (field: string) => {
    if (t[field] !== null && typeof t[field] !== "string") {
      err(`"${field}" must be a string or null`);
    }
  };

  requireString("id");
  requireString("title");
  requireString("description");
  requireBool("done");
  requireBool("reviewed");
  requireBool("needs_human_intervention");
  requireStringOrNull("needs_human_intervention_reason");
  requireStringOrNull("human_note");

  if (!Array.isArray(t.tests)) {
    err(`"tests" must be an array`);
  } else {
    t.tests.forEach((test, i) => {
      if (typeof test !== "object" || test === null) {
        err(`"tests[${i}]" must be an object`);
        return;
      }
      const tt = test as Record<string, unknown>;
      if (typeof tt.description !== "string" || tt.description.length === 0) {
        err(`"tests[${i}].description" must be a non-empty string`);
      }
      if (typeof tt.passes !== "boolean") {
        err(`"tests[${i}].passes" must be a boolean`);
      }
    });
  }

  if (!Array.isArray(t.commits) || t.commits.some((c) => typeof c !== "string")) {
    err(`"commits" must be an array of strings`);
  }

  if (nameMatch && typeof t.id === "string" && t.id !== nameMatch[1]) {
    err(`"id" (${JSON.stringify(t.id)}) does not match filename number (${nameMatch[1]})`);
  }

  return errors;
}

export function isOpen(t: Ticket): boolean {
  return !t.done && !t.needs_human_intervention;
}

export function isClosed(t: Ticket): boolean {
  return t.done || t.needs_human_intervention;
}

export function needsReview(t: Ticket): boolean {
  return t.done && !t.reviewed;
}
