/**
 * `update`: replace `engine/` wholesale from the source pinned in the
 * overlay `config.ts`, leaving every other bundle item alone.
 *
 * Three properties make that safe enough to run unattended-ish:
 *
 *  - **Dry run by default.** `--apply` is the only thing that writes.
 *  - **Two refusals** (see `updateRefusal`) that keep the result reviewable:
 *    the bundle must be clean going in, so the update is exactly one diff a
 *    human can read and `git checkout` can undo, and no sprint may be in
 *    flight, because swapping the engine under a running sprint changes the
 *    rules mid-game.
 *  - **It never runs `init`.** A new engine may scaffold files this project
 *    lacks; update says so and stops there. Creating project files is a
 *    human's decision, not an update's side effect.
 *
 * It also warns about stale prompt overrides (see `staleOverrides`) — the one
 * kind of drift that survives an update *because* update leaves the overlay
 * alone, and the only one that can quietly break a postcondition afterwards.
 */

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { sprintBranches } from "./branches.ts";
import {
  BUNDLE_REL,
  bundleRootOf,
  engineDirOfSource,
  enginePromptRel,
  listFiles,
  promptOverrides,
  readEngineVersion,
  resolvePrompt,
  stepIdOfPromptFile,
} from "./bundle.ts";
import { upgradeNotes } from "./changelog.ts";
import { LoopError } from "./errors.ts";
import { gitIsRepo, gitLocalBranches, gitStatusPorcelain } from "./git.ts";

export interface UpdateOptions {
  /** The project being updated. */
  root: string;
  /** The engine being replaced — `<root>/scripts/mmm-loop/engine`. */
  engineDir: string;
  /** The overlay's `source` pin; `--from` overrides its `from` for one run. */
  source: { from: string; ref?: string } | undefined;
  from?: string;
  apply: boolean;
}

// ------------------------------------------------------------------ sources

export type SourceKind = "path" | "url";

/**
 * Local path or URL? Anything explicitly rooted (`/`, `./`, `~`) or already
 * present on disk is a path; everything else is a URL, so the pin may be
 * written the short way (`github.com/schmkls/mmm-loop`) without a scheme.
 */
export function sourceKind(from: string): SourceKind {
  if (/^[./~]/.test(from) || existsSync(from)) return "path";
  return "url";
}

/** A clone-able URL: the short `host/owner/repo` form gets https://. */
export function cloneUrl(from: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(from) || /^[^/\s]+@[^/\s]+:/.test(from)
    ? from
    : `https://${from}`;
}

// ----------------------------------------------------------------- refusals

export interface Refusal {
  rule: string;
  detail: string;
}

/**
 * The two refusal rules, in order. `dirty` is `git status --porcelain`
 * limited to the bundle; `branches` is every local branch name.
 */
export function updateRefusal(dirty: string[], branches: string[]): Refusal | null {
  if (dirty.length > 0) {
    return {
      rule: `uncommitted changes under ${BUNDLE_REL}/`,
      detail:
        `commit or stash them first, so an applied update stays exactly one ` +
        `reviewable commit that \`git checkout\` can undo:\n` +
        dirty.map((line) => `    ${line}`).join("\n"),
    };
  }
  const sprints = sprintBranches(branches);
  if (sprints.length > 0) {
    return {
      rule: `sprint branch ${sprints.join(", ")} exists`,
      detail: "finish your sprint, then update.",
    };
  }
  return null;
}

// --------------------------------------------------------------------- diff

export interface EngineDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

function sameContent(a: string, b: string): boolean {
  return readFileSync(a).equals(readFileSync(b));
}

/** What replacing `oldDir` with `newDir` would do, file by file. */
export function diffEngines(oldDir: string, newDir: string): EngineDiff {
  const before = new Set(listFiles(oldDir));
  const after = new Set(listFiles(newDir));
  return {
    added: [...after].filter((f) => !before.has(f)).sort(),
    removed: [...before].filter((f) => !after.has(f)).sort(),
    changed: [...after]
      .filter((f) => before.has(f) && !sameContent(join(oldDir, f), join(newDir, f)))
      .sort(),
  };
}

export function isEmptyDiff(d: EngineDiff): boolean {
  return d.added.length === 0 && d.removed.length === 0 && d.changed.length === 0;
}

// -------------------------------------------------------- stale overrides

/**
 * Which of a project's prompt overrides shadow an upstream prompt that moves
 * in this span — the `.md` filenames, sorted.
 *
 * Update deliberately replaces only `engine/`, so an override keeps working
 * afterwards exactly as written. That is the point, and also the hazard: when
 * the engine rewrites its own copy of a prompt the project forked, the fork
 * silently goes on issuing the old instructions to a step whose postcondition
 * may now expect something else. Nothing downstream can detect that — the run
 * just fails oddly, two steps later — so this is the moment to say it.
 *
 * `removed` counts as well as `changed`: an override shadowing a prompt the
 * new engine no longer ships is the same stale fork, one step further gone.
 */
export function staleOverrides(overrides: string[], diff: EngineDiff): string[] {
  const moved = new Set([...diff.changed, ...diff.removed]);
  return overrides.filter((file) => moved.has(enginePromptRel(file))).sort();
}

// ------------------------------------------------------------------ scaffold

/**
 * Files the *new* engine would scaffold that this project does not have —
 * asked of the new engine itself, so a version that adds a scaffold file
 * announces it without this one having to know about it. Best-effort: an
 * engine whose scaffold module has moved or changed shape simply reports
 * nothing rather than failing the update.
 */
async function missingScaffoldFiles(newEngineDir: string, root: string): Promise<string[]> {
  let paths: unknown;
  try {
    paths = (await import(join(newEngineDir, "lib", "scaffold.ts"))).SCAFFOLD_FILES;
  } catch {
    return [];
  }
  if (!Array.isArray(paths)) return [];
  return paths.filter((p): p is string => typeof p === "string" && !existsSync(join(root, p)));
}

// -------------------------------------------------------------------- fetch

/** Materialize a source repo root on disk. `cleanup` removes a clone. */
function fetchSource(from: string, ref: string | undefined): { root: string; cleanup: () => void } {
  if (sourceKind(from) === "path") {
    const root = resolve(from);
    if (!existsSync(root)) throw new LoopError(`source does not exist: ${root}`);
    return { root, cleanup: () => {} };
  }
  const temp = mkdtempSync(join(tmpdir(), "mmm-loop-update-"));
  const dest = join(temp, "source");
  const url = cloneUrl(from);
  const args = ["clone", "--depth", "1", ...(ref ? ["--branch", ref] : []), url, dest];
  const proc = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    rmSync(temp, { recursive: true, force: true });
    throw new LoopError(
      `git clone of ${url}${ref ? ` (ref ${ref})` : ""} failed: ${proc.stderr.toString().trim()}`,
    );
  }
  return { root: dest, cleanup: () => rmSync(temp, { recursive: true, force: true }) };
}

// ------------------------------------------------------------------ command

export async function update({
  root,
  engineDir,
  source,
  from,
  apply,
}: UpdateOptions): Promise<void> {
  const pin = from ?? source?.from;
  if (pin === undefined) {
    throw new LoopError(
      `no update source: set \`source: { from: "…" }\` in ${BUNDLE_REL}/config.ts, ` +
        `or pass --from <path-or-url>.`,
    );
  }
  const bundleRoot = bundleRootOf(engineDir);

  // Refusal rule 1 needs git. Without it there is no way to review or undo an
  // applied update, so the safety the rules provide is simply not available.
  if (!(await gitIsRepo(root))) {
    throw new LoopError(
      `${root} is not a git repository — update needs git so the change is ` +
        `reviewable and undoable. Run \`git init\` and commit first.`,
    );
  }
  const refusal = updateRefusal(
    await gitStatusPorcelain(root, bundleRoot),
    await gitLocalBranches(root),
  );
  if (refusal !== null) {
    throw new LoopError(`refusing to update: ${refusal.rule} — ${refusal.detail}`);
  }

  const { root: sourceRoot, cleanup } = fetchSource(pin, source?.ref);
  try {
    const newEngine = engineDirOfSource(sourceRoot);
    if (!existsSync(newEngine)) {
      throw new LoopError(
        `${pin} has no ${BUNDLE_REL}/engine/ — it looks like a pre-split mmm-loop. ` +
          `update supports only sources that ship an engine/ directory; ` +
          `point --from at a newer ref, or reinstall.`,
      );
    }

    const oldVersion = readEngineVersion(engineDir);
    const newVersion = readEngineVersion(newEngine);
    const diff = diffEngines(engineDir, newEngine);
    const kind = sourceKind(pin) === "path" ? "local path" : "url";

    console.log(`[mmm-loop] update: ${oldVersion} → ${newVersion}`);
    console.log(`[mmm-loop] source: ${pin} (${kind})`);

    if (isEmptyDiff(diff)) {
      console.log(`[mmm-loop] engine/ is already identical to the source — nothing to do.`);
      return;
    }
    for (const f of diff.added) console.log(`  + engine/${f}`);
    for (const f of diff.removed) console.log(`  - engine/${f}`);
    for (const f of diff.changed) console.log(`  ~ engine/${f}`);
    console.log(
      `[mmm-loop] ${diff.added.length} added, ${diff.removed.length} removed, ` +
        `${diff.changed.length} changed`,
    );

    printStaleOverrides(engineDir, staleOverrides(promptOverrides(bundleRoot), diff), diff);
    printUpgradeNotes(sourceRoot, oldVersion, newVersion);

    const missing = await missingScaffoldFiles(newEngine, root);
    if (missing.length > 0) {
      console.log(`[mmm-loop] new scaffold files available — run \`init\`:`);
      for (const f of missing) console.log(`    ${f}`);
    }

    if (!apply) {
      console.log(`[mmm-loop] dry run — nothing changed. Re-run with --apply to update.`);
      return;
    }

    rmSync(engineDir, { recursive: true, force: true });
    cpSync(newEngine, engineDir, { recursive: true });
    const rel = relative(root, engineDir) || basename(engineDir);
    console.log(`[mmm-loop] engine/ replaced — ${oldVersion} → ${newVersion}.`);
    console.log(`[mmm-loop] review with \`git diff\` and commit; \`git checkout -- ${rel}\` undoes it.`);
  } finally {
    cleanup();
  }
}

/** Name every stale override and the upstream file it shadows, one line each
 * — before the upgrade notes, and on dry runs too, since deciding whether to
 * apply is exactly when a human wants to know which fork is going stale. */
function printStaleOverrides(engineDir: string, stale: string[], diff: EngineDiff): void {
  if (stale.length === 0) return;
  console.log(`[mmm-loop] ⚠ prompt overrides shadowing a prompt this update touches:`);
  for (const file of stale) {
    const rel = enginePromptRel(file);
    const fate = diff.removed.includes(rel) ? "removed" : "changed";
    const overlay = resolvePrompt(engineDir, stepIdOfPromptFile(file)).display;
    console.log(`    ${overlay}  (engine/${rel} ${fate} upstream)`);
  }
  console.log(
    `    update leaves overrides alone, so these keep the old instructions — ` +
      `re-apply your edits on top of the new engine prompt.`,
  );
}

/** The source's upgrade notes for the span, when it ships a CHANGELOG. Its
 * absence is normal (a source may predate one) and never an error. */
function printUpgradeNotes(sourceRoot: string, oldVersion: string, newVersion: string): void {
  const path = join(sourceRoot, "CHANGELOG.md");
  if (!existsSync(path)) return;
  const notes = upgradeNotes(readFileSync(path, "utf8"), oldVersion, newVersion);
  if (notes === null) return;
  console.log(`\n[mmm-loop] upgrade notes (${oldVersion} → ${newVersion}):\n`);
  console.log(notes);
  console.log("");
}
