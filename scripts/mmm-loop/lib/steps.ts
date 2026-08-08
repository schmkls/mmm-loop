/**
 * Step handlers 2–7 (spec §8.2–§8.7): each fills prompt vars, defines the
 * programmatic postcondition, runs the agent through the spawn wrapper, and
 * lets the orchestrator commit the resulting loop artifacts (spec §6.4).
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runAgentStep } from "./agent.ts";
import { gitCommitPaths, gitDiffOfCommits, gitHead, gitNewCommits, gitSummaries } from "./git.ts";
import { readSprint, readTicketFile, sprintsDir, SPRINT_DIRNAME_RE, type SprintSnapshot } from "./snapshot.ts";
import {
  isFixTicketId,
  TICKET_FILENAME_RE,
  validateTicket,
  type Ticket,
} from "./tickets.ts";

export interface Ctx {
  root: string;
  bundleDir: string;
}

const REPORT_REL = join("docs", "sprint_reports.html");

function listDir(path: string): string[] {
  return existsSync(path) ? readdirSync(path).sort() : [];
}

function relSprintDir(sprint: { dirName: string }): string {
  return join(".working", "sprints", sprint.dirName);
}

function writeTicket(path: string, ticket: Ticket): void {
  writeFileSync(path, JSON.stringify(ticket, null, 2) + "\n");
}

/** Parse + schema-validate, returning an error string instead of throwing —
 * postconditions report, the retry policy decides. */
function checkTicketFile(path: string, filename: string): { ticket?: Ticket; error?: string } {
  if (!existsSync(path)) return { error: `expected ticket file ${filename} to exist` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return { error: `${filename} is not valid JSON: ${(e as Error).message}` };
  }
  const errors = validateTicket(parsed, filename);
  if (errors.length > 0) return { error: errors.join("\n") };
  return { ticket: parsed as Ticket };
}

function initialValueErrors(t: Ticket, filename: string): string[] {
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

// ---------------------------------------------------------------- step 2

export async function stepSprintFocus(
  ctx: Ctx,
  sprintNumber: string,
  reuseDirName: string | null,
): Promise<void> {
  const sdir = sprintsDir(ctx.root);
  const before = listDir(sdir);

  const folderInstruction = reuseDirName
    ? `An incomplete sprint folder already exists at \`.working/sprints/${reuseDirName}/\`. ` +
      `REUSE it: write \`sprint_focus.md\` inside that exact folder. Do NOT create a new folder.`
    : `Create the folder \`.working/sprints/${sprintNumber}-<slug>/\` — you choose \`<slug>\`, a short ` +
      `kebab-case name for the focus area (lowercase letters, digits, hyphens) — and write ` +
      `\`sprint_focus.md\` inside it.`;

  await runAgentStep({
    stepId: "02-sprint-focus",
    cwd: ctx.root,
    bundleDir: ctx.bundleDir,
    vars: { sprintNumber, folderInstruction },
    check: () => {
      if (reuseDirName) {
        const extra = listDir(sdir).filter((d) => !before.includes(d));
        if (extra.length > 0)
          return `expected the existing folder ${reuseDirName} to be reused, but new entries appeared in .working/sprints/: ${extra.join(", ")}`;
        const focus = join(sdir, reuseDirName, "sprint_focus.md");
        if (!existsSync(focus) || statSync(focus).size === 0)
          return `expected a non-empty sprint_focus.md in .working/sprints/${reuseDirName}/`;
        return null;
      }
      const created = listDir(sdir).filter((d) => !before.includes(d));
      if (created.length !== 1)
        return `expected exactly one new sprint folder in .working/sprints/, found ${created.length} (${created.join(", ") || "none"})`;
      const dirName = created[0]!;
      const m = SPRINT_DIRNAME_RE.exec(dirName);
      if (!m)
        return `new sprint folder "${dirName}" does not match NN-kebab-case-slug (e.g. "${sprintNumber}-mvp")`;
      if (m[1] !== sprintNumber)
        return `new sprint folder "${dirName}" must be numbered ${sprintNumber}`;
      const focus = join(sdir, dirName, "sprint_focus.md");
      if (!existsSync(focus) || statSync(focus).size === 0)
        return `expected a non-empty sprint_focus.md in .working/sprints/${dirName}/`;
      return null;
    },
  });

  await gitCommitPaths(ctx.root, `chore(loop): sprint ${sprintNumber} focus`, [".working"]);
}

// ---------------------------------------------------------------- step 3

export async function stepSpec(ctx: Ctx, sprint: SprintSnapshot): Promise<void> {
  const specPath = join(sprintsDir(ctx.root), sprint.dirName, "spec.md");
  await runAgentStep({
    stepId: "03-spec",
    cwd: ctx.root,
    bundleDir: ctx.bundleDir,
    vars: { sprintDir: relSprintDir(sprint), sprintNumber: sprint.number },
    check: () =>
      existsSync(specPath) && statSync(specPath).size > 0
        ? null
        : `expected a non-empty spec.md at ${relSprintDir(sprint)}/spec.md`,
  });
  await gitCommitPaths(ctx.root, `chore(loop): sprint ${sprint.number} spec`, [".working"]);
}

// ---------------------------------------------------------------- step 4

/** Initial ticket filenames only — fix tickets (`NNN.1`) are review-created. */
const INITIAL_TICKET_FILENAME_RE = /^(\d{3})-[a-z0-9-]+\.json$/;

export async function stepTickets(ctx: Ctx, sprint: SprintSnapshot): Promise<void> {
  const ticketsDir = join(sprintsDir(ctx.root), sprint.dirName, "tickets");
  await runAgentStep({
    stepId: "04-tickets",
    cwd: ctx.root,
    bundleDir: ctx.bundleDir,
    vars: { sprintDir: relSprintDir(sprint), sprintNumber: sprint.number },
    check: () => {
      const files = listDir(ticketsDir);
      if (files.length === 0)
        return `expected at least one ticket file in ${relSprintDir(sprint)}/tickets/`;
      const errors: string[] = [];
      const numbers: number[] = [];
      for (const filename of files) {
        const m = INITIAL_TICKET_FILENAME_RE.exec(filename);
        if (!m) {
          errors.push(`${filename}: filename must match NNN-kebab-slug.json (e.g. 001-first-thing.json)`);
          continue;
        }
        numbers.push(Number(m[1]));
        const { ticket, error } = checkTicketFile(join(ticketsDir, filename), filename);
        if (error) errors.push(error);
        else errors.push(...initialValueErrors(ticket!, filename));
      }
      numbers.sort((a, b) => a - b);
      numbers.forEach((n, i) => {
        if (n !== i + 1)
          errors.push(`ticket numbers must start at 001 and be contiguous; found ${String(n).padStart(3, "0")} at position ${i + 1}`);
      });
      return errors.length > 0 ? errors.join("\n") : null;
    },
  });
  await gitCommitPaths(ctx.root, `chore(loop): sprint ${sprint.number} tickets`, [".working"]);
}

// ---------------------------------------------------------------- step 5.1

export async function stepImplement(
  ctx: Ctx,
  sprint: SprintSnapshot,
  ticketFilename: string,
): Promise<void> {
  const ticketsDir = join(sprintsDir(ctx.root), sprint.dirName, "tickets");
  const ticketPath = join(ticketsDir, ticketFilename);
  const relTicketPath = join(relSprintDir(sprint), "tickets", ticketFilename);
  const before = readTicketFile(ticketPath, ticketFilename);
  const headBefore = await gitHead(ctx.root);

  const commitType = isFixTicketId(before.id) ? "fix" : "feat";
  const commitFormat = `${commitType}(s${sprint.number}/${before.id}): <short description>`;

  const humanNoteSection = before.human_note
    ? `\n## Note from a human\n\nA human reviewed this ticket and left guidance you MUST take into account:\n\n${before.human_note}\n`
    : "";

  await runAgentStep({
    stepId: "05-implement",
    cwd: ctx.root,
    bundleDir: ctx.bundleDir,
    vars: {
      ticketPath: relTicketPath,
      ticketJson: JSON.stringify(before, null, 2),
      ticketId: before.id,
      sprintDir: relSprintDir(sprint),
      sprintNumber: sprint.number,
      commitFormat,
      humanNoteSection,
    },
    check: () => {
      const { ticket, error } = checkTicketFile(ticketPath, ticketFilename);
      if (error) return error;
      const t = ticket!;
      if (t.done && t.needs_human_intervention)
        return `${ticketFilename}: exactly one of "done" / "needs_human_intervention" may be true, not both`;
      if (!t.done && !t.needs_human_intervention)
        return `${ticketFilename}: the run changed neither "done" nor "needs_human_intervention" — set "done": true, or "needs_human_intervention": true with a concrete reason`;
      if (t.needs_human_intervention && !t.needs_human_intervention_reason)
        return `${ticketFilename}: "needs_human_intervention" is true but "needs_human_intervention_reason" is empty`;
      if (t.reviewed)
        return `${ticketFilename}: "reviewed" is orchestrator-owned and must not be set by the implement agent`;
      return null;
    },
  });

  // Record exactly this run's commits on the ticket (spec §6.4).
  const newShas = await gitNewCommits(ctx.root, headBefore);
  const after = readTicketFile(ticketPath, ticketFilename);
  after.commits = [...before.commits, ...newShas.filter((s) => !before.commits.includes(s))];
  writeTicket(ticketPath, after);

  await gitCommitPaths(
    ctx.root,
    `chore(loop): sprint ${sprint.number} ticket ${before.id} status`,
    [".working"],
  );
}

// ---------------------------------------------------------------- step 5.2

export async function stepReview(
  ctx: Ctx,
  sprint: SprintSnapshot,
  ticketFilename: string,
): Promise<void> {
  const ticketsDir = join(sprintsDir(ctx.root), sprint.dirName, "tickets");
  const ticketPath = join(ticketsDir, ticketFilename);
  const ticket = readTicketFile(ticketPath, ticketFilename);
  const isFix = isFixTicketId(ticket.id);

  const beforeFiles = new Map<string, string>(
    listDir(ticketsDir).map((f) => [f, readFileSync(join(ticketsDir, f), "utf8")]),
  );
  const fixAlreadyExists = [...beforeFiles.keys()].some(
    (f) => f !== ticketFilename && f.startsWith(`${ticket.id}.`),
  );

  const fixTicketRules = isFix
    ? `This IS a fix ticket (its id contains "."). You must NOT create any new ticket. If a finding is ` +
      `serious enough to act on, set "needs_human_intervention": true with a concrete ` +
      `"needs_human_intervention_reason" on this ticket (${ticketFilename}); otherwise drop the finding.`
    : fixAlreadyExists
      ? `A fix ticket for this ticket already exists. You must NOT create another one. Findings not ` +
        `covered by it should be dropped.`
      : `If (and only if) your findings are worth fixing, create exactly ONE fix ticket: ` +
        `\`${relSprintDir(sprint)}/tickets/${ticket.id}.1-<kebab-slug>.json\`, following the same JSON schema ` +
        `as the ticket under review, with "id": "${ticket.id}.1", the same (or improved) tests as the ` +
        `findings warrant, and initial values: "done": false, "reviewed": false, all "tests[].passes": false, ` +
        `"needs_human_intervention": false, null reason and human_note, empty "commits". Never more than one.`;

  const diff = await gitDiffOfCommits(ctx.root, ticket.commits);

  await runAgentStep({
    stepId: "05-review",
    cwd: ctx.root,
    bundleDir: ctx.bundleDir,
    vars: {
      ticketPath: join(relSprintDir(sprint), "tickets", ticketFilename),
      ticketJson: JSON.stringify(ticket, null, 2),
      ticketId: ticket.id,
      sprintDir: relSprintDir(sprint),
      sprintNumber: sprint.number,
      fixTicketRules,
      diff,
    },
    check: () => {
      const afterFiles = listDir(ticketsDir);
      const created = afterFiles.filter((f) => !beforeFiles.has(f));
      const errors: string[] = [];

      if (created.length > 1) {
        errors.push(`at most one fix ticket may be created per review; found ${created.length}: ${created.join(", ")}`);
      } else if (created.length === 1) {
        const filename = created[0]!;
        if (isFix) {
          errors.push(`reviews of fix tickets must never create tickets, but ${filename} was created`);
        } else if (fixAlreadyExists) {
          errors.push(`a fix ticket for ${ticket.id} already exists; ${filename} must not be created`);
        } else if (!new RegExp(`^${ticket.id}\\.1-[a-z0-9-]+\\.json$`).test(filename)) {
          errors.push(`fix ticket must be named ${ticket.id}.1-<kebab-slug>.json, got ${filename}`);
        } else {
          const { ticket: fix, error } = checkTicketFile(join(ticketsDir, filename), filename);
          if (error) errors.push(error);
          else errors.push(...initialValueErrors(fix!, filename));
        }
      }

      // Existing tickets must be untouched — except the reviewed fix ticket,
      // which may have needs_human_intervention flagged on it.
      for (const [filename, contentBefore] of beforeFiles) {
        const path = join(ticketsDir, filename);
        if (!existsSync(path)) {
          errors.push(`${filename} was deleted; reviews must not delete tickets`);
          continue;
        }
        const contentAfter = readFileSync(path, "utf8");
        if (contentAfter === contentBefore) continue;
        if (filename === ticketFilename && isFix) {
          const { ticket: t, error } = checkTicketFile(path, filename);
          if (error) errors.push(error);
          else if (!t!.needs_human_intervention || !t!.needs_human_intervention_reason)
            errors.push(
              `${filename}: the only allowed change to a reviewed fix ticket is setting "needs_human_intervention": true with a concrete reason`,
            );
        } else {
          errors.push(`${filename} was modified; the review must not modify existing tickets`);
        }
      }

      return errors.length > 0 ? errors.join("\n") : null;
    },
  });

  // Orchestrator-owned: mark reviewed and commit (spec §8.5.2).
  const after = readTicketFile(ticketPath, ticketFilename);
  after.reviewed = true;
  writeTicket(ticketPath, after);
  await gitCommitPaths(
    ctx.root,
    `chore(loop): sprint ${sprint.number} ticket ${ticket.id} reviewed`,
    [".working"],
  );
}

// ---------------------------------------------------------------- step 6

export async function stepReport(ctx: Ctx, sprint: SprintSnapshot): Promise<void> {
  const reportPath = join(ctx.root, REPORT_REL);
  const marker = `<section id="sprint-${sprint.number}">`;

  // Sections other sprints already have must survive the edit.
  const html = existsSync(reportPath) ? readFileSync(reportPath, "utf8") : "";
  const otherMarkers = [...html.matchAll(/<section id="sprint-(\d{2})">/g)]
    .map((m) => m[0])
    .filter((m) => m !== marker);

  // Fresh read: tickets may have been created/updated since the snapshot.
  const current = readSprint(ctx.root, sprint.dirName);
  const shas = (current.tickets ?? []).flatMap(({ ticket }) => ticket.commits);
  const commitSummaries = await gitSummaries(ctx.root, shas);

  const blocked = (current.tickets ?? [])
    .filter(({ ticket }) => ticket.needs_human_intervention)
    .map(
      ({ ticket }) =>
        `- sprint ${sprint.number}, ticket ${ticket.id} "${ticket.title}": ${ticket.needs_human_intervention_reason}`,
    );

  await runAgentStep({
    stepId: "06-report",
    cwd: ctx.root,
    bundleDir: ctx.bundleDir,
    vars: {
      sprintNumber: sprint.number,
      sprintDir: relSprintDir(sprint),
      reportPath: REPORT_REL,
      commitSummaries,
      blockedTickets: blocked.length > 0 ? blocked.join("\n") : "(none)",
    },
    check: () => {
      if (!existsSync(reportPath)) return `expected ${REPORT_REL} to exist`;
      const content = readFileSync(reportPath, "utf8");
      const count = content.split(marker).length - 1;
      if (count === 0) return `expected ${REPORT_REL} to contain ${marker}`;
      if (count > 1)
        return `expected exactly one ${marker} in ${REPORT_REL}, found ${count} — replace the sprint's own section, never duplicate it`;
      const lost = otherMarkers.filter((m) => !content.includes(m));
      if (lost.length > 0)
        return `other sprints' sections must not be removed; missing: ${lost.join(", ")}`;
      return null;
    },
  });

  await gitCommitPaths(ctx.root, `chore(loop): sprint ${sprint.number} report`, [REPORT_REL]);
}

// ---------------------------------------------------------------- step 7

const VISION_STATUS_HEADINGS = [
  "## What exists now",
  "## What works (verified)",
  "## Known gaps",
  "## Blocked on human",
];

export async function stepVisionStatus(ctx: Ctx, sprint: SprintSnapshot): Promise<void> {
  const rel = join(".working", "vision_status.md");
  const path = join(ctx.root, rel);
  const stamp = `_Last updated: sprint ${sprint.number}_`;

  await runAgentStep({
    stepId: "07-vision-status",
    cwd: ctx.root,
    bundleDir: ctx.bundleDir,
    vars: {
      sprintNumber: sprint.number,
      sprintDir: relSprintDir(sprint),
      visionStatusPath: rel,
    },
    check: () => {
      if (!existsSync(path)) return `expected ${rel} to exist`;
      const content = readFileSync(path, "utf8");
      const firstLine = (content.split("\n")[0] ?? "").trim();
      if (firstLine !== stamp)
        return `expected the first line of ${rel} to be exactly "${stamp}", got "${firstLine}"`;
      const missing = VISION_STATUS_HEADINGS.filter((h) => !content.includes(h));
      if (missing.length > 0)
        return `expected ${rel} to contain the template headings; missing: ${missing.join(", ")}`;
      return null;
    },
  });

  await gitCommitPaths(ctx.root, `chore(loop): sprint ${sprint.number} vision status`, [rel]);
}
