/* Chapter 4, station 1: the sandblast map.
   Pick a site and a lander, tap to place the landing; the rings show where
   exposure drops below 1x, 0.1x and 0.01x of what Surveyor 3 got.

   Sections: state and controls · replay animation · drawing · pointer and zoom
   · readouts under the map (rings, objects, chart) · full screen · init. */

import {
  APOLLO_THRUST_N, DESCENT_CUTOFF_M, DESCENT_RATE, DESCENT_TOP_M, DISTANCES, FILTER, GRID_MAX, GRID_MIN,
  HEIGHTS, LANDERS, LANDING_COUNTS, LEVELS, MEASURED, OUTSIDE_RANGE_WHY, SITES, dustThrownAt, landerIndex,
  landerShortName, outsideRange,
} from "./data.js";
import { $, css, fmtD, fmtN, interpLog, reducedMotion, seededRandom } from "./util.js";
import { STATUS, fmtDist, ringIndex, ringsFor } from "./exposure.js";
import { logChart } from "./logchart.js";

/* =============================================================== state */
// alt: lander altitude (0 = landed); dustFrac: share of the landing's ejecta thrown so far.
const mapState = {
  site: 0, lander: landerIndex(APOLLO_THRUST_N), height: 1, count: 0,
  L: [0, 0], alt: 0, dustFrac: 1, engineOn: false,
  view: { cx: 0, cy: 0, half: 400 },
};
let descentAnim = 0;

function selection() {
  return { lander: LANDERS[mapState.lander], landings: LANDING_COUNTS[mapState.count], hKey: HEIGHTS[mapState.height] };
}
const currentRings = () => {
  const { lander, landings, hKey } = selection();
  return ringsFor(lander, hKey, landings);
};

export function selectSite(i) {
  const s = SITES[i];
  stopDescent();
  mapState.alt = 0; mapState.dustFrac = 1; mapState.engineOn = false;
  hideReadout(); $("alt").hidden = true;
  mapState.site = i; mapState.L = [...s.lander];
  const li = landerIndex(s.thrust);
  if (li >= 0) mapState.lander = li;
  fitView(); renderMap();
}

// Used by the advisor and the heritage gallery: put a landing on the map and show it.
export function showLandingOnMap({ site, lander, at }) {
  selectSite(site);
  if (lander != null) mapState.lander = lander;
  if (at) mapState.L = [...at];
  fitView(); renderMap();
}

function buildControls() {
  SITES.forEach((s, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.id = "site-" + s.id;
    b.innerHTML = `${s.name}<small>${s.sub}</small>`;
    b.onclick = () => selectSite(i);
    $("sites").appendChild(b);
  });
  LANDERS.forEach((l, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.id = "lander-" + i;
    b.innerHTML = `<span>${landerShortName(l)}${outsideRange(l) ? "<small class='out'>outside modelled range</small>" : ""}</span>`
      + `<span class="kn">${(l.thrust_N / 1000).toLocaleString("en")} kN</span>`;
    b.onclick = () => { mapState.lander = i; fitView(); renderMap(); };
    $("landers").appendChild(b);
  });
  $("height").oninput = (e) => { mapState.height = +e.target.value; renderMap(); };
  $("count").oninput = (e) => { mapState.count = +e.target.value; renderMap(); };
}

/* ====================================================== replay animation */
const APOLLO_TEXT = `<p><b>Houston, Intrepid has landed.</b> 19 Nov 1969, 155 m from Surveyor 3. Back home the lab counts about ${MEASURED} pits per cm² on the side that faced the lander. Every ring on this map is scaled to that number.</p>`;
const T_APPROACH = 2600, T_DESCENT = 8200, T_DROP = 1500, T_HOLD = 500;    // ms; the real descent from 34 m takes about a minute

function stopDescent() { if (descentAnim) cancelAnimationFrame(descentAnim); descentAnim = 0; }

function drawAltimeter(phase) {
  const h = mapState.alt;
  $("altVal").textContent = h.toFixed(1);
  $("altMark").style.bottom = `${Math.min(h / DESCENT_TOP_M, 1) * 100}%`;
  $("altDust").textContent = `${Math.round(mapState.dustFrac * 100)}%`;
  $("altTime").textContent = h > DESCENT_CUTOFF_M ? `${Math.round((h - DESCENT_CUTOFF_M) / DESCENT_RATE)} s` : "0 s";
  $("altPhase").textContent = phase;
}

// Fly the lander from `from` to `to`; the rings grow with the share of dust thrown.
function runDescent(to, from, doneLabel, onDone) {
  stopDescent(); hideReadout();
  $("alt").hidden = false;
  const finish = () => {
    descentAnim = 0;
    Object.assign(mapState, { L: [...to], alt: 0, dustFrac: 1, engineOn: false });
    drawAltimeter(doneLabel); renderMap();
    if (onDone) onDone();
  };
  if (reducedMotion()) { finish(); return; }
  Object.assign(mapState, { L: [...from], alt: DESCENT_TOP_M, dustFrac: 0, engineOn: true });
  drawMap(); drawAltimeter("Approach");
  const ease = (x) => (x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  let t0 = 0, phase;
  const step = (now) => {
    if (!t0) t0 = now;
    const t = now - t0;
    if (t < T_APPROACH) {                                       // pitch-over approach, 34 -> 30 m
      const a = ease(t / T_APPROACH);
      mapState.L = [from[0] + (to[0] - from[0]) * a, from[1] + (to[1] - from[1]) * a];
      mapState.alt = DESCENT_TOP_M - 4 * a; phase = "Approach"; mapState.engineOn = true;
    } else if (t < T_APPROACH + T_DESCENT) {                    // vertical descent, slowing down
      const u = (t - T_APPROACH) / T_DESCENT;
      mapState.L = [...to];
      mapState.alt = DESCENT_CUTOFF_M + (DESCENT_TOP_M - 4 - DESCENT_CUTOFF_M) * Math.pow(1 - u, 2.2);
      phase = mapState.alt < 6 ? "Final metres" : "Descent"; mapState.engineOn = true;
    } else if (t < T_APPROACH + T_DESCENT + T_DROP) {           // contact light: engine off, falls (animation only)
      const u = (t - T_APPROACH - T_DESCENT) / T_DROP;
      mapState.alt = DESCENT_CUTOFF_M * (1 - u * u); phase = "Contact light · engine stop"; mapState.engineOn = false;
    } else if (t < T_APPROACH + T_DESCENT + T_DROP + T_HOLD) {
      mapState.alt = 0; mapState.engineOn = false;
    } else { finish(); return; }
    mapState.dustFrac = dustThrownAt(mapState.alt);
    drawMap(); drawAltimeter(phase);
    descentAnim = requestAnimationFrame(step);
  };
  descentAnim = requestAnimationFrame(step);
}

export function replayApollo() {
  if (mapState.site !== 0) { mapState.site = 0; mapState.L = [...SITES[0].lander]; }
  Object.assign(mapState, { count: 0, height: 1, dustFrac: 1, lander: landerIndex(APOLLO_THRUST_N) });
  $("count").value = 0; $("height").value = 1;
  renderMap();
  let from = [...mapState.L];
  if (Math.hypot(from[0], from[1]) < 40) from = [-380, -520];  // always fly in from somewhere
  mapState.L = [0, 0]; fitView();                               // final view; stays fixed during the replay
  mapState.view.half = Math.max(mapState.view.half, Math.hypot(from[0], from[1]) * 1.35);
  mapState.view.cx = from[0] * 0.3; mapState.view.cy = from[1] * 0.3;
  runDescent([0, 0], from, "Touchdown · 19 Nov 1969", () => {
    showReadout(APOLLO_TEXT);
    const row = document.querySelector(".obj[data-calib]");
    if (row) { row.classList.remove("flash"); void row.offsetWidth; row.classList.add("flash"); }
  });
}

function showReadout(html) {
  const box = $("banner");
  $("bannerBody").innerHTML = html;
  box.hidden = false; box.classList.remove("show"); void box.offsetWidth; box.classList.add("show");
}
const hideReadout = () => { $("banner").hidden = true; };

/* ============================================================= drawing */
const canvas = () => $("map");
let ctx = null, W = 0, H = 0, DPR = 1, viewBusy = false;

function resizeMap() {
  const r = canvas().getBoundingClientRect();
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = r.width; H = r.height;
  canvas().width = Math.round(W * DPR); canvas().height = Math.round(H * DPR);
  drawMap();
}
const metresPerPx = () => mapState.view.half / (W / 2);
const toPx = (x, y) => [W / 2 + (x - mapState.view.cx) / metresPerPx(), H / 2 - (y - mapState.view.cy) / metresPerPx()];
const toWorld = (px, py) => [mapState.view.cx + (px - W / 2) * metresPerPx(), mapState.view.cy - (py - H / 2) * metresPerPx()];

// Zoom so that the 0.1x ring and every object of the site are in view.
function fitView() {
  const s = SITES[mapState.site];
  let reach = 150;
  for (const o of s.objects) reach = Math.max(reach, Math.hypot(o.pos[0] - mapState.L[0], o.pos[1] - mapState.L[1]) * 1.25);
  const r2 = currentRings()[1].med;
  if (isFinite(r2)) reach = Math.max(reach, r2 * 1.15);
  mapState.view.half = Math.min(Math.max(reach, 120), 14000);
  mapState.view.cx = mapState.L[0]; mapState.view.cy = mapState.L[1];
}

// Procedural regolith: crater tiles at several scales, seeded per site.
let grainTile = null;
function drawTerrain(c) {
  c.fillStyle = "#77736c"; c.fillRect(0, 0, W, H);
  if (!grainTile) {
    grainTile = document.createElement("canvas"); grainTile.width = grainTile.height = 128;
    const g = grainTile.getContext("2d"), img = g.createImageData(128, 128), rnd = seededRandom(1, 2, 3, 4);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 100 + rnd() * 40;
      img.data[i] = v; img.data[i + 1] = v - 3; img.data[i + 2] = v - 8; img.data[i + 3] = 26;
    }
    g.putImageData(img, 0, 0);
  }
  c.fillStyle = c.createPattern(grainTile, "repeat"); c.fillRect(0, 0, W, H);
  const mpp = metresPerPx(), seed = SITES[mapState.site].seed;
  const [x0, y1] = toWorld(0, 0), [x1, y0] = toWorld(W, H);
  for (let lvl = 0; lvl < 7; lvl++) {
    const tile = 40 * Math.pow(4, lvl), rMax = tile / 7;
    if (rMax / mpp < 1.2 || tile / mpp > W * 6) continue;       // too small to see, or far bigger than the view
    for (let ix = Math.floor(x0 / tile) - 1; ix <= Math.floor(x1 / tile) + 1; ix++) {
      for (let iy = Math.floor(y0 / tile) - 1; iy <= Math.floor(y1 / tile) + 1; iy++) {
        const rnd = seededRandom(seed, lvl, ix, iy);
        for (let k = 0, n = 2 + Math.floor(rnd() * 3); k < n; k++) {
          const cx = (ix + rnd()) * tile, cy = (iy + rnd()) * tile, rr = rMax * (0.25 + 0.75 * Math.pow(rnd(), 2.2));
          const [px, py] = toPx(cx, cy), pr = rr / mpp;
          if (pr < 1 || px < -pr || py < -pr || px > W + pr || py > H + pr) continue;
          const g = c.createRadialGradient(px + pr * .35, py + pr * .3, pr * .1, px, py, pr);
          g.addColorStop(0, "rgba(40,38,35,.28)"); g.addColorStop(.75, "rgba(55,52,48,.18)"); g.addColorStop(1, "rgba(0,0,0,0)");
          c.fillStyle = g; c.beginPath(); c.arc(px, py, pr, 0, Math.PI * 2); c.fill();
          c.strokeStyle = "rgba(225,220,210,.32)"; c.lineWidth = Math.max(1, pr * .08);
          c.beginPath(); c.arc(px, py, pr * .92, Math.PI * .65, Math.PI * 1.45); c.stroke();
        }
      }
    }
  }
}

// Terrain is expensive, so it is cached while the view stands still. While the
// view moves, the cached image is scaled and shifted; it is redrawn once it settles.
const terrain = { canvas: null, key: "", view: null };
function drawTerrainCached(c, quick) {
  const v = mapState.view, key = [mapState.site, W, H, DPR].join("|");
  const same = (t) => t && t.cx === v.cx && t.cy === v.cy && t.half === v.half;
  if (key !== terrain.key || !terrain.view || (!quick && !same(terrain.view))) {
    terrain.canvas ||= document.createElement("canvas");
    terrain.canvas.width = canvas().width; terrain.canvas.height = canvas().height;
    const tc = terrain.canvas.getContext("2d");
    tc.setTransform(DPR, 0, 0, DPR, 0, 0); drawTerrain(tc);
    terrain.key = key; terrain.view = { ...v };
  }
  if (same(terrain.view)) { c.drawImage(terrain.canvas, 0, 0, W, H); return; }
  const s = terrain.view.half / v.half, [px, py] = toPx(terrain.view.cx, terrain.view.cy);
  c.fillStyle = "#77736c"; c.fillRect(0, 0, W, H);
  c.drawImage(terrain.canvas, px - W / 2 * s, py - H / 2 * s, W * s, H * s);
}

function drawRings(c, rings) {
  if (mapState.dustFrac <= 0.002) return;
  const [lx, ly] = toPx(...mapState.L), mpp = metresPerPx(), tint = ["38", "26", "1a"];
  for (let i = rings.length - 1; i >= 0; i--) {                 // tinted zones, outer first
    const r = rings[i], rad = isFinite(r.med) ? r.med / mpp : Math.max(W, H) * 2;
    c.fillStyle = css(r.col) + tint[i]; c.beginPath(); c.arc(lx, ly, rad, 0, Math.PI * 2); c.fill();
  }
  c.lineWidth = 1.2; c.setLineDash([4, 6]);                     // spread: smallest and largest version
  for (const r of rings) {
    c.strokeStyle = css(r.col) + "aa";
    for (const v of [r.lo, r.hi]) if (isFinite(v)) { c.beginPath(); c.arc(lx, ly, v / mpp, 0, Math.PI * 2); c.stroke(); }
  }
  c.setLineDash([]);
  rings.forEach((r, i) => {                                     // median rings with labels
    if (!isFinite(r.med)) return;
    const col = css(r.col), rp = r.med / mpp;
    c.strokeStyle = col; c.lineWidth = 2.5; c.beginPath(); c.arc(lx, ly, rp, 0, Math.PI * 2); c.stroke();
    const a = -Math.PI / 4 - i * 0.18, tx = lx + Math.cos(a) * rp, ty = ly + Math.sin(a) * rp;
    if (tx > 0 && tx < W && ty > 0 && ty < H) {
      const t = `${r.f}× · ${fmtD(r.med)}`;
      c.font = `600 12px ${css("--font-data")}`;
      c.fillStyle = "rgba(20,22,24,.8)"; c.fillRect(tx + 4, ty - 18, c.measureText(t).width + 10, 18);
      c.fillStyle = col; c.fillText(t, tx + 9, ty - 5);
    }
  });
}

function drawObjects(c) {
  c.font = `500 12px ${css("--font-body")}`;
  const marks = SITES[mapState.site].objects
    .filter((o) => Math.hypot(o.pos[0] - mapState.L[0], o.pos[1] - mapState.L[1]) >= 10)   // the lander stands on it
    .map((o) => { const [px, py] = toPx(...o.pos); return { o, px, py, ly: py }; })
    .sort((a, b) => a.py - b.py);
  // Labels sit right of their marker; push a label down if it would overlap the one above.
  for (let i = 1; i < marks.length; i++) {
    const a = marks[i - 1], b = marks[i];
    if (Math.abs(a.px - b.px) < 160 && b.ly - a.ly < 20) b.ly = a.ly + 20;
  }
  for (const { o, px, py, ly } of marks) {
    c.fillStyle = "#f4f2ec"; c.strokeStyle = "#1a1c1e"; c.lineWidth = 2;
    c.beginPath(); c.rect(px - 5, py - 5, 10, 10); c.fill(); c.stroke();
    if (ly !== py) { c.strokeStyle = "rgba(244,242,236,.7)"; c.lineWidth = 1; c.beginPath(); c.moveTo(px + 5, py); c.lineTo(px + 9, ly); c.stroke(); }
    c.fillStyle = "rgba(20,22,24,.78)"; c.fillRect(px + 9, ly - 9, c.measureText(o.name).width + 10, 18);
    c.fillStyle = "#f4f2ec"; c.fillText(o.name, px + 14, ly + 4);
  }
}

function drawLander(c) {
  const [lx, ly] = toPx(...mapState.L), h = mapState.alt;
  if (h > 0.05) { c.fillStyle = "rgba(10,10,10,.38)"; c.beginPath(); c.ellipse(lx, ly, 11, 6, 0, 0, Math.PI * 2); c.fill(); }
  c.save(); c.translate(lx, ly - h * 2.2);
  const sc = 1 + Math.min(h, 34) / 34 * 0.7; c.scale(sc, sc);
  if (mapState.engineOn) {
    const g = c.createRadialGradient(0, 6, 0, 0, 6, 12);
    g.addColorStop(0, "rgba(255,240,200,.9)"); g.addColorStop(1, "rgba(255,200,120,0)");
    c.fillStyle = g; c.beginPath(); c.arc(0, 6, 12, 0, Math.PI * 2); c.fill();
  }
  c.strokeStyle = "#1a1c1e"; c.lineWidth = 2;
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2;
    c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * 13, Math.sin(a) * 13); c.stroke();
    c.beginPath(); c.arc(Math.cos(a) * 13, Math.sin(a) * 13, 2.5, 0, Math.PI * 2); c.fillStyle = "#1a1c1e"; c.fill();
  }
  c.fillStyle = "#ffd25a"; c.beginPath(); c.moveTo(0, -8); c.lineTo(7, 5); c.lineTo(-7, 5); c.closePath(); c.fill(); c.stroke();
  c.restore();
}

// Purely visual dust streaks while the engine fires.
const sprayParticles = Array.from({ length: 180 }, () => ({ a: Math.random() * Math.PI * 2, o: Math.random(), s: 0.6 + Math.random() * 0.9 }));
function drawSpray(c) {
  if (!mapState.engineOn) return;
  const [lx, ly] = toPx(...mapState.L), reach = Math.min(W, H) * 0.48, t = performance.now() / 1000;
  const strength = Math.min(Math.max((34 - mapState.alt) / 30, 0.12), 1);
  c.lineWidth = 1.4;
  for (const p of sprayParticles) {
    const f = (t * 0.8 * p.s + p.o) % 1, r0 = 4 + f * reach, r1 = r0 + 5 + 10 * f;
    c.strokeStyle = `rgba(232,224,206,${((1 - f) * 0.6 * strength).toFixed(3)})`;
    c.beginPath(); c.moveTo(lx + Math.cos(p.a) * r0, ly + Math.sin(p.a) * r0); c.lineTo(lx + Math.cos(p.a) * r1, ly + Math.sin(p.a) * r1); c.stroke();
  }
}

function drawScaleBar() {
  const mpp = metresPerPx(), target = mpp * 110, p = Math.pow(10, Math.floor(Math.log10(target)));
  const nice = [10, 5, 2, 1].map((k) => k * p).find((v) => v <= target) || p;
  $("scalebar").style.width = (nice / mpp) + "px";
  $("scaletxt").textContent = fmtD(nice);
}

function drawMap() {
  if (!W) return;
  ctx ||= canvas().getContext("2d");
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawTerrainCached(ctx, viewBusy);
  const { lander, landings, hKey } = selection();
  drawRings(ctx, ringsFor(lander, hKey, landings * mapState.dustFrac));
  drawSpray(ctx); drawLander(ctx); drawObjects(ctx);   // labels last, so the lander never covers them
  drawScaleBar();
}

/* ====================================================== pointer and zoom */
let settleTimer = 0, zoomAnim = 0, zoomGoal = null;
function viewMoved() {
  viewBusy = true; drawMap();
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => { viewBusy = false; drawMap(); }, 160);
}
const clampHalf = (h) => Math.min(Math.max(h, 40), 14000);
function anchorView(half, px, py, ax, ay) {                    // keep world point (ax, ay) under screen point (px, py)
  mapState.view.half = half;
  mapState.view.cx = ax - (px - W / 2) / (W / 2) * half;
  mapState.view.cy = ay + (py - H / 2) / (W / 2) * half;
}
function zoomAt(k, px = W / 2, py = H / 2) {
  const [ax, ay] = toWorld(px, py);
  zoomGoal = { half: clampHalf((zoomGoal ? zoomGoal.half : mapState.view.half) * k), px, py, ax, ay };
  if (!zoomAnim) zoomAnim = requestAnimationFrame(zoomStep);
}
function zoomStep() {
  zoomAnim = 0;
  const g = zoomGoal; if (!g) return;
  const lh = Math.log(mapState.view.half), lt = Math.log(g.half), done = Math.abs(lt - lh) < 0.004;
  anchorView(done ? g.half : Math.exp(lh + (lt - lh) * 0.3), g.px, g.py, g.ax, g.ay);
  viewMoved();
  if (done) zoomGoal = null; else zoomAnim = requestAnimationFrame(zoomStep);
}
function flyTo(v, ms = 600) {
  zoomGoal = null; if (zoomAnim) cancelAnimationFrame(zoomAnim);
  if (!W || reducedMotion()) { Object.assign(mapState.view, v); drawMap(); return; }
  const a = { ...mapState.view }, t0 = performance.now(), ease = (x) => 1 - Math.pow(1 - x, 3);
  const step = (now) => {
    const u = Math.min((now - t0) / ms, 1), e = ease(u);
    mapState.view.cx = a.cx + (v.cx - a.cx) * e; mapState.view.cy = a.cy + (v.cy - a.cy) * e;
    mapState.view.half = Math.exp(Math.log(a.half) + (Math.log(v.half) - Math.log(a.half)) * e);
    viewMoved();
    zoomAnim = u < 1 ? requestAnimationFrame(step) : 0;
  };
  zoomAnim = requestAnimationFrame(step);
}

// Tap places the lander, drag pans, wheel / pinch / buttons zoom.
function bindPointer() {
  const cv = canvas(), pointers = new Map();
  let drag = null, pinch = null;
  const rel = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const hideHint = () => $("hint").classList.add("gone");
  cv.addEventListener("pointerdown", (e) => {
    hideHint();
    pointers.set(e.pointerId, rel(e));
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or lost pointer */ }
    if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, cx: mapState.view.cx, cy: mapState.view.cy, moved: false };
    else if (pointers.size === 2) {                                // two fingers: pinch zoom
      if (drag) drag.moved = true;
      const [a, b] = [...pointers.values()], [ax, ay] = toWorld((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, half: mapState.view.half, ax, ay };
      zoomGoal = null;
    }
  });
  cv.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, rel(e));
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
      anchorView(clampHalf(pinch.half * pinch.d / d), (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, pinch.ax, pinch.ay);
      viewMoved(); return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) > 4) drag.moved = true;
    if (drag.moved) {
      const m = metresPerPx();
      mapState.view.cx = drag.cx - dx * m; mapState.view.cy = drag.cy + dy * m; viewMoved();
    }
  });
  const end = (e, tap) => {
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; drag = null; return; }
    if (tap && drag && !drag.moved && !descentAnim) { mapState.L = toWorld(...rel(e)); hideReadout(); renderMap(); }
    drag = null;
  };
  cv.addEventListener("pointerup", (e) => end(e, true));
  cv.addEventListener("pointercancel", (e) => end(e, false));
  cv.addEventListener("wheel", (e) => {
    e.preventDefault(); hideHint();
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    zoomAt(Math.exp(Math.max(-120, Math.min(120, dy)) * 0.0024), ...rel(e));
  }, { passive: false });
  $("zin").onclick = () => zoomAt(0.6);
  $("zout").onclick = () => zoomAt(1 / 0.6);
  $("zfit").onclick = () => { const keep = { ...mapState.view }; fitView(); const goal = { ...mapState.view }; Object.assign(mapState.view, keep); flyTo(goal); };
}

/* ================================================ readouts under the map */
const isCalibrationPoint = (o, lander, landings, d) =>
  o.calib && lander.thrust_N === APOLLO_THRUST_N && landings === 1 && Math.abs(d - 155) < 3;

function renderObjects() {
  const { lander, landings, hKey } = selection();
  const rows = SITES[mapState.site].objects.map((o) => {
    const d = Math.hypot(o.pos[0] - mapState.L[0], o.pos[1] - mapState.L[1]);
    const calib = o.calib ? ` data-calib="1"` : "";
    if (d < 10) return `<div class="obj"${calib}><b>${o.name}</b><span class="chip c0">landing site</span><div class="meta">${o.note}</div></div>`;
    const hk = o.heightKey || hKey, curve = lander.by_height[hk].exposure;
    const med = interpLog(DISTANCES, curve.median, d), lo = interpLog(DISTANCES, curve.min, d), hi = interpLog(DISTANCES, curve.max, d);
    const ratio = med == null ? null : med * landings / MEASURED;
    // The status comes from the same rings the map draws, so list and map agree.
    const st = isCalibrationPoint(o, lander, landings, d)
      ? { cls: "c1", txt: `1969: measured ${MEASURED} pits/cm²` }
      : STATUS[ringIndex(ringsFor(lander, hk, landings), d)];
    const where = d > GRID_MAX ? ` · beyond the model grid, value at ${fmtD(GRID_MAX)} shown` : d < GRID_MIN ? " · closer than the model grid" : "";
    const calibNote = isCalibrationPoint(o, lander, landings, d) ? " · calibration point: 1× by definition" : "";
    return `<div class="obj"${calib}><b>${o.name}</b><span class="chip ${st.cls}">${st.txt}</span>
      <div class="meta">${fmtD(d)} away · ${fmtN(med * landings)} impacts/cm² (versions: ${fmtN(lo * landings)}–${fmtN(hi * landings)}) · ${fmtN(ratio)}× Surveyor 3${calibNote}${where}</div>
      <div class="meta prose">${o.note} · ${o.heightKey ? "evaluated 3 m below the plain" : `hardware ${hKey} m tall`}</div></div>`;
  });
  $("objects").innerHTML = rows.join("");
}

function renderRingList() {
  const { lander } = selection();
  $("rings").innerHTML = '<span class="label">Rings around this landing</span>' + currentRings().map((r) => `
    <div class="ring-row" style="color:var(${r.col})"><span class="sw"></span>
      <span class="fg">${r.name} <span class="muted">(${r.f}×)</span></span>
      <span class="num">${fmtDist(r.med)}<small>${fmtDist(r.lo)} – ${fmtDist(r.hi)}</small></span></div>`).join("");
  const warn = $("ringWarn");
  warn.hidden = !outsideRange(lander);
  warn.innerHTML = `<b>Outside the modelled range.</b> ${OUTSIDE_RANGE_WHY} How the distance changes with lander size depends on our scaling assumptions, not on data. Read these rings as an illustration, not an estimate.`;
}

function renderChart() {
  const { lander, landings, hKey } = selection(), c = lander.by_height[hKey].exposure;
  const ch = logChart([...c.min, ...c.max].map((v) => (v == null ? 0 : v * landings)), { floor: MEASURED * 0.01, ceil: MEASURED * 10 });
  let out = ch.axes;
  const top = DISTANCES.map((d, i) => (c.max[i] > 0 ? `${ch.X(d)},${ch.Y(c.max[i] * landings)}` : null)).filter(Boolean);
  const bottom = DISTANCES.map((d, i) => (c.min[i] > 0 ? `${ch.X(d)},${ch.Y(c.min[i] * landings)}` : null)).filter(Boolean).reverse();
  if (top.length && bottom.length) out += `<path d="M${top.join("L")}L${bottom.join("L")}Z" fill="var(--data-hi)" fill-opacity=".16"/>`;
  out += `<path d="${ch.path(c.median, landings)}" fill="none" stroke="var(--data-hi)" stroke-width="2.2"/>`;
  for (const lv of LEVELS) out += ch.level(lv.f * MEASURED, `var(${lv.col})`, `${lv.f}× Surveyor 3`);
  for (const o of SITES[mapState.site].objects) {
    const d = Math.hypot(o.pos[0] - mapState.L[0], o.pos[1] - mapState.L[1]);
    if (d < 10 || d < GRID_MIN || d > GRID_MAX) continue;
    const v = interpLog(DISTANCES, lander.by_height[o.heightKey || hKey].exposure.median, d);
    if (!(v > 0)) continue;
    const y = Math.min(Math.max(ch.Y(v * landings), ch.top), ch.bottom);
    out += `<circle cx="${ch.X(d)}" cy="${y}" r="4.5" fill="var(--fg)" stroke="var(--panel)" stroke-width="2"/>`
      + `<text x="${ch.X(d) + 7}" y="${y - 6}" style="fill:var(--fg)">${o.name}${o.heightKey ? ` (at ${o.heightKey} m)` : ""}</text>`;
  }
  $("chart").innerHTML = out;
  $("chartNote").textContent = `${lander.name}, hardware ${hKey} m tall, ${landings} landing${landings > 1 ? "s" : ""}. `
    + `Line = median of ${lander.by_height[hKey].n_branches} model versions`
    + (FILTER ? ` that pass the pit test (${FILTER.n_kept} of ${FILTER.n_total})` : "")
    + "; band = smallest to largest version.";
}

export function renderMap() {
  SITES.forEach((s, i) => $("site-" + s.id).setAttribute("aria-pressed", i === mapState.site));
  LANDERS.forEach((_, i) => $("lander-" + i).setAttribute("aria-pressed", i === mapState.lander));
  drawMap(); renderRingList(); renderObjects(); renderChart();
}

/* ========================================================== full screen */
function bindFullscreen() {
  const box = $("mapbox"), btn = $("zfull");
  const closeMax = () => { box.classList.remove("map-max"); document.body.classList.remove("map-open"); btn.textContent = "⛶"; };
  btn.onclick = async () => {
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    if (box.classList.contains("map-max")) { closeMax(); return; }
    try {
      if (!box.requestFullscreen) throw new Error("no fullscreen API");
      await box.requestFullscreen();
    } catch (e) {                                               // e.g. iPhone: fill the window instead
      box.classList.add("map-max"); document.body.classList.add("map-open"); btn.textContent = "✕";
    }
  };
  document.addEventListener("fullscreenchange", () => { btn.textContent = document.fullscreenElement ? "✕" : "⛶"; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && box.classList.contains("map-max")) closeMax(); });
}

/* ================================================================ init */
export function refreshMap() { resizeMap(); renderMap(); }   // the map was hidden: size it now

export function initMap() {
  buildControls(); bindPointer(); bindFullscreen();
  $("replay").onclick = replayApollo;
  $("bannerClose").onclick = hideReadout;
  new ResizeObserver(resizeMap).observe($("mapbox"));
  selectSite(0);
}