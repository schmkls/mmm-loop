#!/usr/bin/env bun
/**
 * mmm-loop — an autonomous, sprint-based agent loop for Claude Code.
 *
 *   bun scripts/mmm-loop/loop.ts init                              # scaffold required files
 *   bun scripts/mmm-loop/loop.ts run [--max-sprints N] [--cleanup] # run N sprints (default 1)
 *
 * --cleanup forces the first sprint created during the run to be a cleanup
 * sprint (spec §8.8); every CLEANUP_CADENCE-th sprint is one automatically.
 *
 * Exit codes: 0 = requested sprints completed; 1 = validation/step failure;
 * 2 = sprint finished but tickets need human intervention (spec §5).
 */

import { BlockedError, LoopError } from "./lib/errors.ts";
import { run, type RunOptions } from "./lib/run.ts";
import { init } from "./lib/scaffold.ts";

function usage(): never {
  console.error(
    "Usage:\n  bun scripts/mmm-loop/loop.ts init\n  bun scripts/mmm-loop/loop.ts run [--max-sprints N] [--cleanup]",
  );
  process.exit(1);
}

function parseRunOptions(args: string[]): RunOptions {
  let maxSprints = 1;
  let forceCleanup = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--max-sprints") {
      i += 1;
      const value = Number(args[i]);
      if (!Number.isInteger(value) || value < 1) {
        console.error(`--max-sprints expects a positive integer, got: ${args[i] ?? "(nothing)"}`);
        process.exit(1);
      }
      maxSprints = value;
    } else if (args[i] === "--cleanup") {
      forceCleanup = true;
    } else {
      usage();
    }
  }
  return { maxSprints, forceCleanup };
}

const [command, ...rest] = process.argv.slice(2);
const root = process.cwd();
const bundleDir = import.meta.dir;

switch (command) {
  case "init":
    init(root);
    break;
  case "run":
    try {
      await run({ root, bundleDir }, parseRunOptions(rest));
      console.log("[mmm-loop] done.");
    } catch (e) {
      if (e instanceof LoopError || e instanceof BlockedError) {
        console.error(`[mmm-loop] ${e.message}`);
        process.exit(e.exitCode);
      }
      throw e;
    }
    break;
  default:
    usage();
}
