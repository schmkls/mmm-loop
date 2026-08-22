import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SHIM } from "../scripts/mmm-loop/engine/lib/bundle.ts";
import { upgradeNotes } from "../scripts/mmm-loop/engine/lib/changelog.ts";
import { cloneUrl, sourceKind, updateRefusal } from "../scripts/mmm-loop/engine/lib/update.ts";
import {
  bundleSnapshot,
  cleanup,
  commitAll,
  ENGINE_VERSION,
  gitStatus,
  installedRepo,
  runBundle,
  scratchRepo,
  sourceRepo,
} from "./bundle-helpers.ts";
import { REPO_ROOT, sh } from "./helpers.ts";

const temps: string[] = [];
afterAll(() => cleanup(...temps));

function track<T extends string>(dir: T): T {
  temps.push(dir);
  return dir;
}

const CHANGELOG = `# Changelog

## v0.0.0-dev → v0.9.9

Everything changed.

### Upgrade notes

- move X to Y

## v0.0.0-dev

Initial.
`;

describe("install", () => {
  test("writes the four bundle items", () => {
    const target = track(scratchRepo());
    const r = runBundle(REPO_ROOT, ["install", target]);
    expect(r.exitCode).toBe(0);

    const bundle = join(target, "scripts", "mmm-loop");
    expect(readFileSync(join(bundle, "loop.ts"), "utf8")).toBe(SHIM);
    expect(existsSync(join(bundle, "engine", "loop.ts"))).toBe(true);
    expect(existsSync(join(bundle, "engine", "lib", "run.ts"))).toBe(true);
    expect(readFileSync(join(bundle, "engine", "VERSION"), "utf8").trim()).toBe(ENGINE_VERSION);
    // prompts/ exists and holds no overrides.
    expect(existsSync(join(bundle, "prompts", ".gitkeep"))).toBe(true);
    expect(existsSync(join(bundle, "prompts", "03-spec.md"))).toBe(false);
  });

  test("pins source at the repo install was invoked from", () => {
    const target = track(scratchRepo());
    runBundle(REPO_ROOT, ["install", target]);
    const overlay = readFileSync(join(target, "scripts", "mmm-loop", "config.ts"), "utf8");
    expect(overlay).toContain(`source: { from: ${JSON.stringify(REPO_ROOT)} }`);
    // The overlay must still be a valid Partial<LoopConfig> the engine loads.
    expect(runBundle(target, ["version"]).exitCode).toBe(0);
  });

  test("scaffolds nothing outside the bundle — init stays the human's call", () => {
    const target = track(scratchRepo());
    runBundle(REPO_ROOT, ["install", target]);
    expect(existsSync(join(target, "docs"))).toBe(false);
    expect(existsSync(join(target, ".working"))).toBe(false);
  });

  test("refuses when a bundle already exists", () => {
    const target = track(installedRepo());
    const r = runBundle(REPO_ROOT, ["install", target]);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("already exists");
    expect(r.stderr).toContain("update");
  });

  test("refuses a target that does not exist", () => {
    const r = runBundle(REPO_ROOT, ["install", join(tmpdir(), "mmm-loop-no-such-dir-xyz")]);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("target does not exist");
  });

  test("needs exactly one target", () => {
    expect(runBundle(REPO_ROOT, ["install"]).exitCode).toBe(1);
    expect(runBundle(REPO_ROOT, ["install", "a", "b"]).stderr).toContain("Usage");
  });
});

describe("update — refusals", () => {
  test("rule 1: uncommitted changes under the bundle", () => {
    const root = track(installedRepo());
    writeFileSync(join(root, "scripts", "mmm-loop", "config.ts.bak"), "stale\n");
    const r = runBundle(root, ["update", "--apply", "--from", REPO_ROOT]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("uncommitted changes under scripts/mmm-loop/");
    expect(r.stderr).toContain("config.ts.bak");
  });

  test("changes outside the bundle do not block an update", () => {
    const root = track(installedRepo());
    writeFileSync(join(root, "README.md"), "# edited elsewhere\n");
    const r = runBundle(root, ["update", "--from", REPO_ROOT]);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).not.toContain("refusing");
  });

  test("rule 2: a sprint branch exists", () => {
    const root = track(installedRepo());
    sh(root, "git", "branch", "sprint/99");
    const r = runBundle(root, ["update", "--apply", "--from", REPO_ROOT]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("sprint/99");
    expect(r.stderr).toContain("finish your sprint, then update");
  });

  test("rule 1 is checked first when both apply", () => {
    const root = track(installedRepo());
    sh(root, "git", "branch", "sprint/99");
    writeFileSync(join(root, "scripts", "mmm-loop", "config.ts.bak"), "stale\n");
    const r = runBundle(root, ["update", "--apply", "--from", REPO_ROOT]);
    expect(r.stderr).toContain("uncommitted changes");
    expect(r.stderr).not.toContain("finish your sprint");
  });

  test("refusals apply to dry runs too, so both modes agree", () => {
    const root = track(installedRepo());
    sh(root, "git", "branch", "sprint/99");
    expect(runBundle(root, ["update", "--from", REPO_ROOT]).exitCode).toBe(1);
  });

  test("a project with no git cannot be updated", () => {
    const root = track(realpathSync(mkdtempSync(join(tmpdir(), "mmm-loop-nogit-"))));
    runBundle(REPO_ROOT, ["install", root]);
    const r = runBundle(root, ["update", "--from", REPO_ROOT]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("not a git repository");
  });

  test("a pre-split source is named as such, not copied blindly", () => {
    const root = track(installedRepo());
    const preSplit = track(realpathSync(mkdtempSync(join(tmpdir(), "mmm-loop-presplit-"))));
    // A pre-split bundle: scripts/mmm-loop/loop.ts with no engine/ beside it.
    mkdirSync(join(preSplit, "scripts", "mmm-loop"), { recursive: true });
    writeFileSync(join(preSplit, "scripts", "mmm-loop", "loop.ts"), "// old layout\n");
    const r = runBundle(root, ["update", "--from", preSplit]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("pre-split");
  });

  test("no pin and no --from is an error, not a guess", () => {
    const root = track(installedRepo());
    const overlay = join(root, "scripts", "mmm-loop", "config.ts");
    writeFileSync(
      overlay,
      `import type { LoopConfig } from "./engine/defaults.ts";\n` +
        `export const config: Partial<LoopConfig> = {};\n`,
    );
    commitAll(root, "chore: drop the source pin");
    const r = runBundle(root, ["update"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("no update source");
  });
});

describe("update — dry run", () => {
  test("prints the plan and changes nothing", () => {
    const root = track(installedRepo());
    const src = track(sourceRepo({ version: "v0.9.9", addFiles: { "lib/_added.ts": "// new\n" } }));
    const before = bundleSnapshot(root);

    const r = runBundle(root, ["update", "--from", src]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(`${ENGINE_VERSION} → v0.9.9`);
    expect(r.stdout).toContain("+ engine/lib/_added.ts");
    expect(r.stdout).toContain("~ engine/VERSION");
    expect(r.stdout).toContain("--apply");

    expect(bundleSnapshot(root)).toEqual(before);
    expect(gitStatus(root)).toEqual([]);
  });

  test("an identical source is a no-op, not an empty diff", () => {
    const root = track(installedRepo());
    const r = runBundle(root, ["update", "--from", REPO_ROOT]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("already identical");
  });

  test("uses the pinned source when --from is absent", () => {
    const root = track(installedRepo());
    const r = runBundle(root, ["update"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(`source: ${REPO_ROOT} (local path)`);
  });

  test("prints the source's upgrade notes for the span", () => {
    const root = track(installedRepo());
    const src = track(sourceRepo({ version: "v0.9.9", changelog: CHANGELOG }));
    const out = runBundle(root, ["update", "--from", src]).stdout;
    expect(out).toContain(`upgrade notes (${ENGINE_VERSION} → v0.9.9)`);
    expect(out).toContain("- move X to Y");
    expect(out).not.toContain("Initial.");
  });

  test("a source with no CHANGELOG is fine", () => {
    const root = track(installedRepo());
    const src = track(sourceRepo({ version: "v0.9.9" }));
    const r = runBundle(root, ["update", "--from", src]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).not.toContain("upgrade notes");
  });

  test("points at init for scaffold files the project lacks, without running it", () => {
    const root = track(installedRepo());
    const src = track(sourceRepo({ version: "v0.9.9" }));
    const r = runBundle(root, ["update", "--from", src, "--apply"]);
    expect(r.stdout).toContain("new scaffold files available — run `init`");
    expect(r.stdout).toContain("docs/vision.md");
    expect(existsSync(join(root, "docs"))).toBe(false);
    expect(existsSync(join(root, ".working"))).toBe(false);
  });
});

describe("update — apply", () => {
  test("replaces engine/ and touches nothing outside it", () => {
    const root = track(installedRepo());
    const src = track(sourceRepo({ version: "v0.9.9", addFiles: { "lib/_added.ts": "// new\n" } }));
    const overlayBefore = readFileSync(join(root, "scripts", "mmm-loop", "config.ts"), "utf8");
    writeFileSync(join(root, "scripts", "mmm-loop", "prompts", "03-spec.md"), "# mine\n");
    commitAll(root, "chore: add a prompt override");

    const r = runBundle(root, ["update", "--from", src, "--apply"]);
    expect(r.exitCode).toBe(0);

    const bundle = join(root, "scripts", "mmm-loop");
    expect(readFileSync(join(bundle, "engine", "VERSION"), "utf8").trim()).toBe("v0.9.9");
    expect(existsSync(join(bundle, "engine", "lib", "_added.ts"))).toBe(true);
    // The other three bundle items are untouched.
    expect(readFileSync(join(bundle, "config.ts"), "utf8")).toBe(overlayBefore);
    expect(readFileSync(join(bundle, "loop.ts"), "utf8")).toBe(SHIM);
    expect(readFileSync(join(bundle, "prompts", "03-spec.md"), "utf8")).toBe("# mine\n");

    for (const line of gitStatus(root)) {
      expect(line.slice(3)).toStartWith("scripts/mmm-loop/engine/");
    }
    expect(gitStatus(root).length).toBeGreaterThan(0);
  });

  test("drops files the new engine no longer ships", () => {
    const root = track(installedRepo());
    const src = track(sourceRepo({ version: "v0.9.9", addFiles: { "lib/_gone.ts": "// tmp\n" } }));
    runBundle(root, ["update", "--from", src, "--apply"]);
    commitAll(root, "chore: update engine");
    expect(existsSync(join(root, "scripts", "mmm-loop", "engine", "lib", "_gone.ts"))).toBe(true);

    // Back to this repo, which never had that file.
    const r = runBundle(root, ["update", "--from", REPO_ROOT, "--apply"]);
    expect(r.stdout).toContain("- engine/lib/_gone.ts");
    expect(existsSync(join(root, "scripts", "mmm-loop", "engine", "lib", "_gone.ts"))).toBe(false);
  });

  test("the updated engine still runs", () => {
    const root = track(installedRepo());
    const src = track(sourceRepo({ version: "v0.9.9" }));
    runBundle(root, ["update", "--from", src, "--apply"]);
    expect(runBundle(root, ["version"]).stdout.trim()).toBe(
      "v0.9.9 (engine) · 0 prompt overrides · 1 config override",
    );
  });

  test("rejects unknown flags", () => {
    const root = track(installedRepo());
    expect(runBundle(root, ["update", "--force"]).stderr).toContain("Usage");
    expect(runBundle(root, ["update", "--from"]).stderr).toContain("--from expects");
  });
});

describe("update — pure helpers", () => {
  test("sourceKind: rooted or on-disk is a path, everything else a URL", () => {
    expect(sourceKind("/abs/path")).toBe("path");
    expect(sourceKind("./rel")).toBe("path");
    expect(sourceKind("~/repo")).toBe("path");
    expect(sourceKind(REPO_ROOT)).toBe("path");
    expect(sourceKind("github.com/schmkls/mmm-loop")).toBe("url");
    expect(sourceKind("https://github.com/schmkls/mmm-loop")).toBe("url");
    expect(sourceKind("git@github.com:schmkls/mmm-loop.git")).toBe("url");
  });

  test("cloneUrl: the short host/owner/repo form gets https", () => {
    expect(cloneUrl("github.com/schmkls/mmm-loop")).toBe("https://github.com/schmkls/mmm-loop");
    expect(cloneUrl("https://x.dev/a")).toBe("https://x.dev/a");
    expect(cloneUrl("git@github.com:a/b.git")).toBe("git@github.com:a/b.git");
  });

  test("updateRefusal: dirty wins over sprint, clean passes", () => {
    expect(updateRefusal([], [])).toBeNull();
    expect(updateRefusal([], ["main", "feature/x"])).toBeNull();
    expect(updateRefusal([], ["main", "sprint/07"])?.rule).toContain("sprint/07");
    expect(updateRefusal([" M scripts/mmm-loop/engine/VERSION"], ["sprint/07"])?.rule).toContain(
      "uncommitted changes",
    );
  });

  test("upgradeNotes: only the sections in the span, only their notes", () => {
    const log = `# Changelog

## v0.3.0

### Upgrade notes

- three

## v0.2.0

No notes here.

## v0.1.0

### Upgrade notes

- one
`;
    const span = upgradeNotes(log, "v0.1.0", "v0.3.0");
    expect(span).toContain("- three");
    expect(span).not.toContain("- one");
    expect(upgradeNotes(log, "v0.0.0-dev", "v0.3.0")).toContain("- one");
    // A span whose sections carry no notes reports nothing at all.
    expect(upgradeNotes(log, "v0.2.0", "v0.2.0")).toBeNull();
    expect(upgradeNotes("not a changelog", "v0.1.0", "v0.2.0")).toBeNull();
  });

  test("upgradeNotes: a heading may name the whole span", () => {
    const log = `# Changelog

## c324ef3 → v0.1.0

### Upgrade notes

- move X to Y
`;
    expect(upgradeNotes(log, "v0.0.0-dev", "v0.1.0")).toContain("- move X to Y");
  });

  test("upgradeNotes: a stamped VERSION matches a bare heading", () => {
    const log = `# Changelog

## v0.2.0

### Upgrade notes

- two

## c324ef3 → v0.1.0

### Upgrade notes

- one
`;
    // engine/VERSION carries the release date and sha as well as the number;
    // the span must still start after the release the project is already on.
    const span = upgradeNotes(log, "v0.1.0 (2026-08-22, abc1234)", "v0.2.0");
    expect(span).toContain("- two");
    expect(span).not.toContain("- one");
  });
});

describe("update — url sources", () => {
  /** A source repo served over `file://`, which git treats as a real remote:
   * exercises the clone path (and its temp-dir cleanup) without a network. */
  function gitSource(version: string): string {
    const root = sourceRepo({ version });
    sh(root, "git", "init", "-q", "-b", "main");
    sh(root, "git", "config", "user.email", "test@example.com");
    sh(root, "git", "config", "user.name", "Test");
    commitAll(root, "chore: source");
    return root;
  }

  test("clones the default branch when the pin carries no ref", () => {
    const root = track(installedRepo());
    const src = track(gitSource("v0.9.9"));
    const r = runBundle(root, ["update", "--from", `file://${src}`, "--apply"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("(url)");
    expect(readFileSync(join(root, "scripts", "mmm-loop", "engine", "VERSION"), "utf8").trim()).toBe(
      "v0.9.9",
    );
  });

  test("clones the pinned ref", () => {
    const root = track(installedRepo());
    const src = track(gitSource("v0.9.9"));
    writeFileSync(
      join(root, "scripts", "mmm-loop", "config.ts"),
      `import type { LoopConfig } from "./engine/defaults.ts";\n` +
        `export const config: Partial<LoopConfig> = {\n` +
        `  source: { from: ${JSON.stringify(`file://${src}`)}, ref: "main" },\n` +
        `};\n`,
    );
    commitAll(root, "chore: pin a ref");
    const r = runBundle(root, ["update"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(`${ENGINE_VERSION} → v0.9.9`);
  });

  test("a bad ref fails with git's own message", () => {
    const root = track(installedRepo());
    const src = track(gitSource("v0.9.9"));
    writeFileSync(
      join(root, "scripts", "mmm-loop", "config.ts"),
      `import type { LoopConfig } from "./engine/defaults.ts";\n` +
        `export const config: Partial<LoopConfig> = {\n` +
        `  source: { from: ${JSON.stringify(`file://${src}`)}, ref: "no-such-branch" },\n` +
        `};\n`,
    );
    commitAll(root, "chore: pin a bad ref");
    const r = runBundle(root, ["update"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("git clone");
    expect(r.stderr).toContain("no-such-branch");
  });
});
