// Canned step-C3 agent. Modes via SCENARIO_CLEANUP_IDENTIFY:
//   all (default) — 3 candidates (all yes)
//   docs-only     — only the docs category has a candidate
//   none          — all-none stamp (identification found nothing)
//   garbled       — junk first line (must fail the postcondition)
//   retry-ok      — garbled unless the prompt is a retry
//   nothing       — write nothing
import fs from "node:fs";
import path from "node:path";

const prompt = await Bun.stdin.text();
const mode = process.env.SCENARIO_CLEANUP_IDENTIFY ?? "all";
if (mode === "nothing") process.exit(0);

const sprintDir = /Sprint folder: `([^`]+)`/.exec(prompt)![1]!;
const specPath = path.join(sprintDir, "spec.md");

const isRetry = prompt.includes("PREVIOUS ATTEMPT FAILED");
if (mode === "garbled" || (mode === "retry-ok" && !isRetry)) {
  fs.writeFileSync(specPath, "# Cleanup spec\n\nOops, no stamp.\n");
  process.exit(0);
}

const yes: Record<string, string> = {
  all: "architecture=yes, clean-code=yes, docs=yes",
  "retry-ok": "architecture=yes, clean-code=yes, docs=yes",
  "docs-only": "architecture=none, clean-code=none, docs=yes",
  none: "architecture=none, clean-code=none, docs=none",
};
const stamp = `_Candidates: ${yes[mode]!}_`;

const section = (category: string) =>
  `## ${category}\n\n- What: canned ${category} improvement\n- Files: src/\n` +
  `- Why a clear win: canned\n- Why one ticket: small\n\n`;

const sections = [...stamp.matchAll(/(architecture|clean-code|docs)=yes/g)]
  .map((m) => section(m[1]!))
  .join("");

fs.writeFileSync(specPath, `${stamp}\n\n# Cleanup spec — canned\n\n${sections}`);
