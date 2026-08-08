/**
 * The outer loop (spec §6, §9): derive the phase from filesystem state, run
 * the matching step, repeat. Stop conditions are plain code — no LLM judgment
 * anywhere in the control path.
 */

import { BlockedError, LoopError } from "./errors.ts";
import { derivePhase } from "./phases.ts";
import { missingRequiredFiles } from "./scaffold.ts";
import { readSnapshot } from "./snapshot.ts";
import {
  stepImplement,
  stepReport,
  stepReview,
  stepSpec,
  stepSprintFocus,
  stepTickets,
  stepVisionStatus,
  type Ctx,
} from "./steps.ts";

export async function run(ctx: Ctx, maxSprints: number): Promise<void> {
  // Step 1 (spec §8.1): existence-only validation.
  const missing = missingRequiredFiles(ctx.root);
  if (missing.length > 0) {
    throw new LoopError(
      `Missing required file(s):\n` +
        missing.map((f) => `  - ${f}`).join("\n") +
        `\nRun \`bun scripts/mmm-loop/loop.ts init\` to scaffold them.`,
    );
  }

  let completedThisRun = 0;
  // dirName of the sprint whose steps this run has executed — so a sprint
  // that closes without re-running steps 6/7 (resume after a human unblock,
  // spec §10) still gets its stop conditions applied at the boundary below.
  let workedOnSprint: string | null = null;

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
          `[mmm-loop] sprint ${latest.number} complete (${completedThisRun}/${maxSprints} this run)`,
        );
      }
      if (completedThisRun >= maxSprints) return;
    }

    console.log(`[mmm-loop] phase: ${describe(phase)}`);
    switch (phase.step) {
      case "sprint-focus":
        workedOnSprint = phase.reuseDirName;
        await stepSprintFocus(ctx, phase.sprintNumber, phase.reuseDirName);
        break;
      case "spec":
        workedOnSprint = phase.sprint.dirName;
        await stepSpec(ctx, phase.sprint);
        break;
      case "tickets":
        workedOnSprint = phase.sprint.dirName;
        await stepTickets(ctx, phase.sprint);
        break;
      case "implement":
        workedOnSprint = phase.sprint.dirName;
        await stepImplement(ctx, phase.sprint, phase.ticketFilename);
        break;
      case "review":
        workedOnSprint = phase.sprint.dirName;
        await stepReview(ctx, phase.sprint, phase.ticketFilename);
        break;
      case "report":
        workedOnSprint = phase.sprint.dirName;
        await stepReport(ctx, phase.sprint);
        break;
      case "vision-status":
        workedOnSprint = phase.sprint.dirName;
        await stepVisionStatus(ctx, phase.sprint);
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
    case "implement":
      return `step 5.1 — implement ${phase.ticketFilename} (sprint ${phase.sprint.number})`;
    case "review":
      return `step 5.2 — review ${phase.ticketFilename} (sprint ${phase.sprint.number})`;
    case "report":
      return `step 6 — report (sprint ${phase.sprint.number})`;
    case "vision-status":
      return `step 7 — vision status (sprint ${phase.sprint.number})`;
  }
}
