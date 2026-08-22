/**
 * The config merger: `engine/defaults.ts` (upstream) + `../config.ts` (the
 * project overlay, always written by install) → the symbols the loop reads.
 *
 * Everything inside `engine/lib` imports `"../config.ts"`, which resolves
 * here — so switching a value is an overlay edit, never an engine edit.
 * Unknown top-level keys in the overlay warn and are ignored: a stale key
 * left over from an older engine must not stop a run.
 */

import { config as overlay } from "../config.ts";
import { DEFAULTS, type LoopConfig } from "./defaults.ts";

export type { Effort, LoopConfig, LoopConfigOverlay, StepConfig, StepId } from "./defaults.ts";

const KNOWN_KEYS = [
  "STEP_CONFIG",
  "CLEANUP_CADENCE",
  "BASE_BRANCH",
  "ALLOWED_CLAUDE_USER",
  "PERMISSION_ARGS",
  "RATE_LIMIT",
  "source",
] as const satisfies readonly (keyof LoopConfig)[];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Deep-merge `patch` over `base`. Plain objects merge key by key; everything
 * else (scalars, null, arrays — PERMISSION_ARGS is replaced, not appended)
 * is taken wholesale from the patch. An explicit `undefined` means "no
 * opinion" and keeps the default.
 */
function deepMerge(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(patch)) out[key] = deepMerge(base[key], patch[key]);
  return out;
}

function mergeConfig(defaults: LoopConfig, patch: Partial<LoopConfig>): LoopConfig {
  const unknown = Object.keys(patch).filter((k) => !(KNOWN_KEYS as readonly string[]).includes(k));
  if (unknown.length > 0) {
    console.warn(
      `[mmm-loop] warning: unknown key(s) in scripts/mmm-loop/config.ts, ignored: ${unknown.join(", ")}`,
    );
  }
  const merged = { ...defaults };
  for (const key of KNOWN_KEYS) {
    if (!(key in patch)) continue;
    // Key-by-key so the unknown keys filtered above never reach the result.
    (merged as Record<string, unknown>)[key] = deepMerge(defaults[key], patch[key]);
  }
  return merged;
}

const CONFIG = mergeConfig(DEFAULTS, overlay);

export const STEP_CONFIG = CONFIG.STEP_CONFIG;
export const CLEANUP_CADENCE = CONFIG.CLEANUP_CADENCE;
export const BASE_BRANCH = CONFIG.BASE_BRANCH;
export const ALLOWED_CLAUDE_USER = CONFIG.ALLOWED_CLAUDE_USER;
export const PERMISSION_ARGS = CONFIG.PERMISSION_ARGS;
export const RATE_LIMIT = CONFIG.RATE_LIMIT;
/** Where this engine was installed from (overlay-only; no default). */
export const SOURCE = CONFIG.source;
