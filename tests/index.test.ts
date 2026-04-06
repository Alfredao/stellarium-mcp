/**
 * Tests for tool handler logic in index.ts.
 *
 * Since index.ts registers tools on a global server with side effects,
 * we test the extractable logic: response formatting and the alignment
 * star selection algorithm.
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

// ─── Alignment star selection algorithm (extracted) ─────────────────

interface StarCandidate {
  name: string;
  altitude: number;
  azimuth: number;
  magnitude: number;
}

function selectAlignmentStars(
  starData: StarCandidate[],
  count: number
): StarCandidate[] {
  // Sort by magnitude (brightest first)
  const sorted = [...starData].sort((a, b) => a.magnitude - b.magnitude);
  const selected: StarCandidate[] = [];
  const remaining = [...sorted];

  if (remaining.length > 0) {
    selected.push(remaining.shift()!);

    while (selected.length < count && remaining.length > 0) {
      let bestIdx = 0;
      let bestMinSep = -1;

      for (let i = 0; i < remaining.length; i++) {
        let minSep = Infinity;
        for (const sel of selected) {
          const azDiff = Math.abs(remaining[i].azimuth - sel.azimuth);
          const sep = Math.min(azDiff, 360 - azDiff);
          minSep = Math.min(minSep, sep);
        }
        if (minSep > bestMinSep) {
          bestMinSep = minSep;
          bestIdx = i;
        }
      }
      selected.push(remaining.splice(bestIdx, 1)[0]);
    }
  }

  return selected;
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

describe("selectAlignmentStars", () => {
  it("returns empty array when no candidates", () => {
    expect(selectAlignmentStars([], 3)).toEqual([]);
  });

  it("returns single star when only one candidate", () => {
    const stars = [{ name: "Sirius", altitude: 45, azimuth: 120, magnitude: -1.46 }];
    const result = selectAlignmentStars(stars, 3);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Sirius");
  });

  it("starts with the brightest star", () => {
    const stars = [
      { name: "Dim", altitude: 30, azimuth: 90, magnitude: 1.5 },
      { name: "Bright", altitude: 40, azimuth: 180, magnitude: -1.0 },
      { name: "Medium", altitude: 50, azimuth: 270, magnitude: 0.5 },
    ];
    const result = selectAlignmentStars(stars, 3);
    expect(result[0].name).toBe("Bright");
  });

  it("selects well-spaced stars by azimuth", () => {
    const stars = [
      { name: "North", altitude: 30, azimuth: 0, magnitude: 0.0 },
      { name: "NorthEast", altitude: 30, azimuth: 45, magnitude: 0.1 },
      { name: "East", altitude: 30, azimuth: 90, magnitude: 0.2 },
      { name: "South", altitude: 30, azimuth: 180, magnitude: 0.3 },
      { name: "West", altitude: 30, azimuth: 270, magnitude: 0.4 },
    ];
    const result = selectAlignmentStars(stars, 3);
    // Should pick North (brightest), then South (180° away), then East or West (90° from both)
    expect(result[0].name).toBe("North");
    expect(result[1].name).toBe("South");
    expect(["East", "West"]).toContain(result[2].name);
  });

  it("handles azimuth wrapping around 360°", () => {
    const stars = [
      { name: "A", altitude: 30, azimuth: 350, magnitude: 0.0 },
      { name: "B", altitude: 30, azimuth: 10, magnitude: 0.1 },
      { name: "C", altitude: 30, azimuth: 170, magnitude: 0.2 },
    ];
    const result = selectAlignmentStars(stars, 2);
    // A is brightest, C is furthest away (160° via wrapping)
    expect(result[0].name).toBe("A");
    expect(result[1].name).toBe("C");
  });

  it("respects requested count", () => {
    const stars = [
      { name: "A", altitude: 30, azimuth: 0, magnitude: 0 },
      { name: "B", altitude: 30, azimuth: 90, magnitude: 1 },
      { name: "C", altitude: 30, azimuth: 180, magnitude: 2 },
      { name: "D", altitude: 30, azimuth: 270, magnitude: 3 },
    ];
    expect(selectAlignmentStars(stars, 2)).toHaveLength(2);
    expect(selectAlignmentStars(stars, 4)).toHaveLength(4);
  });

  it("does not return more than available", () => {
    const stars = [
      { name: "A", altitude: 30, azimuth: 0, magnitude: 0 },
    ];
    expect(selectAlignmentStars(stars, 5)).toHaveLength(1);
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
