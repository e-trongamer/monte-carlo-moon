
/* =====================================================================
   APP SHELL: chapters, progress, badges
   ===================================================================== */
const CHAPTERS = ["surveyor", "apollo", "simulation", "future", "log", "sources"];
const BADGES = [
  { id: "explorer", ch: "surveyor", name: "Surveyor expert", desc: "Explored all 5 parts of Surveyor 3" },
  { id: "witness", ch: "apollo", name: "Eyewitness 1969", desc: "Watched Apollo 12 sandblast Surveyor 3" },
  { id: "physicist", ch: "simulation", name: "Dust physicist", desc: "Went through all 4 model steps" },
  { id: "pilot", ch: "future", name: "Pilot", desc: "Made a soft touchdown" },
  { id: "careful", ch: "future", name: "Careful pilot", desc: "Soft touchdown, Surveyor below 10% of 1969" },
  { id: "guardian", ch: "future", name: "Heritage guardian", desc: "Completed the Apollo 11 mission" },
  { id: "builder", ch: "future", name: "Base builder", desc: "Completed the cargo mission" },
  { id: "master", ch: "future", name: "Mission master", desc: "Got 3 stars on a mission" },
  { id: "scout", ch: "future", name: "Heritage scout", desc: "Explored heritage on the Moon, on Mars and in deep space" },
];
const store = {
  get() { try { return JSON.parse(localStorage.getItem("mcm-progress") || "{}"); } catch (e) { return {}; } },
  set(v) { try { localStorage.setItem("mcm-progress", JSON.stringify(v)); } catch (e) { /* storage blocked */ } },
};
const progress = Object.assign({ badges: {}, stars: {} }, store.get());
const MEDAL_HUES = ["#f3c14b", "#5eadff", "#4fd38e", "#ff9f45", "#c792ff", "#ff6a55", "#7ee0d2", "#ffe39a"];
function medal(i) {
  const c = MEDAL_HUES[i % MEDAL_HUES.length];
  return `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M15 3h7l2 13-7 2zM33 3h-7l-2 13 7 2z" fill="${c}" opacity=".55"/>
    <circle cx="24" cy="30" r="14" fill="${c}"/><circle cx="24" cy="30" r="10" fill="none" stroke="#17110a" stroke-opacity=".35" stroke-width="2"/>
    <path d="M24 23l2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7z" fill="#17110a" fill-opacity=".55"/></svg>`;
}
let toastTimer = 0;
function toast(html) {
  const t = document.getElementById("toast");
  t.innerHTML = html; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
}
function award(id) {
  if (progress.badges[id] || window.__tourOn) return;
  progress.badges[id] = Date.now(); store.set(progress);
  const i = BADGES.findIndex((b) => b.id === id), b = BADGES[i];
  toast(`${medal(i)}<div><b>Badge earned: ${b.name}</b><div class="muted" style="font-size:13px">${b.desc}</div></div>`);
  updateProgress();
}
function renderBadges() {
  document.getElementById("badges").innerHTML = BADGES.map((b, i) =>
    `<div class="badge ${progress.badges[b.id] ? "" : "locked"}">${medal(i)}<b>${b.name}</b><small>${b.desc}</small></div>`).join("");
}
function updateProgress() {
  const n = BADGES.filter((b) => progress.badges[b.id]).length;
  document.getElementById("badgeCount").textContent = `${n}/${BADGES.length}`;
  document.getElementById("progressBar").style.width = `${n / BADGES.length * 100}%`;
  document.querySelectorAll(".chapnav a").forEach((a) => {
    const own = BADGES.filter((b) => b.ch === a.dataset.ch);
    a.classList.toggle("done", own.length > 0 && own.every((b) => progress.badges[b.id]));
  });
  renderBadges();
}
const drawer = document.getElementById("drawer");
document.getElementById("badgeBtn").onclick = () => { renderBadges(); drawer.hidden = false; document.getElementById("drawerClose").focus(); };
document.getElementById("drawerClose").onclick = () => { drawer.hidden = true; };
drawer.addEventListener("click", (e) => { if (e.target === drawer) drawer.hidden = true; });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") drawer.hidden = true; });
document.getElementById("resetProgress").onclick = () => {
  progress.badges = {}; progress.stars = {}; store.set(progress);
  seenParts.clear(); seenSteps.clear(); renderParts(); renderStepTabs(); renderMissions(); updateProgress();
};

// Router: one chapter on screen. The map lives in chapter 4.
const planner = document.getElementById("planner");
document.getElementById("slot-future").appendChild(planner);
let currentCh = "";
function showChapter(ch) {
  const ALL = ["intro", ...CHAPTERS];
  if (!ALL.includes(ch)) ch = "intro";
  ALL.forEach((c) => { document.getElementById("ch-" + c).hidden = c !== ch; });
  document.querySelectorAll(".chapnav a").forEach((a) => a.setAttribute("aria-current", a.dataset.ch === ch ? "page" : "false"));
  if (currentCh && currentCh !== ch) window.scrollTo(0, 0);
  currentCh = ch;
  if (ch === "simulation") { showStation(ST.simulation.i, false, "simulation"); startStepLoop(); }
  if (ch === "future") showStation(ST.future.i, false, "future");
  if (ch !== "future") stopGame(true);
  if (ch === "apollo") drawDustScene(0);
}
window.addEventListener("hashchange", () => showChapter(location.hash.slice(1)));

// Stations (chapters 3 and 4): one tool on screen at a time.
const ST = { simulation: { i: 0, seen: new Set() }, future: { i: 0, seen: new Set() } };
let station = 0;   // chapter 3's station, read by its animations
function showStation(i, scroll, ch) {
  ch = ch || (currentCh === "future" ? "future" : "simulation");
  const root = document.getElementById("ch-" + ch), st = ST[ch];
  st.i = i; st.seen.add(i);
  root.querySelectorAll(".station").forEach((s) => { s.hidden = +s.dataset.station !== i; });
  root.querySelectorAll(".stations button").forEach((b) => {
    const k = +b.dataset.station;
    b.setAttribute("aria-current", k === i ? "step" : "false");
    b.classList.toggle("seen", st.seen.has(k));
  });
  if (ch === "simulation") {
    station = i;
    if (i === 0) startStepLoop();
    if (i === 1 && typeof mcDraw === "function") { mcDraw(); mcChart(); }
    if (i === 2 && typeof renderUP === "function") renderUP();
  } else {
    if (i !== 2) stopGame(true);
    if (i === 0 && typeof resize === "function") { resize(); render(); }   // map was hidden: size it now
  }
  if (scroll) root.querySelector(".stations").scrollIntoView({ behavior: "smooth", block: "start" });
}
// Jump to the dust map (chapter 4, station 1) from anywhere in chapter 4
function showMap() {
  showStation(0, false, "future");
  requestAnimationFrame(() => document.getElementById("mapbox").scrollIntoView({ behavior: "smooth", block: "center" }));
}
document.querySelectorAll(".stations button").forEach((b) => { b.onclick = () => showStation(+b.dataset.station, false, b.closest(".chapter").dataset.ch); });
document.querySelectorAll("[data-station-go]").forEach((b) => { b.onclick = () => showStation(+b.dataset.stationGo, true, b.closest(".chapter").dataset.ch); });
document.querySelectorAll("[data-go]").forEach((b) => { b.onclick = () => { location.hash = "#" + b.dataset.go; }; });

/* =====================================================================
   CHAPTER 1: Surveyor 3 hotspots
   ===================================================================== */
// Positions are percentages on photo AS12-48-7100 (1200 x 865).
const PARTS = [
  { x: 47.9, y: 28.5, t: "Solar panel and antenna",
    b: "On top of the mast sit a solar panel, which turned sunlight into electricity, and a flat antenna that beamed pictures and measurements to Earth.",
    f: "No sunlight, no power. That is why the two-week lunar night was so dangerous for Surveyor." },
  { x: 56.1, y: 49.0, t: "TV camera",
    b: "The camera looked into a tilting mirror to photograph the landscape all around. Surveyor 3 sent 6,326 pictures to Earth.",
    f: "In 1969 Pete Conrad cut this camera off and brought it home. Scientists then studied the pits on it." },
  { x: 80.2, y: 63.4, t: "Scoop arm",
    b: "A folding arm with a small scoop at the end. It reached 1.5 m from the lander and dug up to 18 cm deep to test how firm the ground is.",
    f: "Surveyor 3 was the first Surveyor that could dig on the Moon." },
  { x: 62.1, y: 79.5, t: "Landing legs",
    b: "Three legs with crushable footpads softened the landing. Surveyor 3's engine didn't switch off in time, so it bounced twice, first 10 m and then 3 m high.",
    f: "The marks from those bounces showed engineers how the soil squashes." },
  { x: 40.7, y: 60.7, t: "Electronics boxes",
    b: "These boxes held the electronics. Their mirror-like tops reflected sunlight so the electronics wouldn't overheat during the long lunar day.",
    f: "In sunlight the Moon's surface gets hotter than boiling water. At night it is colder than −150 °C." },
];
const seenParts = new Set();
const photoEl = document.getElementById("surveyorPhoto");
PARTS.forEach((p, i) => {
  const b = document.createElement("button");
  b.type = "button"; b.className = "hotspot"; b.id = "part-" + i;
  b.style.left = p.x + "%"; b.style.top = p.y + "%";
  b.setAttribute("aria-label", p.t);
  b.onclick = () => showPart(i);
  photoEl.appendChild(b);
});
function renderParts(active) {
  PARTS.forEach((_, i) => {
    const b = document.getElementById("part-" + i);
    b.classList.toggle("seen", seenParts.has(i));
    b.setAttribute("aria-pressed", i === active ? "true" : "false");
  });
  document.getElementById("partDots").innerHTML = PARTS.map((_, i) => `<i class="${seenParts.has(i) ? "on" : ""}"></i>`).join("");
  document.getElementById("partCount").textContent = `${seenParts.size} of ${PARTS.length} checked`;
}
function showPart(i) {
  const p = PARTS[i];
  seenParts.add(i);
  document.getElementById("partTitle").textContent = p.t;
  document.getElementById("partText").textContent = p.b;
  const f = document.getElementById("partFact"); f.textContent = p.f; f.hidden = false;
  renderParts(i);
  if (seenParts.size === PARTS.length) award("explorer");
}

/* =====================================================================
   CHAPTER 2: side-view dust animation + pit square
   ===================================================================== */
const dc = document.getElementById("dustCanvas"), dctx = dc.getContext("2d");
const DC = { W: 960, H: 320, ground: 270, sx: 960 / 205, sz: 6.0, x0: 30 };   // metres -> px
const dpx = (x) => DC.x0 + (x + 10) * DC.sx, dpz = (z) => DC.ground - z * DC.sz;
let dustRun = null;
function drawSurveyorIcon(c, x, y, s) {
  c.save(); c.translate(x, y); c.scale(s, s);
  c.strokeStyle = "#d9d6cc"; c.lineWidth = 2; c.beginPath();
  c.moveTo(0, -30); c.lineTo(-16, 0); c.moveTo(0, -30); c.lineTo(16, 0); c.moveTo(0, -30); c.lineTo(0, -48); c.stroke();
  c.fillStyle = "#c9c4b6"; c.fillRect(-7, -36, 14, 9);
  c.fillStyle = "#5d7fb0"; c.fillRect(-12, -54, 24, 6);
  c.restore();
}
function drawLM(c, x, y, s, flame) {
  c.save(); c.translate(x, y); c.scale(s, s);
  if (flame) { const g = c.createRadialGradient(0, 4, 0, 0, 4, 18); g.addColorStop(0, "rgba(255,240,200,.95)"); g.addColorStop(1, "rgba(255,190,110,0)"); c.fillStyle = g; c.beginPath(); c.arc(0, 6, 18, 0, Math.PI * 2); c.fill(); }
  c.strokeStyle = "#d9d6cc"; c.lineWidth = 2; c.beginPath(); c.moveTo(-20, 0); c.lineTo(-12, -16); c.moveTo(20, 0); c.lineTo(12, -16); c.stroke();
  c.fillStyle = "#c8a24a"; c.fillRect(-14, -24, 28, 11);
  c.fillStyle = "#c9c6bd"; c.beginPath(); c.moveTo(-11, -24); c.lineTo(-8, -40); c.lineTo(8, -40); c.lineTo(11, -24); c.fill();
  c.restore();
}
const dStars = Array.from({ length: 70 }, (_, i) => { const r = hash(5, i, 7, 2); return [r() * 960, r() * 200, r() * 1.2 + .3]; });
function drawDustScene(t) {
  const c = dctx; c.clearRect(0, 0, DC.W, DC.H);
  c.fillStyle = "#05060a"; c.fillRect(0, 0, DC.W, DC.H);
  for (const [x, y, r] of dStars) { c.fillStyle = "rgba(232,230,223,.7)"; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }
  c.fillStyle = "#77736c"; c.fillRect(0, DC.ground, DC.W, DC.H - DC.ground);
  c.fillStyle = "#8a867e"; c.fillRect(0, DC.ground, DC.W, 3);
  // distance ruler
  c.font = "12px " + css("--font-data"); c.fillStyle = "#cfd3da"; c.strokeStyle = "rgba(255,255,255,.35)";
  for (let m = 0; m <= 175; m += 25) { const x = dpx(m); c.beginPath(); c.moveTo(x, DC.ground + 6); c.lineTo(x, DC.ground + 12); c.stroke(); c.fillText(m + " m", x - 12, DC.ground + 28); }
  drawSurveyorIcon(c, dpx(155), DC.ground, 1);
  c.fillStyle = "#eeece6"; c.font = "600 13px " + css("--font-body"); c.fillText("Surveyor 3", dpx(155) - 32, DC.ground - 62);
  const r = dustRun;
  const h = r ? r.h : 34;
  drawLM(c, dpx(0), dpz(h), 1.2, r && r.engine);
  if (r) {
    c.lineWidth = 1.6;
    for (const p of r.parts) {
      c.strokeStyle = `rgba(232,224,206,${(p.life * .8).toFixed(3)})`;
      c.beginPath(); c.moveTo(dpx(p.x), dpz(p.z)); c.lineTo(dpx(p.x - Math.sign(p.vx) * 4), dpz(p.z - p.vz / Math.abs(p.vx) * 4)); c.stroke();
    }
    if (r.flash > 0) { c.fillStyle = `rgba(255,106,85,${r.flash.toFixed(2)})`; c.beginPath(); c.arc(dpx(155), DC.ground - 22, 26, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = "#f3c14b"; c.font = "600 14px " + css("--font-data");
    c.fillText(`altitude ${h.toFixed(1)} m`, 20, 28);
    c.fillText(`grains hitting Surveyor: ${r.hits}`, 20, 50);
    if (r.done) { c.fillStyle = "#eeece6"; c.font = "700 18px " + css("--font-display"); c.fillText("Contact light. Surveyor 3 just got sandblasted from 155 m.", 20, 80); }
  } else {
    c.fillStyle = "#cfd3da"; c.font = "600 15px " + css("--font-body"); c.fillText("Intrepid on final approach. Press play.", 20, 32);
  }
  // angle label
  c.strokeStyle = "rgba(243,193,75,.7)"; c.setLineDash([5, 5]); c.beginPath();
  c.moveTo(dpx(10), dpz(0.3)); c.lineTo(dpx(150), dpz(150 * Math.tan(3 * Math.PI / 180))); c.stroke(); c.setLineDash([]);
  c.fillStyle = "#f3c14b"; c.font = "12px " + css("--font-data"); c.fillText("3° dust sheet", dpx(80), dpz(80 * .0524) - 8);
}
document.getElementById("dustPlay").onclick = () => {
  if (dustRun && !dustRun.done) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  dustRun = { t0: 0, h: 34, engine: true, parts: [], hits: 0, flash: 0, done: false, last: 0 };
  const T = 7000;
  const step = (now) => {
    const r = dustRun; if (!r) return;
    if (!r.t0) { r.t0 = now; r.last = now; }
    const t = now - r.t0, dt = Math.min((now - r.last) / 1000, .05); r.last = now;
    const u = Math.min(t / T, 1);
    r.h = reduce ? 2 : 2 + 32 * Math.pow(1 - u, 1.8);
    r.engine = u < 1;
    if (r.engine) {
      const rate = 260 * (1 - r.h / 40);                     // more dust near the ground
      for (let k = 0; k < rate * dt; k++) {
        const dir = Math.random() < .55 ? 1 : -1, ang = (1 + Math.random() * 2) * Math.PI / 180;
        const v = 90 + Math.random() * 160;                   // display speed, time is compressed
        r.parts.push({ x: dir * Math.random() * Math.min(r.h, 12), z: 0.2, vx: dir * v, vz: v * Math.tan(ang), life: 1 });
      }
    }
    for (const p of r.parts) {
      const px0 = p.x; p.x += p.vx * dt; p.z += p.vz * dt; p.life -= dt * .45;
      if (p.vx > 0 && px0 < 153 && p.x >= 153 && p.z < 4.5) { r.hits++; r.flash = .8; p.life = 0; }
    }
    r.parts = r.parts.filter((p) => p.life > 0 && p.x < 220 && p.x > -20);
    r.flash = Math.max(0, r.flash - dt * 2);
    if (u >= 1 && r.parts.length === 0) { r.done = true; drawDustScene(t); award("witness"); return; }
    drawDustScene(t);
    if (currentCh === "apollo") requestAnimationFrame(step); else dustRun = null;
  };
  requestAnimationFrame(step);
};
(function drawPits() {
  const c = document.getElementById("pitCanvas").getContext("2d"), N = 560;
  const g = c.createLinearGradient(0, 0, N, N); g.addColorStop(0, "#c9cbcf"); g.addColorStop(.5, "#a9adb3"); g.addColorStop(1, "#d7d9dc");
  c.fillStyle = g; c.fillRect(0, 0, N, N);
  for (let k = 0; k < 600; k++) { const r = hash(3, k, 1, 9); c.fillStyle = `rgba(255,255,255,${(r() * .08).toFixed(3)})`; c.fillRect(r() * N, 0, 1, N); }
  const rnd = hash(42, 1, 0, 3), rad = N * 0.0040;     // 80 um wide pits on a 1 cm square
  for (let k = 0; k < 103; k++) {
    const x = 8 + rnd() * (N - 16), y = 8 + rnd() * (N - 16), s = rad * (0.6 + rnd() * 0.9);
    c.fillStyle = "rgba(40,40,44,.85)"; c.beginPath(); c.ellipse(x, y, s * 1.12, s, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "rgba(255,255,255,.55)"; c.lineWidth = 1; c.beginPath(); c.arc(x + .6, y + .6, s, Math.PI * .1, Math.PI * .9); c.stroke();
  }
  c.fillStyle = "#17110a"; c.fillRect(20, N - 30, N * 0.1, 4);
  c.font = "600 18px JetBrains Mono, monospace"; c.fillText("1 mm", 20, N - 40);
})();

/* =====================================================================
   CHAPTER 3a: four model steps with small animations
   ===================================================================== */
const STEPS = [
  { t: "Blast", h: "1 · The blast",
    b: "The engine's exhaust hits the ground at about 3 km/s and spreads out sideways, like a very strong wind. It drags the loose top layer of dust along and throws it up.",
    n: `<p>The model computes the wind along the ground (the wall shear stress) from the gas speed and its temperature-dependent viscosity:</p>
        <span class="formula">τ = μ(T) · ∂v<sub>r</sub>/∂z</span>
        <p>Three erosion laws turn that into kilograms of dust per second, because scientists still disagree which is right:</p>
        <ul><li>Shear scaling: <code>ṁ = 0.0222 · τ^2.52</code> (Lane &amp; Metzger 2015)</li><li>Roberts' excess-shear theory</li><li>Energy flux (Metzger 2024)</li></ul>` },
  { t: "Fly", h: "2 · The flight",
    b: "Each grain flies off almost flat, only a few degrees up. There is no air on the Moon to slow it, so it keeps going until gravity brings it down. Small grains are the fastest, up to about 2 km/s.",
    n: `<p>Every grain flies on a ballistic path in lunar gravity, with a small correction because the Moon is round:</p>
        <span class="formula">x = v·cosθ·t,  z = v·sinθ·t − ½·g·t² + x²/(2R)</span>
        <p><code>g = 1.62 m/s²</code>, <code>R = 1737 km</code>. Launch angles come from six Apollo landing films (1.4° to 8.1°, ±0.5°). Launch speeds come from two models: a drag calculation and a fit to Lane &amp; Metzger's Fig. 5. That is 10 million grains for every combination.</p>` },
  { t: "Hit", h: "3 · The hit",
    b: "When a grain hits metal it punches a tiny crater. Faster and bigger grains make bigger pits. That is what scientists saw on Surveyor 3's parts.",
    n: `<p>Crater volume from Sheldon &amp; Kanhere (1972):</p>
        <span class="formula">V = K<sub>D</sub> · v³ · D³ · ρ<sup>1.5</sup> · H<sub>V</sub><sup>−1.5</sup></span>
        <p><code>ρ = 3100 kg/m³</code> (grain), <code>H_V = 1.05 GPa</code> (aluminium). The constant <code>K_D</code> was a placeholder (1). Comparing with Surveyor 3's real pits showed it must be at least about 100; the exact value depends on how the 2011 study counted small pits.</p>` },
  { t: "Check", h: "4 · The check",
    b: "We tested every version of the model against the real pits on Surveyor 3. Only the versions that got the pit count right stay in. The map below uses just those.",
    n: `<p>Every result is scaled to the one real measurement:</p>
        <span class="formula">exposure(d) = model(d) / model(Surveyor 3) × 103 pits/cm²</span>
        <p>A model variant is kept if, after calibrating the crater size, its predicted number of pits ≥ 20 µm at Surveyor 3 lies between about 34/cm² and 4000/cm² (the coupon average and the tube's worst spots).</p>` },
];
const seenSteps = new Set();
let stepIdx = 0, stepLoop = 0, stepT0 = 0;
const sc = document.getElementById("stepCanvas"), sctx = sc.getContext("2d");
function renderStepTabs() {
  document.getElementById("stepTabs").innerHTML = STEPS.map((s, i) =>
    `<button type="button" role="tab" id="step-${i}" aria-selected="${i === stepIdx}" class="${seenSteps.has(i) ? "seen" : ""}"><b>${seenSteps.has(i) ? "✓" : i + 1}</b>${s.t}</button>`).join("");
  STEPS.forEach((_, i) => { document.getElementById("step-" + i).onclick = () => showStep(i); });
}
function showStep(i) {
  stepIdx = i; seenSteps.add(i); stepT0 = performance.now();
  const s = STEPS[i];
  document.getElementById("stepTitle").textContent = s.h;
  document.getElementById("stepText").textContent = s.b;
  let nerd = s.n;
  if (i === 3 && D.branch_filter && D.branch_filter.applied) nerd += `<p><b>${D.branch_filter.n_kept} of ${D.branch_filter.n_total}</b> variants pass this test.</p>`;
  document.getElementById("stepNerd").innerHTML = nerd;
  renderStepTabs();
  if (seenSteps.size === STEPS.length) award("physicist");
}
function stepFrame(now) {
  const t = (now - stepT0) / 1000, c = sctx, Wc = 720, Hc = 440, G0 = 360;
  c.clearRect(0, 0, Wc, Hc); c.fillStyle = "#05060a"; c.fillRect(0, 0, Wc, Hc);
  c.font = "13px " + css("--font-data");
  const ground = () => { c.fillStyle = "#77736c"; c.fillRect(0, G0, Wc, Hc - G0); c.fillStyle = "#8a867e"; c.fillRect(0, G0, Wc, 3); };
  if (stepIdx === 0) {
    ground();
    const cx = 360, ny = 150;
    const g = c.createLinearGradient(0, ny, 0, G0); g.addColorStop(0, "rgba(255,236,190,.85)"); g.addColorStop(1, "rgba(255,190,110,.05)");
    c.fillStyle = g; c.beginPath(); c.moveTo(cx - 18, ny); c.lineTo(cx + 18, ny); c.lineTo(cx + 120, G0); c.lineTo(cx - 120, G0); c.fill();
    drawLM(c, cx, ny, 2.2, false);
    for (let k = 0; k < 6; k++) {
      const f = ((t * .9 + k / 6) % 1);
      for (const dir of [-1, 1]) {
        const x = cx + dir * (60 + f * 280);
        c.strokeStyle = `rgba(243,193,75,${(1 - f).toFixed(2)})`; c.lineWidth = 2;
        c.beginPath(); c.moveTo(x, G0 - 8); c.lineTo(x + dir * 22, G0 - 8); c.lineTo(x + dir * 15, G0 - 13); c.stroke();
      }
    }
    for (let k = 0; k < 40; k++) {
      const r = hash(11, k, 2, 2), dir = r() < .5 ? -1 : 1, f = (t * (.5 + r()) + r()) % 1;
      const x = cx + dir * (90 + f * 300), z = 4 + f * 40 * r();
      c.fillStyle = `rgba(232,224,206,${(1 - f).toFixed(2)})`; c.fillRect(x, G0 - z, 2.5, 2.5);
    }
    c.fillStyle = "#eeece6"; c.fillText("exhaust ≈ 3 km/s", cx + 40, 120); c.fillText("wind along the ground lifts the dust", 30, G0 + 40);
  } else if (stepIdx === 1) {
    ground(); drawLM(c, 70, G0, 1.4, true);
    const grains = [[1, "1 µm grain", 1.0, "#ffe9b0", 2], [50, "50 µm grain", .55, "#f3c14b", 3.5], [500, "500 µm grain", .22, "#ff9f45", 5]];
    grains.forEach(([d, lab, sp, col, size], k) => {
      const f = (t * sp * .35 + k * .2) % 1;
      const x = 90 + f * 620, z = Math.max(0, f * 620 * Math.tan(2.5 * Math.PI / 180) * (1 - f * (1.2 - sp)) * 2.2);
      c.strokeStyle = col; c.globalAlpha = .35; c.setLineDash([4, 5]); c.beginPath(); c.moveTo(90, G0 - 2); c.lineTo(x, G0 - 2 - z); c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
      c.fillStyle = col; c.beginPath(); c.arc(x, G0 - 2 - z, size, 0, Math.PI * 2); c.fill();
      c.fillText(lab, 20, 40 + k * 22);
    });
    c.fillStyle = "#9aa1ad"; c.fillText("small = fast, big = slow; all leave at only a few degrees", 20, 112);
  } else if (stepIdx === 2) {
    const sy = 300;
    const g = c.createLinearGradient(0, sy, 0, Hc); g.addColorStop(0, "#b8bcc2"); g.addColorStop(1, "#6f7379"); c.fillStyle = g; c.fillRect(0, sy, Wc, Hc - sy);
    const f = (t % 3) / 3, hx = 360;
    if (f < .45) { const u = f / .45; c.fillStyle = "#f3c14b"; c.beginPath(); c.arc(80 + u * (hx - 80), 120 + u * (sy - 18 - 120), 14, 0, Math.PI * 2); c.fill(); }
    const grow = Math.min(Math.max((f - .45) / .2, 0), 1);
    if (grow > 0) {
      c.fillStyle = "#3a3c40"; c.beginPath(); c.ellipse(hx, sy, 70 * grow, 52 * grow, 0, 0, Math.PI); c.fill();
      c.fillStyle = "#cfd3d8"; c.beginPath(); c.ellipse(hx - 74 * grow, sy, 10 * grow, 6 * grow, 0, Math.PI, 0); c.ellipse(hx + 74 * grow, sy, 10 * grow, 6 * grow, 0, Math.PI, 0); c.fill();
      for (let k = 0; k < 10; k++) { const a = Math.PI + k / 9 * Math.PI, rr = 70 + (f - .45) * 300; c.fillStyle = `rgba(232,224,206,${Math.max(0, 1 - (f - .45) * 2).toFixed(2)})`; c.fillRect(hx + Math.cos(a) * rr, sy + Math.sin(a) * rr * .6, 3, 3); }
    }
    c.fillStyle = "#eeece6"; c.fillText("dust grain", 40, 100); c.fillText("aluminium surface", 20, sy + 30);
    c.fillStyle = "#17110a"; c.fillRect(hx - 70, Hc - 40, 140, 4); c.fillText("≈ 80 µm", hx - 30, Hc - 48);
    c.fillStyle = "#f3c14b"; c.fillText("crater size grows with speed³ × size³", 20, 40);
  } else {
    const n = D.branch_filter && D.branch_filter.applied ? D.branch_filter.n_total : 36;
    const keep = D.branch_filter && D.branch_filter.applied ? new Set(D.branch_filter.kept) : null;
    const kept = keep ? keep.size : n;
    const cols = 9, rows = Math.ceil(n / cols), cell = 58, ox = (Wc - cols * cell) / 2 + cell / 2, oy = 90;
    const reveal = Math.min(t / 2.5, 1) * n;
    let shown = 0;
    // stable order: kept first so the reveal reads clearly
    for (let i = 0; i < n; i++) {
      const x = ox + (i % cols) * cell, y = oy + Math.floor(i / cols) * cell;
      const ok = i < kept, on = i < reveal;
      c.fillStyle = on ? (ok ? "#f3c14b" : "#3a3f4b") : "#1a1e27";
      c.beginPath(); c.arc(x, y, 18, 0, Math.PI * 2); c.fill();
      if (on && !ok) { c.strokeStyle = "#ff6a55"; c.lineWidth = 2.5; c.beginPath(); c.moveTo(x - 9, y - 9); c.lineTo(x + 9, y + 9); c.moveTo(x + 9, y - 9); c.lineTo(x - 9, y + 9); c.stroke(); }
      if (on) shown++;
    }
    c.fillStyle = "#eeece6"; c.font = "600 18px " + css("--font-display");
    c.fillText(`${Math.min(shown, kept)} of ${n} model versions match Surveyor 3`, 40, 44);
    c.font = "13px " + css("--font-data"); c.fillStyle = "#9aa1ad";
    c.fillText("gold = matches the 103 pits/cm²   ✕ = thrown out", 40, oy + rows * cell + 10);
  }
  if (currentCh === "simulation" && station === 0 && !document.hidden) stepLoop = requestAnimationFrame(stepFrame); else stepLoop = 0;
}
function startStepLoop() { if (!stepLoop) { stepT0 = stepT0 || performance.now(); stepLoop = requestAnimationFrame(stepFrame); } }
document.addEventListener("visibilitychange", () => { if (!document.hidden && currentCh === "simulation") startStepLoop(); });

/* =====================================================================
   CHAPTER 3b: Touchdown mini-game (side view)
   ===================================================================== */
const gc = document.getElementById("gameCanvas"), gctx = gc.getContext("2d");
const gameLanderSel = document.getElementById("gameLander");
D.landers.forEach((l, i) => gameLanderSel.add(new Option(l.name.replace(/[()]/g, ""), i)));
gameLanderSel.value = D.landers.findIndex((l) => l.thrust_N === 11600);
const GM = { W: 0, H: 0, dpr: 1, run: false, raf: 0, keys: {}, s: null };
const gStars = Array.from({ length: 90 }, (_, i) => { const r = hash(8, i, 4, 4); return [r(), r() * .7, r() * 1.2 + .3]; });
function gResize() {
  const r = gc.getBoundingClientRect(); GM.dpr = Math.min(window.devicePixelRatio || 1, 2);
  GM.W = r.width; GM.H = r.height; gc.width = Math.round(GM.W * GM.dpr); gc.height = Math.round(GM.H * GM.dpr);
  gDraw();
}
new ResizeObserver(gResize).observe(gc);
function gNew() {
  return { x: -520, h: 120, vx: 14, vz: -3, fuel: 1, thrust: false, parts: [], over: null, t: 0 };
}
function gDraw() {
  if (!GM.W) return;
  const c = gctx, s = GM.s || gNew(), W2 = GM.W, H2 = GM.H;
  c.setTransform(GM.dpr, 0, 0, GM.dpr, 0, 0);
  const span = W2 < 520 ? 240 : 360, k = W2 / span, gy = H2 - 46;
  const camX = s.x;
  const X = (x) => W2 / 2 + (x - camX) * k, Z = (z) => gy - z * k;
  c.fillStyle = "#04050a"; c.fillRect(0, 0, W2, H2);
  for (const [fx, fy, r] of gStars) { c.fillStyle = "rgba(232,230,223,.75)"; c.beginPath(); c.arc(((fx * W2 * 3 - camX * k * .05) % W2 + W2) % W2, fy * H2, r, 0, Math.PI * 2); c.fill(); }
  if (!GM.pat && typeof regolithTexture === "function") GM.pat = c.createPattern(regolithTexture(), "repeat");
  const off = ((-camX * k) % 512 + 512) % 512;
  c.save(); c.translate(off, gy); c.fillStyle = GM.pat || "#77736c"; c.fillRect(-off, 0, W2 + 512, H2 - gy); c.restore();
  const gg = c.createLinearGradient(0, gy, 0, H2); gg.addColorStop(0, "rgba(255,250,235,.10)"); gg.addColorStop(1, "rgba(0,0,0,.45)");
  c.fillStyle = gg; c.fillRect(0, gy, W2, H2 - gy); c.fillStyle = "rgba(235,230,218,.55)"; c.fillRect(0, gy, W2, 1.5);
  c.font = "11px " + css("--font-data"); c.fillStyle = "#e6e3da";
  const first = Math.floor((camX - span) / 50) * 50;
  for (let m = first; m < camX + span; m += 50) {
    const x = X(m); c.fillStyle = "rgba(0,0,0,.35)"; c.fillRect(x, gy + 6, 1.5, 8);
    c.fillStyle = "#1b1c1f"; c.fillText(`${Math.abs(m)} m`, x + 3, gy + 26);
  }
  drawSurveyorIcon(c, X(0), gy, Math.max(.7, k * 3 / 48 * 1.6));
  c.fillStyle = "#eeece6"; c.font = "600 12px " + css("--font-body"); c.fillText("Surveyor 3", X(0) - 30, gy - 58);
  c.lineWidth = 1.5;
  for (const p of s.parts) { c.strokeStyle = `rgba(232,224,206,${(p.life * .8).toFixed(3)})`; c.beginPath(); c.moveTo(X(p.x), Z(p.z)); c.lineTo(X(p.x - Math.sign(p.vx) * 6), Z(p.z)); c.stroke(); }
  const ls = Math.max(.9, k * 9 / 40);
  if (s.h > .1) { c.fillStyle = "rgba(0,0,0,.35)"; c.beginPath(); c.ellipse(X(s.x), gy + 2, 16 * ls, 3, 0, 0, Math.PI * 2); c.fill(); }
  drawLM(c, X(s.x), Z(s.h), ls, s.thrust && s.fuel > 0);
  // HUD
  const vzTxt = (-s.vz).toFixed(1), vxTxt = Math.abs(s.vx).toFixed(1);
  document.getElementById("hud").innerHTML =
    `<span>Altitude</span><b>${s.h.toFixed(1)} m</b>
     <span>Down speed</span><b class="${-s.vz > 2 && s.h < 25 ? "warn" : ""}">${vzTxt} m/s</b>
     <span>Sideways</span><b class="${Math.abs(s.vx) > 1.5 && s.h < 25 ? "warn" : ""}">${vxTxt} m/s</b>
     <span>Fuel</span><b class="${s.fuel < .2 ? "warn" : ""}">${Math.round(s.fuel * 100)}%</b>
     <span>To Surveyor</span><b>${fmtD(Math.abs(s.x))}</b>`;
}
function gStep(now) {
  const s = GM.s; if (!s || !GM.run) return;
  const dt = Math.min((now - (GM.last || now)) / 1000, .05); GM.last = now;
  const up = (GM.keys.up) && s.fuel > 0, left = GM.keys.left && s.fuel > 0, right = GM.keys.right && s.fuel > 0;
  s.thrust = up;
  const az = (up ? 3.2 : 0) - 1.62, ax = (left ? -1.6 : 0) + (right ? 1.6 : 0);
  s.fuel = Math.max(0, s.fuel - dt * ((up ? 1 / 40 : 0) + ((left || right) ? 1 / 160 : 0)));
  s.vz += az * dt; s.vx += ax * dt; s.h += s.vz * dt; s.x += s.vx * dt;
  if (up && s.h < 34) {
    for (let k = 0; k < 120 * dt * (1 - s.h / 40); k++) {
      const dir = Math.random() < .5 ? -1 : 1, v = 60 + Math.random() * 120;
      s.parts.push({ x: s.x + dir * Math.random() * 5, z: .2, vx: dir * v, vz: v * .04, life: 1 });
    }
  }
  for (const p of s.parts) { p.x += p.vx * dt; p.z += p.vz * dt; p.life -= dt * .7; }
  s.parts = s.parts.filter((p) => p.life > 0);
  if (s.h <= 0) { s.h = 0; land(s); return; }
  gDraw(); GM.raf = requestAnimationFrame(gStep);
}
function land(s) {
  GM.run = false; s.thrust = false; gDraw();
  const soft = -s.vz <= 2 && Math.abs(s.vx) <= 1.5;
  const lander = D.landers[+gameLanderSel.value], d = Math.abs(s.x);
  const exp = interpLog(R, curve(lander, "-3").median, Math.max(d, R[0]));
  const ratio = exp / MEAS;
  const stars = soft ? 1 + (ratio < 1 ? 1 : 0) + (ratio < 0.1 ? 1 : 0) : 0;
  if (soft) award("pilot");
  if (soft && ratio < 0.1) award("careful");
  const st = (n) => [0, 1, 2].map((i) => `<span class="${i < n ? "on" : ""}">★</span>`).join("");
  showOverlay(`
    <span class="label">${soft ? "Contact light" : "Anomaly"}</span>
    <div class="stars">${st(stars)}</div>
    <h3 style="font-size:22px">${soft ? `Touchdown, ${fmtD(d)} from Surveyor 3` : "Houston, we had a hard landing."}</h3>
    <p class="muted">${soft
      ? `The model says Surveyor 3 got <b style="color:var(--fg)">${fmtN(ratio)}×</b> the sandblasting of 1969${d < R[0] ? " (closer than the model grid, value at 25 m)" : ""}. ${ratio >= 1 ? "That's worse than Apollo 12. Flight control is not amused." : ratio >= 0.1 ? "Better than 1969, but still a proper sandblasting." : "Clean landing. Barely a scratch on Surveyor 3."}`
      : `Contact at ${(-s.vz).toFixed(1)} m/s down and ${Math.abs(s.vx).toFixed(1)} m/s sideways. The landing legs want less than 2 and 1.5 m/s. Request another attempt.`}</p>
    <button class="btn primary big" type="button" id="gStart">Try another landing</button>`);
}
function showOverlay(html) {
  document.getElementById("gameCard").innerHTML = html;
  document.getElementById("gameOverlay").hidden = false;
  document.getElementById("gStart").onclick = startGame;
}
function startGame() {
  GM.s = gNew(); GM.run = true; GM.last = 0; GM.keys = {};
  document.getElementById("gameOverlay").hidden = true;
  document.getElementById("touch").hidden = false;
  gc.focus && gc.focus();
  GM.raf = requestAnimationFrame(gStep);
}
function stopGame(silent) {
  if (!GM.run) return;
  GM.run = false; cancelAnimationFrame(GM.raf);
  if (silent) showOverlay(`<span class="label">Hold</span><h3 style="font-size:22px">Landing aborted</h3><button class="btn primary big" type="button" id="gStart">Restart the descent</button>`);
}
showOverlay(`<span class="label">Mini-game</span><h3 style="font-size:24px">Touchdown</h3>
  <p class="muted">You are 120 m up and 520 m out from Surveyor 3. Hold <b style="color:var(--fg)">thrust</b> to slow down, steer with <b style="color:var(--fg)">← →</b>. Touch down gently, and give Surveyor some room.</p>
  <button class="btn primary big" type="button" id="gStart">GO for landing</button>`);
const keyMap = { " ": "up", ArrowUp: "up", w: "up", ArrowLeft: "left", a: "left", ArrowRight: "right", d: "right" };
document.addEventListener("keydown", (e) => { if (GM.run && keyMap[e.key]) { GM.keys[keyMap[e.key]] = true; e.preventDefault(); } });
document.addEventListener("keyup", (e) => { if (keyMap[e.key]) GM.keys[keyMap[e.key]] = false; });
[["tThrust", "up"], ["tLeft", "left"], ["tRight", "right"]].forEach(([id, k]) => {
  const b = document.getElementById(id);
  const on = (e) => { e.preventDefault(); GM.keys[k] = true; b.classList.add("active"); };
  const off = () => { GM.keys[k] = false; b.classList.remove("active"); };
  b.addEventListener("pointerdown", on); b.addEventListener("pointerup", off); b.addEventListener("pointerleave", off); b.addEventListener("pointercancel", off);
});

/* =====================================================================
   CHAPTER 4: missions
   ===================================================================== */
const MISSIONS = [
  { id: "m1", badge: "guardian", title: "Heritage visit", site: 1, thrust: 11600, f: 0.1, dest: 0, walk: 3000, who: "Crew walk", budget: 10,
    text: "A crew is headed for Tranquility Base. Eagle and the laser reflector must get less than 10% of the dust Surveyor 3 got. The crew walks, so don't land too far away." },
  { id: "m2", badge: "builder", title: "Cargo for the base", site: 2, thrust: 44000, f: 0.1, dest: 0, walk: 3000, who: "Rover drive", budget: 40,
    text: "Heavy cargo for the south pole base. The habitat and the solar arrays must get less than 10% of the dust Surveyor 3 got. A rover brings the cargo over. Engineering says a landing pad and a berm could help a lot." },
  { id: "m3", badge: null, title: "Small lander, old friend", site: 0, thrust: 3600, f: 1, dest: 0, walk: 1000, who: "Rover drive", budget: 0,
    text: "A small lander drops a rover to visit Surveyor 3. Rule one: nobody sandblasts it harder than Apollo 12 did. That includes the Apollo 12 descent stage and its science station." },
];
// Things you can build. Effects come from the model's mitigation runs (pads and a ring berm at
// 50 m around the landing spot); the crew-day costs are a game rule.
const BUILD = [
  { id: "pad10", kind: "pad", r: 10, name: "Landing pad", size: "20 m across", cost: 6 },
  { id: "pad30", kind: "pad", r: 30, name: "Landing pad", size: "60 m across", cost: 20 },
  { id: "berm1", kind: "berm", h: 1, name: "Ring berm", size: "1 m high", cost: 8 },
  { id: "berm3", kind: "berm", h: 3, name: "Ring berm", size: "3 m high", cost: 18 },
  { id: "berm5", kind: "berm", h: 5, name: "Ring berm", size: "5 m high", cost: 30 },
];
let activeMission = null, missionPhase = "idle";   // phases: place, flying, result
// Walking limit = the model's required distance + 30 %, rounded up to 500 m, so every
// mission stays solvable (but tight) whatever the latest simulation numbers are.
MISSIONS.forEach((m) => {
  const lander = D.landers.find((l) => l.thrust_N === m.thrust);
  if (!lander) return;
  const need = Math.max(...SITES[m.site].objects.map((o) => ringsFor(lander, o.heightKey || "1.5", 1).find((r) => r.f === m.f).med));
  if (isFinite(need)) m.walk = Math.ceil(need * 1.3 / 500) * 500;
  // building needs the model's mitigation runs for this thrust at this threshold
  const pd = D.mitigation && D.mitigation.practical_distance;
  if (!pd || !pd[`${m.thrust / 1000} kN | no mitigation`] || m.f !== D.mitigation.threshold_x_surveyor) m.budget = 0;
});
const limitText = (m) => m.f >= 1 ? "no more dust than Surveyor 3 got in 1969" : `less than ${Math.round(m.f * 100)}% of the dust Surveyor 3 got`;
const inf = (x) => (x == null ? Infinity : x);
const itemName = (it) => it.kind === "pad" ? `Landing pad (${it.r * 2} m across)` : `Ring berm (${it.h} m high)`;
// Which mitigation run applies to the items the lander actually touched down on
function mitigationBand(m, act) {
  if (!act.pad && !act.berm) return null;
  const pd = D.mitigation && D.mitigation.practical_distance, T = `${m.thrust / 1000} kN | `;
  if (!pd) return null;
  const padB = act.pad ? pd[`${T}pad, ${act.pad} m radius`] : null, bermB = act.berm ? pd[`${T}berm ${act.berm} m at 50 m`] : null;
  if (padB && bermB) {
    const both = act.pad === 30 && act.berm === 3 ? pd[`${T}pad 30 m + berm 3 m`] : null;
    if (both) return { b: both, conservative: false };
    return { b: inf(padB.median) <= inf(bermB.median) ? padB : bermB, conservative: true };
  }
  const b = padB || bermB;
  return b ? { b, conservative: false } : null;
}
function evaluate(m) {
  const lander = D.landers.find((l) => l.thrust_N === m.thrust);
  const objs = SITES[m.site].objects;
  const act = { pad: 0, berm: 0 }, used = [];
  for (const it of (state.plan && state.plan.items) || []) {
    const on = itemOn(it); used.push({ it, on });
    if (on) act[it.kind] = it.kind === "pad" ? it.r : it.h;
  }
  const mit = mitigationBand(m, act);
  let safe = true, maxReq = 0;
  const rows = objs.map((o) => {
    const d = Math.hypot(o.pos[0] - state.L[0], o.pos[1] - state.L[1]);
    const req = mit ? inf(mit.b.median) : ringsFor(lander, o.heightKey || "1.5", 1).find((r) => r.f === m.f).med;
    const ok = isFinite(req) && d >= req; safe = safe && ok; maxReq = Math.max(maxReq, req);
    return { o, d, req, ok };
  });
  const dDest = Math.hypot(objs[m.dest].pos[0] - state.L[0], objs[m.dest].pos[1] - state.L[1]);
  const walkOk = dDest <= m.walk, eff = dDest <= maxReq * 1.25 + 25;
  const stars = safe ? 1 + (walkOk ? 1 : 0) + (walkOk && eff ? 1 : 0) : 0;
  return { rows, dDest, walkOk, eff, stars, maxReq, used, mit };
}
function renderMissions() {
  document.getElementById("missions").innerHTML = MISSIONS.map((m, i) => {
    const best = progress.stars[m.id] || 0, l = D.landers.find((x) => x.thrust_N === m.thrust), on = activeMission === m;
    return `<div class="mission" aria-current="${on}">
      <span class="label">Mission ${i + 1} · ${SITES[m.site].name}</span><h3>${m.title}</h3>
      <p style="font-size:14px;color:#d6d9df">${m.text}</p>
      <span class="meta">Lander: ${l ? l.name.replace(/[()]/g, "") : ""} · ${m.who}: max ${fmtD(m.walk)}${m.budget ? ` · Build budget: ${m.budget} crew-days` : ""}</span>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:auto">
        <span class="best" aria-label="${best} of 3 stars">${[0, 1, 2].map((k) => `<span class="${k < best ? "on" : ""}">★</span>`).join("")}</span>
        <button class="btn ${on ? "" : "primary"}" type="button" data-mission="${m.id}" ${on ? "disabled" : ""}>${on ? "In progress" : best ? "Fly again" : "Start mission"}</button>
      </div></div>`;
  }).join("");
  document.querySelectorAll("[data-mission]").forEach((b) => { b.onclick = () => startMission(MISSIONS.find((m) => m.id === b.dataset.mission)); });
}

const mPanel = document.getElementById("missionCtl"), freeCtl = document.getElementById("freeCtl"), hintEl = document.getElementById("hint");
const mapBox = document.getElementById("mapbox"), mapResult = document.getElementById("mapResult");
const HINT_FREE = "Tap to set the landing site. Drag to pan, scroll or pinch to zoom.";
const HINT_MISSION = "Tap where the lander should touch down. Drag to pan, scroll or pinch to zoom.";
const isFull = () => document.fullscreenElement === mapBox || mapBox.classList.contains("map-max");
// View that shows the destination and its walking range (used by "fit")
function missionView() {
  if (!activeMission) return null;
  const dest = SITES[activeMission.site].objects[activeMission.dest].pos;
  let half = activeMission.walk * 1.2;
  if (state.plan && state.plan.placed) half = Math.max(half, Math.hypot(state.L[0] - dest[0], state.L[1] - dest[1]) * 1.25);
  return { cx: dest[0], cy: dest[1], half: Math.min(Math.max(half, 150), 14000) };
}
function startMission(m) {
  exitMission(true);
  selectSite(m.site);
  activeMission = m;
  state.lander = D.landers.findIndex((l) => l.thrust_N === m.thrust);
  state.height = 1; state.count = 0;
  document.getElementById("height").value = 1; document.getElementById("count").value = 0;
  const dest = SITES[m.site].objects[m.dest];
  state.L = [dest.pos[0] + m.walk * 3, dest.pos[1]];          // off stage until the player taps
  state.dustFrac = 0;
  state.plan = { placed: false, hideRings: true, walk: { pos: dest.pos, r: m.walk }, ghost: null, rings: null, lastTest: null, items: [] };
  missionPhase = "place";
  document.getElementById("mNum").textContent = `Mission ${MISSIONS.indexOf(m) + 1} of ${MISSIONS.length} · ${SITES[m.site].name}`;
  document.getElementById("mTitle").textContent = m.title;
  document.getElementById("mBrief").textContent = m.text;
  planner.classList.add("mission-mode"); freeCtl.hidden = true; mPanel.hidden = false;
  hintEl.textContent = HINT_MISSION; hintEl.classList.remove("gone");
  hideBanner(); altEl.hidden = true;
  renderTools();
  render();
  flyTo(missionView());
  renderMissions();
  planner.scrollIntoView({ behavior: "smooth", block: "start" });
  if (!window.__tourOn && !guideSeen()) setTimeout(() => { if (activeMission === m) runGuide(); }, 900);
}
function exitMission(quiet) {
  if (!activeMission) return;
  if (anim) { cancelAnimationFrame(anim); anim = null; }
  state.engineOn = false; state.alt = 0;
  activeMission = null; missionPhase = "idle"; state.plan = null; state.dustFrac = 1;
  planner.classList.remove("mission-mode"); freeCtl.hidden = false; mPanel.hidden = true;
  hintEl.textContent = HINT_FREE; altEl.hidden = true; hideBanner();
  renderTools(); renderMissions();
  if (!quiet) selectSite(state.site);
}
// Anything changed after a test: back to planning, keep the last test as a ghost ring
function backToPlanning() {
  const pl = state.plan;
  if (missionPhase === "result" && pl.lastTest) pl.ghost = pl.lastTest;
  pl.hideRings = true; state.dustFrac = 0; missionPhase = "place";
  hideBanner(); altEl.hidden = true;
}
// Called by the map for every tap; true = the mission handled it
function onMapTap(p) {
  if (!activeMission) return false;
  if (missionPhase === "flying") return true;
  const it = itemUnder(...toPx(p[0], p[1]));                  // tap on a pad or berm: land on it
  if (it) p = [it.x, it.y];
  backToPlanning();
  state.L = p; state.plan.placed = true;
  render();
  return true;
}
/* ---------- build tools: drag from the panel (or the full-screen bar) onto the map */
const canAfford = (b) => {
  const pl = state.plan, m = activeMission;
  const spent = pl.items.filter((it) => it.kind !== b.kind).reduce((s, it) => s + BUILD.find((x) => x.id === it.id).cost, 0);
  return spent + b.cost <= m.budget;
};
function renderTools() {
  const m = activeMission, has = !!(m && m.budget);
  document.getElementById("buildBox").hidden = !has;
  document.getElementById("buildNone").hidden = !(m && !m.budget);
  if (!has) { document.querySelectorAll("[data-tools]").forEach((t) => { t.innerHTML = ""; }); return; }
  const pl = state.plan;
  const spent = pl.items.reduce((s, it) => s + BUILD.find((x) => x.id === it.id).cost, 0);
  document.getElementById("mBudget").innerHTML = `<b>${m.budget - spent}</b> of ${m.budget} crew-days left`;
  const html = BUILD.map((b) => {
    const placed = pl.items.some((it) => it.id === b.id), ok = placed || canAfford(b);
    return `<div class="tool-wrap"><button type="button" class="tool" data-item="${b.id}" aria-pressed="${placed}" ${ok ? "" : "disabled"}
      title="Drag onto the map, or tap to drop it under the lander"><i class="ico ${b.kind}${b.kind === "berm" ? " h" + b.h : ""}"></i>
      <span class="long"><b>${b.name}, ${b.size}</b><small>${b.cost} crew-days${placed ? " · on the map" : ""}</small></span><span class="short">${b.kind === "pad" ? "Pad " + b.r * 2 + " m" : "Berm " + b.h + " m"}</span></button>${placed ? `<button type="button" class="tool-x" data-remove="${b.id}" aria-label="Remove ${b.name}, ${b.size}">×</button>` : ""}</div>`;
  }).join("");
  document.querySelectorAll("[data-tools]").forEach((t) => { t.innerHTML = html; });
  bindTools();
}
let toolDrag = null;
function bindTools() {
  document.querySelectorAll("[data-item]").forEach((b) => {
    const def = BUILD.find((x) => x.id === b.dataset.item);
    b.onpointerdown = (e) => {
      if (b.disabled || missionPhase === "flying") return;
      e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or lost pointer */ }
      toolDrag = { def, x: e.clientX, y: e.clientY, moved: false, ghost: null };
    };
    b.onpointermove = (e) => {
      const td = toolDrag; if (!td) return;
      if (!td.moved && Math.hypot(e.clientX - td.x, e.clientY - td.y) > 6) {
        td.moved = true;
        td.ghost = document.createElement("div"); td.ghost.className = "tool-ghost";
        td.ghost.innerHTML = `<i class="ico ${def.kind}${def.kind === "berm" ? " h" + def.h : ""}"></i>${def.name}, ${def.size}`;
        (isFull() ? mapBox : document.body).appendChild(td.ghost);
      }
      if (td.ghost) { td.ghost.style.left = e.clientX + "px"; td.ghost.style.top = e.clientY + "px"; }
    };
    b.onpointerup = (e) => {
      const td = toolDrag; toolDrag = null; if (!td) return;
      if (td.ghost) td.ghost.remove();
      if (!td.moved) { placeTool(def, null); return; }
      const r = canvas.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom)
        placeTool(def, toWorld(e.clientX - r.left, e.clientY - r.top));
    };
    b.onpointercancel = () => { if (toolDrag && toolDrag.ghost) toolDrag.ghost.remove(); toolDrag = null; };
    b.onclick = (e) => { if (e.detail === 0) placeTool(def, null); };     // keyboard
  });
  document.querySelectorAll("[data-remove]").forEach((b) => {
    b.onclick = () => { if (missionPhase === "flying") return; state.plan.items = state.plan.items.filter((it) => it.id !== b.dataset.remove); backToPlanning(); renderTools(); render(); };
  });
}
// Snap a dropped item onto the lander or onto another item if it lands on top of it
function snapItem(it) {
  const pl = state.plan, [px, py] = toPx(it.x, it.y);
  if (pl.placed) {
    const [lx, ly] = toPx(state.L[0], state.L[1]);
    if (Math.hypot(lx - px, ly - py) <= itemPx(it) + 6) { it.x = state.L[0]; it.y = state.L[1]; return; }
  }
  for (const o of pl.items) if (o !== it) {
    const [ox, oy] = toPx(o.x, o.y);
    if (Math.hypot(ox - px, oy - py) <= Math.max(itemPx(o), itemPx(it)) + 6) { it.x = o.x; it.y = o.y; return; }
  }
}
function placeTool(def, w) {
  const m = activeMission; if (!m || !canAfford(def) || missionPhase === "flying") return;
  const pl = state.plan;
  pl.items = pl.items.filter((it) => it.kind !== def.kind);   // one pad and one berm at a time
  if (!w) w = pl.placed ? [...state.L] : [state.view.cx, state.view.cy];
  const it = { id: def.id, kind: def.kind, r: def.r || 0, h: def.h || 0, x: w[0], y: w[1] };
  pl.items.push(it); snapItem(it);
  backToPlanning(); renderTools(); render();
  if (!isFull()) { const r = mapBox.getBoundingClientRect(); if (r.bottom < 80 || r.top > innerHeight - 80) mapBox.scrollIntoView({ behavior: "smooth", block: "center" }); }
}
// Map drags a built item (and the lander with it, if the lander stands on it)
function moveItem(it, w, off) {
  if (missionPhase === "flying") return;
  it.x = w[0]; it.y = w[1];
  if (off) state.L = [w[0] + off[0], w[1] + off[1]];
  if (missionPhase === "result") backToPlanning();
  drawMap(); updateMission();
}
function dropItem(it) { snapItem(it); render(); }

function testLanding() {
  const m = activeMission, pl = state.plan;
  if (!m || !pl.placed || missionPhase === "flying") return;
  const e = evaluate(m), t = THR.find((x) => x.f === m.f) || THR[1];
  pl.rings = e.mit ? [{ ...t, med: inf(e.mit.b.median), lo: inf(e.mit.b.min), hi: inf(e.mit.b.max) }] : null;
  pl.hideRings = false; pl.ghost = null;
  missionPhase = "flying"; updateMission();
  if (!isFull()) { const r = mapBox.getBoundingClientRect(); if (r.top < 60 || r.bottom > innerHeight) mapBox.scrollIntoView({ behavior: "smooth", block: "center" }); }
  const to = [...state.L], k = state.view.half;
  runDescent(to, [to[0] - k * 0.3, to[1] + k * 0.22], "Touchdown", () => showResult(m));
}
function showResult(m) {
  missionPhase = "result";
  const e = evaluate(m), pl = state.plan, dest = SITES[m.site].objects[m.dest];
  const ring = (pl.rings || ringsFor(D.landers[state.lander], "1.5", 1)).find((x) => x.f === m.f) || {};
  pl.lastTest = { L: [...state.L], r: ring.med, col: ring.col || "--r2" };
  if (e.stars > (progress.stars[m.id] || 0)) { progress.stars[m.id] = e.stars; store.set(progress); }
  if (e.stars >= 1 && m.badge) award(m.badge);
  if (e.stars === 3) award("master");
  const stars = [0, 1, 2].map((i) => `<span class="${i < e.stars ? "on" : ""}">★</span>`).join("");
  const bad = e.rows.find((r) => !r.ok), missed = e.used.find((u) => !u.on);
  const tip = !e.stars ? `${bad.o.name} got too much dust. ${missed ? `Your ${itemName(missed.it).toLowerCase()} was not under the lander. ` : ""}Move the lander farther away${m.budget ? ", or build something and land on it," : ""} and test again.`
    : !e.walkOk ? `Everything is safe, but ${dest.name} is ${fmtD(e.dDest)} away. Land closer for more stars.`
    : !e.eff ? "Safe and reachable. Land a little closer to the safety line for the third star."
    : "Textbook landing site. Flight control is happy.";
  const rows = e.rows.map((r) => `<li class="${r.ok ? "ok" : "bad"}">${r.o.name}: ${fmtD(r.d)} away, ${r.ok ? "safe from" : "needs at least"} ${isFinite(r.req) ? fmtD(r.req) : "10 km"}</li>`);
  rows.push(`<li class="${e.walkOk ? "ok" : "bad"}">${m.who} to ${dest.name}: ${fmtD(e.dDest)} (max ${fmtD(m.walk)})</li>`);
  for (const u of e.used) rows.push(`<li class="${u.on ? "ok" : "bad"}">${itemName(u.it)}: ${u.on ? "the lander touched down on it" : (u.it.kind === "berm" ? "the lander was not inside it, no effect" : "the lander missed it, no effect")}</li>`);
  rows.push(`<li class="${e.stars === 3 ? "ok" : ""}">Bonus: no more than 25% farther than needed</li>`);
  const note = e.mit && e.mit.conservative ? `<p class="note">This pad and berm combination was not simulated, so we only count the better of the two (the safe side).</p>` : "";
  const next = MISSIONS[(MISSIONS.indexOf(m) + 1) % MISSIONS.length];
  const html = `<div class="verdict-line">${e.stars ? '<span class="go">GO</span>' : '<span class="nogo">NO-GO</span>'}<span class="stars" aria-label="${e.stars} of 3 stars">${stars}</span></div>
    <p>${tip}</p><ul class="checks">${rows.join("")}</ul>${note}
    <div class="acts"><button class="btn ${e.stars ? "" : "primary"} r-try" type="button">Try another spot</button>${e.stars ? `<button class="btn primary r-next" type="button">Next mission: ${next.title} →</button>` : ""}</div>`;
  showReadout(html, e.stars ? "go" : "nogo");
  mapResult.innerHTML = `<button type="button" class="r-close" aria-label="Close" style="position:absolute;top:6px;right:8px;background:none;border:0;color:#9aa1ad;font-size:20px;cursor:pointer">×</button>` + html;
  mapResult.dataset.tone = e.stars ? "go" : "nogo"; mapResult.hidden = false; mapBox.classList.add("has-result");
  document.querySelectorAll(".r-try").forEach((b) => { b.onclick = () => { backToPlanning(); pl.ghost = pl.lastTest; render(); }; });
  document.querySelectorAll(".r-next").forEach((b) => { b.onclick = () => startMission(next); });
  mapResult.querySelector(".r-close").onclick = () => { mapResult.hidden = true; mapBox.classList.remove("has-result"); };
  renderMissions(); updateMission();
}
function updateMission() {
  if (!activeMission) return;
  const m = activeMission, pl = state.plan, objs = SITES[m.site].objects, dest = objs[m.dest];
  const names = objs.map((o) => o.name).join(", ").replace(/, ([^,]*)$/, " and $1");
  const dDest = pl.placed ? Math.hypot(dest.pos[0] - state.L[0], dest.pos[1] - state.L[1]) : null;
  const res = missionPhase === "result" ? evaluate(m) : null;
  document.getElementById("mChecks").innerHTML = [
    `<li class="${res ? (res.rows.every((r) => r.ok) ? "ok" : "bad") : ""}">${names}: ${limitText(m)}</li>`,
    `<li class="${dDest == null ? "" : dDest <= m.walk ? "ok" : "bad"}">${m.who} to ${dest.name}: max ${fmtD(m.walk)}${dDest == null ? "" : ` (now ${fmtD(dDest)})`}</li>`,
    `<li class="${res && res.stars === 3 ? "ok" : ""}">Bonus star: land no more than 25% farther than needed</li>`,
  ].join("");
  const offItem = pl.placed && pl.items.find((it) => !itemOn(it));
  document.getElementById("mStep").innerHTML = !pl.placed ? "<b>Step 1:</b> tap the map where the lander should touch down."
    : missionPhase === "flying" ? "Landing in progress. Watch the dust."
    : missionPhase === "result" ? "<b>Result is below the map.</b> Tap the map or move things to try again."
    : offItem ? `<b>Heads up:</b> the lander is not on your ${offItem.kind === "pad" ? "pad" : "berm"}, so it won't help. Tap it to land on it.`
    : "<b>Step 2:</b> happy with the spot? Press Test landing.";
  for (const id of ["mTest", "mTest2"]) {
    const btn = document.getElementById(id);
    btn.disabled = !pl.placed || missionPhase === "flying";
    btn.textContent = missionPhase === "result" ? "▶ Test again" : "▶ Test landing";
  }
}
document.getElementById("mTest").onclick = testLanding;
document.getElementById("mTest2").onclick = testLanding;
document.getElementById("mExit").onclick = () => exitMission(false);

/* ---------- animated guide: a cursor with green arrows shows what you can do on the map */
const G = { on: false, i: 0, steps: [], token: 0 };
const gdEl = document.getElementById("guide"), gdCur = document.getElementById("guideCursor"), gdSvg = document.getElementById("guideSvg");
const gdWait = (ms) => new Promise((r) => setTimeout(r, ms));
function guideSeen() { try { return localStorage.getItem("mcm-guide") === "1"; } catch (e) { return true; } }
function gdMap(fx, fy) { const r = mapBox.getBoundingClientRect(); return [r.left + r.width * fx, r.top + r.height * fy]; }
function gdCenter(el) { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }
const gdOnScreen = (p) => p[1] > 40 && p[1] < innerHeight - 40;
function gdJump(p) { gdCur.style.transitionDuration = "0ms"; gdCur.style.transform = `translate(${p[0] - 5}px, ${p[1] - 3}px)`; void gdCur.offsetWidth; }
function gdMove(p, ms = 700) { gdCur.style.transitionDuration = ms + "ms"; gdCur.style.transform = `translate(${p[0] - 5}px, ${p[1] - 3}px)`; return gdWait(ms + 40); }
function gdRipple(p) { const d = document.createElement("div"); d.className = "guide-ripple"; d.style.left = p[0] + "px"; d.style.top = p[1] + "px"; gdEl.appendChild(d); setTimeout(() => d.remove(), 900); }
async function gdTap(p) { gdCur.classList.add("down"); gdRipple(p); await gdWait(250); gdCur.classList.remove("down"); await gdWait(350); }
const gdLine = (a, b) => `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`;
function gdDraw(paths, labels = []) {
  gdSvg.innerHTML = `<defs><marker id="gHead" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#4fd38e"/></marker></defs>`
    + paths.map((p) => `<path class="guide-arrow ${p.dash ? "dash" : ""}" d="${p.d}" ${p.both ? 'marker-start="url(#gHead)"' : ""} marker-end="url(#gHead)"/>`).join("")
    + labels.map((l) => `<text class="guide-label" x="${l[0]}" y="${l[1]}" text-anchor="middle">${l[2]}</text>`).join("");
}
const GS = {
  async tap() {
    const p = gdMap(.62, .5); gdDraw([], [[p[0], p[1] - 26, "tap"]]);
    gdJump([p[0] + 90, p[1] + 70]); await gdMove(p, 800); await gdTap(p); await gdWait(600);
  },
  async pan() {
    const a = gdMap(.36, .52), b = gdMap(.66, .52);
    gdDraw([{ d: gdLine([a[0], a[1] - 36], [b[0], b[1] - 36]), both: true }], [[(a[0] + b[0]) / 2, a[1] - 48, "drag"]]);
    gdJump([a[0] - 40, a[1] + 40]); await gdMove(a, 500);
    gdCur.classList.add("down"); await gdWait(200); await gdMove(b, 1100); gdCur.classList.remove("down"); await gdWait(300);
    gdCur.classList.add("down"); await gdMove(a, 1100); gdCur.classList.remove("down"); await gdWait(300);
  },
  async zoom() {
    const p = gdMap(.58, .5), x = p[0] + 44, c = [p[0] - 120, p[1] + 6];
    gdDraw([{ d: gdLine([x, p[1] - 6], [x, p[1] - 50]) }, { d: gdLine([x, p[1] + 12], [x, p[1] + 56]) },
      { d: gdLine([c[0] - 10, c[1] - 10], [c[0] - 42, c[1] - 42]) }, { d: gdLine([c[0] + 10, c[1] + 10], [c[0] + 42, c[1] + 42]) }],
      [[x + 2, p[1] - 62, "scroll"], [c[0], c[1] - 56, "pinch"]]);
    gdJump([p[0] + 60, p[1] + 60]); await gdMove(p, 600);
    for (let k = 0; k < 2; k++) { await gdMove([p[0], p[1] - 8], 300); await gdMove([p[0], p[1] + 8], 300); }
    await gdMove(p, 250); await gdWait(400);
  },
  async build() {
    const scope = isFull() ? "#mapBar" : "#buildBox";
    const chip = document.querySelector(`${scope} .tool:not(:disabled)`);
    if (!chip) { gdDraw([]); return gdWait(1500); }
    let a = gdCenter(chip);
    if (!gdOnScreen(a)) { chip.scrollIntoView({ block: "nearest" }); await gdWait(450); a = gdCenter(chip); }
    const b = gdMap(.45, .6);
    if (gdOnScreen(b) && Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) > 120) {       // drag from the panel onto the map
      const mid = [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - 70];
      gdDraw([{ d: `M${a[0]} ${a[1]}Q${mid[0]} ${mid[1]} ${b[0]} ${b[1]}`, dash: true }], [[mid[0], mid[1] + 18, "drag onto the map"]]);
      gdJump([a[0] + 50, a[1] + 40]); await gdMove(a, 500);
      gdCur.classList.add("down", "carrying"); await gdWait(250); await gdMove(b, 1300);
      gdCur.classList.remove("down", "carrying"); gdRipple(b); await gdWait(700);
    } else {                                                                            // small screens: tap to drop it
      gdDraw([], [[a[0], a[1] - 30, "tap"]]);
      gdJump([a[0] + 50, a[1] + 40]); await gdMove(a, 600); await gdTap(a); await gdWait(600);
    }
  },
  async test() {
    const btn = document.getElementById(isFull() ? "mTest2" : "mTest");
    let p = gdCenter(btn);
    if (!gdOnScreen(p)) { btn.scrollIntoView({ block: "nearest" }); await gdWait(450); p = gdCenter(btn); }
    gdDraw([], [[p[0], p[1] - 34, "test"]]);
    gdJump([p[0] + 70, p[1] + 50]); await gdMove(p, 700); await gdTap(p); await gdWait(700);
  },
  async replay() {
    const btn = document.getElementById("replay"); let p = gdCenter(btn);
    if (!gdOnScreen(p)) { btn.scrollIntoView({ block: "nearest" }); await gdWait(450); p = gdCenter(btn); }
    gdDraw([]); gdJump([p[0] + 70, p[1] + 50]); await gdMove(p, 700); await gdTap(p); await gdWait(700);
  },
};
function guideSteps() {
  const mis = activeMission, s = [
    { t: "Choose the landing spot", d: "Tap the map where the lander should touch down. You can tap again as often as you like.", run: GS.tap },
    { t: "Move the map", d: "Press and drag to move the map around.", run: GS.pan },
    { t: "Zoom in and out", d: "Scroll the mouse wheel, or use the + and − buttons. On a phone: pinch with two fingers.", run: GS.zoom },
  ];
  if (mis && mis.budget) s.push({ t: "Build a pad or a berm", d: "Drag a landing pad or a ring berm onto the map, or tap it to drop it under your lander. It only helps if the lander touches down on it.", run: GS.build });
  s.push(mis ? { t: "Test your plan", d: "Press ▶ Test landing and watch the dust. NO-GO? Move the lander or build something, then test again.", run: GS.test }
             : { t: "Watch 1969", d: "Press ▶ Replay Apollo 12 to see the real landing that sandblasted Surveyor 3.", run: GS.replay });
  return s;
}
function gdShow() {
  const s = G.steps[G.i], last = G.i === G.steps.length - 1;
  document.getElementById("gStep").textContent = `How the map works · ${G.i + 1} of ${G.steps.length}`;
  document.getElementById("gTitle").textContent = s.t;
  document.getElementById("gText").textContent = s.d;
  document.getElementById("gBack").disabled = G.i === 0;
  document.getElementById("gNext").textContent = last ? "Let's go" : "Next →";
  const my = ++G.token;
  (async () => { while (G.on && G.token === my) { await s.run(); if (G.token !== my) break; await gdWait(600); } })();
}
function runGuide() {
  if (G.on || isFull()) return;
  G.on = true; G.steps = guideSteps(); G.i = 0;
  planner.scrollIntoView({ behavior: "smooth", block: "start" });
  gdEl.hidden = false; gdSvg.innerHTML = ""; gdJump([innerWidth / 2, innerHeight / 2]);
  setTimeout(gdShow, 550);
}
function closeGuide() {
  G.on = false; G.token++; gdEl.hidden = true; gdSvg.innerHTML = "";
  gdEl.querySelectorAll(".guide-ripple").forEach((d) => d.remove());
  try { localStorage.setItem("mcm-guide", "1"); } catch (e) { /* storage blocked */ }
}
document.getElementById("gNext").onclick = () => { if (G.i < G.steps.length - 1) { G.i++; gdShow(); } else closeGuide(); };
document.getElementById("gBack").onclick = () => { if (G.i > 0) { G.i--; gdShow(); } };
document.getElementById("gSkip").onclick = closeGuide;
document.getElementById("mGuide").onclick = runGuide;
document.getElementById("fGuide").onclick = runGuide;
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && G.on) closeGuide(); });
window.addEventListener("hashchange", () => { if (G.on) closeGuide(); });

const _coreRender = render;
render = function () { _coreRender(); updateMission(); };
window.__missions = true;

/* =====================================================================
   Wrap-up cards (numbers come from the model data)
   ===================================================================== */
function renderLearned() {
  const lm = D.landers.find((l) => l.thrust_N === 11600), small = D.landers[0], big = D.landers.find((l) => l.thrust_N === 44000);
  const r = (l) => ringsFor(l, "1.5", 1).find((x) => x.f === 0.1);
  const fr = (x) => isFinite(x) ? fmtD(x) : "more than 10 km";
  const a = r(lm), s = r(small), b = big ? r(big) : null;
  const M = D.mitigation, p0 = M && M.practical_distance["11.6 kN | no mitigation"], p30 = M && M.practical_distance["11.6 kN | pad, 30 m radius"];
  const cards = [
    ["Dust flies flat and far", `Grains leave at only a few degrees and keep going. For an Apollo-size lander, hardware closer than about ${fr(a.med)} gets more than 10% of the sandblasting Surveyor 3 got.`],
    ["Size matters, but not simply", `A small lander (${small.name.split(" (")[0]}) needs about ${fr(s.med)}${b ? `, a 44 kN cargo lander about ${fr(b.med)}` : ""}. Bigger engines throw more dust, but not proportionally farther.`],
    ["Pads and berms help a lot", p0 && p30 ? `In the model, a 30 m landing pad cuts the safe distance for an Apollo-size lander from ${fr(p0.median)} to ${fr(p30.median)}. That's a best case: pad edges and berms also erode in reality.` : "A landing pad stops the blast from digging up dust right under the engine. Pad results are still being computed."],
    ["Honest uncertainty", `Different model versions disagree: for an Apollo-size lander the safe distance ranges from ${fr(a.lo)} to ${fr(a.hi)}. One measurement on Surveyor 3 can't pin everything down, so we show the range.`],
  ];
  document.getElementById("learned").innerHTML = cards.map(([h, p]) => `<div class="card"><h3>${h}</h3><p>${p}</p></div>`).join("");
}

/* =====================================================================
   Init
   ===================================================================== */
renderParts(); showStep(0);
renderMissions(); renderLearned(); updateProgress();
showChapter(location.hash.slice(1) || "intro");
