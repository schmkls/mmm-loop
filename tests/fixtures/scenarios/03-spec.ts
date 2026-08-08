// Canned step-3 agent. Modes via SCENARIO_SPEC: ok (default) | retry-ok | nothing
import fs from "node:fs";
import path from "node:path";

const prompt = await Bun.stdin.text();
const mode = process.env.SCENARIO_SPEC ?? "ok";
if (mode === "nothing") process.exit(0);
if (mode === "retry-ok" && !prompt.includes("PREVIOUS ATTEMPT FAILED")) process.exit(0);

const sprintDir = /Sprint folder: `([^`]+)`/.exec(prompt)![1]!;
fs.writeFileSync(
  path.join(sprintDir, "spec.md"),
  "# Spec — toy feature\n\n## Goals\n\n- The toy feature exists and its test passes.\n",
);
