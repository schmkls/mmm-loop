// Canned step-F2 agent. Modes via SCENARIO_FEEDBACK:
//   ok (default)  — actionable=yes, every item triaged as in-vision
//   none          — actionable=none, every item vision-change (proposal)
//   garbled       — no stamp (must fail the postcondition)
//   drop-item     — valid stamp, but the last item has no disposition block
//   liar          — stamp says none while an item is dispositioned in-vision
//   triaged       — writes the orchestrator-owned triaged=yes
//   meddle        — also writes into docs/feedback/ (must fail the step)
//   applies       — applies the vision change instead of proposing it
//   busywork      — actionable=yes while every item is declined
//   retry-ok      — garbled unless the prompt is a retry
//   nothing       — write nothing
import fs from "node:fs";
import path from "node:path";

const prompt = await Bun.stdin.text();
const mode = process.env.SCENARIO_FEEDBACK ?? "ok";
if (mode === "nothing") process.exit(0);

const focusPath = /Write `([^`]+)`/.exec(prompt)![1]!;
const sprintNumber = /sprints\/(\d{2})-feedback\//.exec(focusPath)![1]!;
const items = [...prompt.matchAll(/^_docs\/feedback\/inbox\/(\S+)_$/gm)].map((m) => m[1]!);

const isRetry = prompt.includes("PREVIOUS ATTEMPT FAILED");
if (mode === "garbled" || (mode === "retry-ok" && !isRetry)) {
  fs.writeFileSync(focusPath, `# Sprint ${sprintNumber} — oops, no stamp\n`);
  process.exit(0);
}

if (mode === "meddle") {
  fs.writeFileSync("docs/feedback/inbox/agent-added.md", "the agent handing itself a sprint\n");
}
if (mode === "applies") {
  fs.appendFileSync("docs/vision.md", "\n## Web UI\n\nAdded by the triage, which may not.\n");
}

const none = mode === "none";
const busywork = mode === "busywork";
const triagedKey = mode === "triaged" ? "triaged=yes" : "triaged=no";
const stamp = none
  ? `_Feedback: ${triagedKey}, actionable=none, vision-change=proposed_`
  : `_Feedback: ${triagedKey}, actionable=${mode === "liar" ? "none" : "yes"}, vision-change=no_`;
const disposition = none ? "vision-change" : busywork ? "declined" : "in-vision";
const blocks = (mode === "drop-item" ? items.slice(0, -1) : items)
  .map(
    (name) =>
      `### ${name}\n- Disposition: ${disposition}\n` +
      `- What it says: canned triage of ${name}\n- Why this disposition: canned\n` +
      `- What it implies for this sprint: ${none ? "nothing" : "the toy feature"}\n` +
      `- In this sprint: ${none ? "n/a" : "yes"}\n`,
  )
  .join("\n");

const body = none
  ? `## Vision proposals\n\nCanned proposal: the human must decide.\n`
  : `## What\nFix what the feedback points at.\n\n## Why\nA human asked for it.\n`;

fs.writeFileSync(
  focusPath,
  `${stamp}\n\n# Sprint ${sprintNumber} — feedback\n\n## Feedback\n\n${blocks}\n${body}`,
);
