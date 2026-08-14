/** E2E: the Claude-user startup guard (spec §8.1) through the real CLI.
 * Every scenario sets CLAUDE_CONFIG_DIR explicitly so the developer's real
 * ~/.claude.json can never leak into a test. */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { invocations, makeProject, runLoop } from "./helpers.ts";

/** Temp CLAUDE_CONFIG_DIR; with an email, its .claude.json shows that login. */
function claudeConfigDir(email?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "mmm-loop-e2e-claude-cfg-"));
  if (email !== undefined) {
    writeFileSync(
      join(dir, ".claude.json"),
      JSON.stringify({ oauthAccount: { emailAddress: email } }),
    );
  }
  return dir;
}

describe("e2e Claude-user guard", () => {
  test("matching account (case-insensitive) → sprint runs to exit 0", () => {
    const p = makeProject();
    const r = runLoop(p, ["run"], {
      CLAUDE_CONFIG_DIR: claudeConfigDir("dev@example.com"),
      MMM_LOOP_ALLOWED_CLAUDE_USER: "Dev@Example.com",
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("[mmm-loop] done.");
    expect(existsSync(join(p.root, ".working/sprints/01-toy-feature/spec.md"))).toBe(true);
  }, 60000);

  test("wrong account → exit 1 naming both emails, before any agent spawns", () => {
    const p = makeProject();
    const r = runLoop(p, ["run"], {
      CLAUDE_CONFIG_DIR: claudeConfigDir("wrong@example.com"),
      MMM_LOOP_ALLOWED_CLAUDE_USER: "right@example.com",
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("wrong@example.com");
    expect(r.stderr).toContain("right@example.com");
    expect(invocations(p)).toEqual([]); // no `claude` was ever invoked
  }, 60000);

  test("no .claude.json but a user is required → exit 1, fail closed", () => {
    const p = makeProject();
    const r = runLoop(p, ["run"], {
      CLAUDE_CONFIG_DIR: claudeConfigDir(),
      MMM_LOOP_ALLOWED_CLAUDE_USER: "dev@example.com",
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("could not be determined");
    expect(invocations(p)).toEqual([]);
  }, 60000);

  test("empty-string env override = explicit 'accept any' → runs", () => {
    const p = makeProject();
    const r = runLoop(p, ["run"], {
      CLAUDE_CONFIG_DIR: claudeConfigDir(), // not even a .claude.json needed
      MMM_LOOP_ALLOWED_CLAUDE_USER: "",
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("[mmm-loop] done.");
  }, 60000);
});
