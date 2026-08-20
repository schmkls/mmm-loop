// Canned step-5.5.3 agent. SCENARIO_UX_TICKETS:
//   from-findings (default) — one NNN-ux-<slug>.json per F-section in the
//                             findings, skipping findings that already have a
//                             matching ticket (makes crash-resume a pure rerun)
//   zero                    — ticketize nothing
//   bad-name                — misbehave: create a ticket without the ux- infix
//   nothing                 — write nothing (still passes: zero tickets is valid)
//   retry-ok                — no-op unless the prompt is a retry
import fs from "node:fs";
import path from "node:path";

const prompt = await Bun.stdin.text();
const mode = process.env.SCENARIO_UX_TICKETS ?? "from-findings";
if (mode === "nothing" || mode === "zero") process.exit(0);
if (mode === "retry-ok" && !prompt.includes("PREVIOUS ATTEMPT FAILED")) process.exit(0);

const sprintDir = /Sprint folder: `([^`]+)`/.exec(prompt)![1]!;
const ticketsDir = path.join(sprintDir, "tickets");
const next = Number(/starting at `(\d{3})`/.exec(prompt)![1]!);

const writeTicket = (filename: string, id: string, title: string) => {
  const ticket = {
    id,
    title,
    description: `UX finding: ${title} (canned).`,
    tests: [{ description: `${title.toLowerCase()} is fixed`, passes: false }],
    done: false,
    reviewed: false,
    needs_human_intervention: false,
    needs_human_intervention_reason: null,
    human_note: null,
    commits: [],
  };
  fs.writeFileSync(path.join(ticketsDir, filename), JSON.stringify(ticket, null, 2) + "\n");
};

if (mode === "bad-name") {
  writeTicket(`${String(next).padStart(3, "0")}-broken.json`, String(next).padStart(3, "0"), "Broken");
  process.exit(0);
}

// from-findings: one ticket per F-section, skipping already-covered ones.
const titles = [...prompt.matchAll(/^### F\d+ — (.+?) \(severity:/gm)].map((m) => m[1]!);
const existing = fs.readdirSync(ticketsDir);
let n = next;
for (const title of titles) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (existing.some((f) => f.endsWith(`-ux-${slug}.json`))) continue;
  const id = String(n).padStart(3, "0");
  writeTicket(`${id}-ux-${slug}.json`, id, title);
  n += 1;
}
