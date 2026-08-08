// Canned step-4 agent. SCENARIO_TICKETS_MODE: ok (default) | invalid | nothing
// SCENARIO_TICKETS_COUNT: number of tickets to create (default 2).
import fs from "node:fs";
import path from "node:path";

const prompt = await Bun.stdin.text();
const mode = process.env.SCENARIO_TICKETS_MODE ?? "ok";
if (mode === "nothing") process.exit(0);

const sprintDir = /Sprint folder: `([^`]+)`/.exec(prompt)![1]!;
const dir = path.join(sprintDir, "tickets");
fs.mkdirSync(dir, { recursive: true });

if (mode === "invalid") {
  fs.writeFileSync(path.join(dir, "001-broken.json"), '{"id": "001", "title": 42}\n');
  process.exit(0);
}

const count = Number(process.env.SCENARIO_TICKETS_COUNT ?? "2");
for (let i = 1; i <= count; i++) {
  const id = String(i).padStart(3, "0");
  const ticket = {
    id,
    title: `Toy part ${i}`,
    description: `As a user, I want toy part ${i} so that the toy works.`,
    tests: [{ description: `toy part ${i} behaves`, passes: false }],
    done: false,
    reviewed: false,
    needs_human_intervention: false,
    needs_human_intervention_reason: null,
    human_note: null,
    commits: [],
  };
  fs.writeFileSync(path.join(dir, `${id}-toy-part-${i}.json`), JSON.stringify(ticket, null, 2) + "\n");
}
