/**
 * Step handlers 2–7 (spec §8.2–§8.7): each fills prompt vars, defines the
 * programmatic postcondition, runs the agent through the spawn wrapper, and
 * lets the orchestrator commit the resulting loop artifacts (spec §6.4).
 */

import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runAgentStep } from "./agent.ts";
import { CLEANUP_CATEGORIES, cleanupCommitType, type CleanupCategory } from "./cleanup.ts";
import { colorEnabled, style } from "./console.ts";
import {
  emptyInboxFocus,
  FEEDBACK_DIR,
  handledName,
  handledPath,
  HANDLED_DIR,
  INBOX_DIR,
  markTriaged,
  parseDispositions,
  parseFeedbackStamp,
  summarizeDispositions,
} from "./feedback.ts";
import {
  gitCommitPaths,
  gitDiffOfCommits,
  gitHead,
  gitIsIgnored,
  gitNewCommits,
  gitSummaries,
} from "./git.ts";
import { UX_TICKETIZED_NO, UX_TICKETIZED_YES } from "./phases.ts";
import {
  checkCandidatesStamp,
  checkCleanupTickets,
  checkFeedbackFocus,
  checkImplement,
  checkInitialTickets,
  checkNonEmpty,
  checkReport,
  checkReview,
  checkSprintFocus,
  checkStamped,
  checkUxTickets,
  checkVisionStatus,
} from "./postconditions.ts";
import {
  listDir,
  nonEmptyFile,
  readDirFiles,
  readFeedbackInbox,
  readRequiredTextFile,
  readSprint,
  readTextFile,
  readTicketFile,
  sprintsDir,
  type SprintSnapshot,
} from "./snapshot.ts";
import {
  hasFixTicketFor,
  isFixTicketId,
  nextTicketNumber,
  UX_TICKET_FILENAME_RE,
  type Ticket,
} from "./tickets.ts";

export interface Ctx {
  root: string;
  bundleDir: string;
  /**
   * The describe() text of the phase about to run — the outer loop fills it
   * in for the step banner. Optional so tests can call steps directly.
   */
  phaseDescription?: string;
}

const REPORT_REL = join("docs", "sprint_reports.html");
const VISION_REL = join("docs", "vision.md");

function relSprintDir(sprint: { dirName: string }): string {
  return join(".working", "sprints", sprint.dirName);
}

/** What step F2 must leave exactly as it found it, as one path → contents
 * map: everything under `docs/feedback/`, and `docs/vision.md` — the
 * human-authored north star the triage may propose changes to but never
 * edit (spec §8.9). */
function readF2ReadOnly(root: string): Map<string, string> {
  const entries: [string, string][] = [];
  for (const dir of [FEEDBACK_DIR, INBOX_DIR, HANDLED_DIR]) {
    for (const [name, content] of readDirFiles(join(root, dir))) {
      entries.push([join(dir, name), content]);
    }
  }
  const vision = readTextFile(join(root, VISION_REL));
  if (vision !== null) entries.push([VISION_REL, vision]);
  return new Map(entries);
}

function writeTicket(path: string, ticket: Ticket): void {
  writeFileSync(path, JSON.stringify(ticket, null, 2) + "\n");
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
    description: ctx.phaseDescription,
    cwd: ctx.root,
    bundleDir: ctx.bundleDir,
    vars: { sprintNumber, folderInstruction },
    check: () => {
      const after = listDir(sdir);
      return checkSprintFocus(
        {
          before,
          after,
          withFocus: after.filter((d) => nonEmptyFile(join(sdir, d, "sprint_focus.md"))),
        },
        { sprintNumber, reuseDirName },
      );
    },
  });

  await gitCommitPaths(ctx.root, `chore(loop): sprint ${sprintNumber} focus`, [".working"]);
}

// --------------------------------------------------------------- step F2

/**
 * Orchestrator-owned archive (spec §8.9): move each triaged item to
 * `docs/feedback/handled/NN-<name>.md`, never overwriting a name already
 * there. Runs after the stamp flip, so a crash here costs at worst a
 * re-triage of the leftovers in the next feedback sprint — never a triage
 * the loop forgets it did.
 */
function archiveInboxItems(root: string, sprintNumber: string, items: string[]): void {
  if (items.length === 0) return;
  const handledDir = join(root, HANDLED_DIR);
  mkdirSync(handledDir, { recursive: true });
  for (const item of items) {
    const from = join(root, INBOX_DIR, item);
    if (!existsSync(from)) continue; // already gone — nothing to archive
    renameSync(from, join(root, handledPath(handledName(sprintNumber, item, listDir(handledDir)))));
  }
}

/** Undo an agent-written `triaged=yes` on a focus the postcondition
 * rejected: the flip is the orchestrator's word that F2 finished. */
function untriage(focusPath: string): void {
  const content = readTextFile(focusPath);
  if (content === null) return;
  const lines = content.split("\n");
  const stamp = parseFeedbackStamp((lines[0] ?? "").trim());
  if (stamp?.triaged !== "yes") return;
  lines[0] = (lines[0] ?? "").trim().replace("triaged=yes", "triaged=no");
  writeFileSync(focusPath, lines.join("\n"));
}

export async function stepFeedbackFocus(ctx: Ctx, sprint: SprintSnapshot): Promise<void> {
  const relFocusPath = join(relSprintDir(sprint), "sprint_focus.md");
  const focusPath = join(ctx.root, relFocusPath);
  const commit = async () => {
    // A project may gitignore its feedback; `git add` on an ignored path is
    // a hard error, and the archive on disk is what matters either way.
    const track =
      existsSync(join(ctx.root, FEEDBACK_DIR)) && !(await gitIsIgnored(ctx.root, FEEDBACK_DIR));
    await gitCommitPaths(ctx.root, `chore(loop): sprint ${sprint.number} feedback focus`, [
      ".working",
      ...(track ? [FEEDBACK_DIR] : []),
    ]);
  };

  // Fresh read: the boundary decided the sprint type on this inbox, but the
  // folder is the human's — triage exactly what is in it when F2 runs, and
  // archive exactly that list afterwards. Read as untrusted: an item that
  // disappears between the listing and the read is simply not an item.
  const read = readFeedbackInbox(ctx.root)
    .map((name) => ({ name, text: (readTextFile(join(ctx.root, INBOX_DIR, name)) ?? "").trim() }))
    .filter(({ text }) => text.length > 0);
  const items = read.map(({ name }) => name);

  // Emptied between the boundary and here (the human withdrew the items, or
  // a crash left the folder behind). Deterministic, so no agent is spawned
  // to triage nothing — spec §8.9.
  if (items.length === 0) {
    writeFileSync(focusPath, emptyInboxFocus(sprint.number));
    console.log(
      style(
        "cyan",
        `[mmm-loop] 📮 sprint ${sprint.number}: the inbox is empty — nothing to triage`,
        colorEnabled,
      ),
    );
    await commit();
    return;
  }

  // Heading = the bare filename, the same form the focus file must use for
  // its disposition blocks — so the agent copies rather than transcribes.
  const feedbackItems = read
    .map(({ name, text }) => `### ${name}\n\n_${join(INBOX_DIR, name)}_\n\n${text}\n`)
    .join("\n");
  const readOnlyBefore = readF2ReadOnly(ctx.root);

  try {
    await runAgentStep({
      stepId: "02-feedback-focus",
      description: ctx.phaseDescription,
      cwd: ctx.root,
      bundleDir: ctx.bundleDir,
      vars: {
        sprintDir: relSprintDir(sprint),
        sprintNumber: sprint.number,
        focusPath: relFocusPath,
        itemCount: String(items.length),
        feedbackItems,
      },
      check: () =>
        checkFeedbackFocus(
          readTextFile(focusPath),
          { before: readOnlyBefore, after: readF2ReadOnly(ctx.root) },
          { relPath: relFocusPath, itemNames: items },
        ),
    });
  } catch (e) {
    // A rejected focus stays on disk for the human to read — but never
    // wearing the orchestrator's `triaged=yes`, which is the one thing
    // derivation trusts. An agent that stamped itself done must not make
    // the next run skip the triage it just failed.
    untriage(focusPath);
    throw e;
  }

  // Orchestrator-owned, in this order (spec §8.9): flip the stamp to
  // `triaged=yes` — derivation's one signal that F2 is done — then archive,
  // then commit both. Flipping first means a crash can only cost a
  // re-triage, never a silently un-archived one.
  const focus = readRequiredTextFile(focusPath);
  const lines = focus.split("\n");
  lines[0] = markTriaged(lines[0] ?? "");
  writeFileSync(focusPath, lines.join("\n"));
  archiveInboxItems(ctx.root, sprint.number, items);
  await commit();

  const dispositions = items.flatMap((name) => parseDispositions(focus).get(name) ?? []);
  console.log(
    style(
      "cyan",
      `[mmm-loop] 📮 sprint ${sprint.number} feedback: ${summarizeDispositions(dispositions)}` +
        (dispositions.includes("vision-change")
          ? " — a vision change is proposed for you in " + relFocusPath
          : ""),
      colorEnabled,
    ),
  );
}

// ---------------------------------------------------------------- step 3

export async function stepSpec(ctx: Ctx, sprint: SprintSnapshot): Promise<void> {
  const specPath = join(sprintsDir(ctx.root), sprint.dirName, "spec.md");
  await runAgentStep({
    stepId: "03-spec",
    description: ctx.phaseDescription,
    cwd: ctx.root,
    bundleDir: ctx.bundleDir,
    vars: { sprintDir: relSprintDir(sprint), sprintNumber: sprint.number },
    check: () => checkNonEmpty(readTextFile(specPath), `${relSprintDir(sprint)}/spec.md`),
  });
  await gitCommitPaths(ctx.root, `chore(loop): sprint ${sprint.number} spec`, [".working"]);
}

// ---------------------------------------------------------------- step 4

export async function stepTickets(ctx: Ctx, sprint: SprintSnapshot): Promise<void> {
  const ticketsDir = join(sprintsDir(ctx.root), sprint.dirName, "tickets");
  const relTicketsDir = join(relSprintDir(sprint), "tickets");
  await runAgentStep({
    stepId: "04-tickets",
    description: ctx.phaseDescription,
    cwd: ctx.root,
    bundleDir: ctx.bundleDir,
    vars: { sprintDir: relSprintDir(sprint), sprintNumber: sprint.number },
    check: () => checkInitialTickets(readDirFiles(ticketsDir), relTicketsDir),
  });
  await gitCommitPaths(ctx.root, `chore(loop): sprint ${sprint.number} tickets`, [".working"]);
}

// ---------------------------------------------------------------- step C3

export async function stepCleanupIdentify(ctx: Ctx, sprint: SprintSnapshot): Promise<void> {
  const specPath = join(sprintsDir(ctx.root), sprint.dirName, "spec.md");
  await runAgentStep({
    stepId: "03-cleanup-identify",
    description: ctx.phaseDescription,
    cwd: ctx.root,
    bundleDir: ctx.bundleDir,
    vars: { sprintDir: relSprintDir(sprint), sprintNumber: sprint.number },
    check: () => checkCandidatesStamp(readTextFile(specPath), `${relSprintDir(sprint)}/spec.md`),
  });
  await gitCommitPaths(ctx.root, `chore(loop): sprint ${sprint.number} spec`, [".working"]);
}

// ---------------------------------------------------------------- step C4

/** One invocation per yes-category; the outer derive→run→re-derive cycle
 * produces the sequential category-order runs — no internal loop. Unlike
 * step 4 there is no contiguity check: skipped categories leave ID gaps. */
export async function stepCleanupTickets(
  ctx: Ctx,
  sprint: SprintSnapshot,
  categoryKey: CleanupCategory,
): Promise<void> {
  const category = CLEANUP_CATEGORIES.find((c) => c.key === categoryKey)!;
  const ticketsDir = join(sprintsDir(ctx.root), sprint.dirName, "tickets");
  const beforeFiles = readDirFiles(ticketsDir);

  await runAgentStep({
    stepId: "04-cleanup-tickets",
    description: ctx.phaseDescription,
    cwd: ctx.root,
    bundleDir: ctx.bundleDir,
    vars: {
      sprintDir: relSprintDir(sprint),
      sprintNumber: sprint.number,
      category: category.key,
      ticketId: category.ticketId,
    },
    check: () =>
      checkCleanupTickets(
        { before: beforeFiles, after: readDirFiles(ticketsDir) },
        {
          category: category.key,
          ticketId: category.ticketId,
          relTicketsDir: join(relSprintDir(sprint), "tickets"),
        },
      ),
  });

  await gitCommitPaths(
    ctx.root,
    `chore(loop): sprint ${sprint.number} tickets (${category.key})`,
    [".working"],
  );
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

  // Cleanup category tickets commit as refactor/docs (spec §6.4); fix
  // tickets keep `fix`, and UX tickets keep `feat` even on cleanup sprints —
  // a UX fix is not cleanup.
  const commitType = isFixTicketId(before.id)
    ? "fix"
    : sprint.isCleanup && !UX_TICKET_FILENAME_RE.test(ticketFilename)
      ? cleanupCommitType(before.id)
      : "feat";
  const commitFormat = `${commitType}(s${sprint.number}/${before.id}): <short description>`;

  const humanNoteSection = before.human_note
    ? `\n## Note from a human\n\nA human reviewed this ticket and left guidance you MUST take into account:\n\n${before.human_note}\n`
    : "";

  await runAgentStep({
    stepId: "05-implement",
    description: ctx.phaseDescription,
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
    check: () => checkImplement(readTextFile(ticketPath), ticketFilename),
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

  const beforeFiles = readDirFiles(ticketsDir);
  const fixAlreadyExists = hasFixTicketFor(beforeFiles.keys(), ticket.id, ticketFilename);

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
    description: ctx.phaseDescription,
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
    check: () =>
      checkReview(
        { before: beforeFiles, after: readDirFiles(ticketsDir) },
        { ticketFilename, ticketId: ticket.id, isFix, fixAlreadyExists },
      ),
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

// ---------------------------------------------------------------- step 5.5.1

export async function stepUxPlan(ctx: Ctx, sprint: SprintSnapshot): Promise<void> {
  const relPlanPath = join(relSprintDir(sprint), "ux_test_plan.md");
  const planPath = join(ctx.root, relPlanPath);

  // Fresh read: tickets (and their commits) may postdate the snapshot.
  const current = readSprint(ctx.root, sprint.dirName);
  const shas = (current.tickets ?? []).flatMap(({ ticket }) => ticket.commits);
  const commitSummaries = await gitSummaries(ctx.root, shas);

  await runAgentStep({
    stepId: "05.5-ux-plan",
    description: ctx.phaseDescription,
    cwd: ctx.root,
    bundleDir: ctx.bundleDir,
    vars: { sprintDir: relSprintDir(sprint), sprintNumber: sprint.number, commitSummaries },
    check: () => checkNonEmpty(readTextFile(planPath), relPlanPath),
  });
  await gitCommitPaths(ctx.root, `chore(loop): sprint ${sprint.number} ux plan`, [relPlanPath]);
}

// ---------------------------------------------------------------- step 5.5.2

export async function stepUxTest(ctx: Ctx, sprint: SprintSnapshot): Promise<void> {
  const relFindingsPath = join(relSprintDir(sprint), "ux_findings.md");
  const findingsPath = join(ctx.root, relFindingsPath);

  await runAgentStep({
    stepId: "05.5-ux-test",
    description: ctx.phaseDescription,
    cwd: ctx.root,
    bundleDir: ctx.bundleDir,
    vars: { sprintDir: relSprintDir(sprint), sprintNumber: sprint.number },
    check: () => checkStamped(readTextFile(findingsPath), relFindingsPath, UX_TICKETIZED_NO),
  });
  // File-scoped pathspec: scratch/run artifacts the test agent left behind
  // must never end up in this commit.
  await gitCommitPaths(ctx.root, `chore(loop): sprint ${sprint.number} ux findings`, [
    relFindingsPath,
    join(".working", "learnings.md"),
  ]);
}

// ---------------------------------------------------------------- step 5.5.3

export async function stepUxTickets(ctx: Ctx, sprint: SprintSnapshot): Promise<void> {
  const ticketsDir = join(sprintsDir(ctx.root), sprint.dirName, "tickets");
  const relFindingsPath = join(relSprintDir(sprint), "ux_findings.md");
  const findingsPath = join(ctx.root, relFindingsPath);

  const beforeFiles = readDirFiles(ticketsDir);
  const { maxExisting, next } = nextTicketNumber(beforeFiles.keys());

  await runAgentStep({
    stepId: "05.5-ux-tickets",
    description: ctx.phaseDescription,
    cwd: ctx.root,
    bundleDir: ctx.bundleDir,
    vars: {
      sprintDir: relSprintDir(sprint),
      sprintNumber: sprint.number,
      findings: readRequiredTextFile(findingsPath),
      nextTicketNumber: next,
    },
    check: () =>
      checkUxTickets(
        { before: beforeFiles, after: readDirFiles(ticketsDir) },
        { maxExisting, nextTicketNumber: next },
      ),
  });

  // Orchestrator-owned: flip the findings stamp (spec §8.5.3) and commit it
  // together with the new tickets. A zero-candidate cleanup sprint reaches
  // this step with no tickets/ dir at all — git rejects missing pathspecs.
  const lines = readRequiredTextFile(findingsPath).split("\n");
  lines[0] = UX_TICKETIZED_YES;
  writeFileSync(findingsPath, lines.join("\n"));
  await gitCommitPaths(ctx.root, `chore(loop): sprint ${sprint.number} ux tickets`, [
    ...(existsSync(ticketsDir) ? [join(relSprintDir(sprint), "tickets")] : []),
    relFindingsPath,
    join(".working", "learnings.md"),
  ]);
}

// ---------------------------------------------------------------- step 6

/** The report's sprint-type section for a feedback sprint: the orchestrator
 * has already parsed the triage, so the agent is told what was decided
 * rather than asked to find it. */
function feedbackReportSection(root: string, sprint: SprintSnapshot, ticketCount: number): string {
  const focus = readTextFile(join(sprintsDir(root), sprint.dirName, "sprint_focus.md")) ?? "";
  const dispositions = [...parseDispositions(focus).values()].flat();
  const proposed = dispositions.includes("vision-change");
  return (
    `\n## Feedback sprint\n\nSprint ${sprint.number} was a feedback sprint: it was planned from ` +
    `human feedback, not from the vision. Its \`sprint_focus.md\` triages every item it handled ` +
    `(${summarizeDispositions(dispositions)}); the items themselves are archived under ` +
    `\`docs/feedback/handled/${sprint.number}-*.md\`. The section must say, per item, what was ` +
    `decided and what actually shipped.` +
    (proposed
      ? ` This sprint proposes a change to \`docs/vision.md\` (see "## Vision proposals" in the ` +
        `focus): render it as prominently as a blocked ticket — the run cannot resolve it, only a ` +
        `human can.`
      : "") +
    (ticketCount === 0
      ? ` This sprint has zero tickets: the triage found nothing actionable — the section must ` +
        `state exactly that, per item.`
      : "") +
    `\n`
  );
}

export async function stepReport(ctx: Ctx, sprint: SprintSnapshot): Promise<void> {
  const reportPath = join(ctx.root, REPORT_REL);
  const htmlBefore = readTextFile(reportPath);

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

  // Always-filled var (fillTemplate fails loudly otherwise) — same pattern
  // as humanNoteSection in stepImplement.
  const sprintTypeSection = sprint.isCleanup
    ? `\n## Cleanup sprint\n\nSprint ${sprint.number} was a cleanup sprint: there is no ` +
      `sprint_focus.md — the spec's candidates and their tickets are the whole story. ` +
      `Summarize the improvements made (architecture / clean code / docs) instead of feature work.` +
      ((current.tickets ?? []).length === 0
        ? ` This sprint has zero tickets: identification found nothing worth cleaning — the ` +
          `section must state exactly that; it IS the summary.`
        : "") +
      `\n`
    : sprint.isFeedback
      ? feedbackReportSection(ctx.root, sprint, (current.tickets ?? []).length)
      : "";

  await runAgentStep({
    stepId: "06-report",
    description: ctx.phaseDescription,
    cwd: ctx.root,
    bundleDir: ctx.bundleDir,
    vars: {
      sprintNumber: sprint.number,
      sprintDir: relSprintDir(sprint),
      reportPath: REPORT_REL,
      commitSummaries,
      blockedTickets: blocked.length > 0 ? blocked.join("\n") : "(none)",
      sprintTypeSection,
    },
    check: () =>
      checkReport(
        { before: htmlBefore, after: readTextFile(reportPath) },
        { sprintNumber: sprint.number, relPath: REPORT_REL },
      ),
  });

  await gitCommitPaths(ctx.root, `chore(loop): sprint ${sprint.number} report`, [REPORT_REL]);
}

// ---------------------------------------------------------------- step 7

export async function stepVisionStatus(ctx: Ctx, sprint: SprintSnapshot): Promise<void> {
  const rel = join(".working", "vision_status.md");
  const path = join(ctx.root, rel);
  const stamp = `_Last updated: sprint ${sprint.number}_`;

  await runAgentStep({
    stepId: "07-vision-status",
    description: ctx.phaseDescription,
    cwd: ctx.root,
    bundleDir: ctx.bundleDir,
    vars: {
      sprintNumber: sprint.number,
      sprintDir: relSprintDir(sprint),
      visionStatusPath: rel,
    },
    check: () => checkVisionStatus(readTextFile(path), { relPath: rel, stamp }),
  });

  await gitCommitPaths(ctx.root, `chore(loop): sprint ${sprint.number} vision status`, [rel]);
}
