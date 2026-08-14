/**
 * The outer loop (spec §6, §9): derive the phase from filesystem state, run
 * the matching step, repeat. Stop conditions are plain code — no LLM judgment
 * anywhere in the control path.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ALLOWED_CLAUDE_USER, BASE_BRANCH, CLEANUP_CADENCE } from "../config.ts";
import { preflightAction, sprintBranch } from "./branches.ts";
import { claudeUserProblem } from "./claude-user.ts";
import { isCadenceCleanup } from "./cleanup.ts";
import { colorEnabled, style } from "./console.ts";
import { BlockedError, LoopError } from "./errors.ts";
import {
  gitBranchExists,
  gitCheckout,
  gitCreateBranch,
  gitCurrentBranch,
  gitDeleteMergedBranch,
  gitLocalBranches,
  gitMergeNoFF,
} from "./git.ts";
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

  // Branch preflight (spec §6.4): derivation reads the checked-out tree, so
  // the right branch must be checked out before the first readSnapshot.
  if (!(await gitBranchExists(ctx.root, BASE_BRANCH))) {
    throw new LoopError(
      `BASE_BRANCH "${BASE_BRANCH}" does not exist in this repository; ` +
        `create it or change BASE_BRANCH in scripts/mmm-loop/config.ts.`,
    );
  }
  const action = preflightAction(
    await gitCurrentBranch(ctx.root),
    await gitLocalBranches(ctx.root),
    BASE_BRANCH,
  );
  if (action.kind === "error") throw new LoopError(action.message);
  if (action.kind === "checkout") await gitCheckout(ctx.root, action.branch);

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

      // Merge-or-leave (spec §6.4): the latest sprint is fully complete; if
      // we are on its branch, merge it into base (clean) or halt (blocked).
      // Deliberately regardless of workedOnSprint — a resumed run that finds
      // the completed sprint blocked must exit 2 again, never fall through
      // to new-sprint creation (base lacks the sprint's .working/ state).
      if (latest && (await gitCurrentBranch(ctx.root)) === sprintBranch(latest.number)) {
        const branch = sprintBranch(latest.number);
        const blocked = (latest.tickets ?? [])
          .filter(({ ticket }) => ticket.needs_human_intervention)
          .map(({ ticket }) => `sprint ${latest.number}, ticket ${ticket.id}: ${ticket.title}`);
        if (blocked.length > 0) throw new BlockedError(blocked, branch);
        await gitCheckout(ctx.root, BASE_BRANCH);
        const merge = await gitMergeNoFF(
          ctx.root,
          branch,
          `chore(loop): merge sprint ${latest.number}`,
        );
        if (merge === "conflict") {
          throw new LoopError(
            `Merging ${branch} into ${BASE_BRANCH} hit a conflict (the merge was aborted). ` +
              `Merge ${branch} into ${BASE_BRANCH} manually, then rerun.`,
          );
        }
        await gitDeleteMergedBranch(ctx.root, branch);
        console.log(`[mmm-loop] merged ${branch} into ${BASE_BRANCH}`);
      }

      if (latest && latest.dirName === workedOnSprint) {
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

      // New-sprint branch (spec §6.4): created from the base branch's HEAD
      // (we are on base here — guaranteed by the merge above + preflight)
      // before any agent or folder-creation runs for the sprint. The
      // already-on-it check makes the crash window between branch creation
      // and folder creation idempotent.
      if ((await gitCurrentBranch(ctx.root)) !== sprintBranch(phase.sprintNumber)) {
        await gitCreateBranch(ctx.root, sprintBranch(phase.sprintNumber));
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

    // Ensure the sprint's branch is checked out before dispatching (spec
    // §6.4). Normally a no-op (the branch was created at the boundary above,
    // or the preflight checked it out); create-at-HEAD covers adopting a
    // pre-feature project whose in-progress sprint lives on the base branch.
    {
      const branch = sprintBranch(
        phase.step === "sprint-focus" ? phase.sprintNumber : phase.sprint.number,
      );
      if ((await gitCurrentBranch(ctx.root)) !== branch) {
        if (await gitBranchExists(ctx.root, branch)) await gitCheckout(ctx.root, branch);
        else await gitCreateBranch(ctx.root, branch);
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
