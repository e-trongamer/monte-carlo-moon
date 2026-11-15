/* Small helpers shared by every module: DOM lookup, formatting, a seeded
   random generator and log-log interpolation. No app state lives here. */

export const $ = (id) => document.getElementById(id);

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// CSS custom properties, read once (canvases ask for them every frame).
const cssCache = {};
export function css(name) {
  if (!(name in cssCache)) cssCache[name] = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return cssCache[name];
}

// 1234 -> "1.2 km", 87 -> "87 m"; null, NaN or Infinity -> "—"
export function fmtD(m) {
  if (m == null || !isFinite(m)) return "—";
  return m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 0 : 1) + " km" : Math.round(m) + " m";
}

// Numbers that span many decades: 0.0042 -> "4.2e-3", 37 -> "37", 12000 -> "1.2e4"
export function fmtN(x) {
  if (x == null || !isFinite(x)) return "—";
  if (x === 0) return "0";
  if (x >= 1e4 || x < 0.01) return x.toExponential(1).replace("e+", "e");
  return x >= 100 ? Math.round(x).toString() : x.toPrecision(2);
}

// Axis label for a power of ten: 3 -> "1,000", 6 -> "10⁶"
const SUPERSCRIPT = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
export function fmtPow10(p) {
  if (p >= 0 && p <= 3) return (10 ** p).toLocaleString("en");
  if (p === -1) return "0.1";
  if (p === -2) return "0.01";
  return "10" + String(p).split("").map((ch) => SUPERSCRIPT[ch]).join("");
}

// Deterministic pseudo-random numbers from four integer seeds (same picture every load).
export function seededRandom(a, b, c, d) {
  let h = 2166136261 ^ a;
  h = Math.imul(h ^ b, 16777619); h = Math.imul(h ^ c, 16777619); h = Math.imul(h ^ d, 16777619);
  return () => {
    h += 0x6D2B79F5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian() {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Log-log interpolation of ys over xs at x (clamped to the ends); null where data is missing.
export function interpLog(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  for (let i = 0; i < xs.length - 1; i++) {
    if (x <= xs[i + 1]) {
      const a = ys[i], b = ys[i + 1];
      if (a == null || b == null || a <= 0 || b <= 0) return a ?? b;
      const t = Math.log(x / xs[i]) / Math.log(xs[i + 1] / xs[i]);
      return Math.exp(Math.log(a) + t * Math.log(b / a));
    }
  }
  return ys[ys.length - 1];
}

export const median = (values) => {
  const s = [...values].sort((a, b) => a - b), k = s.length;
  return k % 2 ? s[(k - 1) / 2] : (s[k / 2 - 1] + s[k / 2]) / 2;
};