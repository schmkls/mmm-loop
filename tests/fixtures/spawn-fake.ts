#!/usr/bin/env bun
/**
 * Minimal recording fake for the spawn-wrapper unit tests. Records each
 * invocation (argv + prompt) to $SPAWNTEST_DIR/prompt-N.txt. Behavior via
 * $SPAWNTEST_MODE:
 *   succeed     — write $SPAWNTEST_OUT (the postcondition artifact)
 *   fail-once   — write it only from the second invocation on
 *   fail-always — never write it
 *   crash       — exit 3 without writing
 */

import fs from "node:fs";
import path from "node:path";

const prompt = await Bun.stdin.text();
const dir = process.env.SPAWNTEST_DIR!;
const n = fs.readdirSync(dir).filter((f) => f.startsWith("prompt-")).length + 1;
fs.writeFileSync(
  path.join(dir, `prompt-${n}.txt`),
  `ARGV: ${process.argv.slice(2).join(" ")}\n---\n${prompt}`,
);

const mode = process.env.SPAWNTEST_MODE ?? "succeed";
if (mode === "crash") process.exit(3);
if (mode === "succeed" || (mode === "fail-once" && n >= 2)) {
  fs.writeFileSync(process.env.SPAWNTEST_OUT!, "done\n");
}
