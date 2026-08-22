/**
 * Feedback sprints (spec §8.9): pure helpers — the folder names next to
 * `docs/vision.md`, the feedback stamp (parse and flip), the dispositions
 * the triage records, and the archive naming rule. No IO; the inbox listing
 * is a snapshot read (lib/snapshot.ts) and the archive move is the step's
 * write (lib/steps.ts), same split as cleanup.ts.
 */

import { join } from "node:path";

/** A feedback sprint's folder is exactly `NN-feedback` (spec §6.1). */
export const FEEDBACK_DIRNAME_RE = /^\d{2}-feedback$/;

/** Human-facing feedback folders, next to `docs/vision.md` (spec §4). */
export const FEEDBACK_DIR = join("docs", "feedback");
export const INBOX_DIR = join(FEEDBACK_DIR, "inbox");
export const HANDLED_DIR = join(FEEDBACK_DIR, "handled");

/**
 * The filename half of the inbox-item rule (spec §8.9): a `*.md` that is not
 * a dotfile, so a `.gitkeep` never counts, and that a markdown heading can
 * name — a newline in the name would make the `### <filename>` contract
 * unsatisfiable, wedging every rerun on a file only a human can rename. The
 * other half — a regular file with something in it — belongs to the read,
 * in snapshot.ts's readFeedbackInbox.
 */
export function isInboxItem(filename: string): boolean {
  // eslint-disable-next-line no-control-regex
  return filename.endsWith(".md") && !filename.startsWith(".") && !/[\u0000-\u001f]/.test(filename);
}

/**
 * Where sprint NN archives one triaged item. The `NN-` prefix records the
 * handling sprint; `existing` (the handled folder's current filenames) is
 * consulted so a name already there is never overwritten — the archive holds
 * human words, and losing them silently is the one thing it must not do.
 */
export function handledName(
  sprintNumber: string,
  filename: string,
  existing: Iterable<string>,
): string {
  const taken = new Set(existing);
  const base = filename.replace(/\.md$/, "");
  const candidate = (suffix: string) => `${sprintNumber}-${base}${suffix}.md`;
  if (!taken.has(candidate(""))) return candidate("");
  for (let n = 2; ; n++) {
    if (!taken.has(candidate(`-${n}`))) return candidate(`-${n}`);
  }
}

export function handledPath(name: string): string {
  return join(HANDLED_DIR, name);
}

// -------------------------------------------------------------- the stamp

export interface FeedbackStamp {
  /** `no` until the orchestrator has archived the triaged items — the same
   * agent-writes-no / orchestrator-flips-yes idiom as the UX ticketized
   * stamp (spec §8.5.3). Derivation re-runs F2 while it says `no`. */
  triaged: "no" | "yes";
  /** `none` = the triage found no work for this sprint (a valid outcome). */
  actionable: "yes" | "none";
  /** `proposed` = at least one item needs a human decision on the vision. */
  visionChange: "proposed" | "no";
}

const STAMP_RE =
  /^_Feedback: triaged=(no|yes), actionable=(yes|none), vision-change=(proposed|no)_$/;

export const FEEDBACK_STAMP_SHAPE =
  "_Feedback: triaged=no, actionable=<yes|none>, vision-change=<proposed|no>_";

export const FEEDBACK_STAMP_EXAMPLE = "_Feedback: triaged=no, actionable=yes, vision-change=no_";

/**
 * Parse the stamp step F2 writes as `sprint_focus.md`'s first line — the
 * three keys in that order. Any deviation → null (the step failed its
 * postcondition).
 */
export function parseFeedbackStamp(line: string | null): FeedbackStamp | null {
  if (line === null) return null;
  const m = STAMP_RE.exec(line.trim());
  if (!m) return null;
  return {
    triaged: m[1] as "no" | "yes",
    actionable: m[2] as "yes" | "none",
    visionChange: m[3] as "proposed" | "no",
  };
}

/** The orchestrator's flip, applied once the triage is accepted (spec §8.9). */
export function markTriaged(firstLine: string): string {
  return firstLine.trim().replace("triaged=no", "triaged=yes");
}

/** The focus the orchestrator writes itself when the inbox turns out to be
 * empty at triage time (spec §8.9) — deterministic, so no agent is spawned
 * to triage nothing. Already flipped: there is nothing left to archive. */
export function emptyInboxFocus(sprintNumber: string): string {
  return (
    `_Feedback: triaged=yes, actionable=none, vision-change=no_\n\n` +
    `# Sprint ${sprintNumber} — feedback\n\n## Feedback\n\n` +
    `The feedback inbox was empty when the triage ran: every item was ` +
    `withdrawn or handled elsewhere after this sprint was created. Nothing ` +
    `to triage, and nothing for this sprint to do.\n`
  );
}

// ------------------------------------------------------------ dispositions

export const DISPOSITIONS = ["in-vision", "vision-change", "declined"] as const;

export type Disposition = (typeof DISPOSITIONS)[number];

const HEADING_RE = /^###\s+(.+?)\s*$/;
const DISPOSITION_RE = /^-\s*Disposition:\s*(\S+)\s*$/;

/**
 * The dispositions a focus file records, keyed by the `### <item>` heading
 * they sit under: heading → every `- Disposition:` value in that block, so
 * both "none" and "two" are visible to the postcondition. Exact heading
 * match is deliberate — a substring test would let `cli.md` be "mentioned"
 * by a block about `slow-cli.md`, and that item is about to be archived.
 */
export function parseDispositions(content: string): Map<string, string[]> {
  const blocks = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of content.split("\n")) {
    const heading = HEADING_RE.exec(line);
    if (heading) {
      current = [];
      blocks.set(heading[1]!, current);
      continue;
    }
    if (line.startsWith("## ")) current = null; // a new top-level section
    const disposition = DISPOSITION_RE.exec(line);
    if (disposition && current) current.push(disposition[1]!);
  }
  return blocks;
}

/** One line per disposition, for the console and the report prompt:
 * "2 in-vision, 1 vision-change, 1 declined". */
export function summarizeDispositions(dispositions: Iterable<string>): string {
  const counts = new Map<string, number>();
  for (const d of dispositions) counts.set(d, (counts.get(d) ?? 0) + 1);
  return (
    DISPOSITIONS.filter((d) => counts.has(d))
      .map((d) => `${counts.get(d)} ${d}`)
      .join(", ") || "nothing triaged"
  );
}
