/** Pure cleanup helpers (lib/cleanup.ts): stamp parsing, cadence, missing
 * category, commit-type mapping. */

import { describe, expect, test } from "bun:test";
import {
  CLEANUP_DIRNAME_RE,
  cleanupCommitType,
  firstMissingCategory,
  isCadenceCleanup,
  parseCandidatesStamp,
} from "../scripts/mmm-loop/lib/cleanup.ts";
import { LoopError } from "../scripts/mmm-loop/lib/errors.ts";
import type { TicketFile } from "../scripts/mmm-loop/lib/snapshot.ts";
import { freshTicket } from "./helpers.ts";

function tf(filename: string): TicketFile {
  const id = /^(\d{3}(?:\.\d)?)/.exec(filename)![1]!;
  return { filename, ticket: freshTicket(id) };
}

const stamp = (a: string, c: string, d: string) =>
  `_Candidates: architecture=${a}, clean-code=${c}, docs=${d}_`;

describe("CLEANUP_DIRNAME_RE", () => {
  test("matches exactly NN-cleanup", () => {
    expect(CLEANUP_DIRNAME_RE.test("03-cleanup")).toBe(true);
    expect(CLEANUP_DIRNAME_RE.test("03-cleanup-docs")).toBe(false);
    expect(CLEANUP_DIRNAME_RE.test("3-cleanup")).toBe(false);
    expect(CLEANUP_DIRNAME_RE.test("03-clean")).toBe(false);
  });
});

describe("parseCandidatesStamp", () => {
  test("all 8 yes/none permutations parse", () => {
    for (const a of ["yes", "none"] as const) {
      for (const c of ["yes", "none"] as const) {
        for (const d of ["yes", "none"] as const) {
          expect(parseCandidatesStamp(stamp(a, c, d))).toEqual({
            architecture: a,
            "clean-code": c,
            docs: d,
          });
        }
      }
    }
  });

  test("surrounding whitespace is tolerated (line is trimmed)", () => {
    expect(parseCandidatesStamp(`  ${stamp("yes", "none", "yes")}  `)).not.toBeNull();
  });

  test("any deviation → null", () => {
    for (const line of [
      null,
      "",
      "# Cleanup spec",
      // wrong key order
      "_Candidates: clean-code=yes, architecture=yes, docs=yes_",
      // missing key
      "_Candidates: architecture=yes, docs=yes_",
      // junk value
      stamp("yes", "maybe", "none"),
      stamp("Yes", "none", "none"),
      // missing underscores
      "Candidates: architecture=yes, clean-code=none, docs=yes",
      "_Candidates: architecture=yes, clean-code=none, docs=yes",
      // leading garbage
      `x ${stamp("yes", "none", "yes")}`,
    ]) {
      expect(parseCandidatesStamp(line)).toBeNull();
    }
  });
});

describe("isCadenceCleanup", () => {
  test("default cadence 3 hits sprints 03, 06, 09 and misses the rest", () => {
    const hits = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"].filter((n) =>
      isCadenceCleanup(n, 3),
    );
    expect(hits).toEqual(["03", "06", "09"]);
  });

  test("cadence 0 disables cleanup sprints entirely", () => {
    for (const n of ["01", "03", "06"]) expect(isCadenceCleanup(n, 0)).toBe(false);
  });
});

describe("firstMissingCategory", () => {
  const allYes = parseCandidatesStamp(stamp("yes", "yes", "yes"))!;

  test("empty tickets → architecture (first in ID order)", () => {
    expect(firstMissingCategory(allYes, [])?.key).toBe("architecture");
  });

  test("gap: only 002- present → architecture is still first missing", () => {
    expect(firstMissingCategory(allYes, [tf("002-simplify.json")])?.key).toBe("architecture");
  });

  test("progresses in ID order as tickets appear", () => {
    expect(firstMissingCategory(allYes, [tf("001-a.json")])?.key).toBe("clean-code");
    expect(firstMissingCategory(allYes, [tf("001-a.json"), tf("002-b.json")])?.key).toBe("docs");
    expect(
      firstMissingCategory(allYes, [tf("001-a.json"), tf("002-b.json"), tf("003-c.json")]),
    ).toBeNull();
  });

  test("a fix ticket (001.1-) does not satisfy category 001", () => {
    expect(firstMissingCategory(allYes, [tf("001.1-fix.json")])?.key).toBe("architecture");
  });

  test("none-categories are never missing; all-none → null with zero tickets", () => {
    const docsOnly = parseCandidatesStamp(stamp("none", "none", "yes"))!;
    expect(firstMissingCategory(docsOnly, [])?.key).toBe("docs");
    expect(firstMissingCategory(docsOnly, [tf("003-c.json")])).toBeNull();

    const allNone = parseCandidatesStamp(stamp("none", "none", "none"))!;
    expect(firstMissingCategory(allNone, [])).toBeNull();
  });
});

describe("cleanupCommitType", () => {
  test("001/002 → refactor, 003 → docs; fix ids resolve via their integer part", () => {
    expect(cleanupCommitType("001")).toBe("refactor");
    expect(cleanupCommitType("002")).toBe("refactor");
    expect(cleanupCommitType("003")).toBe("docs");
    expect(cleanupCommitType("002.1")).toBe("refactor");
    expect(cleanupCommitType("003.1")).toBe("docs");
  });

  test("any other id on a cleanup sprint is malformed state → LoopError", () => {
    expect(() => cleanupCommitType("004")).toThrow(LoopError);
    expect(() => cleanupCommitType("004")).toThrow(/no cleanup category/);
  });
});
