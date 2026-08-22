/** Helpers for the bundle-level commands (version, install, update): scratch
 * projects with a real installed bundle, and mutable copies of this repo to
 * update *from*. */

import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { listFiles } from "../scripts/mmm-loop/engine/lib/bundle.ts";
import { LOOP_TS, REPO_ROOT, sh } from "./helpers.ts";

/** An empty git repo with one commit, ready to install into. `realpathSync`
 * because macOS temp dirs are symlinks and the loop reports real paths. */
export function scratchRepo(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "mmm-loop-scratch-")));
  sh(root, "git", "init", "-q", "-b", "main");
  sh(root, "git", "config", "user.email", "test@example.com");
  sh(root, "git", "config", "user.name", "Test");
  writeFileSync(join(root, "README.md"), "# scratch\n");
  commitAll(root, "chore: scratch");
  return root;
}

export function commitAll(root: string, message: string): void {
  sh(root, "git", "add", "-A");
  sh(root, "git", "commit", "-q", "-m", message);
}

/** A scratch repo with this engine installed and committed. */
export function installedRepo(): string {
  const root = scratchRepo();
  const r = runBundle(REPO_ROOT, ["install", root]);
  if (r.exitCode !== 0) throw new Error(`install failed: ${r.stderr}`);
  commitAll(root, "chore: install mmm-loop");
  return root;
}

/**
 * A copy of this repo to update from, optionally mutated so a test can see a
 * real diff. Only `scripts/` (plus any CHANGELOG) is copied — that is all a
 * source needs.
 */
export function sourceRepo(
  opts: { version?: string; changelog?: string; addFiles?: Record<string, string> } = {},
): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "mmm-loop-source-")));
  cpSync(join(REPO_ROOT, "scripts"), join(root, "scripts"), { recursive: true });
  const engine = join(root, "scripts", "mmm-loop", "engine");
  if (opts.version !== undefined) writeFileSync(join(engine, "VERSION"), `${opts.version}\n`);
  if (opts.changelog !== undefined) writeFileSync(join(root, "CHANGELOG.md"), opts.changelog);
  for (const [rel, content] of Object.entries(opts.addFiles ?? {})) {
    mkdirSync(dirname(join(engine, rel)), { recursive: true });
    writeFileSync(join(engine, rel), content);
  }
  return root;
}

/** Run a bundle's own `loop.ts` from inside `root` (the installed case), or
 * this repo's when `root` is REPO_ROOT. */
export function runBundle(
  root: string,
  args: string[],
): { exitCode: number; stdout: string; stderr: string } {
  const loop = root === REPO_ROOT ? LOOP_TS : join(root, "scripts", "mmm-loop", "loop.ts");
  const r = Bun.spawnSync(["bun", loop, ...args], {
    cwd: root,
    env: { ...(process.env as Record<string, string>), NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

/** Every file under `scripts/mmm-loop`, path → content: the thing a dry run
 * must leave byte-identical. */
export function bundleSnapshot(root: string): Record<string, string> {
  const bundle = join(root, "scripts", "mmm-loop");
  return Object.fromEntries(
    listFiles(bundle).map((rel) => [rel, readFileSync(join(bundle, rel), "utf8")]),
  );
}

export function gitStatus(root: string): string[] {
  return sh(root, "git", "status", "--porcelain")
    .split("\n")
    .filter((l) => l.trim() !== "");
}

export function cleanup(...dirs: string[]): void {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}
