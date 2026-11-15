/* Chapter 3, station 1: the model in four steps (blast, flight, hit, check).
   Steps 1-2 use the 3D close-up when WebGL is available; steps 3-4 (and all
   steps without WebGL) are drawn on a 2D canvas. One animation loop runs while
   the station is on screen. */

import { FILTER, G_MOON, KEPT } from "./data.js";
import { $, css, seededRandom } from "./util.js";
import { isShown } from "./router.js";
import { drawLanderIcon } from "./icons2d.js";
import { emitDust, hasWebGL, makeLandingScene, projectToHost, renderScene, setLanderAltitude, stepDust } from "./scene3d.js";

const N_TOTAL = FILTER ? FILTER.n_total : 36;
const N_KEPT = FILTER ? FILTER.n_kept : N_TOTAL;

export const STEPS = [
  { tab: "Blast", title: "1 · The blast",
    text: "The engine shoots gas straight down at about 3 km per second, nearly nine times the speed of sound on Earth. At the ground it spreads out sideways, like a leaf blower pointed at a sandy floor, and sweeps the loose top layer of dust along.",
    nerd: `<p>The model computes the wind along the ground (the wall shear stress) from the gas speed and its temperature-dependent viscosity:</p>
      <span class="formula">τ = μ(T) · ∂v<sub>r</sub>/∂z</span>
      <p>Three erosion laws turn that into kilograms of dust per second, because scientists still disagree which is right:</p>
      <ul><li>Shear scaling: <code>ṁ = 0.0222 · τ^2.52</code> (Lane &amp; Metzger 2015)</li><li>Roberts' excess-shear theory</li><li>Energy flux (Metzger 2024)</li></ul>` },
  { tab: "Fly", title: "2 · The flight",
    text: "Each grain leaves almost flat, only a few degrees above the ground. On Earth, air would slow it down, the push you feel on your hand out of a car window. The Moon has no air, so the grain keeps its speed until gravity, only a sixth of Earth's, pulls it down. The smallest grains are the fastest: up to about 2 km per second, faster than a rifle bullet.",
    nerd: `<p>Every grain flies on a ballistic path in lunar gravity, with a small correction because the Moon is round:</p>
      <span class="formula">x = v·cosθ·t,  z = v·sinθ·t - ½·g·t² + x²/(2R)</span>
      <p><code>g = ${G_MOON} m/s²</code>, <code>R = 1737 km</code>. Launch angles come from six Apollo landing films (1.4° to 8.1°, ±0.5°). Launch speeds come from two models: a drag calculation and a fit to Lane &amp; Metzger's Fig. 5. That is 10 million grains for each of the 36 versions.</p>` },
  { tab: "Hit", title: "3 · The hit",
    text: "When a grain hits metal it punches a tiny crater, like hail denting a car roof, only much smaller: each pit is about as wide as a hair. Faster and bigger grains make bigger pits. In the formula we use, a grain twice as fast digs a pit with eight times the volume. These are the pits scientists found on Surveyor 3's parts.",
    nerd: `<p>Crater volume from Sheldon &amp; Kanhere (1972):</p>
      <span class="formula">V = K<sub>D</sub> · v³ · D³ · ρ<sup>1.5</sup> · STEP_H<sub>V</sub><sup>-1.5</sup></span>
      <p><code>ρ = 3100 kg/m³</code> (grain), <code>H_V = 1.05 GPa</code> (aluminium). The constant <code>K_D</code> was a placeholder (1). Calibrating each model version against Surveyor 3's real pits puts it in the hundreds or higher, depending on the version.</p>` },
  { tab: "Check", title: "4 · The check",
    text: `Our model comes in ${N_TOTAL} versions, and nobody knows for sure which is right. Every version is scaled so that it gives the 103 pits per cm² measured on Surveyor 3, so they all agree there by construction. The test is a different one: we tune each version's crater size to the size of the real pits (about 80 µm), then check whether its own, unscaled pit count lands in the range found on Surveyor's parts. A version whose answer rests on only a few simulated grains is left out too, since chance would decide it. The range is wide, so this is a sanity check, not a proof. ${N_KEPT} versions pass, and the map uses only those.`,
    nerd: `<p>Every result is scaled to the one real measurement:</p>
      <span class="formula">exposure(d) = model(d) / model(Surveyor 3) × 103 pits/cm²</span>
      <p>A version is kept if, after calibrating the crater constant to the mean pit size on the coupons (79 µm), its own predicted number of pits ≥ 20 µm at Surveyor 3, not scaled, lies between about 34/cm² (a third of the coupon average) and 4000/cm² (the tube's worst spots). Pits are counted from 20 µm, like the 1971 count on the tube. A version also needs at least ${FILTER && FILTER.min_grains ? FILTER.min_grains : 20} simulated grains at Surveyor 3, both in total and among the counted pits; below that, the Monte Carlo noise is larger than about 22 %.</p>
      ${FILTER ? `<p><b>${FILTER.n_kept} of ${FILTER.n_total}</b> versions pass this test.</p>` : ""}` },
];

let stepIndex = 0, stepT0 = 0, stepLooping = false, close3d = null;
const seenSteps = new Set();
const stepCanvas = () => $("stepCanvas");

function renderTabs() {
  $("stepTabs").innerHTML = STEPS.map((s, i) =>
    `<button type="button" role="tab" id="step-${i}" aria-selected="${i === stepIndex}" class="${seenSteps.has(i) ? "seen" : ""}"><b>${seenSteps.has(i) ? "✓" : i + 1}</b>${s.tab}</button>`).join("");
  STEPS.forEach((_, i) => { $("step-" + i).onclick = () => showStep(i); });
}

export function showStep(i) {
  stepIndex = i; seenSteps.add(i); stepT0 = performance.now();
  const s = STEPS[i];
  $("stepTitle").textContent = s.title;
  $("stepText").textContent = s.text;
  $("stepNerd").innerHTML = s.nerd;
  $("stepScene").classList.toggle("show3d", !!close3d && i < 2);
  renderTabs();
  startStepLoop();
}

/* ------------------------------------------------------------ 3D, steps 1-2 */
function frame3d(now, dt) {
  const S = close3d;
  S.engine = true; emitDust(S, dt, 6); stepDust(S, dt);
  setLanderAltitude(S, 6 + Math.sin(now / 900) * 0.3);
  // step 1: close look at the blast; step 2: low camera looking along the flat dust sheet
  const goal = stepIndex === 0 ? [34, 10, 58, 0, 5, 0] : [16, 2.0, 20, 140, 1.4, -45];
  const p = S.cam.position;
  p.x += (goal[0] - p.x) * 0.04; p.y += (goal[1] - p.y) * 0.04; p.z += (goal[2] - p.z) * 0.04;
  for (let k = 0; k < 3; k++) S.look[k] += (goal[3 + k] - S.look[k]) * 0.04;
  S.cam.lookAt(...S.look);
  renderScene(S);
  const [nx, ny] = projectToHost(S, 0, S.alt + 0.3, 0);
  $("stepHud").innerHTML = stepIndex === 0
    ? `<span class="tag3" style="left:${nx}px;top:${ny + 40}px">exhaust ≈ 3 km/s</span><div class="readout">The wind along the ground drags the loose top layer with it</div>`
    : `<div class="readout">Grains leave a few degrees above the ground (1.4–8° in the Apollo films). No air to slow them: they keep going until gravity brings them down.</div>`;
}

/* ------------------------------------------------------------ 2D canvas */
const STEP_W = 720, STEP_H = 440, STEP_GROUND = 360;
function ground(c) {
  c.fillStyle = "#77736c"; c.fillRect(0, STEP_GROUND, STEP_W, STEP_H - STEP_GROUND);
  c.fillStyle = "#8a867e"; c.fillRect(0, STEP_GROUND, STEP_W, 3);
}
function drawBlast(c, t) {
  ground(c);
  const cx = 360, ny = 150, g = c.createLinearGradient(0, ny, 0, STEP_GROUND);
  g.addColorStop(0, "rgba(255,236,190,.85)"); g.addColorStop(1, "rgba(255,190,110,.05)");
  c.fillStyle = g; c.beginPath(); c.moveTo(cx - 18, ny); c.lineTo(cx + 18, ny); c.lineTo(cx + 120, STEP_GROUND); c.lineTo(cx - 120, STEP_GROUND); c.fill();
  drawLanderIcon(c, cx, ny, 2.2);
  for (let k = 0; k < 6; k++) {                                 // arrows: wind along the ground
    const f = (t * .9 + k / 6) % 1;
    for (const dir of [-1, 1]) {
      const x = cx + dir * (60 + f * 280);
      c.strokeStyle = `rgba(232,233,235,${(1 - f).toFixed(2)})`; c.lineWidth = 2;
      c.beginPath(); c.moveTo(x, STEP_GROUND - 8); c.lineTo(x + dir * 22, STEP_GROUND - 8); c.lineTo(x + dir * 15, STEP_GROUND - 13); c.stroke();
    }
  }
  for (let k = 0; k < 40; k++) {
    const r = seededRandom(11, k, 2, 2), dir = r() < .5 ? -1 : 1, f = (t * (.5 + r()) + r()) % 1;
    c.fillStyle = `rgba(232,224,206,${(1 - f).toFixed(2)})`; c.fillRect(cx + dir * (90 + f * 300), STEP_GROUND - 4 - f * 40 * r(), 2.5, 2.5);
  }
  c.fillStyle = "#eeece6"; c.fillText("exhaust ≈ 3 km/s", cx + 40, 120); c.fillText("wind along the ground lifts the dust", 30, STEP_GROUND + 40);
}
function drawFlight(c, t) {
  ground(c); drawLanderIcon(c, 70, STEP_GROUND, 1.4, true);
  const hi = css("--data-hi");
  const grains = [[1, "1 µm grain", 1.0, "#ffe9b0", 2], [50, "50 µm grain", .55, hi, 3.5], [500, "500 µm grain", .22, "#ff9f45", 5]];
  grains.forEach(([, label, speed, col, size], k) => {
    const f = (t * speed * .35 + k * .2) % 1;
    const x = 90 + f * 620, z = Math.max(0, f * 620 * Math.tan(2.5 * Math.PI / 180) * (1 - f * (1.2 - speed)) * 2.2);
    c.strokeStyle = col; c.globalAlpha = .35; c.setLineDash([4, 5]);
    c.beginPath(); c.moveTo(90, STEP_GROUND - 2); c.lineTo(x, STEP_GROUND - 2 - z); c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
    c.fillStyle = col; c.beginPath(); c.arc(x, STEP_GROUND - 2 - z, size, 0, Math.PI * 2); c.fill();
    c.fillText(label, 20, 40 + k * 22);
  });
  c.fillStyle = "#9aa1ad"; c.fillText("small = fast, big = slow; all leave at only a few degrees", 20, 112);
}
function drawHit(c, t) {
  const sy = 300, g = c.createLinearGradient(0, sy, 0, STEP_H);
  g.addColorStop(0, "#b8bcc2"); g.addColorStop(1, "#6f7379"); c.fillStyle = g; c.fillRect(0, sy, STEP_W, STEP_H - sy);
  const f = (t % 3) / 3, hx = 360;
  if (f < .45) {                                                  // the grain flies in
    const u = f / .45; c.fillStyle = css("--data-hi");
    c.beginPath(); c.arc(80 + u * (hx - 80), 120 + u * (sy - 18 - 120), 14, 0, Math.PI * 2); c.fill();
  }
  const grow = Math.min(Math.max((f - .45) / .2, 0), 1);
  if (grow > 0) {                                                 // the pit opens, debris flies off
    c.fillStyle = "#3a3c40"; c.beginPath(); c.ellipse(hx, sy, 70 * grow, 52 * grow, 0, 0, Math.PI); c.fill();
    c.fillStyle = "#cfd3d8"; c.beginPath();
    c.ellipse(hx - 74 * grow, sy, 10 * grow, 6 * grow, 0, Math.PI, 0); c.ellipse(hx + 74 * grow, sy, 10 * grow, 6 * grow, 0, Math.PI, 0); c.fill();
    for (let k = 0; k < 10; k++) {
      const a = Math.PI + k / 9 * Math.PI, rr = 70 + (f - .45) * 300;
      c.fillStyle = `rgba(232,224,206,${Math.max(0, 1 - (f - .45) * 2).toFixed(2)})`;
      c.fillRect(hx + Math.cos(a) * rr, sy + Math.sin(a) * rr * .6, 3, 3);
    }
  }
  c.fillStyle = "#eeece6"; c.fillText("dust grain", 40, 100); c.fillText("aluminium surface", 20, sy + 30);
  c.fillStyle = "#17110a"; c.fillRect(hx - 70, STEP_H - 40, 140, 4); c.fillText("≈ 80 µm", hx - 30, STEP_H - 48);
  c.fillStyle = "#eeece6"; c.fillText("pit volume grows with speed³ × size³", 20, 40);
}
function drawCheck(c, t) {
  const cols = 9, cell = 58, ox = (STEP_W - cols * cell) / 2 + cell / 2, oy = 90, rows = Math.ceil(N_TOTAL / cols);
  const reveal = Math.min(t / 2.5, 1) * N_TOTAL;
  let shown = 0;
  for (let i = 0; i < N_TOTAL; i++) {                             // kept versions first, so the reveal reads clearly
    const x = ox + (i % cols) * cell, y = oy + Math.floor(i / cols) * cell, ok = i < N_KEPT, on = i < reveal;
    c.fillStyle = on ? (ok ? css("--data-hi") : "#3a3f4b") : "#1a1e27";
    c.beginPath(); c.arc(x, y, 18, 0, Math.PI * 2); c.fill();
    if (on && !ok) {
      c.strokeStyle = "#ff6a55"; c.lineWidth = 2.5;
      c.beginPath(); c.moveTo(x - 9, y - 9); c.lineTo(x + 9, y + 9); c.moveTo(x + 9, y - 9); c.lineTo(x - 9, y + 9); c.stroke();
    }
    if (on && ok) shown++;
  }
  c.fillStyle = "#eeece6"; c.font = `600 18px ${css("--font-display")}`;
  c.fillText(`${shown} of ${N_TOTAL} model versions pass the pit test`, 40, 44);
  c.font = `13px ${css("--font-data")}`; c.fillStyle = "#9aa1ad";
  c.fillText(KEPT ? "filled = unscaled pit count lands in the measured range   ✕ = left out" : "no filter applied in this data", 40, oy + rows * cell + 10);
}
const DRAW_2D = [drawBlast, drawFlight, drawHit, drawCheck];

function frame2d(now) {
  const c = stepCanvas().getContext("2d"), t = (now - stepT0) / 1000;
  c.clearRect(0, 0, STEP_W, STEP_H); c.fillStyle = "#05060a"; c.fillRect(0, 0, STEP_W, STEP_H);
  c.font = `13px ${css("--font-data")}`;
  DRAW_2D[stepIndex](c, t);
}

/* ------------------------------------------------------------ loop */
export function startStepLoop() {
  if (stepLooping) return;
  stepLooping = true;
  let last = 0;
  const loop = (now) => {
    if (!isShown("simulation", 0)) { stepLooping = false; return; }
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 0; last = now;
    if (close3d && stepIndex < 2) frame3d(now, dt); else frame2d(now);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

export function initModelSteps() {
  if (hasWebGL()) { close3d = makeLandingScene($("stepScene"), "close"); close3d.look = [0, 5, 0]; }
  showStep(0);
}