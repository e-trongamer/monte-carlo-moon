/* Log-log exposure chart (distance vs impacts per cm²) as SVG markup, shared by
   the map's chart and the playground. Returns helpers so callers can add their
   own lines on top of the axes. */

import { DISTANCES } from "./data.js";
import { fmtD, fmtPow10 } from "./util.js";

export const CHART_W = 520, CHART_H = 300;
const M = { l: 58, r: 16, t: 16, b: 42 };

export function logChart(values, { minDecades = 2, maxDecades = 8, floor = null, ceil = null } = {}) {
  const pos = values.filter((v) => v > 0);
  let ymax = Math.ceil(Math.log10(Math.max(...pos, ceil ?? 0, 1e-300)));
  let ymin = Math.floor(Math.log10(Math.min(...pos, floor ?? Infinity)));
  ymin = Math.max(Math.min(ymin, ymax - minDecades), ymax - maxDecades);
  const xmin = Math.log10(DISTANCES[0]), xmax = Math.log10(DISTANCES[DISTANCES.length - 1]);
  const X = (d) => M.l + (Math.log10(d) - xmin) / (xmax - xmin) * (CHART_W - M.l - M.r);
  const Y = (v) => M.t + (ymax - Math.log10(Math.max(v, 10 ** ymin))) / (ymax - ymin) * (CHART_H - M.t - M.b);
  let axes = "";
  for (let p = ymin; p <= ymax; p++) {
    axes += `<line x1="${M.l}" x2="${CHART_W - M.r}" y1="${Y(10 ** p)}" y2="${Y(10 ** p)}" stroke="var(--line)"/>`
      + `<text x="${M.l - 6}" y="${Y(10 ** p) + 3}" text-anchor="end">${fmtPow10(p)}</text>`;
  }
  for (const d of [25, 100, 1000, 10000]) {
    axes += `<line x1="${X(d)}" x2="${X(d)}" y1="${M.t}" y2="${CHART_H - M.b}" stroke="var(--line)"/>`
      + `<text x="${X(d)}" y="${CHART_H - M.b + 14}" text-anchor="middle">${fmtD(d)}</text>`;
  }
  axes += `<text class="t-axis" x="${(M.l + CHART_W - M.r) / 2}" y="${CHART_H - 6}" text-anchor="middle">distance from the lander</text>`;
  axes += `<text class="t-axis" transform="translate(12 ${(M.t + CHART_H - M.b) / 2}) rotate(-90)" text-anchor="middle">impacts per cm² (log scale)</text>`;
  const path = (ys, scale = 1) => {
    const pts = DISTANCES.map((d, i) => (ys[i] > 0 ? `${X(d).toFixed(1)},${Y(ys[i] * scale).toFixed(1)}` : null)).filter(Boolean);
    return pts.length > 1 ? `M${pts.join("L")}` : "";
  };
  // Dashed horizontal level with its label on a dark background (so curves can't hide it).
  const level = (v, color, label) => {
    const y = Y(v);
    if (y < M.t || y > CHART_H - M.b) return "";
    const w = label.length * 6.1 + 10;
    return `<line x1="${M.l}" x2="${CHART_W - M.r}" y1="${y}" y2="${y}" stroke="${color}" stroke-dasharray="5 4" stroke-width="1.5"/>`
      + `<rect x="${M.l + 4}" y="${y - 16}" width="${w}" height="14" rx="3" fill="var(--panel)" fill-opacity=".9"/>`
      + `<text x="${M.l + 9}" y="${y - 5}" style="fill:${color}">${label}</text>`;
  };
  return { X, Y, axes, path, level, top: M.t, bottom: CHART_H - M.b };
}