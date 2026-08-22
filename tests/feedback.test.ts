/** Feedback sprints (spec §8.9): the pure helpers plus the inbox read. */

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FEEDBACK_DIRNAME_RE,
  handledName,
  isInboxItem,
  markTriaged,
  parseDispositions,
  parseFeedbackStamp,
  summarizeDispositions,
} from "../scripts/mmm-loop/engine/lib/feedback.ts";
import { readFeedbackInbox } from "../scripts/mmm-loop/engine/lib/snapshot.ts";

describe("parseFeedbackStamp", () => {
  test("parses all three keys", () => {
    expect(parseFeedbackStamp("_Feedback: triaged=no, actionable=yes, vision-change=no_")).toEqual({
      triaged: "no",
      actionable: "yes",
      visionChange: "no",
    });
    expect(
      parseFeedbackStamp("_Feedback: triaged=yes, actionable=none, vision-change=proposed_"),
    ).toEqual({ triaged: "yes", actionable: "none", visionChange: "proposed" });
  });

  test("tolerates surrounding whitespace only", () => {
    expect(
      parseFeedbackStamp("  _Feedback: triaged=no, actionable=yes, vision-change=no_  "),
    ).not.toBeNull();
  });

  test("rejects anything else", () => {
    for (const line of [
      null,
      "",
      "# Sprint 01 — feedback",
      "_Feedback: actionable=yes, vision-change=no_",
      "_Feedback: triaged=maybe, actionable=yes, vision-change=no_",
      "_Feedback: triaged=no, actionable=maybe, vision-change=no_",
      "_Feedback: actionable=yes, triaged=no, vision-change=no_",
      "_Feedback: triaged=no, actionable=yes_",
      "_Candidates: architecture=yes, clean-code=none, docs=yes_",
      "text _Feedback: triaged=no, actionable=yes, vision-change=no_",
    ]) {
      expect(parseFeedbackStamp(line)).toBeNull();
    }
  });

  test("markTriaged flips exactly the orchestrator's key", () => {
    expect(markTriaged("_Feedback: triaged=no, actionable=none, vision-change=proposed_")).toBe(
      "_Feedback: triaged=yes, actionable=none, vision-change=proposed_",
    );
    // Already flipped, or junk: unchanged rather than corrupted.
    const flipped = "_Feedback: triaged=yes, actionable=yes, vision-change=no_";
    expect(markTriaged(flipped)).toBe(flipped);
    expect(markTriaged("# not a stamp")).toBe("# not a stamp");
  });
});

describe("parseDispositions", () => {
  const focus = [
    "_Feedback: triaged=no, actionable=yes, vision-change=proposed_",
    "",
    "## Feedback",
    "",
    "### slow-cli.md",
    "- Disposition: in-vision",
    "- What it says: the CLI is slow",
    "",
    "### wrong-product.md",
    "-  Disposition:   vision-change  ",
    "",
    "## Vision proposals",
    "",
    "- Disposition: declined",
    "",
  ].join("\n");

  test("keys blocks by their exact heading and tolerates loose spacing", () => {
    expect(parseDispositions(focus)).toEqual(
      new Map([
        ["slow-cli.md", ["in-vision"]],
        ["wrong-product.md", ["vision-change"]],
      ]),
    );
  });

  test("a new ## section ends the block — stray lines belong to nobody", () => {
    expect(parseDispositions(focus).get("wrong-product.md")).toEqual(["vision-change"]);
  });

  test("headings match exactly, so one item name never covers another", () => {
    const blocks = parseDispositions("### slow-cli.md\n- Disposition: in-vision\n");
    expect(blocks.has("cli.md")).toBe(false);
  });

  test("two dispositions in one block are both reported", () => {
    const blocks = parseDispositions(
      "### a.md\n- Disposition: in-vision\n- Disposition: declined\n",
    );
    expect(blocks.get("a.md")).toEqual(["in-vision", "declined"]);
  });

  test("summarizeDispositions counts in a fixed order", () => {
    expect(summarizeDispositions(["declined", "in-vision", "in-vision"])).toBe(
      "2 in-vision, 1 declined",
    );
    expect(summarizeDispositions([])).toBe("nothing triaged");
  });
});

describe("folder and item naming", () => {
  test("NN-feedback is the feedback sprint folder shape", () => {
    expect(FEEDBACK_DIRNAME_RE.test("01-feedback")).toBe(true);
    expect(FEEDBACK_DIRNAME_RE.test("12-feedback")).toBe(true);
    for (const d of ["1-feedback", "01-feedback-2", "01-cleanup", "feedback", "01-feedbacks"]) {
      expect(FEEDBACK_DIRNAME_RE.test(d)).toBe(false);
    }
  });

  test("only non-dot .md files a heading can name are items", () => {
    expect(isInboxItem("slow-cli.md")).toBe(true);
    expect(isInboxItem("åäö 🚀.md")).toBe(true);
    for (const f of [".gitkeep", "notes.txt", ".hidden.md", "README", "two\nlines.md"]) {
      expect(isInboxItem(f)).toBe(false);
    }
  });

  test("the archive name records the handling sprint", () => {
    expect(handledName("07", "slow-cli.md", [])).toBe("07-slow-cli.md");
  });

  test("a name already in the archive is never overwritten", () => {
    expect(handledName("07", "slow-cli.md", ["07-slow-cli.md"])).toBe("07-slow-cli-2.md");
    expect(handledName("07", "slow-cli.md", ["07-slow-cli.md", "07-slow-cli-2.md"])).toBe(
      "07-slow-cli-3.md",
    );
    // A different sprint's entry is not in the way.
    expect(handledName("08", "slow-cli.md", ["07-slow-cli.md"])).toBe("08-slow-cli.md");
  });
});

describe("readFeedbackInbox", () => {
  function project(files: Record<string, string> = {}, opts: { inbox?: boolean } = {}): string {
    const root = mkdtempSync(join(tmpdir(), "mmm-loop-inbox-"));
    if (opts.inbox !== false) mkdirSync(join(root, "docs/feedback/inbox"), { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(root, "docs/feedback/inbox", name), content);
    }
    return root;
  }

  test("missing folder reads as empty — the folders are optional", () => {
    expect(readFeedbackInbox(project({}, { inbox: false }))).toEqual([]);
  });

  test("empty folder reads as empty", () => {
    expect(readFeedbackInbox(project())).toEqual([]);
  });

  test("returns non-empty .md files, sorted", () => {
    const root = project({ "b.md": "second", "a.md": "first" });
    expect(readFeedbackInbox(root)).toEqual(["a.md", "b.md"]);
  });

  test("ignores .gitkeep, other extensions, and files with nothing in them", () => {
    const root = project({
      ".gitkeep": "",
      "notes.txt": "not markdown",
      "accidental-touch.md": "",
      "blank-line.md": "\n  \n\t\n",
      "real.md": "the CLI error message is useless",
    });
    expect(readFeedbackInbox(root)).toEqual(["real.md"]);
  });

  test("symlinks are never items — dangling or not", () => {
    const root = project({ "real.md": "x" });
    symlinkSync("/nonexistent/target.md", join(root, "docs/feedback/inbox/broken.md"));
    symlinkSync(join(root, "docs/feedback/inbox/real.md"), join(root, "docs/feedback/inbox/alias.md"));
    // Archiving one would move a link, not the words; and the untouched
    // check cannot see symlinks either.
    expect(readFeedbackInbox(root)).toEqual(["real.md"]);
  });

  test("ignores subdirectories", () => {
    const root = project({ "real.md": "x" });
    mkdirSync(join(root, "docs/feedback/inbox/archive.md"), { recursive: true });
    expect(readFeedbackInbox(root)).toEqual(["real.md"]);
  });
});
