#!/usr/bin/env bun
/**
 * Fake `claude` binary for tests (injected via MMM_LOOP_CLAUDE_BIN).
 *
 * - Logs every invocation (argv + prompt) to $FAKE_CLAUDE_LOG/NN-<step>.txt.
 * - Dispatches to $FAKE_CLAUDE_SCENARIO/<step>.ts based on the
 *   `<!-- mmm-loop:step:... -->` marker every prompt template starts with,
 *   passing the prompt on stdin, cwd unchanged. No scenario script → no-op.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const prompt = await Bun.stdin.text();
const stepId = /<!-- mmm-loop:step:([a-z0-9-]+) -->/.exec(prompt)?.[1] ?? "unknown";

const logDir = process.env.FAKE_CLAUDE_LOG;
if (logDir) {
  mkdirSync(logDir, { recursive: true });
  const n = readdirSync(logDir).length + 1;
  writeFileSync(
    join(logDir, `${String(n).padStart(2, "0")}-${stepId}.txt`),
    `ARGV: ${process.argv.slice(2).join(" ")}\n---\n${prompt}`,
  );
}

const scenarioDir = process.env.FAKE_CLAUDE_SCENARIO;
if (scenarioDir) {
  const script = join(scenarioDir, `${stepId}.ts`);
  if (existsSync(script)) {
    const proc = Bun.spawn(["bun", script], {
      stdin: new TextEncoder().encode(prompt),
      stdout: "inherit",
      stderr: "inherit",
      cwd: process.cwd(),
      env: process.env,
    });
    process.exit(await proc.exited);
  }
}
process.exit(0);
