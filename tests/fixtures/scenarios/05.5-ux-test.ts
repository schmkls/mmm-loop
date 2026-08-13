// Canned step-5.5.2 agent. SCENARIO_UX_TEST:
//   findings (default) — one F1 finding, correctly stamped no
//   none               — "No findings.", stamped
//   bad-stamp          — first line _Ticketized: yes_ (must fail the postcondition)
//   nothing            — write nothing
//   retry-ok           — no-op unless the prompt is a retry
import fs from "node:fs";
import path from "node:path";

const prompt = await Bun.stdin.text();
const mode = process.env.SCENARIO_UX_TEST ?? "findings";
if (mode === "nothing") process.exit(0);
if (mode === "retry-ok" && !prompt.includes("PREVIOUS ATTEMPT FAILED")) process.exit(0);

const sprintDir = /Sprint folder: `([^`]+)`/.exec(prompt)![1]!;
const num = /# UX findings — sprint (\d{2})/.exec(prompt)![1]!;

const stamp = mode === "bad-stamp" ? "_Ticketized: yes_" : "_Ticketized: no_";
const summary = mode === "none" ? "No findings." : "One finding (canned).";
const findings =
  mode === "none"
    ? ""
    : "### F1 — Toy output confusing (severity: medium)\n- Where: the toy feature's output\n- Expected: clear output\n- Actual: confusing output\n- Repro: run the toy feature\n";

fs.writeFileSync(
  path.join(sprintDir, "ux_findings.md"),
  `${stamp}\n\n# UX findings — sprint ${num}\n\n## Summary\n\n${summary}\n\n## Tested\n\nT1 (canned).\n\n## Findings\n\n${findings}\n## Not testable\n\nNothing.\n`,
);
