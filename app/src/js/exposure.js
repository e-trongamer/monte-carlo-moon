/* Exposure maths shared by the map, the advisor and the playground. The rules
   match the Python side (psi_study.practical_distance / distance_band), so the
   page and escalation_results.json give the same distances. */

import { DISTANCES, GRID_MIN, GRID_MAX, KEPT, MEASURED, LEVELS } from "./data.js";
import { fmtD, median } from "./util.js";

// Last distance where the curve is still >= thr, log-log interpolated.
// GRID_MIN if it is below everywhere, Infinity if it never drops below on the grid.
export function practicalDistance(ys, thr, xs = DISTANCES) {
  let last = -1;
  for (let i = 0; i < xs.length; i++) if (ys[i] != null && ys[i] >= thr) last = i;
  if (last === -1) return xs[0];
  if (last === xs.length - 1) return Infinity;
  const y0 = ys[last], y1 = ys[last + 1];
  if (!(y0 > 0 && y1 > 0)) return xs[last + 1];
  const t = (Math.log(thr) - Math.log(y0)) / (Math.log(y1) - Math.log(y0));
  return Math.exp(Math.log(xs[last]) + t * Math.log(xs[last + 1] / xs[last]));
}

// Practical distance per variant curve, then median / min / max over variants.
export function distanceBand(curves, thr, landings = 1) {
  const d = curves.map((y) => practicalDistance(y.map((v) => (v == null ? null : v * landings)), thr));
  return { med: median(d), lo: Math.min(...d), hi: Math.max(...d), n: d.length };
}

// Per-variant exposure curves of one lander at one hardware height, filtered
// to the variants that pass the pit test (when the export applied that filter).
export function variantCurves(lander, heightKey, onlyKept = true) {
  return Object.entries(lander.by_height[heightKey].branches || {})
    .filter(([tag]) => !onlyKept || !KEPT || KEPT.has(tag))
    .map(([, y]) => y);
}

// The three rings (1x, 0.1x, 0.01x Surveyor) for a lander, height and number of landings.
export function ringsFor(lander, heightKey, landings = 1) {
  const curves = variantCurves(lander, heightKey);
  return LEVELS.map((lv) => ({ ...lv, ...distanceBand(curves, lv.f * MEASURED, landings) }));
}

// Which ring a point at distance d falls in: index 0 = inside the 1x ring, ..., 3 = outside all.
export function ringIndex(rings, d) {
  const i = rings.findIndex((r) => d < r.med);
  return i === -1 ? rings.length : i;
}

export const STATUS = [
  { cls: "c1", txt: "NO-GO · worse than 1969" },
  { cls: "c2", txt: "CAUTION · sandblasted" },
  { cls: "c3", txt: "WATCH · light pitting" },
  { cls: "c4", txt: "GO · under 1% of 1969" },
];

/* A practical distance as text. The target grid has points at 25, 50, 75, ... m,
   so two results are grid artifacts rather than distances:
     - at or below the first grid point: "≤ 25 m" (below the level everywhere we looked)
     - with a ring berm, the first grid point behind the berm: the hardware is
       protected as soon as it is behind the berm, whatever that grid point is. */
export function fmtPractical(m, { bermRadius = null } = {}) {
  if (m == null || !isFinite(m)) return `> ${fmtD(GRID_MAX)}`;
  if (m <= GRID_MIN + 1e-6) return `≤ ${GRID_MIN} m`;
  if (bermRadius != null) {
    const next = DISTANCES.find((x) => x > bermRadius);
    if (next != null && m <= next + 1e-6) return `behind the berm (${bermRadius} m)`;
  }
  return fmtD(m);
}

// A distance that may lie beyond the target grid (Infinity).
export const fmtDist = (m) => (m == null || isFinite(m) ? fmtD(m) : `> ${fmtD(GRID_MAX)}`);

// "berm 3 m at 50 m" -> 50; anything else -> null
export const bermRadiusOf = (label) => {
  const m = /berm .* at (\d+) m/.exec(label);
  return m ? +m[1] : null;
};