/**
 * Coordinate conversion and spherical geometry.
 *
 * Pure functions, no I/O — kept out of the client and the server so both can
 * import them and so the tests exercise the real implementation rather than a
 * copy of it.
 */

/**
 * Convert equatorial coordinates to the rectangular unit vector that the
 * view and focus endpoints expect.
 *
 * Stellarium takes directions as unit vectors rather than angles, so a J2000
 * right ascension / declination pair has to be projected before it can be
 * sent. Right ascension is in degrees — multiply catalogue hours by 15.
 */
export function raDecToVector(raDeg: number, decDeg: number): [number, number, number] {
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
}

/**
 * True angular separation between two horizontal positions, in degrees.
 *
 * Comparing azimuths alone is not a usable proxy: azimuth lines converge at
 * the zenith, so two stars at altitude 85° with opposite azimuths are 10°
 * apart on the sky while their azimuths differ by 180°. This uses the
 * spherical law of cosines, which accounts for altitude.
 */
export function angularSeparation(
  alt1: number,
  az1: number,
  alt2: number,
  az2: number
): number {
  const toRad = Math.PI / 180;
  const a1 = alt1 * toRad;
  const a2 = alt2 * toRad;
  const dAz = (az1 - az2) * toRad;

  const cosSep =
    Math.sin(a1) * Math.sin(a2) + Math.cos(a1) * Math.cos(a2) * Math.cos(dAz);

  // Guard against the rounding that pushes cosSep just outside [-1, 1] for
  // coincident or antipodal positions, which would make acos return NaN.
  return (Math.acos(Math.min(1, Math.max(-1, cosSep))) * 180) / Math.PI;
}

export interface StarCandidate {
  name: string;
  altitude: number;
  azimuth: number;
  magnitude: number;
}

/**
 * Pick `count` stars that are bright and spread widely across the sky.
 *
 * Telescope alignment degrades when the reference stars sit close together, so
 * this starts from the brightest candidate and then repeatedly takes whichever
 * remaining star is furthest from everything already chosen (a greedy
 * farthest-point selection, maximising the minimum separation).
 */
export function selectAlignmentStars(
  starData: StarCandidate[],
  count: number
): StarCandidate[] {
  const remaining = [...starData].sort((a, b) => a.magnitude - b.magnitude);
  const selected: StarCandidate[] = [];

  if (remaining.length === 0) return selected;

  selected.push(remaining.shift()!);

  while (selected.length < count && remaining.length > 0) {
    let bestIdx = 0;
    let bestMinSep = -1;

    for (let i = 0; i < remaining.length; i++) {
      let minSep = Infinity;
      for (const sel of selected) {
        const sep = angularSeparation(
          remaining[i].altitude,
          remaining[i].azimuth,
          sel.altitude,
          sel.azimuth
        );
        minSep = Math.min(minSep, sep);
      }
      if (minSep > bestMinSep) {
        bestMinSep = minSep;
        bestIdx = i;
      }
    }
    selected.push(remaining.splice(bestIdx, 1)[0]);
  }

  return selected;
}
