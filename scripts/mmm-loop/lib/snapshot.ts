/**
 * Filesystem reads. Two consumers:
 *   - the ProjectSnapshot phase derivation (lib/phases.ts) is computed from —
 *     loop artifacts the orchestrator wrote and maintains, so a malformed or
 *     missing one is a bug and throws (readTicketFile, readRequiredTextFile);
 *   - the raw primitives step postconditions are judged on — fresh agent
 *     output, where absent or malformed is an expected outcome to report, not
 *     an exception (listDir, readTextFile, readDirFiles).
 * Read IO lives here so both derivePhase and the postconditions stay IO-free.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CLEANUP_DIRNAME_RE } from "./cleanup.ts";
import { LoopError } from "./errors.ts";
import { TICKET_FILENAME_RE, validateTicket, type Ticket } from "./tickets.ts";

export const SPRINT_DIRNAME_RE = /^(\d{2})-[a-z0-9-]+$/;

export interface TicketFile {
  filename: string;
  ticket: Ticket;
}

export interface SprintSnapshot {
  dirName: string; // e.g. "01-mvp"
  number: string; // e.g. "01"
  /** Folder is exactly `NN-cleanup` → cleanup sprint (spec §6.1). */
  isCleanup: boolean;
  hasFocus: boolean;
  hasSpec: boolean;
  /** First line of spec.md (trimmed), or null if the file is absent. Only
   * cleanup derivation consumes it (the candidates stamp); reading it here
   * keeps derivePhase IO-free, same split as visionStatusFirstLine. */
  specFirstLine: string | null;
  /** Non-empty ux_test_plan.md exists in the sprint folder. */
  hasUxPlan: boolean;
  /** First line of ux_findings.md (trimmed), or null if the file is absent. */
  uxFindingsFirstLine: string | null;
  /** null = no tickets/ dir; sorted by filename (= execution order). */
  tickets: TicketFile[] | null;
}

export interface ProjectSnapshot {
  /** All sprint folders, sorted by name (= numeric order). */
  sprints: SprintSnapshot[];
  /** Contents of docs/sprint_reports.html, or null if absent. */
  reportHtml: string | null;
  /** First line of .working/vision_status.md, or null if absent. */
  visionStatusFirstLine: string | null;
}

export function sprintsDir(root: string): string {
  return join(root, ".working", "sprints");
}

export function nonEmptyFile(path: string): boolean {
  return existsSync(path) && statSync(path).size > 0;
}

/** Sorted entry names in `dir`; a missing dir reads as empty. */
export function listDir(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

/** Untrusted read: whole file, or null when absent. Never throws on absence. */
export function readTextFile(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/** Trusted read: a loop artifact the orchestrator itself wrote in an earlier
 * step. Absent means the loop's own invariant broke, so this throws rather
 * than coercing to "". */
export function readRequiredTextFile(path: string): string {
  if (!existsSync(path)) {
    throw new LoopError(`Expected loop artifact ${path} to exist; an earlier step wrote it.`);
  }
  return readFileSync(path, "utf8");
}

/** filename → contents for every file directly in `dir`, in sorted order
 * (error messages are emitted in iteration order). Missing dir = empty map. */
export function readDirFiles(dir: string): Map<string, string> {
  if (!existsSync(dir)) return new Map();
  return new Map(
    readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort()
      .map((name) => [name, readFileSync(join(dir, name), "utf8")]),
  );
}

export function readTicketFile(path: string, filename: string): Ticket {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new LoopError(`Malformed ticket JSON in ${path}: ${(e as Error).message}`);
  }
  const errors = validateTicket(parsed, filename);
  if (errors.length > 0) {
    throw new LoopError(`Invalid ticket ${path}:\n  ${errors.join("\n  ")}`);
  }
  return parsed as Ticket;
}

export function readSprint(root: string, dirName: string): SprintSnapshot {
  const dir = join(sprintsDir(root), dirName);
  const ticketsDir = join(dir, "tickets");
  let tickets: TicketFile[] | null = null;
  if (existsSync(ticketsDir)) {
    tickets = readdirSync(ticketsDir)
      .filter((f) => TICKET_FILENAME_RE.test(f))
      .sort()
      .map((filename) => ({
        filename,
        ticket: readTicketFile(join(ticketsDir, filename), filename),
      }));
  }
  const findingsPath = join(dir, "ux_findings.md");
  const specPath = join(dir, "spec.md");
  return {
    dirName,
    number: SPRINT_DIRNAME_RE.exec(dirName)![1]!,
    isCleanup: CLEANUP_DIRNAME_RE.test(dirName),
    hasFocus: nonEmptyFile(join(dir, "sprint_focus.md")),
    hasSpec: nonEmptyFile(specPath),
    specFirstLine: existsSync(specPath)
      ? (readFileSync(specPath, "utf8").split("\n")[0] ?? "").trim()
      : null,
    hasUxPlan: nonEmptyFile(join(dir, "ux_test_plan.md")),
    uxFindingsFirstLine: existsSync(findingsPath)
      ? (readFileSync(findingsPath, "utf8").split("\n")[0] ?? "").trim()
      : null,
    tickets,
  };
}

export function readSnapshot(root: string): ProjectSnapshot {
  const sdir = sprintsDir(root);
  const sprintDirs = existsSync(sdir)
    ? readdirSync(sdir)
        .filter((d) => SPRINT_DIRNAME_RE.test(d) && statSync(join(sdir, d)).isDirectory())
        .sort()
    : [];

  const reportPath = join(root, "docs", "sprint_reports.html");
  const visionStatusPath = join(root, ".working", "vision_status.md");

  return {
    sprints: sprintDirs.map((d) => readSprint(root, d)),
    reportHtml: existsSync(reportPath) ? readFileSync(reportPath, "utf8") : null,
    visionStatusFirstLine: existsSync(visionStatusPath)
      ? (readFileSync(visionStatusPath, "utf8").split("\n")[0] ?? "").trim()
      : null,
  };
}
