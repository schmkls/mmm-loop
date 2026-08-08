/**
 * The agent-spawn wrapper (spec §6.2–§6.3, §7): every agent step runs through
 * runAgentStep — fill the prompt, spawn a fresh `claude -p`, await it, check
 * the step's postcondition, retry once with the failure appended, then die.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PERMISSION_ARGS, STEP_CONFIG, type Effort, type StepId } from "../config.ts";
import { LoopError } from "./errors.ts";
import { fillTemplate } from "./template.ts";

/** Overridable so tests can inject a fake `claude`. */
export function claudeBin(): string {
  return process.env.MMM_LOOP_CLAUDE_BIN || "claude";
}

/**
 * Translate config.ts effort to what the installed Claude Code understands.
 * Claude Code ≥2.1 exposes `--effort low|medium|high|xhigh|max`; "extra"
 * means the highest available. This wrapper is the only place that knows.
 */
function effortArgs(effort: Effort): string[] {
  return effort === "extra" ? ["--effort", "max"] : [];
}

export interface AgentStep {
  stepId: StepId;
  vars: Record<string, string>;
  /** Postcondition: null = success, otherwise what was expected but missing. */
  check: () => string | null | Promise<string | null>;
  /** Project root — the agent's working directory. */
  cwd: string;
  /** The scripts/mmm-loop directory (where prompts/ lives). */
  bundleDir: string;
}

async function spawnClaude(step: AgentStep, prompt: string): Promise<string | null> {
  const cfg = STEP_CONFIG[step.stepId];
  const argv = [
    claudeBin(),
    "-p",
    ...PERMISSION_ARGS,
    "--model",
    cfg.model,
    "--max-turns",
    String(cfg.maxTurns),
    ...effortArgs(cfg.effort),
  ];
  const proc = Bun.spawn(argv, {
    cwd: step.cwd,
    // Explicit: Bun snapshots env at startup; without this, runtime changes
    // to process.env (e.g. MMM_LOOP_CLAUDE_BIN in tests) would not propagate.
    env: process.env,
    stdin: new TextEncoder().encode(prompt),
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  return exitCode === 0 ? null : `\`${claudeBin()}\` exited with code ${exitCode}`;
}

export async function runAgentStep(step: AgentStep): Promise<void> {
  const template = readFileSync(join(step.bundleDir, "prompts", `${step.stepId}.md`), "utf8");
  const prompt = fillTemplate(template, step.vars);

  let failure = (await spawnClaude(step, prompt)) ?? (await step.check());
  if (failure === null) return;

  console.error(`[mmm-loop] step ${step.stepId} failed postcondition, retrying once: ${failure}`);
  const retryPrompt =
    prompt +
    `\n\n## PREVIOUS ATTEMPT FAILED\n\nA previous run of this step did not produce the expected output:\n\n${failure}\n\nCorrect this now. Produce exactly the expected output described above.`;
  failure = (await spawnClaude(step, retryPrompt)) ?? (await step.check());
  if (failure !== null) {
    throw new LoopError(
      `Step ${step.stepId} failed its postcondition twice. Last failure:\n${failure}\n` +
        `A human should look at the prompt (scripts/mmm-loop/prompts/${step.stepId}.md) or the project state.`,
    );
  }
}
