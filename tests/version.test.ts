import { afterAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatVersionLine } from "../scripts/mmm-loop/engine/lib/version.ts";
import { cleanup, ENGINE_VERSION, installedRepo, runBundle } from "./bundle-helpers.ts";
import { REPO_ROOT } from "./helpers.ts";

const temps: string[] = [];
afterAll(() => cleanup(...temps));

describe("version", () => {
  test("formats the line, pluralizing each count", () => {
    expect(formatVersionLine("v0.1.0", 0, 0)).toBe(
      "v0.1.0 (engine) · 0 prompt overrides · 0 config overrides",
    );
    expect(formatVersionLine("v0.1.0", 1, 1)).toBe(
      "v0.1.0 (engine) · 1 prompt override · 1 config override",
    );
    expect(formatVersionLine("v0.1.0", 2, 3)).toBe(
      "v0.1.0 (engine) · 2 prompt overrides · 3 config overrides",
    );
  });

  test("in this repo: the engine version and a stock overlay", () => {
    const r = runBundle(REPO_ROOT, ["version"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe(
      `${ENGINE_VERSION} (engine) · 0 prompt overrides · 0 config overrides`,
    );
  });

  test("a fresh install reports its one config key — the source pin", () => {
    const root = installedRepo();
    temps.push(root);
    const r = runBundle(root, ["version"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe(
      `${ENGINE_VERSION} (engine) · 0 prompt overrides · 1 config override`,
    );
  });

  test("counts prompt overrides — .md files only, not the .gitkeep", () => {
    const root = installedRepo();
    temps.push(root);
    const prompts = join(root, "scripts", "mmm-loop", "prompts");
    writeFileSync(join(prompts, "03-spec.md"), "# override\n");
    writeFileSync(join(prompts, "05-implement.md"), "# override\n");
    writeFileSync(join(prompts, "notes.txt"), "not a prompt\n");
    expect(runBundle(root, ["version"]).stdout.trim()).toBe(
      `${ENGINE_VERSION} (engine) · 2 prompt overrides · 1 config override`,
    );
  });

  test("takes no arguments", () => {
    const r = runBundle(REPO_ROOT, ["version", "--wat"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Usage");
  });
});
