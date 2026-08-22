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
 *
 * The layout is spelled here and nowhere else — in particular `resolvePrompt`
 * is the only thing that turns a step id into a file, so prompts overlay the
 * same way config does: `prompts/<id>.md` shadows `engine/prompts/<id>.md`.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Where a repo root keeps its bundle. */
export const BUNDLE_REL = "scripts/mmm-loop";

/** The two directory names the layout is made of. Private: everything that
 * needs them goes through the helpers below, so no other module spells a
 * bundle path itself. */
const ENGINE = "engine";
const PROMPTS = "prompts";

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
  return join(sourceRoot, BUNDLE_REL, ENGINE);
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

// ------------------------------------------------------------------ prompts

/** Where a project puts prompt overrides. */
export function overlayPromptsDir(bundleRoot: string): string {
  return join(bundleRoot, PROMPTS);
}

/** Where an engine ships the prompts it was released with. */
export function enginePromptsDir(engineDir: string): string {
  return join(engineDir, PROMPTS);
}

/** A shipped prompt as an *engine-relative* path — the form `diffEngines`
 * reports, so `update` can ask whether one moved. */
export function enginePromptRel(file: string): string {
  return `${PROMPTS}/${file}`;
}

/** Prompt overrides in a bundle's `prompts/`: the `.md` files a project has
 * put there. Dotfiles (the scaffolded `.gitkeep`) are not overrides. */
export function promptOverrides(bundleRoot: string): string[] {
  return listFiles(overlayPromptsDir(bundleRoot)).filter(
    (f) => !f.startsWith(".") && f.endsWith(".md"),
  );
}

/** The step id a prompt override file names: `03-spec.md` → `03-spec`. */
export function stepIdOfPromptFile(file: string): string {
  return file.replace(/\.md$/, "");
}

export interface ResolvedPrompt {
  /** Absolute path to read the template from. */
  path: string;
  /** The same file repo-relative — what banners and errors show a human. */
  display: string;
  /** True when the project overlay shadows the engine's own prompt. */
  overridden: boolean;
}

/**
 * Which file a step's prompt actually comes from: the project's
 * `prompts/<id>.md` when it exists, otherwise the engine's
 * `engine/prompts/<id>.md`.
 *
 * Every prompt read in the engine goes through here, and `display` travels
 * with the content — so an override cannot take effect silently: the banner
 * printed before the spawn and the message printed when the step dies both
 * name the file that was actually read.
 *
 * `display` is built from the layout constants, not from the absolute path,
 * so it is the stable `scripts/mmm-loop/…` string regardless of where the
 * bundle happens to live on disk.
 */
export function resolvePrompt(engineDir: string, stepId: string): ResolvedPrompt {
  const file = `${stepId}.md`;
  const overlay = join(overlayPromptsDir(bundleRootOf(engineDir)), file);
  const overridden = existsSync(overlay);
  return {
    path: overridden ? overlay : join(enginePromptsDir(engineDir), file),
    display: overridden
      ? `${BUNDLE_REL}/${PROMPTS}/${file}`
      : `${BUNDLE_REL}/${ENGINE}/${PROMPTS}/${file}`,
    overridden,
  };
}
