const APP_DATA = __APP_DATA__;

/* ------------------------------------------------------------------ data */
const D = APP_DATA;
const R = D.distances_m;
const MEAS = D.anchor.measured_per_cm2;
const HEIGHTS = ["0", "1.5", "3", "5", "8"];
const COUNTS = [1, 3, 10, 30, 100];
const THR = [{f: 1, cls: "c1", col: "--r1", name: "Surveyor 3 level"},
             {f: 0.1, cls: "c2", col: "--r2", name: "10× less"},
             {f: 0.01, cls: "c3", col: "--r3", name: "100× less"}];

// Positions in metres east / north of each site's reference point, from LRO-based
// coordinates in NASA's NSSDCA catalogue (1 degree = 30.32 km on the Moon):
//   Apollo 12 LM 3.0128 S 23.4219 W; Surveyor 3 3.0162 S 336.582 E; Apollo 12 ALSEP 3.0098 S 23.4249 W
//   Apollo 11 LM 0.67416 N 23.47314 E; Apollo 11 LRRR 0.67345 N 23.47307 E
// The south-pole base is hypothetical.
const SITES = [
  { id: "a12", name: "Apollo 12 & Surveyor 3", sub: "Ocean of Storms · 1969", seed: 12,
    lander: [-380, -520], thrust: 11600,
    objects: [
      { name: "Surveyor 3", note: "157 m from the lander, in a ~200 m crater about 3 m below the plain", pos: [118, -103], heightKey: "-3", calib: true },
      { name: "Apollo 12 descent stage", note: "Intrepid, historic landing point", pos: [0, 0], historic: true },
      { name: "Apollo 12 ALSEP", note: "science station, set up after the 1969 landing (so that dust missed it); ran until 1977 and carried a dust detector", pos: [-91, 91] },
    ] },
  { id: "a11", name: "Apollo 11", sub: "Tranquility Base · heritage site", seed: 11,
    lander: [0, -2000], thrust: 11600,
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

// alt = lander altitude in m (0 = on the ground), dustFrac = share of the landing's
// total ejecta already thrown (from the simulation's descent profile), engineOn for the dust spray.
const state = { site: 0, lander: 2, height: 1, count: 0, L: [0, 0], alt: 0, dustFrac: 1, engineOn: false,
                view: { cx: 0, cy: 0, half: 400 } };

/* --------------------------------------------------------------- helpers */
const cssCache = {};   // colours are read every frame while animating, so remember them
const css = (v) => (v in cssCache ? cssCache[v] : (cssCache[v] = getComputedStyle(document.documentElement).getPropertyValue(v).trim()));
const fmtD = (m) => m == null ? "—" : (m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 0 : 1) + " km" : Math.round(m) + " m");
function fmtN(x) {
  if (x == null || !isFinite(x)) return "—";
  if (x === 0) return "0";
  if (x >= 1e4 || x < 0.01) return x.toExponential(1).replace("e+", "e");
  return x >= 100 ? Math.round(x).toString() : x.toPrecision(2);
}
function curve(lander, hKey) { return lander.by_height[hKey].exposure; }
function interpLog(xs, ys, x) {
  // log-log interpolation; returns null where data is missing
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
function crossing(xs, ys, thr) {
  // last distance where the curve is still >= thr (same rule as psi_study.practical_distance)
  let last = -1;
  for (let i = 0; i < xs.length; i++) if (ys[i] != null && ys[i] >= thr) last = i;
  if (last === -1) return xs[0];
  if (last === xs.length - 1) return Infinity;
  const y0 = ys[last], y1 = ys[last + 1];
  if (!(y0 > 0 && y1 > 0)) return xs[last + 1];
  const t = (Math.log(thr) - Math.log(y0)) / (Math.log(y1) - Math.log(y0));
  return Math.exp(Math.log(xs[last]) + t * Math.log(xs[last + 1] / xs[last]));
}
function scaled(arr, n) { return arr.map((v) => v == null ? null : v * n); }
function current() {
  const lander = D.landers[state.lander];
  const n = COUNTS[state.count];
  const hKey = HEIGHTS[state.height];
  return { lander, n, hKey };
}
// Variants whose calibrated pit counts match Surveyor 3 (plausible_branches.json)
const KEEP = D.branch_filter && D.branch_filter.applied ? new Set(D.branch_filter.kept) : null;
function medianOf(sorted) {
  const k = sorted.length;
  return k % 2 ? sorted[(k - 1) / 2] : (sorted[k / 2 - 1] + sorted[k / 2]) / 2;
}
// Safe distance per model variant, then median / min / max over the variants:
// the same method as psi_study.distance_band in the Python scripts.
function distanceBand(curves, thr, n = 1) {
  const d = curves.map((y) => crossing(R, scaled(y, n), thr)).sort((a, b) => a - b);
  return { med: medianOf(d), lo: d[0], hi: d[d.length - 1] };
}
function variantCurves(lander, hKey) {
  return Object.entries(lander.by_height[hKey].branches || {})
    .filter(([tag]) => !KEEP || KEEP.has(tag)).map(([, y]) => y);
}
function ringsFor(lander, hKey, n) {
  const vc = variantCurves(lander, hKey);
  if (vc.length) return THR.map((t) => ({ ...t, ...distanceBand(vc, t.f * MEAS, n) }));
  const c = curve(lander, hKey);   // fallback for data without per-variant curves
  return THR.map((t) => ({ ...t,
    med: crossing(R, scaled(c.median, n), t.f * MEAS),
    lo: crossing(R, scaled(c.min, n), t.f * MEAS),
    hi: crossing(R, scaled(c.max, n), t.f * MEAS) }));
}
function status(ratio) {
  if (ratio == null) return { cls: "c0", txt: "no data" };
  if (ratio >= 1) return { cls: "c1", txt: "NO-GO · worse than 1969" };
  if (ratio >= 0.1) return { cls: "c2", txt: "CAUTION · sandblasted" };
  if (ratio >= 0.01) return { cls: "c3", txt: "WATCH · light pitting" };
  return { cls: "c4", txt: "GO · under 1% of 1969" };
}

/* ------------------------------------------------------------- controls */
const sitesEl = document.getElementById("sites");
SITES.forEach((s, i) => {
  const b = document.createElement("button");
  b.type = "button"; b.id = "site-" + s.id;
  b.innerHTML = `${s.name}<small>${s.sub}</small>`;
  b.onclick = () => selectSite(i);
  sitesEl.appendChild(b);
});
const landersEl = document.getElementById("landers");
D.landers.forEach((l, i) => {
  const b = document.createElement("button");
  b.type = "button"; b.id = "lander-" + i;
  const nm = l.name.replace(/^[\d.]+ kN\s*/, "").replace(/[()]/g, "") || "Generic lander";
  const out = l.thrust_N > D.validated_max_thrust_N;
  b.innerHTML = `<span>${nm}${out ? "<small class='out'>outside modelled range</small>" : ""}</span><span class="kn">${(l.thrust_N / 1000).toLocaleString("en")} kN</span>`;
  b.onclick = () => { state.lander = i; fitView(); render(); };
  landersEl.appendChild(b);
});
document.getElementById("height").oninput = (e) => { state.height = +e.target.value; render(); };
document.getElementById("count").oninput = (e) => { state.count = +e.target.value; render(); };
// Replay and test landings: fly a lander down onto a spot and let the dust rings spread.
const banner = document.getElementById("banner"), bannerBody = document.getElementById("bannerBody");
let anim = null;
// Descent profile from the simulation: share of total ejecta thrown above altitude h.
const PROF = D.descent_profile;
const H_START = PROF ? PROF.h_m[0] : 34, H_CUT = PROF ? PROF.h_m[PROF.h_m.length - 1] : 2;
const RATE = PROF ? PROF.descent_rate_m_s : 0.5;
function dustAt(h) {
  if (!PROF) return h <= H_CUT ? 1 : 0;
  const hs = PROF.h_m, fs = PROF.cum_fraction;     // hs runs from top to bottom
  if (h >= hs[0]) return 0;
  if (h <= hs[hs.length - 1]) return 1;
  for (let i = 0; i < hs.length - 1; i++) if (h <= hs[i] && h >= hs[i + 1]) {
    const t = (hs[i] - h) / (hs[i] - hs[i + 1]); return fs[i] + t * (fs[i + 1] - fs[i]);
  }
  return 1;
}
const altEl = document.getElementById("alt");
function drawAltimeter(phase) {
  const h = state.alt;
  document.getElementById("altVal").textContent = h.toFixed(1);
  document.getElementById("altMark").style.bottom = `${Math.min(h / H_START, 1) * 100}%`;
  document.getElementById("altDust").textContent = `${Math.round(state.dustFrac * 100)}%`;
  document.getElementById("altTime").textContent =
    h > H_CUT ? `${Math.round((h - H_CUT) / RATE)} s` : "0 s";
  document.getElementById("altPhase").textContent = phase;
}
// Result box under the map (never on top of it, so nothing covers it)
function showReadout(html, tone) {
  bannerBody.innerHTML = html; banner.dataset.tone = tone || "";
  banner.hidden = false; banner.classList.remove("show"); void banner.offsetWidth; banner.classList.add("show");
}
const hideBanner = () => {
  banner.hidden = true; banner.classList.remove("show");
  const mr = document.getElementById("mapResult");
  if (mr) { mr.hidden = true; document.getElementById("mapbox").classList.remove("has-result"); }
};

// Descent timeline in ms (compressed: the real descent from 34 m takes about a minute).
const T_APPROACH = 2600, T_DESCENT = 8200, T_DROP = 1500, T_HOLD = 500;
function runDescent(to, from, doneLabel, onDone) {
  if (anim) cancelAnimationFrame(anim);
  hideBanner();
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let t0 = 0;
  const inout = (x) => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  altEl.hidden = false;
  const finish = () => {
    anim = null; state.L = [...to]; state.alt = 0; state.dustFrac = 1; state.engineOn = false;
    drawAltimeter(doneLabel);
    render();
    if (onDone) onDone();
  };
  if (reduce) { finish(); return; }
  state.L = [...from]; state.alt = H_START; state.dustFrac = 0; state.engineOn = true;
  drawMap(); drawAltimeter("Approach");
  const step = (now) => {
    if (!t0) t0 = now;
    const t = now - t0;
    let phase;
    if (t < T_APPROACH) {                       // pitch-over approach: glide in, 34 -> 30 m
      const a = inout(t / T_APPROACH);
      state.L = [from[0] + (to[0] - from[0]) * a, from[1] + (to[1] - from[1]) * a];
      state.alt = H_START - 4 * a; phase = "Approach";
      state.engineOn = true;
    } else if (t < T_APPROACH + T_DESCENT) {    // vertical descent, slowing towards the ground
      const u = (t - T_APPROACH) / T_DESCENT;
      state.L = [...to];
      state.alt = H_CUT + (H_START - 4 - H_CUT) * Math.pow(1 - u, 2.2);
      phase = state.alt < 6 ? "Final metres" : "Descent";
      state.engineOn = true;
    } else if (t < T_APPROACH + T_DESCENT + T_DROP) {  // contact light: engine off, fall under 1.62 m/s²
      const u = (t - T_APPROACH - T_DESCENT) / T_DROP;
      state.alt = H_CUT * (1 - u * u); phase = "Contact light · engine stop";
      state.engineOn = false;
    } else if (t < T_APPROACH + T_DESCENT + T_DROP + T_HOLD) {
      state.alt = 0; phase = "Contact light · engine stop"; state.engineOn = false;
    } else { finish(); return; }
    state.dustFrac = dustAt(state.alt);
    drawMap(); drawAltimeter(phase);
    anim = requestAnimationFrame(step);
  };
  anim = requestAnimationFrame(step);
}
const APOLLO_TEXT = "<p><b>Houston, Intrepid has landed.</b> 19 Nov 1969, 155 m from Surveyor 3. Back home the lab counts about 103 pits per cm² on the side that faced the lander. Every ring on this map is calibrated to that number.</p>";
document.getElementById("replay").onclick = () => {
  if (window.__missions) exitMission(true);   // mission code loads later in the same script
  if (anim) cancelAnimationFrame(anim);
  if (state.site !== 0) { state.site = 0; state.L = [...SITES[0].lander]; }
  state.count = 0; state.height = 1; state.dustFrac = 1;
  state.lander = D.landers.findIndex((l) => l.thrust_N === 11600);
  document.getElementById("count").value = 0; document.getElementById("height").value = 1;
  render();
  let from = [...state.L];
  if (Math.hypot(from[0], from[1]) < 40) from = [-380, -520];  // always fly in from somewhere
  state.L = [0, 0]; fitView();                                  // final view; stays fixed during the replay
  state.view.half = Math.max(state.view.half, Math.hypot(from[0], from[1]) * 1.35);
  state.view.cx = from[0] * 0.3; state.view.cy = from[1] * 0.3;
  runDescent([0, 0], from, "Touchdown · 19 Nov 1969", () => {
    showReadout(APOLLO_TEXT);
    const row = document.querySelector(".obj[data-calib]");
    if (row) { row.classList.remove("flash"); void row.offsetWidth; row.classList.add("flash"); }
  });
};
function selectSite(i) {
  if (window.__missions) exitMission(true);   // mission code loads later in the same script
  const s = SITES[i];
  if (anim) { cancelAnimationFrame(anim); anim = null; }
  state.alt = 0; state.dustFrac = 1; state.engineOn = false;
  hideBanner(); altEl.hidden = true;
  state.site = i; state.L = [...s.lander];
  const li = D.landers.findIndex((l) => l.thrust_N === s.thrust);
  if (li >= 0) state.lander = li;
  fitView(); render();
}

/* ------------------------------------------------------------------ map */
const canvas = document.getElementById("map");
let ctx = canvas.getContext("2d");
let W = 0, H = 0, DPR = 1;
function resize() {
  const r = canvas.getBoundingClientRect();
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = r.width; H = r.height;
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  drawMap();
}
const toPx = (x, y) => [W / 2 + (x - state.view.cx) / state.view.half * (W / 2),
                        H / 2 - (y - state.view.cy) / state.view.half * (W / 2)];
const toWorld = (px, py) => [state.view.cx + (px - W / 2) / (W / 2) * state.view.half,
                             state.view.cy - (py - H / 2) / (W / 2) * state.view.half];
function fitView() {
  const { lander, n, hKey } = current();
  const rg = ringsFor(lander, hKey, n);
  const s = SITES[state.site];
  let reach = 150;
  for (const o of s.objects) reach = Math.max(reach, Math.hypot(o.pos[0] - state.L[0], o.pos[1] - state.L[1]) * 1.25);
  const r2 = rg[1].med; if (isFinite(r2)) reach = Math.max(reach, r2 * 1.15);
  state.view.half = Math.min(Math.max(reach, 120), 14000);
  state.view.cx = state.L[0]; state.view.cy = state.L[1];
}

// Deterministic procedural regolith: crater tiles at several scales.
function hash(a, b, c, d) {
  let h = 2166136261 ^ a; h = Math.imul(h ^ b, 16777619); h = Math.imul(h ^ c, 16777619); h = Math.imul(h ^ d, 16777619);
  return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
let grain = null;
function makeGrain() {
  grain = document.createElement("canvas"); grain.width = grain.height = 128;
  const g = grain.getContext("2d"); const img = g.createImageData(128, 128); const rnd = hash(1, 2, 3, 4);
  for (let i = 0; i < img.data.length; i += 4) { const v = 100 + rnd() * 40; img.data[i] = v; img.data[i + 1] = v - 3; img.data[i + 2] = v - 8; img.data[i + 3] = 26; }
  g.putImageData(img, 0, 0);
}
function drawTerrain() {
  ctx.fillStyle = "#77736c"; ctx.fillRect(0, 0, W, H);
  if (!grain) makeGrain();
  ctx.fillStyle = ctx.createPattern(grain, "repeat"); ctx.fillRect(0, 0, W, H);
  const mPerPx = state.view.half / (W / 2);
  const seed = SITES[state.site].seed;
  for (let lvl = 0; lvl < 7; lvl++) {
    const tile = 40 * Math.pow(4, lvl);
    const rMax = tile / 7;
    if (rMax / mPerPx < 1.2) continue;                 // too small to see
    if (tile / mPerPx > W * 6) continue;               // tiles far larger than view
    const [x0, y1] = toWorld(0, 0), [x1, y0] = toWorld(W, H);
    for (let ix = Math.floor(x0 / tile) - 1; ix <= Math.floor(x1 / tile) + 1; ix++) {
      for (let iy = Math.floor(y0 / tile) - 1; iy <= Math.floor(y1 / tile) + 1; iy++) {
        const rnd = hash(seed, lvl, ix, iy);
        const n = 2 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) {
          const cx = (ix + rnd()) * tile, cy = (iy + rnd()) * tile;
          const rr = rMax * (0.25 + 0.75 * Math.pow(rnd(), 2.2));
          const [px, py] = toPx(cx, cy); const pr = rr / mPerPx;
          if (pr < 1 || px < -pr || py < -pr || px > W + pr || py > H + pr) continue;
          const g = ctx.createRadialGradient(px + pr * .35, py + pr * .3, pr * .1, px, py, pr);
          g.addColorStop(0, "rgba(40,38,35,.28)"); g.addColorStop(.75, "rgba(55,52,48,.18)"); g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = "rgba(225,220,210,.32)"; ctx.lineWidth = Math.max(1, pr * .08);
          ctx.beginPath(); ctx.arc(px, py, pr * .92, Math.PI * .65, Math.PI * 1.45); ctx.stroke();
        }
      }
    }
  }
}
function drawRings(rg) {
  const s = DPR;
  const [lx, ly] = toPx(state.L[0], state.L[1]);
  const mPerPx = state.view.half / (W / 2);
  if (state.dustFrac <= 0.002) return;
  // 1) danger zones: tinted INSIDE each median ring (strongest near the lander), outer zones first
  const zoneAlpha = ["38", "26", "1a"];
  for (let i = rg.length - 1; i >= 0; i--) {
    const r = rg[i];
    const rad = isFinite(r.med) ? r.med / mPerPx : Math.max(W, H) * 2;
    ctx.fillStyle = css(r.col) + zoneAlpha[i];
    ctx.beginPath(); ctx.arc(lx, ly, rad, 0, Math.PI * 2); ctx.fill();
  }
  // 2) uncertainty: thin dashed circles at the smallest and largest model version
  for (let i = rg.length - 1; i >= 0; i--) {
    const r = rg[i]; const col = css(r.col);
    ctx.strokeStyle = col + "aa"; ctx.lineWidth = 1.2; ctx.setLineDash([4, 6]);
    for (const v of [r.lo, r.hi]) if (isFinite(v)) { ctx.beginPath(); ctx.arc(lx, ly, v / mPerPx, 0, Math.PI * 2); ctx.stroke(); }
    ctx.setLineDash([]);
  }
  for (let i = rg.length - 1; i >= 0; i--) {
    const r = rg[i]; const col = css(r.col);
    if (isFinite(r.med)) {
      ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(lx, ly, r.med / mPerPx, 0, Math.PI * 2); ctx.stroke();
      const a = -Math.PI / 4 - i * 0.18, rp = r.med / mPerPx;
      const tx = lx + Math.cos(a) * rp, ty = ly + Math.sin(a) * rp;
      if (tx > 0 && tx < W && ty > 0 && ty < H) {
        const t = `${r.f}× · ${fmtD(r.med)}`;
        ctx.font = `600 12px ${css("--font-data")}`; const tw = ctx.measureText(t).width;
        ctx.fillStyle = "rgba(20,22,24,.8)"; ctx.fillRect(tx + 4, ty - 18, tw + 10, 18);
        ctx.fillStyle = col; ctx.fillText(t, tx + 9, ty - 5);
      }
    }
  }
}
function drawObjects() {
  const s = SITES[state.site];
  ctx.font = `500 12px ${css("--font-body")}`;
  for (const o of s.objects) {
    const [px, py] = toPx(o.pos[0], o.pos[1]);
    // the lander is standing on this object: no label, it would cover nearby markers
    if (Math.hypot(o.pos[0] - state.L[0], o.pos[1] - state.L[1]) < 10) continue;
    ctx.fillStyle = "#f4f2ec"; ctx.strokeStyle = "#1a1c1e"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.rect(px - 5, py - 5, 10, 10); ctx.fill(); ctx.stroke();
    const tw = ctx.measureText(o.name).width;
    ctx.fillStyle = "rgba(20,22,24,.78)"; ctx.fillRect(px + 9, py - 9, tw + 10, 18);
    ctx.fillStyle = "#f4f2ec"; ctx.fillText(o.name, px + 14, py + 4);
  }
}
function drawLander() {
  const [lx, ly] = toPx(state.L[0], state.L[1]);
  const h = state.alt;
  if (h > 0.05) {                                       // shadow on the ground, lander lifted above it
    ctx.fillStyle = "rgba(10,10,10,.38)";
    ctx.beginPath(); ctx.ellipse(lx, ly, 11, 6, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.save(); ctx.translate(lx, ly - h * 2.2);
  const sc = 1 + Math.min(h, 34) / 34 * 0.7; ctx.scale(sc, sc);
  if (state.engineOn) {                                 // engine glow
    const g = ctx.createRadialGradient(0, 6, 0, 0, 6, 12);
    g.addColorStop(0, "rgba(255,240,200,.9)"); g.addColorStop(1, "rgba(255,200,120,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 6, 12, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = "#1a1c1e"; ctx.fillStyle = "#ffd25a"; ctx.lineWidth = 2;
  for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * Math.PI / 2;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 13, Math.sin(a) * 13); ctx.stroke();
    ctx.beginPath(); ctx.arc(Math.cos(a) * 13, Math.sin(a) * 13, 2.5, 0, Math.PI * 2); ctx.fillStyle = "#1a1c1e"; ctx.fill(); }
  ctx.fillStyle = "#ffd25a"; ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(7, 5); ctx.lineTo(-7, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}
function drawScale() {
  const mPerPx = state.view.half / (W / 2);
  const target = mPerPx * 110; const p = Math.pow(10, Math.floor(Math.log10(target)));
  const nice = [1, 2, 5, 10].map((k) => k * p).reverse().find((v) => v <= target) || p;
  document.getElementById("scalebar").style.width = (nice / mPerPx) + "px";
  document.getElementById("scaletxt").textContent = fmtD(nice);
}
// Terrain is expensive (hundreds of gradients); cache it while the view does not move.
// While the view is moving (zoom, pan, pinch), the last terrain image is scaled and shifted
// instead of redrawn, and the full terrain is drawn again once the view settles.
let terrainCache = null, terrainKey = "", terrainView = null;
function drawTerrainCached(quick) {
  const key = [state.site, W, H, DPR].join("|"), v = state.view;
  const same = (t) => t && t.cx === v.cx && t.cy === v.cy && t.half === v.half;
  if (key !== terrainKey || !terrainView || (!quick && !same(terrainView))) {
    terrainCache = terrainCache || document.createElement("canvas");
    terrainCache.width = canvas.width; terrainCache.height = canvas.height;
    const main = ctx; ctx = terrainCache.getContext("2d");
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); drawTerrain(); ctx = main;
    terrainKey = key; terrainView = { cx: v.cx, cy: v.cy, half: v.half };
  }
  if (same(terrainView)) { ctx.drawImage(terrainCache, 0, 0, W, H); return; }
  const s = terrainView.half / v.half, [px, py] = toPx(terrainView.cx, terrainView.cy);
  ctx.fillStyle = "#77736c"; ctx.fillRect(0, 0, W, H);
  ctx.drawImage(terrainCache, px - W / 2 * s, py - H / 2 * s, W * s, H * s);
}
// Mission overlays: walking range, landing pad, the rings of the previous test
function drawPlan() {
  const pl = state.plan; if (!pl) return;
  const mPerPx = state.view.half / (W / 2);
  ctx.font = `500 12px ${css("--font-body")}`;
  const tag = (t, x, y, col) => {
    const tw = ctx.measureText(t).width;
    ctx.fillStyle = "rgba(20,22,24,.8)"; ctx.fillRect(x - tw / 2 - 6, y - 13, tw + 12, 18);
    ctx.fillStyle = col; ctx.textAlign = "center"; ctx.fillText(t, x, y); ctx.textAlign = "left";
  };
  if (pl.walk) {
    const [x, y] = toPx(pl.walk.pos[0], pl.walk.pos[1]), r = pl.walk.r / mPerPx;
    ctx.strokeStyle = "rgba(255,255,255,.8)"; ctx.lineWidth = 1.6; ctx.setLineDash([8, 6]);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    // label at the top of the circle, unless the hint / zoom buttons sit there: then at the bottom
    const wl = `walking range · ${fmtD(pl.walk.r)}`;
    if (y - r > 52) tag(wl, x, y - r + 4, "#f4f2ec"); else if (y + r < H - 70) tag(wl, x, y + r + 4, "#f4f2ec");
  }
  if (pl.ghost && isFinite(pl.ghost.r)) {
    const [x, y] = toPx(pl.ghost.L[0], pl.ghost.L[1]), r = pl.ghost.r / mPerPx;
    ctx.strokeStyle = css(pl.ghost.col) + "aa"; ctx.lineWidth = 2; ctx.setLineDash([3, 5]);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5); ctx.moveTo(x + 5, y - 5); ctx.lineTo(x - 5, y + 5); ctx.stroke();
    if (y + r < H - 8) tag("last test", x, y + r + 4, css(pl.ghost.col));
  }
  for (const it of pl.items || []) {                      // built pads and berms
    const [x, y] = toPx(it.x, it.y), r = itemPx(it), on = pl.placed && itemOn(it);
    if (it.kind === "berm") {
      const w = 2 + it.h * 1.4;
      ctx.strokeStyle = "#5c5140"; ctx.lineWidth = w + 2.5; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = "#c2a978"; ctx.lineWidth = w; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.fillStyle = "#cfcfca"; ctx.strokeStyle = "#2d3035"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = "rgba(45,48,53,.55)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, r * .62, 0, Math.PI * 2); ctx.stroke();
    }
    if (on) {
      ctx.strokeStyle = css("--ok"); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, r + (it.kind === "berm" ? 5 + it.h : 4), 0, Math.PI * 2); ctx.stroke();
    }
    const name = it.kind === "pad" ? `pad ${it.r * 2} m` : `berm ${it.h} m`;
    if (y + r + 22 < H) tag(on ? `${name} · lander on it` : name, x, y + r + 20, on ? css("--ok") : "#f4f2ec");
  }
}
// Built items: drawn at least a few pixels big so they stay visible and grabbable when zoomed out
function itemPx(it) { const m = state.view.half / (W / 2); return it.kind === "pad" ? Math.max(it.r / m, 11) : Math.max(50 / m, 20); }
const BERM_TOL_M = 20;   // the model's berm surrounds the landing site; land near its middle
function itemOn(it) { const d = Math.hypot(it.x - state.L[0], it.y - state.L[1]); return it.kind === "pad" ? d <= it.r + 1 : d <= BERM_TOL_M; }
// Item whose handle is under a screen point (pads first; big berms only by their wall)
function itemAt(px, py) {
  const pl = state.plan; if (!pl || !pl.items) return null;
  for (const it of [...pl.items].sort((a, b) => (a.kind === "pad" ? -1 : 1))) {
    const [x, y] = toPx(it.x, it.y), r = itemPx(it), d = Math.hypot(px - x, py - y);
    if (it.kind === "pad" ? d <= r + 6 : (r > 34 ? Math.abs(d - r) <= 12 : d <= r + 8)) return it;
  }
  return null;
}
// Item that covers a screen point (used to land on it with a tap)
function itemUnder(px, py) {
  const pl = state.plan; if (!pl || !pl.items) return null;
  for (const it of [...pl.items].sort((a, b) => (a.kind === "pad" ? -1 : 1))) {
    const [x, y] = toPx(it.x, it.y);
    if (Math.hypot(px - x, py - y) <= itemPx(it) + 6) return it;
  }
  return null;
}
// Dust spray: purely visual streaks running outward while the engine fires.
const dust = Array.from({ length: 180 }, () => ({ a: Math.random() * Math.PI * 2, o: Math.random(), s: 0.6 + Math.random() * 0.9 }));
function drawDust() {
  if (!state.engineOn) return;
  const [lx, ly] = toPx(state.L[0], state.L[1]);
  const reach = Math.min(W, H) * 0.48;
  const strength = Math.min(Math.max((34 - state.alt) / 30, 0.12), 1);
  const t = performance.now() / 1000;
  ctx.lineWidth = 1.4;
  for (const p of dust) {
    const f = (t * 0.8 * p.s + p.o) % 1;
    const r0 = 4 + f * reach, r1 = r0 + 5 + 10 * f;
    ctx.strokeStyle = `rgba(232,224,206,${((1 - f) * 0.6 * strength).toFixed(3)})`;
    ctx.beginPath(); ctx.moveTo(lx + Math.cos(p.a) * r0, ly + Math.sin(p.a) * r0);
    ctx.lineTo(lx + Math.cos(p.a) * r1, ly + Math.sin(p.a) * r1); ctx.stroke();
  }
}
function drawMap() {
  if (!W) return;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawTerrainCached(viewBusy);
  drawPlan();
  const pl = state.plan;
  if (!pl || (pl.placed && !pl.hideRings)) {
    const { lander, n, hKey } = current();
    let rg;
    if (pl && pl.rings) {            // landing pad: one ring from the pad study
      const k = Math.sqrt(state.dustFrac);
      rg = pl.rings.map((r) => ({ ...r, med: r.med * k, lo: r.lo * k, hi: r.hi * k }));
    } else rg = ringsFor(lander, hKey, n * state.dustFrac);
    drawRings(rg);
  }
  drawDust(); drawObjects();
  if (!pl || pl.placed) drawLander();
  drawScale();
}

// Pointer: tap places the lander, drag pans, wheel / pinch / buttons zoom smoothly.
let viewBusy = false, settleTimer = 0, viewAnim = 0, zoomGoal = null;
function moved() {
  viewBusy = true; drawMap();
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => { viewBusy = false; drawMap(); }, 160);
}
const clampHalf = (h) => Math.min(Math.max(h, 40), 14000);
function anchorView(half, px, py, ax, ay) {       // keep world point (ax, ay) under screen point (px, py)
  state.view.half = half;
  state.view.cx = ax - (px - W / 2) / (W / 2) * half;
  state.view.cy = ay + (py - H / 2) / (W / 2) * half;
}
function zoomAt(k, px = W / 2, py = H / 2) {
  const [ax, ay] = toWorld(px, py);
  zoomGoal = { half: clampHalf((zoomGoal ? zoomGoal.half : state.view.half) * k), px, py, ax, ay };
  if (!viewAnim) viewAnim = requestAnimationFrame(zoomStep);
}
function zoomStep() {
  viewAnim = 0;
  const g = zoomGoal; if (!g) return;
  const lh = Math.log(state.view.half), lt = Math.log(g.half);
  const done = Math.abs(lt - lh) < 0.004;
  anchorView(done ? g.half : Math.exp(lh + (lt - lh) * 0.3), g.px, g.py, g.ax, g.ay);
  moved();
  if (done) zoomGoal = null; else viewAnim = requestAnimationFrame(zoomStep);
}
function zoom(k) { zoomAt(k); }
// Glide the view to {cx, cy, half}
function flyTo(v, ms = 600) {
  zoomGoal = null; if (viewAnim) cancelAnimationFrame(viewAnim);
  if (!W || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { Object.assign(state.view, v); drawMap(); return; }
  const a = { ...state.view }, t0 = performance.now();
  const ease = (x) => 1 - Math.pow(1 - x, 3);
  const step = (now) => {
    const u = Math.min((now - t0) / ms, 1), e = ease(u);
    state.view.cx = a.cx + (v.cx - a.cx) * e; state.view.cy = a.cy + (v.cy - a.cy) * e;
    state.view.half = Math.exp(Math.log(a.half) + (Math.log(v.half) - Math.log(a.half)) * e);
    moved();
    viewAnim = u < 1 ? requestAnimationFrame(step) : 0;
  };
  viewAnim = requestAnimationFrame(step);
}
const pts = new Map();
let drag = null, pinch = null;
const rel = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
const hideHint = () => document.getElementById("hint").classList.add("gone");
canvas.addEventListener("pointerdown", (e) => {
  hideHint();
  pts.set(e.pointerId, rel(e)); try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or lost pointer */ }
  if (pts.size === 1) {
    const it = !anim ? itemAt(...rel(e)) : null;                 // grab a built pad or berm?
    const off = it && state.plan.placed && itemOn(it) ? [state.L[0] - it.x, state.L[1] - it.y] : null;
    drag = { x: e.clientX, y: e.clientY, cx: state.view.cx, cy: state.view.cy, moved: false, item: it, off };
  }
  else if (pts.size === 2) {                                   // two fingers: pinch zoom
    if (drag) drag.moved = true;
    const [a, b] = [...pts.values()];
    const [ax, ay] = toWorld((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, half: state.view.half, ax, ay };
    zoomGoal = null;
  }
});
canvas.addEventListener("pointermove", (e) => {
  if (!pts.has(e.pointerId)) return;
  pts.set(e.pointerId, rel(e));
  if (pinch && pts.size >= 2) {
    const [a, b] = [...pts.values()];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
    anchorView(clampHalf(pinch.half * pinch.d / d), (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, pinch.ax, pinch.ay);
    moved(); return;
  }
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.hypot(dx, dy) > 4) drag.moved = true;
  if (drag.moved && drag.item) { if (typeof moveItem === "function") moveItem(drag.item, toWorld(...rel(e)), drag.off); return; }
  if (drag.moved) { const m = state.view.half / (W / 2); state.view.cx = drag.cx - dx * m; state.view.cy = drag.cy + dy * m; moved(); }
});
function endPointer(e, tap) {
  pts.delete(e.pointerId);
  if (pinch) { if (pts.size < 2) pinch = null; drag = null; return; }
  if (drag && drag.item && drag.moved) { if (typeof dropItem === "function") dropItem(drag.item); drag = null; return; }
  if (tap && drag && !drag.moved && !anim) {
    const p = toWorld(...rel(e));
    if (!(typeof onMapTap === "function" && onMapTap(p))) { state.L = p; hideBanner(); render(); }
  }
  drag = null;
}
canvas.addEventListener("pointerup", (e) => endPointer(e, true));
canvas.addEventListener("pointercancel", (e) => endPointer(e, false));
canvas.addEventListener("wheel", (e) => {
  e.preventDefault(); hideHint();
  const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
  const [px, py] = rel(e);
  zoomAt(Math.exp(Math.max(-120, Math.min(120, dy)) * 0.0024), px, py);
}, { passive: false });
document.getElementById("zin").onclick = () => zoomAt(0.6);
document.getElementById("zout").onclick = () => zoomAt(1 / 0.6);
document.getElementById("zfit").onclick = () => {
  let target = typeof missionView === "function" ? missionView() : null;
  if (!target) { const keep = { ...state.view }; fitView(); target = { ...state.view }; Object.assign(state.view, keep); }
  flyTo(target);
};

/* ------------------------------------------------------------- readouts */
function renderObjects() {
  const { lander, n, hKey } = current();
  const s = SITES[state.site];
  const el = document.getElementById("objects"); el.innerHTML = "";
  for (const o of s.objects) {
    const d = Math.hypot(o.pos[0] - state.L[0], o.pos[1] - state.L[1]);
    const row = document.createElement("div"); row.className = "obj";
    if (o.calib) row.dataset.calib = "1";
    if (d < 10) {
      row.innerHTML = `<b>${o.name}</b><span class="chip c0">landing site</span><div class="meta">${o.note}</div>`;
      el.appendChild(row); continue;
    }
    const hk = o.heightKey || hKey;
    const c = curve(lander, hk);
    const med = interpLog(R, c.median, d), lo = interpLog(R, c.min, d), hi = interpLog(R, c.max, d);
    const ratio = med == null ? null : med * n / MEAS;
    const isCalib = o.calib && lander.thrust_N === 11600 && n === 1 && Math.abs(d - 155) < 3;
    const st = isCalib ? { cls: "c1", txt: "1969: measured 103 pits/cm²" } : status(ratio);
    const beyond = d > R[R.length - 1] ? " · beyond model grid, value at 10 km shown" : (d < R[0] ? " · closer than model grid" : "");
    const calib = isCalib ? " · calibration point: 1× by definition" : "";
    row.innerHTML = `<b>${o.name}</b><span class="chip ${st.cls}">${st.txt}</span>
      <div class="meta">${fmtD(d)} away · ${fmtN(med * n)} impacts/cm² (range ${fmtN(lo * n)}–${fmtN(hi * n)}) · ${fmtN(ratio)}× Surveyor 3${calib}${beyond}</div>
      <div class="meta" style="font-family:var(--font-body)">${o.note}${o.heightKey ? " · evaluated 3 m below the plain" : ` · hardware ${hKey} m tall`}</div>`;
    el.appendChild(row);
  }
  const rg = ringsFor(lander, hKey, n);
  const re = document.getElementById("rings"); re.innerHTML = '<span class="label">Rings around this landing</span>';
  for (const r of rg) {
    const fmtR = (x) => isFinite(x) ? fmtD(x) : "> 10 km";
    const row = document.createElement("div"); row.className = "ring-row"; row.style.color = `var(${r.col})`;
    row.innerHTML = `<span class="sw"></span><span style="color:var(--fg)">${r.name} <span style="color:var(--muted)">(${r.f}×)</span></span>
      <span class="num" style="color:var(--fg)">${fmtR(r.med)}<small>${fmtR(r.lo)} – ${fmtR(r.hi)}</small></span>`;
    re.appendChild(row);
  }
}

function renderChart() {
  const { lander, n, hKey } = current();
  const c = curve(lander, hKey);
  const svg = document.getElementById("chart");
  const w = 520, h = 300, m = { l: 54, r: 16, t: 14, b: 40 };
  const xs = R, xmin = Math.log10(xs[0]), xmax = Math.log10(xs[xs.length - 1]);
  const vals = [...c.min, ...c.max].filter((v) => v > 0).map((v) => v * n);
  const ymax = Math.ceil(Math.log10(Math.max(...vals, MEAS * 10)));
  const ymin = Math.min(Math.floor(Math.log10(Math.min(...vals, MEAS * 0.01))), ymax - 2);
  const X = (d) => m.l + (Math.log10(d) - xmin) / (xmax - xmin) * (w - m.l - m.r);
  const Y = (v) => m.t + (ymax - Math.log10(v)) / (ymax - ymin) * (h - m.t - m.b);
  let out = "";
  for (let p = ymin; p <= ymax; p++) {
    out += `<line x1="${m.l}" x2="${w - m.r}" y1="${Y(10 ** p)}" y2="${Y(10 ** p)}" stroke="var(--line)" stroke-width="1"/>`;
    out += `<text x="${m.l - 6}" y="${Y(10 ** p) + 3}" text-anchor="end">1e${p}</text>`;
  }
  for (const d of [25, 100, 1000, 10000]) {
    if (d < xs[0] || d > xs[xs.length - 1]) continue;
    out += `<line x1="${X(d)}" x2="${X(d)}" y1="${m.t}" y2="${h - m.b}" stroke="var(--line)" stroke-width="1"/>`;
    out += `<text x="${X(d)}" y="${h - m.b + 14}" text-anchor="middle">${fmtD(d)}</text>`;
  }
  out += `<text class="t-axis" x="${(m.l + w - m.r) / 2}" y="${h - 6}" text-anchor="middle">distance from lander</text>`;
  out += `<text class="t-axis" transform="translate(12 ${(m.t + h - m.b) / 2}) rotate(-90)" text-anchor="middle">impacts per cm²</text>`;
  // band
  const pts = (arr) => xs.map((d, i) => arr[i] > 0 ? [X(d), Y(arr[i] * n)] : null).filter(Boolean);
  const top = pts(c.max), bot = pts(c.min).reverse();
  if (top.length && bot.length) out += `<path d="M${top.map((p) => p.join(",")).join("L")}L${bot.map((p) => p.join(",")).join("L")}Z" fill="var(--accent)" fill-opacity=".16" stroke="none"/>`;
  const md = pts(c.median);
  if (md.length) out += `<path d="M${md.map((p) => p.join(",")).join("L")}" fill="none" stroke="var(--accent)" stroke-width="2.2"/>`;
  for (const t of THR) {
    const y = Y(t.f * MEAS); if (y < m.t || y > h - m.b) continue;
    out += `<line x1="${m.l}" x2="${w - m.r}" y1="${y}" y2="${y}" stroke="var(${t.col})" stroke-dasharray="5 4" stroke-width="1.5"/>`;
    out += `<text x="${w - m.r - 4}" y="${y - 4}" text-anchor="end" style="fill:var(${t.col})">${t.f}× Surveyor 3</text>`;
  }
  for (const o of SITES[state.site].objects) {
    const d = Math.hypot(o.pos[0] - state.L[0], o.pos[1] - state.L[1]);
    if (d < 10 || d < xs[0] || d > xs[xs.length - 1]) continue;
    const v = interpLog(R, curve(lander, o.heightKey || hKey).median, d);
    if (!(v > 0)) continue;
    const y = Math.min(Math.max(Y(v * n), m.t), h - m.b);
    out += `<circle cx="${X(d)}" cy="${y}" r="4.5" fill="var(--fg)" stroke="var(--panel)" stroke-width="2"/>`;
    out += `<text x="${X(d) + 7}" y="${y - 6}" style="fill:var(--fg)">${o.name}${o.heightKey ? " (at " + o.heightKey + " m)" : ""}</text>`;
  }
  svg.innerHTML = out;
  document.getElementById("chartNote").textContent =
    `${lander.name}, hardware ${hKey} m tall, ${n} landing${n > 1 ? "s" : ""}. Line = median of ${lander.by_height[hKey].n_branches} model variants` +
    (D.branch_filter && D.branch_filter.applied ? ` that match the pits found on Surveyor 3 (${D.branch_filter.n_kept} of ${D.branch_filter.n_total} pass that test)` : "") +
    `; band = smallest to largest variant.`;
}

function renderMitigation() {
  const M = D.mitigation;
  const tbl = document.getElementById("mit"), note = document.getElementById("mitNote");
  if (!M) { note.textContent = "Mitigation results not computed yet."; tbl.innerHTML = ""; return; }
  const rows = {};
  for (const [k, v] of Object.entries(M.practical_distance)) {
    const [t, lab] = k.split(" | "); (rows[lab] ||= {})[t] = v;
  }
  const thrusts = [...new Set(Object.keys(M.practical_distance).map((k) => k.split(" | ")[0]))];
  const f = (b) => !b ? "—" : `${b.median == null ? "> 10 km" : fmtD(b.median)}`;
  const rng = (b) => !b ? "" : `<small style="color:var(--muted);display:block">${b.min == null ? "> 10 km" : fmtD(b.min)} – ${b.max == null ? "> 10 km" : fmtD(b.max)}</small>`;
  tbl.innerHTML = `<thead><tr><th>Option</th>${thrusts.map((t) => `<th style="text-align:right">${t}</th>`).join("")}</tr></thead><tbody>` +
    Object.entries(rows).map(([lab, v]) => `<tr><td>${lab}</td>${thrusts.map((t) => `<td class="n">${f(v[t])}${rng(v[t])}</td>`).join("")}</tr>`).join("") + "</tbody>";
  note.textContent = `Safe distance where hardware 1.5 m tall gets less than ${M.threshold_x_surveyor}× Surveyor 3's exposure, per landing` +
    (M.filtered ? ", using only model variants that match Surveyor 3" : "") +
    `. Pad-edge erosion, berm erosion and bulk cratering are not modelled, so pads and berms look better here than they will in reality.`;
}

function renderMeta() {
  document.getElementById("dataTag").textContent = D.quick ? "quick-resolution data" : "full-resolution data";
  if (D.quick) document.getElementById("dataTag").classList.add("warn");
  const lim = [
    "Absolute scale comes from one measurement (Surveyor 3, 103 pits/cm²).",
    "Crater size constant recalibrated against the Surveyor coupons; model variants that miss the measured pit counts are left out.",
    `Above ${(D.validated_max_thrust_N / 1000).toFixed(1)} kN deep cratering is expected; the model does not include it.`,
    "Repeated landings add up linearly; worn pads and growing craters are not modelled.",
    "Ejected grains fly ballistically; collisions inside the dust sheet are ignored.",
  ];
  document.getElementById("limits").innerHTML = lim.map((t) => `<li>${t}</li>`).join("");
}

function render() {
  SITES.forEach((s, i) => document.getElementById("site-" + s.id).setAttribute("aria-pressed", i === state.site));
  D.landers.forEach((l, i) => document.getElementById("lander-" + i).setAttribute("aria-pressed", i === state.lander));
  document.getElementById("replay").hidden = false;
  drawMap(); renderObjects(); renderChart();
}

document.getElementById("bannerClose").onclick = hideBanner;
/* ------------------------------------------------------- landing advisor */
const OBJS = [];
SITES.forEach((s, si) => s.objects.forEach((o) => OBJS.push({ ...o, si, label: `${o.name} · ${s.name}` })));
const advObj = document.getElementById("advObj"), advLander = document.getElementById("advLander");
OBJS.forEach((o, i) => advObj.add(new Option(o.label, i)));
D.landers.forEach((l, i) => advLander.add(new Option(`${l.name.replace(/[()]/g, "")}`, i)));
advLander.value = D.landers.findIndex((l) => l.thrust_N === 44000);
advObj.value = OBJS.findIndex((o) => o.si === 1);
const logPos = (d) => {                                   // 25 m .. 10 km on a log axis
  const a = Math.log10(R[0]), b = Math.log10(R[R.length - 1]);
  return Math.min(Math.max((Math.log10(Math.min(Math.max(d, R[0]), R[R.length - 1])) - a) / (b - a), 0), 1) * 100;
};
function renderAdvisor() {
  const o = OBJS[+advObj.value], lander = D.landers[+advLander.value];
  const f = +document.getElementById("advLevel").value, acc = +document.getElementById("advAcc").value;
  document.getElementById("advAccVal").textContent = `± ${acc} m`;
  const hKey = o.heightKey || "1.5";
  const r = ringsFor(lander, hKey, 1).find((x) => x.f === f);
  const fmtR = (x) => isFinite(x) ? fmtD(x) : "> 10 km";
  const rec = isFinite(r.med) ? r.med + acc : Infinity;
  const out = lander.thrust_N > D.validated_max_thrust_N;
  let pads = "";
  const M = D.mitigation;
  const tk = `${lander.thrust_N / 1000} kN`;
  if (M && f === M.threshold_x_surveyor && M.practical_distance[`${tk} | no mitigation`]) {
    const rows = ["no mitigation", "pad, 10 m radius", "pad, 30 m radius", "berm 3 m at 50 m", "pad 30 m + berm 3 m"]
      .map((lab) => [lab, M.practical_distance[`${tk} | ${lab}`]]).filter(([, v]) => v);
    pads = `<span class="label">With a landing pad or berm</span><div class="pads">` + rows.map(([lab, v]) =>
      `<div class="row"><span>${lab[0].toUpperCase() + lab.slice(1)}</span><span>${v.median == null ? "> 10 km" : fmtD(v.median)}</span></div>`).join("") +
      `</div><p class="note">Pad-edge and berm erosion are not modelled, so these are best cases.</p>`;
  } else {
    pads = `<p class="note">Pads and berms are computed for the Apollo LM (11.6 kN) and 44 kN at the “10× less” level.</p>`;
  }
  const mk = (x, cls) => isFinite(x) ? `<span class="mk ${cls}" style="left:calc(${logPos(x)}% - 1px)"></span>` : "";
  document.getElementById("advOut").innerHTML = `
    <span class="label">Flight control recommends at least</span>
    <div class="big">${isFinite(rec) ? fmtD(rec) : "> 10 km"} <small>from ${o.name}</small></div>
    <p class="note">${fmtR(r.med)} is where the median model variant drops below ${f}× Surveyor 3's exposure, plus ± ${acc} m for landing accuracy.
      The variants range from ${fmtR(r.lo)} to ${fmtR(r.hi)}; to be safe against all of them, stay beyond ${fmtR(r.hi)}${isFinite(r.hi) ? ` + ${acc} m` : ""}.
      ${o.heightKey ? "Evaluated 3 m below the plain, like Surveyor 3." : "Hardware 1.5 m tall, one landing."}
      ${out ? " This lander is outside the modelled range: deep cratering is expected and not included." : ""}</p>
    <div class="rangebar" aria-hidden="true"><span class="track"></span>
      ${isFinite(r.lo) ? `<span class="span" style="left:${logPos(r.lo)}%;width:${logPos(isFinite(r.hi) ? r.hi : 1e9) - logPos(r.lo)}%"></span>` : ""}
      ${mk(r.lo, "")}${mk(r.med, "med")}${mk(r.hi, "")}
      ${[25, 100, 1000, 10000].map((d) => `<span class="tick" style="left:${logPos(d)}%">${fmtD(d)}</span>`).join("")}</div>
    <button class="btn" type="button" id="advShow">Show this landing on the map</button>
    ${pads}`;
  document.getElementById("advShow").onclick = () => {
    selectSite(o.si);
    state.lander = +advLander.value;
    const dist = isFinite(rec) ? rec : 10000;
    state.L = [o.pos[0], o.pos[1] - dist];
    fitView(); render();
    if (typeof showMap === "function") showMap();
    else document.getElementById("mapbox").scrollIntoView({ behavior: "smooth", block: "center" });
  };
}
["advObj", "advLander", "advLevel", "advAcc"].forEach((id) => document.getElementById(id).addEventListener("input", renderAdvisor));

renderAdvisor();
renderMeta(); renderMitigation();
selectSite(0);
new ResizeObserver(() => resize()).observe(document.getElementById("mapbox"));
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { for (const k in cssCache) delete cssCache[k]; render(); });
