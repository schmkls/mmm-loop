/**
 * The outer loop (spec §6, §9): derive the phase from filesystem state, run
 * the matching step, repeat. Stop conditions are plain code — no LLM judgment
 * anywhere in the control path.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ALLOWED_CLAUDE_USER, CLEANUP_CADENCE } from "../config.ts";
import { claudeUserProblem } from "./claude-user.ts";
import { isCadenceCleanup } from "./cleanup.ts";
import { colorEnabled, style } from "./console.ts";
import { BlockedError, LoopError } from "./errors.ts";
import { derivePhase } from "./phases.ts";
import { missingRequiredFiles } from "./scaffold.ts";
import { readSnapshot, sprintsDir } from "./snapshot.ts";
import {
  stepCleanupIdentify,
  stepCleanupTickets,
  stepImplement,
  stepReport,
  stepReview,
  stepSpec,
  stepSprintFocus,
  stepTickets,
  stepUxPlan,
  stepUxTest,
  stepUxTickets,
  stepVisionStatus,
  type Ctx,
} from "./steps.ts";

export interface RunOptions {
  maxSprints: number;
  forceCleanup: boolean;
}

export async function run(ctx: Ctx, { maxSprints, forceCleanup }: RunOptions): Promise<void> {
  // Step 1 (spec §8.1): existence-only validation.
  const missing = missingRequiredFiles(ctx.root);
  if (missing.length > 0) {
    throw new LoopError(
      `Missing required file(s):\n` +
        missing.map((f) => `  - ${f}`).join("\n") +
        `\nRun \`bun scripts/mmm-loop/loop.ts init\` to scaffold them.`,
    );
  }

  // Step 1 continued (spec §8.1): refuse to run as the wrong Claude account.
  // Checked once at startup, before any agent spawns or git operation; an
  // account switch mid-run is out of scope. Env override wins when set;
  // empty string = explicit "accept any" for this run.
  const allowedUser =
    process.env.MMM_LOOP_ALLOWED_CLAUDE_USER !== undefined
      ? process.env.MMM_LOOP_ALLOWED_CLAUDE_USER || null
      : ALLOWED_CLAUDE_USER;
  const userProblem = claudeUserProblem(allowedUser);
  if (userProblem) throw new LoopError(userProblem);

  let completedThisRun = 0;
  // dirName of the sprint whose steps this run has executed — so a sprint
  // that closes without re-running steps 6/7 (resume after a human unblock,
  // spec §10) still gets its stop conditions applied at the boundary below.
  let workedOnSprint: string | null = null;
  // --cleanup applies to the first sprint *created* during the run (spec §5);
  // consumed on use. Cadence stays purely number-derived, so a forced 02
  // still yields a cadence 03.
  let forceCleanupPending = forceCleanup;

  while (true) {
    const snapshot = readSnapshot(ctx.root);
    const phase = derivePhase(snapshot);

    // Sprint boundary: derivation wants to start a brand-new sprint, meaning
    // the previous one (if any) is fully complete. Apply spec §9 here.
    if (phase.step === "sprint-focus" && phase.reuseDirName === null) {
      const latest = snapshot.sprints.at(-1);
      if (latest && latest.dirName === workedOnSprint) {
        const blocked = (latest.tickets ?? [])
          .filter(({ ticket }) => ticket.needs_human_intervention)
          .map(({ ticket }) => `sprint ${latest.number}, ticket ${ticket.id}: ${ticket.title}`);
        if (blocked.length > 0) throw new BlockedError(blocked);
        completedThisRun += 1;
        workedOnSprint = null;
        console.log(
          style(
            "green",
            `[mmm-loop] 🎉 sprint ${latest.number} complete (${completedThisRun}/${maxSprints} this run)`,
            colorEnabled,
          ),
        );
      }
      if (completedThisRun >= maxSprints) {
        if (forceCleanupPending) {
          console.log("[mmm-loop] --cleanup had no effect: this run created no new sprint");
        }
        return;
      }

      // Cleanup sprint creation (spec §6.1): the orchestrator, not an agent,
      // decides the type and creates the NN-cleanup folder, so the type is
      // on disk from the first moment and resume can branch on it. No commit
      // here — git can't track an empty dir; the first commit is C3's spec.
      const wantCleanup =
        forceCleanupPending || isCadenceCleanup(phase.sprintNumber, CLEANUP_CADENCE);
      if (wantCleanup) {
        forceCleanupPending = false;
        mkdirSync(join(sprintsDir(ctx.root), `${phase.sprintNumber}-cleanup`), {
          recursive: true,
        });
        console.log(
          style(
            "cyan",
            `[mmm-loop] 🧹 sprint ${phase.sprintNumber} will be a cleanup sprint`,
            colorEnabled,
          ),
        );
        continue; // re-derive: lands on cleanup-identify
      }
    }

    // The spawn wrapper prints the step banner (and its `phase: <describe>`
    // grep-contract line) — it alone knows about the §6.3 retry reprint.
    const sctx: Ctx = { ...ctx, phaseDescription: describe(phase) };
    switch (phase.step) {
      case "sprint-focus":
        workedOnSprint = phase.reuseDirName;
        await stepSprintFocus(sctx, phase.sprintNumber, phase.reuseDirName);
        break;
      case "spec":
        workedOnSprint = phase.sprint.dirName;
        await stepSpec(sctx, phase.sprint);
        break;
      case "tickets":
        workedOnSprint = phase.sprint.dirName;
        await stepTickets(sctx, phase.sprint);
        break;
      case "cleanup-identify":
        workedOnSprint = phase.sprint.dirName;
        await stepCleanupIdentify(sctx, phase.sprint);
        break;
      case "cleanup-tickets":
        workedOnSprint = phase.sprint.dirName;
        await stepCleanupTickets(sctx, phase.sprint, phase.category);
        break;
      case "implement":
        workedOnSprint = phase.sprint.dirName;
        await stepImplement(sctx, phase.sprint, phase.ticketFilename);
        break;
      case "review":
        workedOnSprint = phase.sprint.dirName;
        await stepReview(sctx, phase.sprint, phase.ticketFilename);
        break;
      case "ux-plan":
        workedOnSprint = phase.sprint.dirName;
        await stepUxPlan(sctx, phase.sprint);
        break;
      case "ux-test":
        workedOnSprint = phase.sprint.dirName;
        await stepUxTest(sctx, phase.sprint);
        break;
      case "ux-tickets":
        workedOnSprint = phase.sprint.dirName;
        await stepUxTickets(sctx, phase.sprint);
        break;
      case "report":
        workedOnSprint = phase.sprint.dirName;
        await stepReport(sctx, phase.sprint);
        break;
      case "vision-status":
        workedOnSprint = phase.sprint.dirName;
        await stepVisionStatus(sctx, phase.sprint);
        break;
    }
  }
}

function describe(phase: ReturnType<typeof derivePhase>): string {
  switch (phase.step) {
    case "sprint-focus":
      return phase.reuseDirName
        ? `step 2 — sprint focus (reusing ${phase.reuseDirName})`
        : `step 2 — sprint focus (new sprint ${phase.sprintNumber})`;
    case "spec":
      return `step 3 — spec (sprint ${phase.sprint.number})`;
    case "tickets":
      return `step 4 — tickets (sprint ${phase.sprint.number})`;
    case "cleanup-identify":
      return `step C3 — identify cleanup candidates (sprint ${phase.sprint.number})`;
    case "cleanup-tickets":
      return `step C4 — cleanup ticket: ${phase.category} (sprint ${phase.sprint.number})`;
    case "implement":
      return `step 5.1 — implement ${phase.ticketFilename} (sprint ${phase.sprint.number})`;
    case "review":
      return `step 5.2 — review ${phase.ticketFilename} (sprint ${phase.sprint.number})`;
    case "ux-plan":
      return `step 5.5.1 — ux plan (sprint ${phase.sprint.number})`;
    case "ux-test":
      return `step 5.5.2 — ux test (sprint ${phase.sprint.number})`;
    case "ux-tickets":
      return `step 5.5.3 — ux ticketize (sprint ${phase.sprint.number})`;
    case "report":
      return `step 6 — report (sprint ${phase.sprint.number})`;
    case "vision-status":
      return `step 7 — vision status (sprint ${phase.sprint.number})`;
  }
}
