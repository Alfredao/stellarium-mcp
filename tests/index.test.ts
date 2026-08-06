/**
 * Tests for tool handler logic in index.ts.
 *
 * Since index.ts registers tools on a global server with side effects, the
 * logic here is duplicated rather than imported. Anything worth testing
 * properly belongs in src/astronomy.ts, which the tests import directly.
 */

import { describe, it, expect } from "vitest";

// ─── textResult / errorResult (re-implemented for testing) ──────────

function textResult(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(err: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

// ─── toggle_display_feature action map (extracted) ──────────────────

const actionMap: Record<string, string> = {
  constellation_lines: "actionShow_Constellation_Lines",
  constellation_labels: "actionShow_Constellation_Labels",
  constellation_art: "actionShow_Constellation_Art",
  atmosphere: "actionShow_Atmosphere",
  ground: "actionShow_Ground",
  cardinal_points: "actionShow_Cardinal_Points",
  equatorial_grid: "actionShow_Equatorial_Grid",
  azimuthal_grid: "actionShow_Azimuthal_Grid",
  stars: "actionShow_Stars",
  planets: "actionShow_Planets",
  nebulae: "actionShow_Nebulae",
  milky_way: "actionShow_MilkyWay",
};

// ─── Tests ──────────────────────────────────────────────────────────

describe("textResult", () => {
  it("wraps string data directly", () => {
    const result = textResult("hello");
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toBe("hello");
  });

  it("JSON-stringifies non-string data", () => {
    const result = textResult({ key: "value" });
    expect(JSON.parse(result.content[0].text)).toEqual({ key: "value" });
  });

  it("handles arrays", () => {
    const result = textResult([1, 2, 3]);
    expect(JSON.parse(result.content[0].text)).toEqual([1, 2, 3]);
  });

  it("handles null", () => {
    const result = textResult(null);
    expect(result.content[0].text).toBe("null");
  });
});

describe("errorResult", () => {
  it("extracts Error message", () => {
    const result = errorResult(new Error("something broke"));
    expect(result.content[0].text).toBe("Error: something broke");
    expect(result.isError).toBe(true);
  });

  it("stringifies non-Error values", () => {
    const result = errorResult("raw string");
    expect(result.content[0].text).toBe("Error: raw string");
  });

  it("stringifies numbers", () => {
    const result = errorResult(42);
    expect(result.content[0].text).toBe("Error: 42");
  });
});

describe("toggle_display_feature actionMap", () => {
  it("maps all 12 features to action IDs", () => {
    const features = [
      "constellation_lines", "constellation_labels", "constellation_art",
      "atmosphere", "ground", "cardinal_points",
      "equatorial_grid", "azimuthal_grid",
      "stars", "planets", "nebulae", "milky_way",
    ];
    for (const f of features) {
      expect(actionMap[f]).toBeDefined();
      expect(actionMap[f]).toMatch(/^actionShow_/);
    }
  });

  it("milky_way maps to MilkyWay (not Milky_Way)", () => {
    expect(actionMap["milky_way"]).toBe("actionShow_MilkyWay");
  });
});
