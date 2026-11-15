/* Chapter 2: Apollo 12 lands 155 m from Surveyor 3.
   Two 3D views of the same landing (from the side, and through Surveyor's
   camera) and the 1 cm² square with the 103 measured pits.

   The views are illustrations, not the model: grains fly at display speed in
   compressed time. The pit counter therefore does not count animated grains
   (a few thousand display grains would almost never hit a 3 m robot at 155 m).
   It shows the 1969 lab count, 103 pits per cm², building up with the share of
   dust the model says has been thrown at each altitude. */

import { MEASURED, dustThrownAt } from "./data.js";
import { $, css, seededRandom } from "./util.js";
import { isShown, onStation } from "./router.js";
import {
  SURVEYOR_X, clearDust, descentAltitude, emitDust, hasWebGL, makeLandingScene,
  projectToHost, renderScene, setLanderAltitude, stepDust,
} from "./scene3d.js";

const DESCENT_MS = 9000, SETTLE_MS = 3200;
const pitsSoFar = (alt) => Math.round(dustThrownAt(alt) * MEASURED);

let side = null, pov = null;
const sideRun = { playing: false, done: false };
const povRun = { playing: false, done: false, pits: 0, lens: null };

/* ---------------------------------------------------------- side view */
function sideHud(text) {
  const hud = $("dustHud");
  if (!side) return;
  const a = side.alt;
  const [lx, ly] = projectToHost(side, 0, a + 17, 0), [sx, sy] = projectToHost(side, SURVEYOR_X, 9, 0);
  hud.innerHTML = `<span class="tag3" style="left:${lx}px;top:${ly}px">Intrepid · ${a.toFixed(1)} m</span>
    <span class="tag3" style="left:${sx}px;top:${sy}px">Surveyor 3 · 155 m</span>
    <div class="readout">${text}</div>`;
}
const sideIdleText = () => sideRun.done
  ? `Contact light. Surveyor's side facing the lander: about ${MEASURED} pits per cm², as counted in the lab.`
  : "Intrepid on final approach. Press play.";

function playSide() {
  if (!side || sideRun.playing) return;
  sideRun.playing = true; sideRun.done = false;
  clearDust(side);
  let t0 = 0, last = 0;
  const step = (now) => {
    if (!t0) { t0 = now; last = now; }
    const t = now - t0, dt = Math.min((now - last) / 1000, 0.05); last = now;
    const a = descentAltitude(t, DESCENT_MS);
    side.engine = t < DESCENT_MS;
    if (side.engine) emitDust(side, dt, a);
    stepDust(side, dt);
    setLanderAltitude(side, a); renderScene(side);
    sideHud(side.engine
      ? `Altitude ${a.toFixed(1)} m · pits on Surveyor so far: about ${pitsSoFar(a)} per cm²`
      : sideIdleText());
    if (t < DESCENT_MS + SETTLE_MS && isShown("apollo", 1)) { requestAnimationFrame(step); return; }
    sideRun.playing = false; sideRun.done = t >= DESCENT_MS; side.engine = false;
    sideHud(sideIdleText());
  };
  requestAnimationFrame(step);
}

/* ------------------------------------------------- Surveyor's camera view */
function lensCanvas() {
  if (!povRun.lens) { povRun.lens = document.createElement("canvas"); povRun.lens.width = 960; povRun.lens.height = 420; }
  return povRun.lens.getContext("2d");
}
// One mark on the lens per pit per cm² (illustration: the lens itself was not counted).
function addLensPit(L) {
  const x = 960 * (0.1 + Math.random() * 0.8), y = 420 * (0.1 + Math.random() * 0.8), s = 1 + Math.random() * 2.5;
  L.fillStyle = "rgba(255,255,255,.8)"; L.beginPath(); L.arc(x, y, s, 0, Math.PI * 2); L.fill();
  L.strokeStyle = "rgba(255,255,255,.35)"; L.lineWidth = 0.8;
  for (let k = 0; k < 3; k++) {
    const an = Math.random() * Math.PI * 2;
    L.beginPath(); L.moveTo(x, y); L.lineTo(x + Math.cos(an) * s * 4, y + Math.sin(an) * s * 4); L.stroke();
  }
}
function drawPovFrame(text) {
  const ov = $("povOverlay"), w = ov.clientWidth, h = ov.clientHeight;
  if (!w || !h) return;
  if (ov.width !== w || ov.height !== h) { ov.width = w; ov.height = h; }
  const c = ov.getContext("2d");
  c.clearRect(0, 0, w, h);
  if (povRun.lens) c.drawImage(povRun.lens, 0, 0, w, h);
  const v = c.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, w * 0.62);   // 1960s TV: vignette, scanlines
  v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,.85)");
  c.fillStyle = v; c.fillRect(0, 0, w, h);
  c.fillStyle = "rgba(0,0,0,.2)"; for (let y = 0; y < h; y += 3) c.fillRect(0, y, w, 1);
  c.fillStyle = "#e8e8e8"; c.font = `500 ${Math.max(12, w / 64)}px ${css("--font-data")}`;
  c.fillText("SURVEYOR 3 · TV CAMERA · 200 LINES", 18, 28);
  c.fillText(text, 18, 28 + Math.max(16, w / 46));
}
const povIdleText = () => povRun.done ? `TOUCHDOWN · ABOUT ${MEASURED} PITS PER CM² ON THE LANDER SIDE` : "PRESS PLAY";

function playPov() {
  if (!pov || povRun.playing) return;
  povRun.playing = true; povRun.done = false; povRun.pits = 0;
  clearDust(pov);
  const L = lensCanvas(); L.clearRect(0, 0, 960, 420);
  let t0 = 0, last = 0;
  const step = (now) => {
    if (!t0) { t0 = now; last = now; }
    const t = now - t0, dt = Math.min((now - last) / 1000, 0.05); last = now;
    const a = descentAltitude(t, DESCENT_MS);
    pov.engine = t < DESCENT_MS;
    if (pov.engine) emitDust(pov, dt, a);
    stepDust(pov, dt);
    for (const target = pitsSoFar(a); povRun.pits < target; povRun.pits++) addLensPit(L);
    setLanderAltitude(pov, a); renderScene(pov);
    drawPovFrame(pov.engine ? `LANDER ALT ${a.toFixed(1)} m · 155 m AWAY · ${povRun.pits} PITS/CM² SO FAR` : povIdleText());
    if (t < DESCENT_MS + SETTLE_MS && isShown("apollo", 1)) { requestAnimationFrame(step); return; }
    povRun.playing = false; povRun.done = t >= DESCENT_MS; pov.engine = false;
    drawPovFrame(povIdleText());
  };
  requestAnimationFrame(step);
}

/* --------------------------------------------------------- the pit square */
function drawPitSquare() {
  const c = $("pitCanvas").getContext("2d"), N = 560;            // 560 px = 1 cm
  const g = c.createLinearGradient(0, 0, N, N);
  g.addColorStop(0, "#c9cbcf"); g.addColorStop(.5, "#a9adb3"); g.addColorStop(1, "#d7d9dc");
  c.fillStyle = g; c.fillRect(0, 0, N, N);
  for (let k = 0; k < 600; k++) {                                // brushed-metal streaks
    const r = seededRandom(3, k, 1, 9);
    c.fillStyle = `rgba(255,255,255,${(r() * .08).toFixed(3)})`; c.fillRect(r() * N, 0, 1, N);
  }
  const rnd = seededRandom(42, 1, 0, 3), radius = N * 0.0040;   // ~80 um wide pits
  for (let k = 0; k < MEASURED; k++) {
    const x = 8 + rnd() * (N - 16), y = 8 + rnd() * (N - 16), s = radius * (0.6 + rnd() * 0.9);
    c.fillStyle = "rgba(40,40,44,.85)"; c.beginPath(); c.ellipse(x, y, s * 1.12, s, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "rgba(255,255,255,.55)"; c.lineWidth = 1; c.beginPath(); c.arc(x + .6, y + .6, s, Math.PI * .1, Math.PI * .9); c.stroke();
  }
  c.fillStyle = "#17110a"; c.fillRect(20, N - 30, N * 0.1, 4);
  c.font = `600 18px ${css("--font-data")}`; c.fillText("1 mm", 20, N - 40);
}

/* ------------------------------------------------------------------ init */
function refreshViews() {
  if (side) { renderScene(side); sideHud(sideIdleText()); }
  if (pov) { renderScene(pov); drawPovFrame(povIdleText()); }
}

export function initApollo() {
  drawPitSquare();
  if (!hasWebGL()) {
    for (const id of ["dustScene", "povScene"]) $(id).classList.add("no3d");
    for (const id of ["dustPlay", "povPlay"]) $(id).disabled = true;
    return;
  }
  side = makeLandingScene($("dustScene"), "side");
  pov = makeLandingScene($("povScene"), "pov");
  side.onResize = () => sideHud(sideIdleText());
  pov.onResize = () => drawPovFrame(povIdleText());
  $("dustPlay").onclick = playSide;
  $("povPlay").onclick = playPov;
  onStation("apollo", 1, () => requestAnimationFrame(refreshViews));
}

// For the tour.
export const playApolloSide = playSide;
export const playApolloPov = playPov;