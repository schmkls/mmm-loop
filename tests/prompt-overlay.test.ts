/**
 * The prompt overlay: `scripts/mmm-loop/prompts/<id>.md` shadows the engine's
 * own `engine/prompts/<id>.md`, exactly the way the config overlay shadows
 * `engine/defaults.ts`.
 *
 * Three things have to hold together for that to be safe, and each is tested
 * here: the resolver picks the right file; the *agent* is actually handed the
 * overridden bytes (not just the right path); and both the banner and
 * `update` say out loud which file won, so an override can never take effect
 * unnoticed.
 */

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgentStep } from "../scripts/mmm-loop/engine/lib/agent.ts";
import {
  enginePromptRel,
  promptOverrides,
  resolvePrompt,
  stepIdOfPromptFile,
} from "../scripts/mmm-loop/engine/lib/bundle.ts";
import { staleOverrides } from "../scripts/mmm-loop/engine/lib/update.ts";
import { cleanup, commitAll, installedRepo, runBundle, sourceRepo } from "./bundle-helpers.ts";
import { ENGINE_DIR, REPO_ROOT } from "./helpers.ts";

const temps: string[] = [];
afterAll(() => cleanup(...temps));

function track<T extends string>(dir: T): T {
  temps.push(dir);
  return dir;
}

/** A bundle laid out the real way — `<root>/scripts/mmm-loop/{prompts,engine}`
 * — with the engine's copy of one prompt written. Returns the engine dir plus
 * a hook to drop an override beside it. */
function bundle(stepId: string, engineBody: string) {
  const root = track(realTemp("mmm-loop-overlay-"));
  const bundleRoot = join(root, "scripts", "mmm-loop");
  const engineDir = join(bundleRoot, "engine");
  mkdirSync(join(engineDir, "prompts"), { recursive: true });
  mkdirSync(join(bundleRoot, "prompts"), { recursive: true });
  writeFileSync(join(engineDir, "prompts", `${stepId}.md`), engineBody);
  return {
    root,
    bundleRoot,
    engineDir,
    override: (body: string) => writeFileSync(join(bundleRoot, "prompts", `${stepId}.md`), body),
  };
}

function realTemp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("resolvePrompt", () => {
  test("no override: falls back to the prompt the engine ships", () => {
    const b = bundle("03-spec", "# engine\n");
    const r = resolvePrompt(b.engineDir, "03-spec");
    expect(r.overridden).toBe(false);
    expect(r.path).toBe(join(b.engineDir, "prompts", "03-spec.md"));
    expect(readFileSync(r.path, "utf8")).toBe("# engine\n");
    expect(r.display).toBe("scripts/mmm-loop/engine/prompts/03-spec.md");
  });

  test("override present: the project's copy wins", () => {
    const b = bundle("03-spec", "# engine\n");
    b.override("# mine\n");
    const r = resolvePrompt(b.engineDir, "03-spec");
    expect(r.overridden).toBe(true);
    expect(r.path).toBe(join(b.bundleRoot, "prompts", "03-spec.md"));
    expect(readFileSync(r.path, "utf8")).toBe("# mine\n");
    expect(r.display).toBe("scripts/mmm-loop/prompts/03-spec.md");
  });

  test("resolution is per step — one override does not shadow its neighbours", () => {
    const b = bundle("03-spec", "# engine\n");
    writeFileSync(join(b.engineDir, "prompts", "04-tickets.md"), "# engine tickets\n");
    b.override("# mine\n");
    expect(resolvePrompt(b.engineDir, "03-spec").overridden).toBe(true);
    expect(resolvePrompt(b.engineDir, "04-tickets").overridden).toBe(false);
  });

  test("in this repo every shipped step resolves to the engine — no stray overrides", () => {
    expect(promptOverrides(join(REPO_ROOT, "scripts", "mmm-loop"))).toEqual([]);
    for (const file of readdirSync(join(ENGINE_DIR, "prompts"))) {
      const r = resolvePrompt(ENGINE_DIR, stepIdOfPromptFile(file));
      expect(r.overridden).toBe(false);
      expect(r.display).toBe(`scripts/mmm-loop/engine/prompts/${file}`);
    }
  });
});

// ------------------------------------------------ the agent gets the override

const SPAWN_FAKE = join(import.meta.dir, "fixtures", "spawn-fake.ts");
const ENV_KEYS = ["MMM_LOOP_CLAUDE_BIN", "SPAWNTEST_DIR", "SPAWNTEST_OUT", "SPAWNTEST_MODE"];
let saved: Map<string, string | undefined> | undefined;

afterEach(() => {
  for (const [k, v] of saved ?? []) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  saved = undefined;
});

/** runAgentStep against the recording fake, in a real bundle layout. Returns
 * the prompt text `claude` was actually fed. */
async function promptGivenToAgent(b: ReturnType<typeof bundle>): Promise<string> {
  const rec = join(b.root, "rec");
  const cwd = join(b.root, "proj");
  mkdirSync(rec, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  const out = join(b.root, "out.txt");

  saved = new Map(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.MMM_LOOP_CLAUDE_BIN = SPAWN_FAKE;
  process.env.SPAWNTEST_DIR = rec;
  process.env.SPAWNTEST_OUT = out;
  process.env.SPAWNTEST_MODE = "succeed";

  await runAgentStep({
    stepId: "03-spec",
    vars: {},
    cwd,
    bundleDir: b.engineDir,
    check: () => (existsSync(out) ? null : "expected out.txt"),
  });
  const files = readdirSync(rec).sort();
  expect(files.length).toBe(1);
  return readFileSync(join(rec, files[0]!), "utf8");
}

describe("runAgentStep reads the resolved prompt", () => {
  test("the override's body is what the agent is given", async () => {
    const b = bundle("03-spec", "ENGINE BODY\n");
    b.override("OVERRIDDEN BODY\n");
    const given = await promptGivenToAgent(b);
    expect(given).toContain("OVERRIDDEN BODY");
    expect(given).not.toContain("ENGINE BODY");
  });

  test("without an override the engine's body is what the agent is given", async () => {
    const b = bundle("03-spec", "ENGINE BODY\n");
    const given = await promptGivenToAgent(b);
    expect(given).toContain("ENGINE BODY");
  });

  test("the banner names the overlay file, so the override is visible on the run", async () => {
    const b = bundle("03-spec", "ENGINE BODY\n");
    b.override("OVERRIDDEN BODY\n");
    const logged: string[] = [];
    const real = console.log;
    console.log = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
    try {
      await promptGivenToAgent(b);
    } finally {
      console.log = real;
    }
    expect(logged.join("\n")).toContain("prompt: scripts/mmm-loop/prompts/03-spec.md");
    expect(logged.join("\n")).not.toContain("engine/prompts/03-spec.md");
  });
});

// ------------------------------------------------------- update's stale warning

describe("staleOverrides", () => {
  const diff = (over: Partial<{ added: string[]; removed: string[]; changed: string[] }>) => ({
    added: [],
    removed: [],
    changed: [],
    ...over,
  });

  test("an override whose upstream changed in the span is stale", () => {
    expect(staleOverrides(["03-spec.md"], diff({ changed: [enginePromptRel("03-spec.md")] }))).toEqual([
      "03-spec.md",
    ]);
  });

  test("an override whose upstream is untouched is not", () => {
    expect(staleOverrides(["03-spec.md"], diff({ changed: ["lib/run.ts", "VERSION"] }))).toEqual([]);
    expect(staleOverrides(["03-spec.md"], diff({ changed: [enginePromptRel("04-tickets.md")] }))).toEqual(
      [],
    );
  });

  test("an override whose upstream the new engine dropped is stale too", () => {
    expect(staleOverrides(["06-report.md"], diff({ removed: [enginePromptRel("06-report.md")] }))).toEqual([
      "06-report.md",
    ]);
  });

  test("a prompt merely added upstream is nobody's stale fork", () => {
    expect(staleOverrides([], diff({ added: [enginePromptRel("08-new.md")] }))).toEqual([]);
  });
});

describe("update — stale override warning", () => {
  /** An installed project with `03-spec.md` overridden and committed. */
  function repoWithOverride(...files: string[]): string {
    const root = track(installedRepo());
    for (const f of files) {
      writeFileSync(join(root, "scripts", "mmm-loop", "prompts", f), `# my ${f}\n`);
    }
    commitAll(root, "chore: fork a prompt");
    return root;
  }

  test("warns, naming the prompt, when the span changes what an override shadows", () => {
    const root = repoWithOverride("03-spec.md");
    const src = track(
      sourceRepo({ version: "v0.9.9", addFiles: { "prompts/03-spec.md": "# upstream, rewritten\n" } }),
    );
    const r = runBundle(root, ["update", "--from", src]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("prompt overrides shadowing a prompt this update touches");
    expect(r.stdout).toContain("scripts/mmm-loop/prompts/03-spec.md");
    expect(r.stdout).toContain("(engine/prompts/03-spec.md changed upstream)");
  });

  test("stays silent when the span leaves the overridden prompt alone", () => {
    const root = repoWithOverride("05-implement.md");
    const src = track(
      sourceRepo({ version: "v0.9.9", addFiles: { "prompts/03-spec.md": "# upstream, rewritten\n" } }),
    );
    const r = runBundle(root, ["update", "--from", src]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("~ engine/prompts/03-spec.md"); // the span really did change one
    expect(r.stdout).not.toContain("shadowing a prompt");
  });

  test("the warning is a dry-run warning — it fires before anything is written", () => {
    const root = repoWithOverride("03-spec.md");
    const src = track(
      sourceRepo({ version: "v0.9.9", addFiles: { "prompts/03-spec.md": "# upstream, rewritten\n" } }),
    );
    const before = readFileSync(
      join(root, "scripts", "mmm-loop", "engine", "prompts", "03-spec.md"),
      "utf8",
    );
    const r = runBundle(root, ["update", "--from", src]);
    expect(r.stdout).toContain("shadowing a prompt");
    expect(r.stdout).toContain("dry run — nothing changed");
    expect(
      readFileSync(join(root, "scripts", "mmm-loop", "engine", "prompts", "03-spec.md"), "utf8"),
    ).toBe(before);
  });

  test("--apply warns too, and leaves the override in place to keep being used", () => {
    const root = repoWithOverride("03-spec.md");
    const src = track(
      sourceRepo({ version: "v0.9.9", addFiles: { "prompts/03-spec.md": "# upstream, rewritten\n" } }),
    );
    const r = runBundle(root, ["update", "--from", src, "--apply"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("shadowing a prompt");
    const bundleRoot = join(root, "scripts", "mmm-loop");
    expect(readFileSync(join(bundleRoot, "prompts", "03-spec.md"), "utf8")).toBe("# my 03-spec.md\n");
    expect(readFileSync(join(bundleRoot, "engine", "prompts", "03-spec.md"), "utf8")).toBe(
      "# upstream, rewritten\n",
    );
    // And the updated bundle still resolves 03-spec to the project's fork.
    expect(resolvePrompt(join(bundleRoot, "engine"), "03-spec").overridden).toBe(true);
  });

  test("every stale override is named, one line each", () => {
    const root = repoWithOverride("03-spec.md", "04-tickets.md", "06-report.md");
    const src = track(
      sourceRepo({
        version: "v0.9.9",
        addFiles: {
          "prompts/03-spec.md": "# rewritten\n",
          "prompts/04-tickets.md": "# rewritten\n",
        },
      }),
    );
    const out = runBundle(root, ["update", "--from", src]).stdout;
    expect(out).toContain("scripts/mmm-loop/prompts/03-spec.md");
    expect(out).toContain("scripts/mmm-loop/prompts/04-tickets.md");
    // 06-report was not touched upstream, so it is not stale.
    expect(out).not.toContain("scripts/mmm-loop/prompts/06-report.md");
  });
});

// ------------------------------------------------------------ version counting

describe("version sees the overlay", () => {
  test("an override is counted, and dropping it uncounts it", () => {
    const root = track(installedRepo());
    const prompts = join(root, "scripts", "mmm-loop", "prompts");
    writeFileSync(join(prompts, "03-spec.md"), "# mine\n");
    expect(runBundle(root, ["version"]).stdout).toContain("1 prompt override");
    rmSync(join(prompts, "03-spec.md"));
    expect(runBundle(root, ["version"]).stdout).toContain("0 prompt overrides");
  });
});
