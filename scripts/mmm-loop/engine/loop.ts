#!/usr/bin/env bun
/**
 * mmm-loop — an autonomous, sprint-based agent loop for Claude Code.
 *
 *   bun scripts/mmm-loop/loop.ts init                              # scaffold required files
 *   bun scripts/mmm-loop/loop.ts run [--max-sprints N] [--cleanup] # run N sprints (default 1)
 *   bun scripts/mmm-loop/loop.ts version                           # engine version + overlay size
 *   bun scripts/mmm-loop/loop.ts update [--apply] [--from SRC]     # replace engine/ from its source
 *   bun scripts/mmm-loop/loop.ts install <target>                  # install this engine elsewhere
 *
 * --cleanup forces the first sprint created during the run to be a cleanup
 * sprint (spec §8.8); every CLEANUP_CADENCE-th sprint is one automatically.
 *
 * Exit codes: 0 = requested sprints completed; 1 = validation/step failure;
 * 2 = sprint finished but tickets need human intervention (spec §5).
 */

import { OVERLAY_KEYS, SOURCE } from "./config.ts";
import { bundleRootOf, promptOverrides, readEngineVersion } from "./lib/bundle.ts";
import { colorEnabled, style } from "./lib/console.ts";
import { BlockedError, LoopError } from "./lib/errors.ts";
import { install } from "./lib/install.ts";
import { run, type RunOptions } from "./lib/run.ts";
import { init } from "./lib/scaffold.ts";
import { update } from "./lib/update.ts";
import { formatVersionLine } from "./lib/version.ts";

function usage(): never {
  console.error(
    "Usage:\n" +
      "  bun scripts/mmm-loop/loop.ts init\n" +
      "  bun scripts/mmm-loop/loop.ts run [--max-sprints N] [--cleanup]\n" +
      "  bun scripts/mmm-loop/loop.ts version\n" +
      "  bun scripts/mmm-loop/loop.ts update [--apply] [--from <path-or-url>]\n" +
      "  bun scripts/mmm-loop/loop.ts install <target>",
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

function parseUpdateOptions(args: string[]): { apply: boolean; from?: string } {
  let apply = false;
  let from: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--apply") {
      apply = true;
    } else if (args[i] === "--from") {
      i += 1;
      if (args[i] === undefined) {
        console.error("--from expects a path or URL");
        process.exit(1);
      }
      from = args[i];
    } else {
      usage();
    }
  }
  return { apply, from };
}

/** One try/catch for every command that can refuse: a LoopError is a message
 * for the human plus an exit code, never a stack trace. */
async function guard(fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof LoopError || e instanceof BlockedError) {
      const emoji = e instanceof BlockedError ? "⛔ " : "";
      console.error(style("red", `[mmm-loop] ${emoji}${e.message}`, colorEnabled));
      process.exit(e.exitCode);
    }
    throw e;
  }
}

const [command, ...rest] = process.argv.slice(2);
const root = process.cwd();
/** This engine's own directory — where the shipped prompts live, and what
 * `update` replaces. */
const engineDir = import.meta.dir;

switch (command) {
  case "init":
    init(root);
    break;
  case "run":
    await guard(async () => {
      await run({ root, bundleDir: engineDir }, parseRunOptions(rest));
      // Emoji after the text: "[mmm-loop] done." is a grep contract.
      console.log(style("green", "[mmm-loop] done. ✅", colorEnabled));
    });
    break;
  case "version": {
    if (rest.length > 0) usage();
    console.log(
      formatVersionLine(
        readEngineVersion(engineDir),
        promptOverrides(bundleRootOf(engineDir)).length,
        OVERLAY_KEYS.length,
      ),
    );
    break;
  }
  case "update": {
    const { apply, from } = parseUpdateOptions(rest);
    await guard(() => update({ root, engineDir, source: SOURCE, from, apply }));
    break;
  }
  case "install": {
    const [target, ...extra] = rest;
    if (target === undefined || extra.length > 0) usage();
    await guard(() => install({ engineDir, target, cwd: root }));
    break;
  }
  default:
    usage();
}
