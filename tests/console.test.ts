/** Console output: pure format functions (banner, outcome line, durations)
 * and an e2e check that a happy-path run's stdout carries a banner per step
 * id, a ✓ line per step, and — being non-TTY — zero ANSI escape bytes. */

import { describe, expect, test } from "bun:test";
import { STEP_CONFIG, type StepId } from "../scripts/mmm-loop/engine/defaults.ts";
import {
  formatDuration,
  formatStepBanner,
  formatStepDone,
  STEP_EMOJI,
  style,
} from "../scripts/mmm-loop/engine/lib/console.ts";
import { makeProject, runLoop } from "./helpers.ts";

const ESC = "\u001b";

describe("style", () => {
  test("wraps in ANSI codes when color is on, identity when off", () => {
    expect(style("bold", "x", true)).toBe(`${ESC}[1mx${ESC}[0m`);
    expect(style("red", "x", true)).toBe(`${ESC}[31mx${ESC}[0m`);
    expect(style("bold", "x", false)).toBe("x");
  });
});

describe("STEP_EMOJI", () => {
  // Completeness is enforced at compile time (Record<StepId, string>);
  // this guards against empty placeholder values.
  test("every configured step has a non-empty emoji", () => {
    expect(Object.keys(STEP_EMOJI).sort()).toEqual(Object.keys(STEP_CONFIG).sort());
    for (const emoji of Object.values(STEP_EMOJI)) expect(emoji.length).toBeGreaterThan(0);
  });
});

describe("formatStepBanner", () => {
  const description = "step 5.1 — implement 001-toy-part-1.json (sprint 01)";
  const input = {
    stepId: "05-implement" as StepId,
    description,
    config: STEP_CONFIG["05-implement"],
    attempt: 1 as const,
  };

  test("without color: three plain lines, no rules, no escape bytes", () => {
    expect(formatStepBanner({ ...input, color: false })).toBe(
      "🔨 phase: step 5.1 — implement 001-toy-part-1.json (sprint 01)\n" +
        "   agent: claude-fable-5 · effort max · ≤150 turns\n" +
        "   prompt: scripts/mmm-loop/prompts/05-implement.md",
    );
  });

  test("with color: framed by ── rules, bold title keeps the describe() text contiguous", () => {
    const banner = formatStepBanner({ ...input, color: true });
    const lines = banner.split("\n");
    expect(lines.length).toBe(5);
    expect(lines[0]).toContain("──");
    expect(lines[4]).toContain("──");
    // The grep contract survives coloring: no escape bytes inside the phrase.
    expect(banner).toContain(`${ESC}[1mphase: ${description}${ESC}[0m`);
    expect(lines[1]).toStartWith("🔨 ");
  });

  test("attempt 2 reprints with the marker; attempt 1 has none", () => {
    expect(formatStepBanner({ ...input, color: false })).not.toContain("attempt");
    expect(formatStepBanner({ ...input, attempt: 2, color: false })).toContain(
      "phase: step 5.1 — implement 001-toy-part-1.json (sprint 01) · attempt 2/2",
    );
  });

  test("default effort steps say so", () => {
    const banner = formatStepBanner({
      stepId: "06-report",
      description: "step 6 — report (sprint 01)",
      config: STEP_CONFIG["06-report"],
      attempt: 1,
      color: false,
    });
    expect(banner).toContain("agent: claude-fable-5 · effort default · ≤75 turns");
    expect(banner).toContain("prompt: scripts/mmm-loop/prompts/06-report.md");
  });
});

describe("formatStepDone", () => {
  test("step label from the describe() text, wall-clock duration", () => {
    expect(formatStepDone("step 5.1 — implement x (sprint 01)", 252_000, false)).toBe(
      "✓ step 5.1 done (4m 12s)",
    );
    expect(formatStepDone("step C4 — cleanup ticket: docs (sprint 03)", 12_000, false)).toBe(
      "✓ step C4 done (12s)",
    );
  });

  test("colored variant only tints the checkmark", () => {
    expect(formatStepDone("step 2 — sprint focus (new sprint 01)", 1_000, true)).toBe(
      `${ESC}[32m✓${ESC}[0m step 2 done (1s)`,
    );
  });
});

describe("formatDuration", () => {
  test("rounds to seconds and picks the right unit mix", () => {
    expect(formatDuration(400)).toBe("0s");
    expect(formatDuration(12_000)).toBe("12s");
    expect(formatDuration(59_600)).toBe("1m 0s");
    expect(formatDuration(252_000)).toBe("4m 12s");
    expect(formatDuration(3_725_000)).toBe("1h 2m 5s");
  });
});

describe("e2e console output", () => {
  test("happy path: banner per step id, ✓ line per step, zero ANSI bytes", () => {
    const p = makeProject();
    const r = runLoop(p);
    expect(r.exitCode).toBe(0);

    // Non-TTY run: colors and rules degrade to plain text.
    expect(r.stdout).not.toContain(ESC);
    expect(r.stderr).not.toContain(ESC);

    // Every step id of the happy path got a full banner.
    const ranStepIds: StepId[] = [
      "02-sprint-focus",
      "03-spec",
      "04-tickets",
      "05-implement",
      "05-review",
      "05.5-ux-plan",
      "05.5-ux-test",
      "05.5-ux-tickets",
      "06-report",
      "07-vision-status",
    ];
    for (const id of ranStepIds) {
      expect(r.stdout).toContain(`${STEP_EMOJI[id]} phase: step `);
      expect(r.stdout).toContain(`agent: ${STEP_CONFIG[id].model} · effort `);
      expect(r.stdout).toContain(`prompt: scripts/mmm-loop/prompts/${id}.md`);
    }

    // One ✓ outcome line per banner (no retries on the happy path).
    const lines = r.stdout.split("\n");
    const banners = lines.filter((l) => /^.+ phase: step /.test(l));
    const dones = lines.filter((l) => /^✓ step [0-9C.]+ done \(\d+[hms]/.test(l));
    expect(banners.length).toBeGreaterThanOrEqual(ranStepIds.length);
    expect(dones.length).toBe(banners.length);

    // Event lines kept their text and gained their emoji.
    expect(r.stdout).toContain("[mmm-loop] 🎉 sprint 01 complete (1/1 this run)");
    expect(r.stdout).toContain("[mmm-loop] done. ✅");
  }, 60000);
});
