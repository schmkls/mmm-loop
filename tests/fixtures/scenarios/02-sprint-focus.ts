// Canned step-2 agent. Modes via SCENARIO_FOCUS:
//   ok (default) | badname | cleanup-slug (reserved NN-cleanup name) | nothing
import fs from "node:fs";
import path from "node:path";

const prompt = await Bun.stdin.text();
const mode = process.env.SCENARIO_FOCUS ?? "ok";
if (mode === "nothing") process.exit(0);

if (mode === "badname") {
  const dir = ".working/sprints/01_BAD";
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "sprint_focus.md"), "# bad\n");
  process.exit(0);
}

if (mode === "cleanup-slug") {
  const num = /Create the folder `\.working\/sprints\/(\d{2})-/.exec(prompt)![1]!;
  const dir = path.join(".working/sprints", `${num}-cleanup`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "sprint_focus.md"), "# cleanup\n");
  process.exit(0);
}

const reuse = /already exists at `\.working\/sprints\/([^/`]+)\//.exec(prompt);
let dir: string;
if (reuse) {
  dir = path.join(".working/sprints", reuse[1]!);
} else {
  const num = /Create the folder `\.working\/sprints\/(\d{2})-/.exec(prompt)![1]!;
  dir = path.join(".working/sprints", `${num}-toy-feature`);
}
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(
  path.join(dir, "sprint_focus.md"),
  "# Sprint — toy feature\n\n## What\nBuild the toy feature.\n\n## Why\nIt is the smallest step toward the vision.\n",
);
