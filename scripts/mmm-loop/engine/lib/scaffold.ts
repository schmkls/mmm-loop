/** `init`: scaffold required files with template content (spec §5). Never
 * overwrites an existing file. */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const CONTEXT_TEMPLATE = `# Context

Always-relevant context for every agent working on this project.

<!-- TODO: what is this project, in two sentences? -->

## Tech stack

<!-- TODO: languages, frameworks, runtime, package manager. -->

## How to run and test

<!-- TODO: exact commands to build, run, and test. -->

## Conventions

<!-- TODO: code style, directory layout, naming, anything agents must respect. -->
`;

const VISION_TEMPLATE = `# Vision

<!-- TODO: what should this project become? Written for an agent deciding what to build next. -->

## What we are building

<!-- TODO: the product/tool and its core capabilities. -->

## For whom and why

<!-- TODO: users and the problem being solved. -->

## Non-goals

<!-- TODO: what this project deliberately does NOT do. -->
`;

const VISION_STATUS_TEMPLATE = `_Last updated: sprint 00_

# Vision status

## What exists now

Nothing is built yet.

## What works (verified)

Nothing yet.

## Known gaps

Everything in the vision.

## Blocked on human

Nothing.
`;

const LEARNINGS_TEMPLATE = `# Learnings — append-only one-liners (gotchas, conventions) written by agents.
`;

const FEEDBACK_README_TEMPLATE = `# Feedback

Drop feedback for the loop here — one markdown file per item in \`inbox/\`.

Before creating its next sprint the loop looks in \`inbox/\`. If it holds at
least one non-empty \`.md\` file, that sprint becomes a **feedback sprint**:
it is planned from your feedback instead of from \`docs/vision.md\`. The
triage step decides, per item, whether the vision already covers it (so the
gap is execution), whether the product itself should change (a proposal for
you — the loop never edits \`docs/vision.md\`), or whether it is declined and
why. The items are then moved to \`handled/NN-<name>.md\`, where \`NN\` is the
sprint that handled them.

- One item per file; plain prose, no format required.
- Only non-empty \`*.md\` files directly in \`inbox/\` count — a \`.gitkeep\` or
  a stray \`.txt\` never starts a sprint.
- Feedback dropped mid-sprint waits for the next sprint boundary; a sprint's
  scope never shifts under the steps already running.
- To re-open a handled item, move the file back into \`inbox/\`.
`;

export const REQUIRED_FILES = ["docs/CONTEXT.md", "docs/vision.md", ".working/vision_status.md"];

const SCAFFOLD: Record<string, string> = {
  "docs/CONTEXT.md": CONTEXT_TEMPLATE,
  "docs/vision.md": VISION_TEMPLATE,
  ".working/vision_status.md": VISION_STATUS_TEMPLATE,
  ".working/learnings.md": LEARNINGS_TEMPLATE,
  // Feedback folders (spec §8.9). Optional by design — step 1 does not
  // require them — but scaffolded so the inbox is there when a human wants
  // it. `.gitkeep` keeps the empty folders in git without ever counting as
  // an inbox item.
  "docs/feedback/README.md": FEEDBACK_README_TEMPLATE,
  "docs/feedback/inbox/.gitkeep": "",
  "docs/feedback/handled/.gitkeep": "",
};

export function init(root: string): void {
  for (const [rel, content] of Object.entries(SCAFFOLD)) {
    const path = join(root, rel);
    if (existsSync(path)) {
      console.log(`[mmm-loop] exists, leaving untouched: ${rel}`);
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    console.log(`[mmm-loop] created ${rel}`);
  }
  console.log(
    "[mmm-loop] init done. Fill in docs/CONTEXT.md and docs/vision.md, then: bun scripts/mmm-loop/loop.ts run",
  );
  console.log(
    "[mmm-loop] tip: drop feedback into docs/feedback/inbox/ and the next sprint handles it (see docs/feedback/README.md)",
  );
}

/** Step 1 (spec §8.1): existence-only validation. Returns missing files. */
export function missingRequiredFiles(root: string): string[] {
  return REQUIRED_FILES.filter((rel) => !existsSync(join(root, rel)));
}
