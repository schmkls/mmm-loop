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

export const REQUIRED_FILES = ["docs/CONTEXT.md", "docs/vision.md", ".working/vision_status.md"];

const SCAFFOLD: Record<string, string> = {
  "docs/CONTEXT.md": CONTEXT_TEMPLATE,
  "docs/vision.md": VISION_TEMPLATE,
  ".working/vision_status.md": VISION_STATUS_TEMPLATE,
  ".working/learnings.md": LEARNINGS_TEMPLATE,
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
}

/** Step 1 (spec §8.1): existence-only validation. Returns missing files. */
export function missingRequiredFiles(root: string): string[] {
  return REQUIRED_FILES.filter((rel) => !existsSync(join(root, rel)));
}
