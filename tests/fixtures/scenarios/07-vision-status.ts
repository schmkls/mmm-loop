// Canned step-7 agent. SCENARIO_VISION: ok (default) | nostamp | nothing
import fs from "node:fs";

const prompt = await Bun.stdin.text();
const mode = process.env.SCENARIO_VISION ?? "ok";
if (mode === "nothing") process.exit(0);

const visionStatusPath = /rewrite `([^`]+)`/.exec(prompt)![1]!;
const stamp = /(_Last updated: sprint \d{2}_)/.exec(prompt)![1]!;

const body = `# Vision status

## What exists now

The toy feature.

## What works (verified)

The toy feature's canned test.

## Known gaps

Everything else in the vision.

## Blocked on human

Nothing.
`;

fs.writeFileSync(visionStatusPath, mode === "nostamp" ? body : `${stamp}\n\n${body}`);
