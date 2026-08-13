// Canned step-5.5.1 agent. SCENARIO_UX_PLAN: ok (default) | empty | nothing | retry-ok
import fs from "node:fs";
import path from "node:path";

const prompt = await Bun.stdin.text();
const mode = process.env.SCENARIO_UX_PLAN ?? "ok";
if (mode === "nothing") process.exit(0);
if (mode === "retry-ok" && !prompt.includes("PREVIOUS ATTEMPT FAILED")) process.exit(0);

const sprintDir = /Sprint folder: `([^`]+)`/.exec(prompt)![1]!;
const num = /# UX test plan — sprint (\d{2})/.exec(prompt)![1]!;

const delta =
  mode === "empty"
    ? "Nothing user-facing changed this sprint (canned)."
    : "The toy feature (canned).";
const tests =
  mode === "empty"
    ? ""
    : "### T1 — toy feature output\n- Method: run the toy feature with existing tools and inspect its output\n- Suspected problems: confusing output\n";

fs.writeFileSync(
  path.join(sprintDir, "ux_test_plan.md"),
  `# UX test plan — sprint ${num}\n\n## User-facing delta\n\n${delta}\n\n## Tests\n\n${tests}\n## Not testable / out of scope\n\nNothing.\n`,
);
