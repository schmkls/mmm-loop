/**
 * Startup guard (spec §8.1): only run when the logged-in Claude account
 * matches `ALLOWED_CLAUDE_USER` in config.ts. This module is the only place
 * that knows how the logged-in account is discovered.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Claude Code's own config file: `$CLAUDE_CONFIG_DIR/.claude.json` when the
 * env var is set, else `~/.claude.json`. Exported so tests can pin the
 * fallback logic directly. */
export function claudeConfigPath(): string {
  const dir = process.env.CLAUDE_CONFIG_DIR;
  return join(dir || homedir(), ".claude.json");
}

/**
 * Email of the logged-in Claude account, or null if undeterminable.
 *
 * Mechanism — research outcome (Claude Code 2.1.232, 2026-08): reads
 * `oauthAccount.emailAddress` from Claude Code's own `.claude.json`. The CLI
 * does offer an official query, `claude auth status --json` (prints `email`
 * and `loggedIn`), but it was deliberately not used here: it verifies live
 * keychain credentials rather than reporting the configured account (under a
 * crafted CLAUDE_CONFIG_DIR it reports `loggedIn: false` with no email, so
 * tests cannot fake a login), and invoking it mutates the config dir (writes
 * `machineID`, `firstStartTime`, migration flags into `.claude.json`) — not
 * acceptable for a read-only probe. Reading the file keeps this function
 * side-effect-free and honors CLAUDE_CONFIG_DIR exactly like the spawned
 * agents do. Internal storage can move between Claude Code versions —
 * accepted (spec §2.2); revisit if a side-effect-free identity query lands.
 */
export function loggedInClaudeUserEmail(): string | null {
  try {
    const parsed = JSON.parse(readFileSync(claudeConfigPath(), "utf8"));
    const email = parsed?.oauthAccount?.emailAddress;
    return typeof email === "string" && email.trim() !== "" ? email : null;
  } catch {
    return null; // missing file, bad JSON — undeterminable, never a crash
  }
}

/** null = ok to run; otherwise a human-readable refusal. Pure — comparison is
 * case-insensitive and ignores surrounding whitespace. */
export function checkClaudeUser(allowed: string | null, actual: string | null): string | null {
  if (allowed === null) return null;
  if (actual === null) {
    return (
      `ALLOWED_CLAUDE_USER is set to "${allowed}" but the logged-in Claude user ` +
      `could not be determined. Check with /status inside claude, log in to the right ` +
      `account, or set ALLOWED_CLAUDE_USER to null in scripts/mmm-loop/config.ts. ` +
      `(Note: API-key auth has no logged-in user.)`
    );
  }
  if (actual.trim().toLowerCase() !== allowed.trim().toLowerCase()) {
    return `The logged-in Claude user is "${actual}" but this project only runs as "${allowed}".`;
  }
  return null;
}

/**
 * The whole startup decision in one call: asks who is logged in only when a
 * specific user is actually required, so the shipped default
 * (`allowed === null`) never touches the filesystem. `actualEmail` is
 * injectable purely so a unit test can pin that short-circuit.
 */
export function claudeUserProblem(
  allowed: string | null,
  actualEmail: () => string | null = loggedInClaudeUserEmail,
): string | null {
  if (allowed === null) return null;
  return checkClaudeUser(allowed, actualEmail());
}
