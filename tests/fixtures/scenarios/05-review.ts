// Canned step-5.2 agent. SCENARIO_REVIEW:
//   none (default)  — no findings, change nothing
//   fix             — create the one allowed fix ticket
//   two-fix         — misbehave: create two fix tickets
//   always-fix      — misbehave: create a fix ticket even when forbidden
//   flag            — set needs_human_intervention on the reviewed (fix) ticket
import fs from "node:fs";
import path from "node:path";

const prompt = await Bun.stdin.text();
const mode = process.env.SCENARIO_REVIEW ?? "none";
if (mode === "none") process.exit(0);

const ticketPath = /Ticket file: `([^`]+)`/.exec(prompt)![1]!;
const ticket = JSON.parse(fs.readFileSync(ticketPath, "utf8"));
const ticketsDir = path.dirname(ticketPath);

const writeFix = (fixPath: string, id: string) => {
  const fix = {
    id,
    title: `Clean up ${ticket.title}`,
    description: "Canned fix ticket created by the review scenario.",
    tests: ticket.tests.map((t: { description: string }) => ({ description: t.description, passes: false })),
    done: false,
    reviewed: false,
    needs_human_intervention: false,
    needs_human_intervention_reason: null,
    human_note: null,
    commits: [],
  };
  fs.writeFileSync(fixPath, JSON.stringify(fix, null, 2) + "\n");
};

if (mode === "flag") {
  ticket.needs_human_intervention = true;
  ticket.needs_human_intervention_reason = "Review finding only a human can resolve (canned).";
  fs.writeFileSync(ticketPath, JSON.stringify(ticket, null, 2) + "\n");
  process.exit(0);
}

if (mode === "fix" || mode === "two-fix") {
  const template = /ONE fix ticket: `([^`]+)`/.exec(prompt)![1]!;
  writeFix(template.replace("<kebab-slug>", "cleanup"), `${ticket.id}.1`);
  if (mode === "two-fix") {
    writeFix(path.join(ticketsDir, `${ticket.id}.2-more.json`), `${ticket.id}.2`);
  }
} else if (mode === "always-fix") {
  writeFix(path.join(ticketsDir, `${ticket.id}.1-rogue.json`), `${ticket.id}.1`);
}
