/**
 * The on-disk shape of an installed bundle, in one place — `version`,
 * `install`, and `update` all reason about the same four items:
 *
 *   scripts/mmm-loop/
 *     loop.ts      one-line shim into the engine (written by install)
 *     config.ts    the project overlay (written by install, never updated)
 *     prompts/     project prompt overrides (empty at install time)
 *     engine/      upstream; `update` replaces this wholesale
 *
 * A *source* is a repo root — local path or URL — whose engine lives at
 * `scripts/mmm-loop/engine`. That one convention is what makes install and
 * update symmetric: install copies out of a source, update copies in.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Where a repo root keeps its bundle. */
export const BUNDLE_REL = "scripts/mmm-loop";

/** The bundle root (`…/scripts/mmm-loop`) holding `engineDir`. */
export function bundleRootOf(engineDir: string): string {
  return dirname(engineDir);
}

/** The repo root that a bundle root belongs to — what install records as
 * `source.from`, and what `--from` names. */
export function repoRootOf(bundleRoot: string): string {
  return resolve(bundleRoot, "..", "..");
}

/** The engine directory of a source repo root (local path or clone). */
export function engineDirOfSource(sourceRoot: string): string {
  return join(sourceRoot, BUNDLE_REL, "engine");
}

/** The one-line shim install writes as `scripts/mmm-loop/loop.ts`. */
export const SHIM = `import "./engine/loop.ts";\n`;

/** The starter overlay install writes, with the source it was invoked from
 * pinned so a later `update` knows where to fetch from. */
export function starterOverlay(from: string): string {
  return `/** Project overrides, deep-merged over \`engine/defaults.ts\` by \`engine/config.ts\`.
 *  Empty = stock engine. Widen to \`LoopConfigOverlay\` for partial nested values. */
import type { LoopConfig } from "./engine/defaults.ts";

export const config: Partial<LoopConfig> = {
  /** Where this engine was installed from; \`update\` fetches from here. */
  source: { from: ${JSON.stringify(from)} },
};
`;
}

/** Every file under `dir`, as paths relative to it, sorted. Missing dir = [].
 * Directories are not listed — an engine is defined by its files. */
export function listFiles(dir: string, prefix = ""): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listFiles(join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

/** The engine's version string, or "(unknown)" when VERSION is absent —
 * never a throw, so `update` can still report on a malformed source. */
export function readEngineVersion(engineDir: string): string {
  const path = join(engineDir, "VERSION");
  if (!existsSync(path) || !statSync(path).isFile()) return "(unknown)";
  return readFileSync(path, "utf8").trim() || "(unknown)";
}

/** Prompt overrides in a bundle's `prompts/`: the `.md` files a project has
 * put there. Dotfiles (the scaffolded `.gitkeep`) are not overrides. */
export function promptOverrides(bundleRoot: string): string[] {
  return listFiles(join(bundleRoot, "prompts")).filter(
    (f) => !f.startsWith(".") && f.endsWith(".md"),
  );
}
