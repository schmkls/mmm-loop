/**
 * `install <target>`: put this engine into another project.
 *
 * Writes the four bundle items (see bundle.ts) and nothing else — in
 * particular it does not scaffold `docs/` or `.working/`; that is `init`'s
 * job, run by the human afterwards. Refusing when a bundle already exists
 * keeps install a create-only operation: moving an existing project forward
 * is what `update` is for.
 */

import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  BUNDLE_REL,
  bundleRootOf,
  overlayPromptsDir,
  readEngineVersion,
  repoRootOf,
  SHIM,
  starterOverlay,
} from "./bundle.ts";
import { LoopError } from "./errors.ts";

export interface InstallOptions {
  /** The engine doing the installing — `engine/` of the source bundle. */
  engineDir: string;
  /** Project to install into, as typed on the command line. */
  target: string;
  /** Directory `target` is resolved against. */
  cwd: string;
}

export function install({ engineDir, target, cwd }: InstallOptions): void {
  const sourceRoot = repoRootOf(bundleRootOf(engineDir));
  const targetRoot = resolve(cwd, target);
  const destBundle = join(targetRoot, BUNDLE_REL);

  if (existsSync(destBundle)) {
    throw new LoopError(
      `${BUNDLE_REL}/ already exists in ${targetRoot}.\n` +
        `install only creates a bundle; to move an existing one forward run ` +
        `\`bun ${BUNDLE_REL}/loop.ts update\` there instead.`,
    );
  }
  if (!existsSync(targetRoot)) {
    throw new LoopError(`target does not exist: ${targetRoot}`);
  }

  mkdirSync(destBundle, { recursive: true });
  cpSync(engineDir, join(destBundle, "engine"), { recursive: true });
  writeFileSync(join(destBundle, "loop.ts"), SHIM);
  writeFileSync(join(destBundle, "config.ts"), starterOverlay(sourceRoot));
  // `.gitkeep` so the empty override directory survives a commit; it is a
  // dotfile, so it never counts as an override.
  mkdirSync(overlayPromptsDir(destBundle), { recursive: true });
  writeFileSync(join(overlayPromptsDir(destBundle), ".gitkeep"), "");

  console.log(
    `[mmm-loop] installed ${readEngineVersion(engineDir)} into ${join(targetRoot, BUNDLE_REL)}`,
  );
  console.log(`[mmm-loop] source pinned to ${sourceRoot}`);
  console.log(`[mmm-loop] next: cd ${targetRoot} && bun ${BUNDLE_REL}/loop.ts init`);
}
