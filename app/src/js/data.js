/* Model data (app_data.json, written by export_app_data.py and inlined by
   build.py) plus the constants derived from it. Everything else reads the data
   through this module. */

export const DATA = JSON.parse(document.getElementById("app-data").textContent);

export const DISTANCES = DATA.distances_m;                 // target grid, 25 m .. 10 km
export const GRID_MIN = DISTANCES[0];
export const GRID_MAX = DISTANCES[DISTANCES.length - 1];
export const MEASURED = DATA.anchor.measured_per_cm2;       // Surveyor 3: 103 pits per cm²
// Our own cut-off (2 × the Apollo LM), not a published threshold.
export const VALIDATED_MAX_N = DATA.validated_max_thrust_N;
export const APOLLO_THRUST_N = 11600;
export const G_MOON = 1.625;                 // m/s², same as config.Moon in the model
export const R_MOON = 1.7374e6;              // m
// Why we flag landers above VALIDATED_MAX_N. Shared by the map, advisor and wrap-up.
export const OUTSIDE_RANGE_WHY = `Above ${(VALIDATED_MAX_N / 1000).toFixed(1)} kN (twice the Apollo LM) we haven't tested the model, `
  + "and heavier landers may dig a crater under the engine instead of only blowing off the top layer. The model leaves that out.";

// The measured Apollo ejection angles the model runs with (one branch each).
export const APOLLO_ANGLES = [1.4, 2.0, 2.4, 2.6, 3.3, 8.1];

// Hardware heights the map offers (keys of lander.by_height). "-3" is Surveyor's crater.
export const HEIGHTS = ["0", "1.5", "3", "5", "8"];
export const LANDING_COUNTS = [1, 3, 10, 30, 100];

// Exposure levels, as fractions of what Surveyor 3 got. These are team choices.
export const LEVELS = [
  { f: 1, cls: "c1", col: "--r1", name: "Surveyor 3 level" },
  { f: 0.1, cls: "c2", col: "--r2", name: "10× less" },
  { f: 0.01, cls: "c3", col: "--r3", name: "100× less" },
];

// Variants that pass the pit test (plausible_branches.json); null = no filter applied.
export const FILTER = DATA.branch_filter && DATA.branch_filter.applied ? DATA.branch_filter : null;
export const KEPT = FILTER ? new Set(FILTER.kept) : null;

export const LANDERS = DATA.landers;
export const landerIndex = (thrustN) => LANDERS.findIndex((l) => l.thrust_N === thrustN);
export const outsideRange = (lander) => lander.thrust_N > VALIDATED_MAX_N;
export const thrustKey = (lander) => `${lander.thrust_N / 1000} kN`;   // as in mitigation keys
// "11.6 kN (Apollo LM hover)" -> "Apollo LM hover", "25 kN" -> "Generic lander"
export const landerShortName = (lander) =>
  lander.name.replace(/^[\d.]+ kN\s*/, "").replace(/[()]/g, "") || "Generic lander";
export const landerLabel = (lander) => lander.name.replace(/[()]/g, "");

// Map sites. Positions in metres east / north of each site's reference point, from
// LRO-based coordinates in NASA's NSSDCA catalogue (1 degree = 30.32 km on the Moon):
//   Apollo 12 LM 3.0128 S 23.4219 W; Surveyor 3 3.0162 S 336.582 E; Apollo 12 ALSEP 3.0098 S 23.4249 W
//   Apollo 11 LM 0.67416 N 23.47314 E; Apollo 11 LRRR 0.67345 N 23.47307 E
// The south-pole base is hypothetical.
export const SITES = [
  { id: "a12", name: "Apollo 12 & Surveyor 3", sub: "Ocean of Storms · 1969", seed: 12,
    lander: [-380, -520], thrust: APOLLO_THRUST_N,
    objects: [
      { name: "Surveyor 3", note: "157 m from the Apollo 12 lander, in a ~200 m crater about 3 m below the plain",
        pos: [118, -103], heightKey: "-3", calib: true },
      { name: "Apollo 12 descent stage", note: "Intrepid, historic landing point", pos: [0, 0] },
      { name: "Apollo 12 ALSEP", note: "science station, set up after the 1969 landing (so that dust missed it); ran until 1977 and carried a dust detector",
        pos: [-91, 91] },
    ] },
  { id: "a11", name: "Apollo 11", sub: "Tranquility Base · heritage site", seed: 11,
    lander: [0, -2000], thrust: APOLLO_THRUST_N,
    objects: [
      { name: "Eagle descent stage", note: "first crewed landing site", pos: [0, 0] },
      { name: "Laser reflector", note: "22 m south of Eagle, still used for laser ranging", pos: [-2, -22] },
    ] },
  { id: "art", name: "South pole base", sub: "Artemis-era scenario · hypothetical", seed: 77,
    lander: [900, -500], thrust: 44000,
    objects: [
      { name: "Habitat", note: "hypothetical base module", pos: [0, 0] },
      { name: "Solar array field", note: "hypothetical, sensitive to dust", pos: [-260, 140] },
    ] },
];

// Descent profile of the Apollo reference run: share of the landing's ejecta
// already thrown when the lander is at height h (used by the animations).
const PROFILE = DATA.descent_profile;
export const DESCENT_TOP_M = PROFILE ? PROFILE.h_m[0] : 34;
export const DESCENT_CUTOFF_M = PROFILE ? PROFILE.h_m[PROFILE.h_m.length - 1] : 2;
export const DESCENT_RATE = PROFILE ? PROFILE.descent_rate_m_s : 0.5;
export function dustThrownAt(h) {
  if (!PROFILE) return h <= DESCENT_CUTOFF_M ? 1 : 0;
  const hs = PROFILE.h_m, fs = PROFILE.cum_fraction;       // hs runs from top to bottom
  if (h >= hs[0]) return 0;
  if (h <= hs[hs.length - 1]) return 1;
  for (let i = 0; i < hs.length - 1; i++) {
    if (h <= hs[i] && h >= hs[i + 1]) {
      const t = (hs[i] - h) / (hs[i] - hs[i + 1]);
      return fs[i] + t * (fs[i + 1] - fs[i]);
    }
  }
  return 1;
}