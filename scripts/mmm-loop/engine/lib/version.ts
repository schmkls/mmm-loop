/**
 * `version`: one line answering "which engine is this, and how far has this
 * project drifted from it?" — the engine's own version plus the size of the
 * two overlays that sit on top of it (prompt files and config keys).
 */

/** "1 prompt override" / "0 prompt overrides". */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export function formatVersionLine(
  engineVersion: string,
  promptOverrideCount: number,
  configOverrideCount: number,
): string {
  return [
    `${engineVersion} (engine)`,
    count(promptOverrideCount, "prompt override"),
    count(configOverrideCount, "config override"),
  ].join(" · ");
}
