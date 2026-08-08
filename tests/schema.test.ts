import { describe, expect, test } from "bun:test";
import { TICKET_FILENAME_RE, validateTicket } from "../scripts/mmm-loop/lib/tickets.ts";
import { freshTicket } from "./helpers.ts";

describe("ticket filename rule", () => {
  test("valid names", () => {
    expect(TICKET_FILENAME_RE.test("001-first-thing.json")).toBe(true);
    expect(TICKET_FILENAME_RE.test("003.1-fix-first-thing.json")).toBe(true);
  });

  test("invalid names", () => {
    for (const bad of ["01-short.json", "001-Upper.json", "001.json", "001-thing.txt", "001.12-x.json"]) {
      expect(TICKET_FILENAME_RE.test(bad)).toBe(false);
    }
  });

  test("lexical filename sort equals execution order (fix ticket directly after parent)", () => {
    const files = ["004-y.json", "003.1-fix-x.json", "003-x.json"];
    expect([...files].sort()).toEqual(["003-x.json", "003.1-fix-x.json", "004-y.json"]);
  });
});

describe("validateTicket", () => {
  test("valid ticket passes", () => {
    expect(validateTicket(freshTicket("001"), "001-a-thing.json")).toEqual([]);
  });

  test("valid fix ticket passes", () => {
    expect(validateTicket(freshTicket("003.1"), "003.1-fix-thing.json")).toEqual([]);
  });

  test("missing field fails, naming file and field", () => {
    const t = freshTicket("001") as unknown as Record<string, unknown>;
    delete t.title;
    const errors = validateTicket(t, "001-a.json");
    expect(errors.some((e) => e.includes("001-a.json") && e.includes('"title"'))).toBe(true);
  });

  test("wrong type fails", () => {
    const errors = validateTicket(freshTicket("001", { done: "yes" as unknown as boolean }), "001-a.json");
    expect(errors.some((e) => e.includes('"done" must be a boolean'))).toBe(true);
  });

  test("bad tests entries fail", () => {
    const t = freshTicket("001");
    t.tests = [{ description: "", passes: "nope" as unknown as boolean }];
    const errors = validateTicket(t, "001-a.json");
    expect(errors.some((e) => e.includes("tests[0].description"))).toBe(true);
    expect(errors.some((e) => e.includes("tests[0].passes"))).toBe(true);
  });

  test("commits must be strings", () => {
    const errors = validateTicket(freshTicket("001", { commits: [42] as unknown as string[] }), "001-a.json");
    expect(errors.some((e) => e.includes('"commits"'))).toBe(true);
  });

  test("id/filename mismatch fails", () => {
    const errors = validateTicket(freshTicket("002"), "001-a.json");
    expect(errors.some((e) => e.includes("does not match filename number"))).toBe(true);
  });

  test("bad filename fails", () => {
    const errors = validateTicket(freshTicket("001"), "1-a.json");
    expect(errors.some((e) => e.includes("filename does not match"))).toBe(true);
  });

  test("non-object fails without crashing", () => {
    expect(validateTicket(null, "001-a.json").length).toBeGreaterThan(0);
    expect(validateTicket([], "001-a.json").length).toBeGreaterThan(0);
  });
});
