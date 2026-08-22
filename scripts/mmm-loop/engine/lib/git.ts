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

// --------------------------------------------------------------- branches
// Sprint-branch plumbing (spec §6.4): the orchestrator creates, checks out,
// merges, and deletes `sprint/NN` branches; agents never touch branches.

/** Name of the currently checked-out branch. */
export async function gitCurrentBranch(cwd: string): Promise<string> {
  return (await git(cwd, "rev-parse", "--abbrev-ref", "HEAD")).trim();
}

/** True when `cwd` is inside a git work tree. `update` needs this before it
 * can promise a reviewable, undoable change. */
export async function gitIsRepo(cwd: string): Promise<boolean> {
  const proc = Bun.spawn(["git", "rev-parse", "--is-inside-work-tree"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  return (await proc.exited) === 0;
}

/** `git status --porcelain` lines limited to one pathspec — staged,
 * unstaged, and untracked alike. Empty = nothing to lose under that path. */
export async function gitStatusPorcelain(cwd: string, pathspec: string): Promise<string[]> {
  const out = await git(cwd, "status", "--porcelain", "--", pathspec);
  return out.split("\n").filter((l) => l.trim() !== "");
}

/** All local branch names (short form, e.g. "main", "sprint/01"). */
export async function gitLocalBranches(cwd: string): Promise<string[]> {
  const out = await git(cwd, "for-each-ref", "refs/heads", "--format=%(refname:short)");
  return out.split("\n").filter(Boolean);
}

/** True when `path` is gitignored — a project may keep its feedback out of
 * git, and `git add` on an ignored path is a hard error. */
export async function gitIsIgnored(cwd: string, path: string): Promise<boolean> {
  const proc = Bun.spawn(["git", "check-ignore", "-q", "--", path], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  return (await proc.exited) === 0;
}

export async function gitBranchExists(cwd: string, name: string): Promise<boolean> {
  return (await gitLocalBranches(cwd)).includes(name);
}

export async function gitCheckout(cwd: string, name: string): Promise<void> {
  await git(cwd, "checkout", name);
}

/** Create `name` at the current HEAD and check it out. */
export async function gitCreateBranch(cwd: string, name: string): Promise<void> {
  await git(cwd, "checkout", "-b", name);
}

/** Delete a fully-merged branch. `-d` (not `-D`) on purpose: refusing to
 * delete an unmerged branch is a free extra safety check. */
export async function gitDeleteMergedBranch(cwd: string, name: string): Promise<void> {
  await git(cwd, "branch", "-d", name);
}

/**
 * `git merge --no-ff <name> -m <message>` into the current branch. On any
 * failure the merge is aborted (best-effort) and "conflict" is returned
 * instead of throwing — the caller owns the message. The orchestrator never
 * attempts conflict resolution.
 */
export async function gitMergeNoFF(
  cwd: string,
  name: string,
  message: string,
): Promise<"merged" | "conflict"> {
  const proc = Bun.spawn(["git", "merge", "--no-ff", name, "-m", message], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    // Abort whatever half-merge state remains; ignore this command's own
    // failure (there is no merge in progress when e.g. the checkout failed).
    const abort = Bun.spawn(["git", "merge", "--abort"], { cwd, stdout: "pipe", stderr: "pipe" });
    await abort.exited;
    return "conflict";
  }
  return "merged";
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
