import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeProject, runLoop } from "./helpers.ts";

describe("init + step-1 validation", () => {
  test("run in an empty project exits 1 and names all three missing files", () => {
    const p = makeProject({ scaffold: false });
    const r = runLoop(p);
    expect(r.exitCode).toBe(1);
    for (const f of ["docs/CONTEXT.md", "docs/vision.md", ".working/vision_status.md"]) {
      expect(r.stderr).toContain(f);
    }
    expect(r.stderr).toContain("init");
  });

  test("init scaffolds the four files with template content", () => {
    const p = makeProject({ scaffold: false });
    expect(runLoop(p, ["init"]).exitCode).toBe(0);
    expect(readFileSync(join(p.root, "docs/CONTEXT.md"), "utf8")).toContain("# Context");
    expect(readFileSync(join(p.root, "docs/vision.md"), "utf8")).toContain("# Vision");
    expect(readFileSync(join(p.root, ".working/vision_status.md"), "utf8")).toStartWith(
      "_Last updated: sprint 00_",
    );
    expect(readFileSync(join(p.root, ".working/learnings.md"), "utf8")).toContain("# Learnings");
  });

  test("init scaffolds the optional feedback folders, empty of items", () => {
    const p = makeProject({ scaffold: false });
    expect(runLoop(p, ["init"]).exitCode).toBe(0);
    expect(readFileSync(join(p.root, "docs/feedback/README.md"), "utf8")).toContain("# Feedback");
    expect(existsSync(join(p.root, "docs/feedback/inbox/.gitkeep"))).toBe(true);
    expect(existsSync(join(p.root, "docs/feedback/handled/.gitkeep"))).toBe(true);
    // Optional by design: a project without them still validates and runs.
    expect(readFileSync(join(p.root, "docs/CONTEXT.md"), "utf8")).toContain("# Context");
  });

  test("rerunning init leaves pre-existing files untouched", () => {
    const p = makeProject({ scaffold: false });
    runLoop(p, ["init"]);
    writeFileSync(join(p.root, "docs/CONTEXT.md"), "MY CUSTOM CONTENT");
    const r = runLoop(p, ["init"]);
    expect(r.exitCode).toBe(0);
    expect(readFileSync(join(p.root, "docs/CONTEXT.md"), "utf8")).toBe("MY CUSTOM CONTENT");
  });

  test("after init, run passes validation and reaches step 2 (report absence is fine)", () => {
    const p = makeProject();
    expect(existsSync(join(p.root, "docs/sprint_reports.html"))).toBe(false);
    const r = runLoop(p, ["run"], { SCENARIO_FOCUS: "nothing" });
    expect(r.stdout).toContain("phase: step 2");
    expect(r.stderr).not.toContain("Missing required file");
    expect(r.exitCode).toBe(1); // step 2's fake produced nothing, by design
  });

  test("--max-sprints rejects non-integers", () => {
    const p = makeProject();
    const r = runLoop(p, ["run", "--max-sprints", "banana"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("--max-sprints");
  });

  test("unknown command prints usage and exits 1", () => {
    const p = makeProject({ scaffold: false });
    const r = runLoop(p, ["frobnicate"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Usage");
  });
});
