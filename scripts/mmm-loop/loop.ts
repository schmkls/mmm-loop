#!/usr/bin/env bun
/**
 * mmm-loop — an autonomous, sprint-based agent loop for Claude Code.
 *
 *   bun scripts/mmm-loop/loop.ts init                  # scaffold required files
 *   bun scripts/mmm-loop/loop.ts run [--max-sprints N] # run N sprints (default 1)
 *
 * Exit codes: 0 = requested sprints completed; 1 = validation/step failure;
 * 2 = sprint finished but tickets need human intervention (spec §5).
 */

import { BlockedError, LoopError } from "./lib/errors.ts";
import { run } from "./lib/run.ts";
import { init } from "./lib/scaffold.ts";

function usage(): never {
  console.error(
    "Usage:\n  bun scripts/mmm-loop/loop.ts init\n  bun scripts/mmm-loop/loop.ts run [--max-sprints N]",
  );
  process.exit(1);
}

function parseMaxSprints(args: string[]): number {
  const i = args.indexOf("--max-sprints");
  if (i === -1) return 1;
  const value = Number(args[i + 1]);
  if (!Number.isInteger(value) || value < 1) {
    console.error(`--max-sprints expects a positive integer, got: ${args[i + 1] ?? "(nothing)"}`);
    process.exit(1);
  }
  return value;
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
      await run({ root, bundleDir }, parseMaxSprints(rest));
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
