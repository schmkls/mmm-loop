/** Shared test helpers: temp projects wired to the fake `claude`. */

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { UX_TICKETIZED_NO, UX_TICKETIZED_YES } from "../scripts/mmm-loop/lib/phases.ts";
import { init } from "../scripts/mmm-loop/lib/scaffold.ts";
import type { Ticket } from "../scripts/mmm-loop/lib/tickets.ts";

export const REPO_ROOT = resolve(import.meta.dir, "..");
export const BUNDLE_DIR = join(REPO_ROOT, "scripts", "mmm-loop");
export const LOOP_TS = join(BUNDLE_DIR, "loop.ts");
export const FAKE_CLAUDE = join(REPO_ROOT, "tests", "fixtures", "fake-claude.ts");
const SCENARIOS_SRC = join(REPO_ROOT, "tests", "fixtures", "scenarios");

export interface TestProject {
  root: string;
  scenarioDir: string;
  logDir: string;
  /** Env for spawning the loop CLI; extend with SCENARIO_* to steer fakes. */
  env: Record<string, string>;
}

export function sh(cwd: string, ...argv: string[]): string {
  const r = Bun.spawnSync(argv, { cwd, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) {
    throw new Error(`${argv.join(" ")} failed (${r.exitCode}): ${r.stderr.toString()}`);
  }
  return r.stdout.toString();
}

/** Temp git project with scaffolded files committed and all canned scenarios
 * available (behavior steered via SCENARIO_* env vars). */
export function makeProject(opts: { scaffold?: boolean } = {}): TestProject {
  const base = mkdtempSync(join(tmpdir(), "mmm-loop-test-"));
  const root = join(base, "proj");
  const scenarioDir = join(base, "scenarios");
  const logDir = join(base, "log");
  mkdirSync(root);
  mkdirSync(logDir);
  cpSync(SCENARIOS_SRC, scenarioDir, { recursive: true });

  sh(root, "git", "init", "-q", "-b", "main");
  sh(root, "git", "config", "user.email", "test@example.com");
  sh(root, "git", "config", "user.name", "Test");
  if (opts.scaffold !== false) {
    init(root);
    sh(root, "git", "add", "-A");
    sh(root, "git", "commit", "-q", "-m", "chore: scaffold");
  }

  return {
    root,
    scenarioDir,
    logDir,
    env: {
      ...(process.env as Record<string, string>),
      MMM_LOOP_CLAUDE_BIN: FAKE_CLAUDE,
      FAKE_CLAUDE_SCENARIO: scenarioDir,
      FAKE_CLAUDE_LOG: logDir,
    },
  };
}

export function runLoop(
  p: TestProject,
  args: string[] = ["run"],
  extraEnv: Record<string, string> = {},
): { exitCode: number; stdout: string; stderr: string } {
  const r = Bun.spawnSync(["bun", LOOP_TS, ...args], {
    cwd: p.root,
    env: { ...p.env, ...extraEnv },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

const FAKE_ENV_KEYS = ["MMM_LOOP_CLAUDE_BIN", "FAKE_CLAUDE_SCENARIO", "FAKE_CLAUDE_LOG"];

/** Run `fn` (which calls step functions in-process) with the fake claude and
 * any SCENARIO_* vars set in process.env, restoring afterwards. */
export async function withFakeClaude<T>(
  p: TestProject,
  extraEnv: Record<string, string>,
  fn: () => Promise<T>,
): Promise<T> {
  const keys = [...FAKE_ENV_KEYS, ...Object.keys(extraEnv)];
  const saved = new Map(keys.map((k) => [k, process.env[k]]));
  for (const k of FAKE_ENV_KEYS) process.env[k] = p.env[k];
  Object.assign(process.env, extraEnv);
  try {
    return await fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// ------------------------------------------------------------ state builders

export function freshTicket(id: string, overrides: Partial<Ticket> = {}): Ticket {
  return {
    id,
    title: `Ticket ${id}`,
    description: `Do the thing for ticket ${id}.`,
    tests: [{ description: `ticket ${id} works`, passes: false }],
    done: false,
    reviewed: false,
    needs_human_intervention: false,
    needs_human_intervention_reason: null,
    human_note: null,
    commits: [],
    ...overrides,
  };
}

export interface SprintFiles {
  dirName?: string;
  focus?: boolean;
  /** Verbatim sprint_focus.md content (e.g. a feedback stamp); overrides the
   * generic default written when `focus` is not false. */
  focusContent?: string;
  spec?: boolean;
  /** Verbatim spec.md content (e.g. a cleanup candidates stamp); overrides
   * the generic default written when `spec` is not false. */
  specContent?: string;
  /** filename → ticket. Omit for no tickets/ dir; {} for an empty one. */
  tickets?: Record<string, Ticket>;
  /** UX-pass state: plan writes ux_test_plan.md; findings "no"/"yes" map to
   * the stamp constants (any other string is written verbatim as the first
   * line, for malformed-stamp tests). */
  ux?: { plan?: boolean; findings?: "no" | "yes" | string };
}

/** Write a sprint folder directly (bypassing agents) and commit it. */
export function makeSprint(p: TestProject, files: SprintFiles = {}): string {
  const dirName = files.dirName ?? "01-toy";
  const dir = join(p.root, ".working", "sprints", dirName);
  mkdirSync(dir, { recursive: true });
  if (files.focusContent !== undefined) {
    writeFileSync(join(dir, "sprint_focus.md"), files.focusContent);
  } else if (files.focus !== false) {
    writeFileSync(join(dir, "sprint_focus.md"), "# Sprint — toy\n\n## What\nToy.\n\n## Why\nTest.\n");
  }
  if (files.specContent !== undefined) {
    writeFileSync(join(dir, "spec.md"), files.specContent);
  } else if (files.spec !== false) {
    writeFileSync(join(dir, "spec.md"), "# Spec\n\n- Toy works.\n");
  }
  if (files.tickets !== undefined) {
    mkdirSync(join(dir, "tickets"), { recursive: true });
    for (const [filename, ticket] of Object.entries(files.tickets)) {
      writeTicketFile(p, dirName, filename, ticket);
    }
  }
  if (files.ux?.plan) {
    writeFileSync(
      join(dir, "ux_test_plan.md"),
      "# UX test plan — sprint 01\n\n## User-facing delta\n\nThe toy (seeded).\n\n## Tests\n\n### T1 — toy feature output\n- Method: run the toy with existing tools\n\n## Not testable / out of scope\n\nNothing.\n",
    );
  }
  if (files.ux?.findings !== undefined) {
    const stamps: Record<string, string> = { no: UX_TICKETIZED_NO, yes: UX_TICKETIZED_YES };
    const firstLine = stamps[files.ux.findings] ?? files.ux.findings;
    writeFileSync(
      join(dir, "ux_findings.md"),
      `${firstLine}\n\n# UX findings — sprint 01\n\n## Summary\n\nOne finding (seeded).\n\n## Tested\n\nT1 (seeded).\n\n## Findings\n\n### F1 — Toy output confusing (severity: medium)\n- Where: the toy feature's output\n- Expected: clear output\n- Actual: confusing output\n- Repro: run the toy feature\n\n## Not testable\n\nNothing.\n`,
    );
  }
  sh(p.root, "git", "add", "-A");
  sh(p.root, "git", "commit", "-q", "-m", `test: seed sprint ${dirName}`);
  return dirName;
}

/** Drop feedback items into docs/feedback/inbox/ and commit them, the way a
 * human would before a run. */
export function seedFeedback(p: TestProject, items: Record<string, string>): void {
  const inbox = join(p.root, "docs", "feedback", "inbox");
  mkdirSync(inbox, { recursive: true });
  for (const [filename, content] of Object.entries(items)) {
    writeFileSync(join(inbox, filename), content);
  }
  sh(p.root, "git", "add", "-A");
  sh(p.root, "git", "commit", "-q", "-m", "test: seed feedback");
}

/** Item filenames in docs/feedback/inbox|handled (sorted, dotfiles such as
 * the scaffolded .gitkeep excluded); missing dir = []. */
export function feedbackFiles(p: TestProject, which: "inbox" | "handled"): string[] {
  const dir = join(p.root, "docs", "feedback", which);
  return existsSync(dir) ? readdirSync(dir).filter((f) => !f.startsWith(".")).sort() : [];
}

export function writeTicketFile(p: TestProject, dirName: string, filename: string, t: Ticket): void {
  writeFileSync(
    join(p.root, ".working", "sprints", dirName, "tickets", filename),
    JSON.stringify(t, null, 2) + "\n",
  );
}

export function readTicket(p: TestProject, dirName: string, filename: string): Ticket {
  return JSON.parse(
    readFileSync(join(p.root, ".working", "sprints", dirName, "tickets", filename), "utf8"),
  );
}

// ------------------------------------------------------------------ asserts

/** Commit subjects, newest first. */
export function gitSubjects(p: TestProject): string[] {
  return logSubjects(p, "HEAD");
}

/** Commit subjects reachable from `ref`, newest first. `--topo-order` keeps
 * the order deterministic across merge commits (children before parents). */
export function logSubjects(p: TestProject, ref: string): string[] {
  return sh(p.root, "git", "log", "--topo-order", "--format=%s", ref).trim().split("\n");
}

export function currentBranch(p: TestProject): string {
  return sh(p.root, "git", "rev-parse", "--abbrev-ref", "HEAD").trim();
}

export function localBranches(p: TestProject): string[] {
  return sh(p.root, "git", "for-each-ref", "refs/heads", "--format=%(refname:short)")
    .trim()
    .split("\n")
    .filter(Boolean);
}

/** Invocation log filenames (chronological) — e.g. ["01-03-spec.txt"]. */
export function invocations(p: TestProject): string[] {
  return readdirSync(p.logDir).sort();
}

export function invocationText(p: TestProject, filename: string): string {
  return readFileSync(join(p.logDir, filename), "utf8");
}
