/** The Claude-user startup guard (spec §8.1): the pure decision, the config
 * file probe, and the allowed === null short-circuit. */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkClaudeUser,
  claudeConfigPath,
  claudeUserProblem,
  loggedInClaudeUserEmail,
} from "../scripts/mmm-loop/lib/claude-user.ts";

/** Run `fn` with CLAUDE_CONFIG_DIR set (or removed), restoring afterwards —
 * Bun tests run in-process, so env changes must never leak between cases. */
function withConfigDir<T>(dir: string | undefined, fn: () => T): T {
  const saved = process.env.CLAUDE_CONFIG_DIR;
  if (dir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = dir;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
  }
}

/** Temp dir whose .claude.json has the given content (omit for no file). */
function tempConfigDir(content?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "mmm-loop-claude-user-"));
  if (content !== undefined) writeFileSync(join(dir, ".claude.json"), content);
  return dir;
}

describe("checkClaudeUser", () => {
  test("allowed null → ok, whoever is logged in (feature off)", () => {
    expect(checkClaudeUser(null, "anyone@example.com")).toBeNull();
    expect(checkClaudeUser(null, null)).toBeNull();
  });

  test("matching email → ok", () => {
    expect(checkClaudeUser("dev@example.com", "dev@example.com")).toBeNull();
  });

  test("different email → refusal naming both addresses", () => {
    const problem = checkClaudeUser("right@example.com", "wrong@example.com");
    expect(problem).toContain("right@example.com");
    expect(problem).toContain("wrong@example.com");
  });

  test("actual null while a user is required → fail closed with guidance", () => {
    const problem = checkClaudeUser("dev@example.com", null);
    expect(problem).toContain("could not be determined");
    expect(problem).toContain("dev@example.com");
    expect(problem).toContain("/status");
    expect(problem).toContain("ALLOWED_CLAUDE_USER");
    expect(problem).toContain("API-key");
  });

  test("comparison is case-insensitive", () => {
    expect(checkClaudeUser("Foo@X.com", "foo@x.com")).toBeNull();
  });

  test("comparison trims whitespace", () => {
    expect(checkClaudeUser("  dev@example.com ", "dev@example.com")).toBeNull();
    expect(checkClaudeUser("dev@example.com", " dev@example.com\n")).toBeNull();
  });
});

describe("claudeConfigPath", () => {
  test("CLAUDE_CONFIG_DIR set → <dir>/.claude.json", () => {
    expect(withConfigDir("/some/dir", claudeConfigPath)).toBe("/some/dir/.claude.json");
  });

  test("CLAUDE_CONFIG_DIR unset (or empty) → ~/.claude.json", () => {
    expect(withConfigDir(undefined, claudeConfigPath)).toBe(join(homedir(), ".claude.json"));
    expect(withConfigDir("", claudeConfigPath)).toBe(join(homedir(), ".claude.json"));
  });
});

describe("loggedInClaudeUserEmail", () => {
  test("valid .claude.json → the email", () => {
    const dir = tempConfigDir(
      JSON.stringify({ oauthAccount: { emailAddress: "dev@example.com" } }),
    );
    expect(withConfigDir(dir, loggedInClaudeUserEmail)).toBe("dev@example.com");
  });

  test("no .claude.json → null", () => {
    expect(withConfigDir(tempConfigDir(), loggedInClaudeUserEmail)).toBeNull();
  });

  test("invalid JSON → null, never throws", () => {
    expect(withConfigDir(tempConfigDir("not json {"), loggedInClaudeUserEmail)).toBeNull();
  });

  test("oauthAccount without emailAddress → null", () => {
    const dir = tempConfigDir(JSON.stringify({ oauthAccount: { accountUuid: "abc" } }));
    expect(withConfigDir(dir, loggedInClaudeUserEmail)).toBeNull();
  });

  test("empty-string email → null", () => {
    const dir = tempConfigDir(JSON.stringify({ oauthAccount: { emailAddress: "  " } }));
    expect(withConfigDir(dir, loggedInClaudeUserEmail)).toBeNull();
  });
});

describe("claudeUserProblem", () => {
  test("allowed null short-circuits without asking who is logged in", () => {
    const problem = claudeUserProblem(null, () => {
      throw new Error("must not probe the filesystem when the feature is off");
    });
    expect(problem).toBeNull();
  });

  test("allowed set → probes and decides", () => {
    expect(claudeUserProblem("dev@example.com", () => "dev@example.com")).toBeNull();
    expect(claudeUserProblem("dev@example.com", () => "other@example.com")).toContain(
      "other@example.com",
    );
    expect(claudeUserProblem("dev@example.com", () => null)).toContain("could not be determined");
  });
});
