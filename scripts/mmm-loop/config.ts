/** Project overrides, deep-merged over `engine/defaults.ts` by `engine/config.ts`.
 *  Empty = stock engine. Widen to `LoopConfigOverlay` for partial nested values. */
import type { LoopConfig } from "./engine/defaults.ts";

export const config: Partial<LoopConfig> = {};
