// Canned step-5.1 agent. SCENARIO_IMPLEMENT:
//   happy (default) | blocked | blocked-ux (block only -ux- tickets) | nothing | multi
import fs from "node:fs";
import path from "node:path";

const prompt = await Bun.stdin.text();
const mode = process.env.SCENARIO_IMPLEMENT ?? "happy";
if (mode === "nothing") process.exit(0);

const ticketPath = /Ticket file: `([^`]+)`/.exec(prompt)![1]!;
const ticket = JSON.parse(fs.readFileSync(ticketPath, "utf8"));

if (mode === "blocked" || (mode === "blocked-ux" && ticketPath.includes("-ux-"))) {
  ticket.needs_human_intervention = true;
  ticket.needs_human_intervention_reason = "Need a human decision (canned scenario).";
  fs.writeFileSync(ticketPath, JSON.stringify(ticket, null, 2) + "\n");
  process.exit(0);
}

const commitFormat = /must follow:\s*`([^`]+)`/.exec(prompt)![1]!;
const message = commitFormat.replace("<short description>", `implement ${ticket.title.toLowerCase()}`);
const git = (...args: string[]) => {
  const r = Bun.spawnSync(["git", ...args]);
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.toString()}`);
};

const commitCount = mode === "multi" ? 2 : 1;
for (let i = 1; i <= commitCount; i++) {
  fs.mkdirSync("src", { recursive: true });
  fs.appendFileSync(path.join("src", `feature-${ticket.id}.txt`), `work ${i} for ticket ${ticket.id}\n`);
  git("add", "src");
  git("commit", "-q", "-m", message);
}

for (const t of ticket.tests) t.passes = true;
ticket.done = true;
fs.writeFileSync(ticketPath, JSON.stringify(ticket, null, 2) + "\n");
