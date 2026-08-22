import { describe, expect, test } from "bun:test";
import { fillTemplate } from "../scripts/mmm-loop/engine/lib/template.ts";

describe("fillTemplate", () => {
  test("substitutes variables, including repeats", () => {
    expect(fillTemplate("a {{x}} b {{y}} c {{x}}", { x: "1", y: "2" })).toBe("a 1 b 2 c 1");
  });

  test("throws on placeholders without values, naming all of them", () => {
    expect(() => fillTemplate("{{known}} {{bogus}} {{also_bogus}}", { known: "v" })).toThrow(
      /\{\{bogus\}\}, \{\{also_bogus\}\}/,
    );
  });

  test("values containing $ and {{...}} are inserted literally, not re-expanded", () => {
    expect(fillTemplate("v={{x}}", { x: "$& {{y}}" })).toBe("v=$& {{y}}");
  });

  test("extra provided vars are fine", () => {
    expect(fillTemplate("plain", { unused: "v" })).toBe("plain");
  });
});
