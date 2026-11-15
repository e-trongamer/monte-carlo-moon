/* Chapter 3, station 2: a mini Monte Carlo that runs in the browser.
   Deliberately simplified (it says so on the page): grain size from the
   lognormal, speed from the Fig. 5 fit without height dependence, one of the
   six Apollo angles, ballistic flight. A "hit" is a grain passing the target
   distance 0-1.5 m above the ground. */

import { APOLLO_ANGLES } from "./data.js";
import { $, css, gaussian } from "./util.js";
import { drawLanderIcon } from "./icons2d.js";

const SIZE = 560, RADIUS = 262, MAX_RANGE_M = 3e5;
const LN_SIGMA = Math.log(3), D50_NUMBER_UM = 70 * Math.exp(-3 * LN_SIGMA * LN_SIGMA);   // number median of the mass lognormal
const ORBITAL_SPEED = 1680;                                       // m/s, circular orbit at the surface

const mc = { n: 0, hits: 0, history: [], todo: 0, perFrame: 0, running: false, dots: null };
const targetDistance = () => +$("mcDist").value;

function throwGrain(d) {
  let D; do { D = D50_NUMBER_UM * Math.exp(LN_SIGMA * gaussian()); } while (D < 1 || D > 500);
  const v = Math.min(2054 / Math.sqrt(D), 2370) * (0.35 + 0.65 * Math.random());
  const th = (APOLLO_ANGLES[Math.floor(Math.random() * APOLLO_ANGLES.length)] + 0.5 * gaussian()) * Math.PI / 180;
  const r0 = 12 * Math.sqrt(Math.random());
  let hit = false;
  if (th > 0) {
    const dd = d - r0, vh = v * Math.cos(th), t = dd / vh;
    const z = dd * Math.tan(th) - 0.5 * 1.62 * t * t + dd * dd / (2 * 1.7374e6);
    hit = z >= 0 && z <= 1.5;
  }
  const range = th > 0 ? r0 + v * v * Math.sin(2 * th) / 1.62 : r0;
  return { D, range, hit, orbit: v >= ORBITAL_SPEED };
}

// Log-scaled radius on the top-view map.
const mapRadius = (m) => RADIUS * Math.log10(1 + m / 5) / Math.log10(1 + MAX_RANGE_M / 5);

function drawBase() {
  const c = $("mcMap").getContext("2d");
  c.fillStyle = "#05060a"; c.fillRect(0, 0, SIZE, SIZE);
  c.strokeStyle = "rgba(255,255,255,.12)"; c.fillStyle = "#9aa1ad"; c.font = `11px ${css("--font-data")}`;
  for (const [m, label] of [[100, "100 m"], [1000, "1 km"], [10000, "10 km"], [100000, "100 km"]]) {
    c.beginPath(); c.arc(SIZE / 2, SIZE / 2, mapRadius(m), 0, Math.PI * 2); c.stroke();
    c.fillText(label, SIZE / 2 + mapRadius(m) * .71 + 4, SIZE / 2 - mapRadius(m) * .71);
  }
  c.strokeStyle = css("--data-hi"); c.lineWidth = 2; c.setLineDash([6, 4]);
  c.beginPath(); c.arc(SIZE / 2, SIZE / 2, mapRadius(targetDistance()), 0, Math.PI * 2); c.stroke();
  c.setLineDash([]); c.lineWidth = 1;
  drawLanderIcon(c, SIZE / 2, SIZE / 2 + 8, .7);
  return c;
}

export function drawMiniMc() {
  drawBase().drawImage(mc.dots, 0, 0);
  $("mcN").textContent = mc.n.toLocaleString("en");
  $("mcHits").textContent = mc.hits.toLocaleString("en");
  if (mc.n) {
    const p = mc.hits / mc.n, se = 1.96 * Math.sqrt(Math.max(p * (1 - p), 1e-12) / mc.n);
    $("mcEst").textContent = `${Math.round(p * 1e6).toLocaleString("en")} ± ${Math.round(se * 1e6).toLocaleString("en")}`;
  } else $("mcEst").textContent = "–";
  drawEstimateChart();
}

function drawEstimateChart() {
  const svg = $("mcChart"), w = 420, h = 200, m = { l: 52, r: 10, t: 10, b: 30 }, hist = mc.history;
  if (!hist.length) {
    svg.innerHTML = `<text x="${w / 2}" y="${h / 2}" text-anchor="middle">throw some grains to see the estimate settle</text>`;
    return;
  }
  const xmax = Math.max(1000, hist[hist.length - 1][0]);
  const X = (n) => m.l + Math.log10(n) / Math.log10(xmax) * (w - m.l - m.r);
  const ymax = Math.max(...hist.flatMap(([, p, s]) => [p + s]), 1) * 1.1;
  const Y = (v) => m.t + (1 - v / ymax) * (h - m.t - m.b);
  let out = "";
  for (let k = 0; k <= 4; k++) {
    const v = ymax * k / 4;
    out += `<line x1="${m.l}" x2="${w - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/>`
      + `<text x="${m.l - 6}" y="${Y(v) + 3}" text-anchor="end">${Math.round(v).toLocaleString("en")}</text>`;
  }
  for (const n of [10, 100, 1000, 10000, 100000]) if (n <= xmax) out += `<text x="${X(n)}" y="${h - 14}" text-anchor="middle">${n.toLocaleString("en")}</text>`;
  const top = hist.map(([n, p, s]) => `${X(n)},${Y(p + s)}`), bottom = hist.map(([n, p, s]) => `${X(n)},${Y(Math.max(0, p - s))}`).reverse();
  out += `<path d="M${top.join("L")}L${bottom.join("L")}Z" fill="var(--data-hi)" fill-opacity=".18"/>`;
  out += `<path d="M${hist.map(([n, p]) => `${X(n)},${Y(p)}`).join("L")}" fill="none" stroke="var(--data-hi)" stroke-width="2"/>`;
  out += `<text class="t-axis" x="${w - m.r}" y="${h - 1}" text-anchor="end">grains thrown (log scale)</text>`;
  out += `<text class="t-axis" transform="translate(11 ${(m.t + h - m.b) / 2}) rotate(-90)" text-anchor="middle">hits per million</text>`;
  svg.innerHTML = out;
}

export function resetMiniMc() {
  Object.assign(mc, { n: 0, hits: 0, history: [], todo: 0, running: false });
  mc.dots = document.createElement("canvas"); mc.dots.width = mc.dots.height = SIZE;
  drawMiniMc();
}

export function throwGrains(count) {
  mc.todo += count; mc.perFrame = Math.max(mc.perFrame, Math.ceil(count / 70));
  if (mc.running) return;
  mc.running = true;
  const hiColor = css("--data-hi");
  const step = () => {
    const k = Math.min(mc.todo, mc.perFrame), c = mc.dots.getContext("2d"), dist = targetDistance();
    for (let i = 0; i < k; i++) {
      const g = throwGrain(dist); mc.n++; if (g.hit) mc.hits++;
      const a = Math.random() * Math.PI * 2, rr = g.orbit ? RADIUS + 4 : mapRadius(Math.min(g.range, MAX_RANGE_M));
      c.fillStyle = g.hit ? hiColor : g.D < 10 ? "rgba(170,205,255,.35)" : g.D < 100 ? "rgba(232,224,206,.35)" : "rgba(255,159,69,.45)";
      c.fillRect(SIZE / 2 + Math.cos(a) * rr, SIZE / 2 + Math.sin(a) * rr, g.hit ? 3 : 1.6, g.hit ? 3 : 1.6);
      if (g.hit) {
        c.strokeStyle = hiColor; c.globalAlpha = .5;
        c.beginPath(); c.moveTo(SIZE / 2, SIZE / 2); c.lineTo(SIZE / 2 + Math.cos(a) * mapRadius(dist), SIZE / 2 + Math.sin(a) * mapRadius(dist)); c.stroke();
        c.globalAlpha = 1;
      }
    }
    mc.todo -= k;
    const p = mc.hits / mc.n;
    mc.history.push([mc.n, p * 1e6, 1.96 * Math.sqrt(Math.max(p * (1 - p), 1e-12) / mc.n) * 1e6]);
    drawMiniMc();
    if (mc.todo > 0 && !document.hidden) requestAnimationFrame(step); else { mc.running = false; mc.perFrame = 0; }
  };
  requestAnimationFrame(step);
}

export function initMiniMc() {
  $("mc1k").onclick = () => throwGrains(1000);
  $("mc10k").onclick = () => throwGrains(10000);
  $("mcReset").onclick = resetMiniMc;
  $("mcDist").onchange = resetMiniMc;
  resetMiniMc();
}