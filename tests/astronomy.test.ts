import { describe, it, expect } from "vitest";
import {
  raDecToVector,
  angularSeparation,
  selectAlignmentStars,
} from "../src/astronomy.js";

// ─── raDecToVector ──────────────────────────────────────────────────

describe("raDecToVector", () => {
  const closeTo = (v: [number, number, number], e: [number, number, number]) => {
    v.forEach((n, i) => expect(n).toBeCloseTo(e[i], 10));
  };

  it("maps the vernal equinox to the x axis", () => {
    closeTo(raDecToVector(0, 0), [1, 0, 0]);
  });

  it("maps RA 90° to the y axis", () => {
    closeTo(raDecToVector(90, 0), [0, 1, 0]);
  });

  it("maps RA 180° to negative x", () => {
    closeTo(raDecToVector(180, 0), [-1, 0, 0]);
  });

  it("maps the north celestial pole to the z axis", () => {
    closeTo(raDecToVector(0, 90), [0, 0, 1]);
  });

  it("maps the south celestial pole to negative z", () => {
    closeTo(raDecToVector(123, -90), [0, 0, -1]);
  });

  it("always returns a unit vector", () => {
    for (const [ra, dec] of [
      [279.234, 38.784],
      [95.988, -52.696],
      [317.5, -71.2],
    ]) {
      const [x, y, z] = raDecToVector(ra, dec);
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 12);
    }
  });

  it("puts northern declinations above the equator", () => {
    expect(raDecToVector(45, 30)[2]).toBeGreaterThan(0);
    expect(raDecToVector(45, -30)[2]).toBeLessThan(0);
  });
});

// ─── angularSeparation ──────────────────────────────────────────────

describe("angularSeparation", () => {
  it("is zero for the same position", () => {
    expect(angularSeparation(45, 120, 45, 120)).toBeCloseTo(0, 10);
  });

  it("measures altitude difference along a shared azimuth", () => {
    expect(angularSeparation(20, 90, 80, 90)).toBeCloseTo(60, 10);
  });

  it("is 90° from the zenith to the horizon", () => {
    expect(angularSeparation(90, 0, 0, 137)).toBeCloseTo(90, 10);
  });

  it("collapses azimuth near the zenith", () => {
    // The case azimuth-only spacing gets wrong: 180° apart in azimuth but
    // only 10° apart on the sky.
    expect(angularSeparation(85, 0, 85, 180)).toBeCloseTo(10, 10);
  });

  it("equals the azimuth difference on the horizon", () => {
    expect(angularSeparation(0, 10, 0, 80)).toBeCloseTo(70, 10);
  });

  it("wraps across 0°/360°", () => {
    expect(angularSeparation(0, 350, 0, 10)).toBeCloseTo(20, 10);
    expect(angularSeparation(30, 350, 30, 10)).toBeCloseTo(
      angularSeparation(30, 10, 30, 350),
      12
    );
  });

  it("is symmetric", () => {
    expect(angularSeparation(12, 34, 56, 78)).toBeCloseTo(
      angularSeparation(56, 78, 12, 34),
      12
    );
  });

  it("returns 180° for antipodal points without NaN", () => {
    const sep = angularSeparation(90, 0, -90, 0);
    expect(Number.isNaN(sep)).toBe(false);
    expect(sep).toBeCloseTo(180, 10);
  });

  it("never exceeds 180° or drops below 0°", () => {
    for (const [a1, z1, a2, z2] of [
      [90, 0, 90, 359],
      [-90, 12, -90, 300],
      [0, 0, 0, 180],
      [89.999, 0, 89.999, 180],
    ]) {
      const sep = angularSeparation(a1, z1, a2, z2);
      expect(sep).toBeGreaterThanOrEqual(0);
      expect(sep).toBeLessThanOrEqual(180);
    }
  });
});

// ─── selectAlignmentStars ───────────────────────────────────────────

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
    expect(selectAlignmentStars(stars, 3)[0].name).toBe("Bright");
  });

  it("spreads the selection around the sky", () => {
    const stars = [
      { name: "North", altitude: 30, azimuth: 0, magnitude: 0.0 },
      { name: "NorthEast", altitude: 30, azimuth: 45, magnitude: 0.1 },
      { name: "East", altitude: 30, azimuth: 90, magnitude: 0.2 },
      { name: "South", altitude: 30, azimuth: 180, magnitude: 0.3 },
      { name: "West", altitude: 30, azimuth: 270, magnitude: 0.4 },
    ];
    const result = selectAlignmentStars(stars, 3);
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
    const stars = [{ name: "A", altitude: 30, azimuth: 0, magnitude: 0 }];
    expect(selectAlignmentStars(stars, 5)).toHaveLength(1);
  });

  it("rejects a near-zenith pair that only looks far apart in azimuth", () => {
    // Zenith2 sits 180° away in azimuth but 4° away on the sky. Spread is the
    // whole point of the selection, so the low star has to win.
    const stars = [
      { name: "Zenith1", altitude: 88, azimuth: 0, magnitude: 0.0 },
      { name: "Zenith2", altitude: 88, azimuth: 180, magnitude: 0.5 },
      { name: "Low", altitude: 30, azimuth: 90, magnitude: 1.0 },
    ];
    const result = selectAlignmentStars(stars, 2);
    expect(result[0].name).toBe("Zenith1");
    expect(result[1].name).toBe("Low");
  });

  it("prefers altitude spread over a small azimuth spread", () => {
    // High shares an azimuth with Base but is 60° away; Near differs by 30° in
    // azimuth yet is only 28° away.
    const stars = [
      { name: "Base", altitude: 20, azimuth: 90, magnitude: 0.0 },
      { name: "High", altitude: 80, azimuth: 90, magnitude: 0.5 },
      { name: "Near", altitude: 25, azimuth: 120, magnitude: 1.0 },
    ];
    const result = selectAlignmentStars(stars, 2);
    expect(result[1].name).toBe("High");
  });

  it("maximises the minimum separation across the whole selection", () => {
    const stars = [
      { name: "A", altitude: 10, azimuth: 0, magnitude: 0.0 },
      { name: "B", altitude: 15, azimuth: 20, magnitude: 0.1 },
      { name: "C", altitude: 70, azimuth: 200, magnitude: 0.2 },
      { name: "D", altitude: 12, azimuth: 190, magnitude: 0.3 },
    ];
    const chosen = selectAlignmentStars(stars, 3).map((s) => s.name);
    expect(chosen).toContain("A");
    // B is the crowded one — 20° from A — so it should be the star left out.
    expect(chosen).not.toContain("B");
  });
});
