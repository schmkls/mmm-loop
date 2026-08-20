// Canned step-C4 agent. Modes via SCENARIO_CLEANUP_TICKETS:
//   ok (default) — one ticket with the fixed ID read from the prompt
//   retry-ok     — no-op unless the prompt is a retry
//   nothing      — write nothing
import fs from "node:fs";
import path from "node:path";

const prompt = await Bun.stdin.text();
const mode = process.env.SCENARIO_CLEANUP_TICKETS ?? "ok";
if (mode === "nothing") process.exit(0);
if (mode === "retry-ok" && !prompt.includes("PREVIOUS ATTEMPT FAILED")) process.exit(0);

const sprintDir = /Sprint folder: `([^`]+)`/.exec(prompt)![1]!;
const category = /Cleanup ticket: ([a-z-]+)/.exec(prompt)![1]!;
const fixedId = /tickets\/(\d{3})-<kebab-slug>\.json/.exec(prompt)![1]!;
const ticketsDir = path.join(sprintDir, "tickets");
fs.mkdirSync(ticketsDir, { recursive: true });

const ticket = {
  id: fixedId,
  title: `Cleanup: ${category}`,
  description: `Canned ${category} cleanup ticket.`,
  tests: [{ description: "all existing tests still pass", passes: false }],
  done: false,
  reviewed: false,
  needs_human_intervention: false,
  needs_human_intervention_reason: null,
  human_note: null,
  commits: [],
};
fs.writeFileSync(
  path.join(ticketsDir, `${fixedId}-${category}-cleanup.json`),
  JSON.stringify(ticket, null, 2) + "\n",
);
