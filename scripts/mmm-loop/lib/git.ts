/** Git helpers for the orchestrator's deterministic commits and commit-SHA
 * recording (spec §6.4). */

import { LoopError } from "./errors.ts";

async function git(cwd: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, errOut, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new LoopError(`git ${args.join(" ")} failed (${exitCode}): ${errOut.trim()}`);
  }
  return out;
}

/** Current HEAD sha, or null in a repo with no commits yet. */
export async function gitHead(cwd: string): Promise<string | null> {
  const proc = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return exitCode === 0 ? out.trim() : null;
}

/** New commits since `before` (oldest first). `before` null = all commits. */
export async function gitNewCommits(cwd: string, before: string | null): Promise<string[]> {
  const range = before ? `${before}..HEAD` : "HEAD";
  if ((await gitHead(cwd)) === null) return [];
  const out = await git(cwd, "rev-list", "--reverse", range);
  return out.split("\n").filter(Boolean);
}

/** `git show` patches for exactly the given commits, oldest first. */
export async function gitDiffOfCommits(cwd: string, shas: string[]): Promise<string> {
  if (shas.length === 0) return "(no commits recorded for this ticket)";
  return git(cwd, "show", "--patch", "--stat", ...shas);
}

/** One-line summaries of the given commits. */
export async function gitSummaries(cwd: string, shas: string[]): Promise<string> {
  if (shas.length === 0) return "(no commits)";
  const out = await git(cwd, "show", "--no-patch", "--format=%h %s", ...shas);
  return out.trim();
}

/**
 * Stage the given paths and commit if anything changed under them. Loop
 * artifacts only — agent code commits are the implement agent's job.
 */
export async function gitCommitPaths(cwd: string, message: string, paths: string[]): Promise<void> {
  await git(cwd, "add", "--", ...paths);
  const changed = await git(cwd, "status", "--porcelain", "--", ...paths);
  if (changed.trim() === "") return;
  // Pathspec commit: only the loop's artifacts, even if an agent left
  // unrelated changes staged.
  await git(cwd, "commit", "-m", message, "--", ...paths);
}
