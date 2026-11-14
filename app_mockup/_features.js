
/* =====================================================================
   SOUND (Web Audio, generated in the browser, off until switched on)
   ===================================================================== */
const SFX = {
  on: false, ctx: null, gain: null,
  init() {
    if (this.ctx) return;
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    this.ctx = new C();
    const len = this.ctx.sampleRate * 2, buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { b = 0.985 * b + 0.015 * (Math.random() * 2 - 1); d[i] = b * 4; }   // brown noise = rumble
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = this.ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 420;
    this.gain = this.ctx.createGain(); this.gain.gain.value = 0;
    src.connect(lp); lp.connect(this.gain); this.gain.connect(this.ctx.destination); src.start();
  },
  engine(level) {
    if (!this.ctx) return;
    this.gain.gain.setTargetAtTime(this.on ? level * 0.55 : 0, this.ctx.currentTime, 0.08);
  },
  beep(n = 2) {   // "contact light"
    if (!this.on || !this.ctx) return;
    for (let k = 0; k < n; k++) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain(), t = this.ctx.currentTime + k * 0.22;
      o.type = "square"; o.frequency.value = 1180; g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.06, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      o.connect(g); g.connect(this.ctx.destination); o.start(t); o.stop(t + 0.16);
    }
  },
  tick(vol = 0.12) {   // a grain hitting metal
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime, len = Math.floor(this.ctx.sampleRate * 0.03);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const s = this.ctx.createBufferSource(); s.buffer = buf;
    const hp = this.ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 2600;
    const g = this.ctx.createGain(); g.gain.value = vol;
    s.connect(hp); hp.connect(g); g.connect(this.ctx.destination); s.start(t);
  },
};
const soundBtn = document.getElementById("soundBtn");
function setSound(on) {
  SFX.on = on;
  if (on) { SFX.init(); if (SFX.ctx && SFX.ctx.state === "suspended") SFX.ctx.resume(); }
  if (!on) SFX.engine(0);
  soundBtn.setAttribute("aria-pressed", on ? "true" : "false");
  soundBtn.setAttribute("aria-label", on ? "Sound on" : "Sound off");
  document.getElementById("soundWaves").setAttribute("opacity", on ? "1" : ".25");
  progress.sound = on; store.set(progress);
}
soundBtn.onclick = () => setSound(!SFX.on);
// One monitor loop turns what is happening on screen into sound.
let lastPhase = "", lastDustHits = 0, lastGameRun = false, lastPovHits = 0, lastMcHits = 0;
setInterval(() => {
  if (!SFX.on || !SFX.ctx || document.hidden) { if (SFX.ctx) SFX.engine(0); return; }
  let lvl = 0;
  if (state.engineOn) lvl = Math.max(lvl, 0.3 + 0.7 * (1 - Math.min(state.alt, 34) / 34));
  if (GM.run && GM.s && GM.s.thrust) lvl = Math.max(lvl, 0.85);
  if (dustRun && dustRun.engine && !dustRun.done) lvl = Math.max(lvl, 0.35 + 0.6 * (1 - dustRun.h / 34));
  if (POV.run && POV.engine) lvl = Math.max(lvl, 0.25 + 0.5 * (1 - POV.h / 34));
  SFX.engine(lvl);
  const ph = document.getElementById("altPhase").textContent;
  if (ph !== lastPhase && ph.toUpperCase().startsWith("CONTACT")) SFX.beep();
  lastPhase = ph;
  if (dustRun && dustRun.hits > lastDustHits) SFX.tick();
  lastDustHits = dustRun ? dustRun.hits : 0;
  if (POV.hits > lastPovHits) SFX.tick(0.18);
  lastPovHits = POV.hits;
  if (MC.hits > lastMcHits) SFX.tick(0.05);
  lastMcHits = MC.hits;
  if (lastGameRun && !GM.run && GM.s && GM.s.h === 0) SFX.beep();
  lastGameRun = GM.run;
}, 60);

/* =====================================================================
   3D MOON INTRO (three.js, procedural texture)
   ===================================================================== */
const GLOBE_SITES = [
  { name: "Apollo 12 + Surveyor 3", lat: -3.01, lon: -23.42, site: 0 },
  { name: "Apollo 11", lat: 0.67, lon: 23.47, site: 1 },
  { name: "South pole (Artemis region)", lat: -88.5, lon: 0, site: 2 },
];
const GLB = { ok: false, run: false, focus: -1 };
const MOON_TEX = "__IMG_MOON__";
function moonTexture() {
  const W2 = 2048, H2 = 1024, c = document.createElement("canvas"); c.width = W2; c.height = H2;
  const x = c.getContext("2d");
  x.fillStyle = "#8f8c86"; x.fillRect(0, 0, W2, H2);
  const px = (lon) => (lon + 180) / 360 * W2, py = (lat) => (90 - lat) / 180 * H2;
  const r = hash(77, 1, 2, 3);
  for (let i = 0; i < 9000; i++) { x.fillStyle = `rgba(${r() < .5 ? "255,255,255" : "0,0,0"},${(r() * .05).toFixed(3)})`; x.beginPath(); x.arc(r() * W2, r() * H2, 2 + r() * 14, 0, Math.PI * 2); x.fill(); }
  // Maria (dark basaltic plains), approximate positions: lon, lat, half-width, half-height in degrees
  const MARIA = [[-57, 18, 24, 26], [-16, 33, 14, 10], [17, 28, 8, 8], [31, 8, 10, 8], [59, 17, 6, 5], [51, -8, 7, 10], [-17, -21, 10, 8],
    [-23, -10, 6, 5], [0, 56, 38, 5], [4, 13, 4, 3], [35, -15, 5, 5], [-39, -24, 6, 6], [-31, 7, 9, 6], [-50, -5, 10, 10]];
  for (const [lon, lat, rx, ry] of MARIA) {
    for (let k = 0; k < 14; k++) {
      const ox = (r() - .5) * rx * .8, oy = (r() - .5) * ry * .8;
      const cx = px(lon + ox), cy = py(lat + oy), rr = (rx + ry) / 2 * (0.5 + r() * 0.5) / 360 * W2;
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, rr);
      g.addColorStop(0, "rgba(66,64,60,.55)"); g.addColorStop(.7, "rgba(66,64,60,.35)"); g.addColorStop(1, "rgba(66,64,60,0)");
      x.fillStyle = g; x.beginPath(); x.ellipse(cx, cy, rr * (rx / ry > 1.5 ? 1.6 : 1), rr, 0, 0, Math.PI * 2); x.fill();
    }
  }
  for (let i = 0; i < 2600; i++) {
    const cx = r() * W2, cy = r() * H2, rr = Math.pow(r(), 4) * 16 + 1;
    x.fillStyle = "rgba(40,38,35,.32)"; x.beginPath(); x.arc(cx, cy, rr, 0, Math.PI * 2); x.fill();
    x.strokeStyle = "rgba(235,232,224,.35)"; x.lineWidth = Math.max(.6, rr * .18); x.beginPath(); x.arc(cx, cy, rr, Math.PI * .6, Math.PI * 1.5); x.stroke();
  }
  for (const [lon, lat, n] of [[-11.4, -43.3, 22], [-20.1, 9.6, 14]]) {   // Tycho and Copernicus with rays
    const cx = px(lon), cy = py(lat);
    for (let k = 0; k < n; k++) { const a = r() * Math.PI * 2, L = 60 + r() * 220; x.strokeStyle = "rgba(240,238,230,.12)"; x.lineWidth = 3; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L); x.stroke(); }
    x.fillStyle = "rgba(245,243,236,.85)"; x.beginPath(); x.arc(cx, cy, 6, 0, Math.PI * 2); x.fill();
  }
  return c;
}
function sph(lat, lon, R) {
  const phi = (lon + 180) / 360 * 2 * Math.PI, th = (90 - lat) / 180 * Math.PI;
  return new THREE.Vector3(-R * Math.cos(phi) * Math.sin(th), R * Math.cos(th), R * Math.sin(phi) * Math.sin(th));
}
function initGlobe() {
  const el = document.getElementById("globe");
  const chips = document.getElementById("siteChips");
  chips.innerHTML = GLOBE_SITES.map((s, i) => `<button type="button" id="gchip-${i}" aria-pressed="false">${s.name}</button>`).join("");
  GLOBE_SITES.forEach((_, i) => { document.getElementById("gchip-" + i).onclick = () => globeFocus(i); });
  if (!window.THREE) { el.style.display = "none"; return; }
  try {
    const T = THREE;
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    el.insertBefore(renderer.domElement, el.firstChild);
    const scene = new T.Scene(), camera = new T.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 0, 4.4);
    const group = new T.Group(); group.rotation.order = "XYZ"; scene.add(group);
    // Real Moon colour map (NASA SVS CGI Moon Kit, LRO data); hand-drawn map as fallback.
    const mat = new T.MeshStandardMaterial({ color: 0x8f8c86, roughness: 1, metalness: 0 });
    const useFallback = () => { mat.map = new T.CanvasTexture(moonTexture()); mat.color.set(0xffffff); mat.needsUpdate = true; };
    if (MOON_TEX.startsWith("data:")) {
      new T.TextureLoader().load(MOON_TEX, (tx) => { mat.map = tx; mat.color.set(0xc9c6c0); mat.needsUpdate = true; }, undefined, useFallback);
    } else useFallback();
    group.add(new T.Mesh(new T.SphereGeometry(1, 96, 64), mat));
    scene.add(new T.AmbientLight(0xffffff, 0.22));
    const sun = new T.DirectionalLight(0xfff6e8, 1.2); sun.position.set(-3, 1.1, 2.6); scene.add(sun);
    const pts = [], rs = hash(2, 4, 6, 8);
    for (let i = 0; i < 900; i++) { const u = rs() * 2 - 1, a = rs() * Math.PI * 2, s = Math.sqrt(1 - u * u); pts.push(30 * s * Math.cos(a), 30 * u, 30 * s * Math.sin(a)); }
    const sg = new T.BufferGeometry(); sg.setAttribute("position", new T.Float32BufferAttribute(pts, 3));
    scene.add(new T.Points(sg, new T.PointsMaterial({ color: 0xd8d6cf, size: 0.05 })));
    const labelsEl = document.getElementById("globeLabels");
    const markers = GLOBE_SITES.map((s, i) => {
      const m = new T.Mesh(new T.SphereGeometry(0.022, 16, 12), new T.MeshBasicMaterial({ color: 0xf3c14b }));
      m.position.copy(sph(s.lat, s.lon, 1.005)); group.add(m);
      const lab = document.createElement("span"); lab.textContent = s.name; labelsEl.appendChild(lab);
      return { m, lab };
    });
    Object.assign(GLB, { ok: true, renderer, scene, camera, group, markers, el, rx: 0.15, ry: -0.6, tz: 4.4, trx: 0.15, try_: -0.6 });
    group.rotation.set(GLB.rx, GLB.ry, 0);
    new ResizeObserver(() => { const w = el.clientWidth; if (!w) return; renderer.setSize(w, w, false); camera.aspect = 1; camera.updateProjectionMatrix(); }).observe(el);
  } catch (e) { el.style.display = "none"; GLB.ok = false; }
}
function globeFocus(i) {
  GLB.focus = i;
  GLOBE_SITES.forEach((_, k) => document.getElementById("gchip-" + k).setAttribute("aria-pressed", k === i ? "true" : "false"));
  if (!GLB.ok) return;
  if (i < 0 || !GLOBE_SITES[i]) { GLB.focus = -1; GLB.trx = 0.15; GLB.tz = 4.4; return; }   // back to slow spinning
  const s = GLOBE_SITES[i], p = sph(s.lat, s.lon, 1);
  const a = -Math.atan2(p.x, p.z);
  const z1 = -p.x * Math.sin(a) + p.z * Math.cos(a);
  GLB.try_ = a; GLB.trx = Math.atan2(p.y, z1); GLB.tz = 3.35;
  // shortest way round
  while (GLB.try_ - GLB.ry > Math.PI) GLB.try_ -= 2 * Math.PI;
  while (GLB.try_ - GLB.ry < -Math.PI) GLB.try_ += 2 * Math.PI;
}
function globeFrame() {
  if (!GLB.ok || currentCh !== "intro" || document.hidden) { GLB.run = false; return; }
  GLB.run = true;
  if (GLB.focus < 0) { GLB.try_ += 0.0025; }
  GLB.ry += (GLB.try_ - GLB.ry) * 0.05; GLB.rx += (GLB.trx - GLB.rx) * 0.05;
  GLB.camera.position.z += (GLB.tz - GLB.camera.position.z) * 0.05;
  GLB.group.rotation.set(GLB.rx, GLB.ry, 0);
  GLB.renderer.render(GLB.scene, GLB.camera);
  const w = GLB.el.clientWidth, v = new THREE.Vector3();
  GLB.markers.forEach(({ m, lab }) => {
    m.getWorldPosition(v);
    const facing = v.clone().normalize().dot(GLB.camera.position.clone().normalize()) > 0.15;
    v.project(GLB.camera);
    lab.style.left = `${(v.x + 1) / 2 * w}px`; lab.style.top = `${(1 - v.y) / 2 * w}px`;
    const inside = v.x > -0.95 && v.x < 0.95 && v.y > -0.95 && v.y < 0.95;
    lab.style.opacity = facing && inside ? 1 : 0;
    lab.style.transform = v.x > 0.25 ? "translate(calc(-100% - 10px), -50%)" : "translate(10px, -50%)";
  });
  requestAnimationFrame(globeFrame);
}
function startGlobe() { if (GLB.ok && !GLB.run) requestAnimationFrame(globeFrame); }

/* =====================================================================
   SURVEYOR'S VIEW (first person, black and white like its TV camera)
   ===================================================================== */
const POV = { run: false, h: 34, engine: false, hits: 0, parts: [], t0: 0, last: 0, lens: null };
const pv = document.getElementById("povCanvas"), pctx = pv.getContext("2d");
const PW = 960, PH = 420, HOR = 250, FPX = 917, CAMH = 1.5;
const povRocks = Array.from({ length: 140 }, (_, i) => { const r = hash(31, i, 5, 5); return { X: (r() - .5) * 120, Z: 3 + Math.pow(r(), 2) * 150, s: .1 + r() * .5 }; });
function povLens() {
  if (!POV.lens) { POV.lens = document.createElement("canvas"); POV.lens.width = PW; POV.lens.height = PH; }
  return POV.lens.getContext("2d");
}
function drawPOV() {
  const c = pctx;
  c.fillStyle = "#000"; c.fillRect(0, 0, PW, PH);
  const g = c.createLinearGradient(0, HOR, 0, PH); g.addColorStop(0, "#77756f"); g.addColorStop(1, "#4a4844");
  c.fillStyle = g; c.fillRect(0, HOR, PW, PH - HOR);
  const proj = (X, Y, Z) => [PW / 2 + X / Z * FPX, HOR + (CAMH - Y) / Z * FPX];
  for (const k of povRocks) { const [x, y] = proj(k.X, 0, k.Z); const rr = Math.max(.8, k.s / k.Z * FPX); c.fillStyle = "rgba(30,30,28,.55)"; c.beginPath(); c.ellipse(x, y, rr * 1.4, rr * .5, 0, 0, Math.PI * 2); c.fill(); }
  // the Apollo 12 lander, 155 m away
  const [lx, ly] = proj(18, POV.h, 155), sc = FPX / 155;
  c.save(); c.translate(lx, ly); c.scale(sc / 1.5, sc / 1.5);
  if (POV.engine) { const gg = c.createRadialGradient(0, 2, 0, 0, 2, 26); gg.addColorStop(0, "rgba(255,255,255,.9)"); gg.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = gg; c.beginPath(); c.arc(0, 4, 26, 0, Math.PI * 2); c.fill(); }
  c.strokeStyle = "#ddd"; c.lineWidth = 2; c.beginPath(); c.moveTo(-26, 0); c.lineTo(-15, -20); c.moveTo(26, 0); c.lineTo(15, -20); c.stroke();
  c.fillStyle = "#bdbdbd"; c.fillRect(-18, -30, 36, 14); c.fillStyle = "#d8d8d8"; c.beginPath(); c.moveTo(-14, -30); c.lineTo(-10, -52); c.lineTo(10, -52); c.lineTo(14, -30); c.fill();
  c.restore();
  // dust grains coming towards the camera
  for (const p of POV.parts) {
    const [x, y] = proj(p.X, p.Y, p.Z), [x2, y2] = proj(p.X - p.vX * .04, p.Y, p.Z - p.vZ * .04);
    c.strokeStyle = `rgba(235,235,235,${Math.min(1, p.life).toFixed(2)})`; c.lineWidth = Math.min(3, 0.6 + 12 / p.Z);
    c.beginPath(); c.moveTo(x, y); c.lineTo(x2, y2); c.stroke();
  }
  const haze = POV.run ? Math.min(.35, POV.parts.length / 900) : 0;
  if (haze > 0) { c.fillStyle = `rgba(200,200,200,${haze.toFixed(3)})`; c.fillRect(0, HOR - 40, PW, PH - HOR + 40); }
  if (POV.lens) c.drawImage(POV.lens, 0, 0);
  // camera frame: vignette + scanlines, like 1960s TV
  const v = c.createRadialGradient(PW / 2, PH / 2, PH * .35, PW / 2, PH / 2, PW * .62); v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,.85)");
  c.fillStyle = v; c.fillRect(0, 0, PW, PH);
  c.fillStyle = "rgba(0,0,0,.18)"; for (let y = 0; y < PH; y += 3) c.fillRect(0, y, PW, 1);
  c.fillStyle = "#e8e8e8"; c.font = "600 14px " + css("--font-data");
  c.fillText("SURVEYOR 3 · TV CAMERA", 22, 30);
  c.fillText(POV.run ? `LANDER ALT ${POV.h.toFixed(1)} m · 155 m AWAY` : (POV.done ? `TOUCHDOWN · ${POV.hits} NEW PITS ON THE LENS` : "PRESS PLAY"), 22, 52);
}
document.getElementById("povPlay").onclick = () => {
  if (POV.run) return;
  Object.assign(POV, { run: true, h: 34, engine: true, hits: 0, parts: [], t0: 0, last: 0, done: false });
  const L = povLens(); L.clearRect(0, 0, PW, PH);
  const T = 9500;
  const step = (now) => {
    if (!POV.t0) { POV.t0 = now; POV.last = now; }
    const t = now - POV.t0, dt = Math.min((now - POV.last) / 1000, .05); POV.last = now;
    const u = Math.min(t / T, 1);
    POV.h = 2 + 32 * Math.pow(1 - u, 1.8); POV.engine = u < 1;
    if (POV.engine && POV.h < 32) {
      const rate = 420 * (1 - POV.h / 36);
      for (let k = 0; k < rate * dt; k++) {
        const ang = (1 + Math.random() * 2) * Math.PI / 180, v = 35 + Math.random() * 70;
        const az = (Math.random() - .5) * 0.5;                  // a fan towards the camera
        POV.parts.push({ X: 18 + (Math.random() - .5) * 10, Y: .2, Z: 152 + Math.random() * 6, vX: -v * Math.sin(az) - 18 / 155 * v, vZ: -v * Math.cos(az), vY: v * Math.tan(ang), life: 1 });
      }
    }
    for (const p of POV.parts) {
      p.X += p.vX * dt; p.Z += p.vZ * dt; p.Y += p.vY * dt;
      if (p.Z < 1.2) {
        if (Math.abs(p.X) < 1.6 && Math.abs(p.Y - CAMH) < 1.6) {
          POV.hits++;
          const x = PW / 2 + (Math.random() - .5) * PW * .8, y = PH / 2 + (Math.random() - .5) * PH * .8, s = 1 + Math.random() * 2.5;
          L.fillStyle = "rgba(255,255,255,.75)"; L.beginPath(); L.arc(x, y, s, 0, Math.PI * 2); L.fill();
          L.strokeStyle = "rgba(255,255,255,.35)"; L.lineWidth = .8;
          for (let k = 0; k < 3; k++) { const a = Math.random() * Math.PI * 2; L.beginPath(); L.moveTo(x, y); L.lineTo(x + Math.cos(a) * s * 4, y + Math.sin(a) * s * 4); L.stroke(); }
        }
        p.life = 0;
      }
    }
    POV.parts = POV.parts.filter((p) => p.life > 0 && p.Z > 1);
    if (u >= 1 && POV.parts.length === 0) { POV.run = false; POV.done = true; POV.engine = false; drawPOV(); return; }
    drawPOV();
    if (currentCh === "apollo") requestAnimationFrame(step); else { POV.run = false; POV.engine = false; }
  };
  requestAnimationFrame(step);
};

/* =====================================================================
   LIVE MONTE CARLO (simplified, runs in the browser)
   ===================================================================== */
const MC = { N: 0, hits: 0, hist: [], todo: 0, perFrame: 0, run: false, dots: null, rng: Math.random };
const mcMap = document.getElementById("mcMap"), mcx = mcMap.getContext("2d");
const MCW = 560, MCR = 262, MC_RMAX = 3e5;
const APOLLO_ANGLES = [1.4, 2.0, 2.4, 2.6, 3.3, 8.1];
const LN_SG = Math.log(3), D50N = 70 * Math.exp(-3 * LN_SG * LN_SG);    // number median of the mass log-normal
function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function mcGrain(d) {
  let D; do { D = D50N * Math.exp(LN_SG * gauss()); } while (D < 1 || D > 500);
  const v = Math.min(2054 / Math.sqrt(D), 2370) * (0.35 + 0.65 * Math.random());
  const th = (APOLLO_ANGLES[Math.floor(Math.random() * 6)] + 0.5 * gauss()) * Math.PI / 180;
  const r0 = 12 * Math.sqrt(Math.random());
  let hit = false;
  if (th > 0) {
    const dd = d - r0, vh = v * Math.cos(th), t = dd / vh;
    const z = dd * Math.tan(th) - 0.5 * 1.62 * t * t + dd * dd / (2 * 1.7374e6);
    hit = z >= 0 && z <= 1.5;          // passes the target distance low enough to hit hardware 1.5 m tall
  }
  const range = th > 0 ? r0 + v * v * Math.sin(2 * th) / 1.62 : r0;
  return { D, v, range, hit, orbit: v >= 1680 };
}
const mcRad = (m) => MCR * Math.log10(1 + m / 5) / Math.log10(1 + MC_RMAX / 5);
function mcBase() {
  const c = mcx; c.fillStyle = "#05060a"; c.fillRect(0, 0, MCW, MCW);
  c.strokeStyle = "rgba(255,255,255,.12)"; c.fillStyle = "#9aa1ad"; c.font = "11px " + css("--font-data");
  for (const [m, lab] of [[100, "100 m"], [1000, "1 km"], [10000, "10 km"], [100000, "100 km"]]) {
    c.beginPath(); c.arc(MCW / 2, MCW / 2, mcRad(m), 0, Math.PI * 2); c.stroke(); c.fillText(lab, MCW / 2 + mcRad(m) * .71 + 4, MCW / 2 - mcRad(m) * .71);
  }
  const d = +document.getElementById("mcDist").value;
  c.strokeStyle = "#f3c14b"; c.lineWidth = 2; c.setLineDash([6, 4]); c.beginPath(); c.arc(MCW / 2, MCW / 2, mcRad(d), 0, Math.PI * 2); c.stroke(); c.setLineDash([]); c.lineWidth = 1;
  drawLM(c, MCW / 2, MCW / 2 + 8, .7, false);
}
function mcReset() {
  Object.assign(MC, { N: 0, hits: 0, hist: [], todo: 0, run: false });
  MC.dots = document.createElement("canvas"); MC.dots.width = MCW; MC.dots.height = MCW;
  mcDraw(); mcChart();
}
function mcDraw() {
  mcBase(); mcx.drawImage(MC.dots, 0, 0);
  document.getElementById("mcN").textContent = MC.N.toLocaleString("en");
  document.getElementById("mcHits").textContent = MC.hits.toLocaleString("en");
  if (MC.N) {
    const p = MC.hits / MC.N, se = 1.96 * Math.sqrt(Math.max(p * (1 - p), 1e-12) / MC.N);
    document.getElementById("mcEst").textContent = `${Math.round(p * 1e6).toLocaleString("en")} ± ${Math.round(se * 1e6).toLocaleString("en")}`;
  } else document.getElementById("mcEst").textContent = "–";
}
function mcChart() {
  const svg = document.getElementById("mcChart"), w = 420, h = 200, m = { l: 46, r: 10, t: 10, b: 28 };
  const H = MC.hist; if (!H.length) { svg.innerHTML = `<text x="${w / 2}" y="${h / 2}" text-anchor="middle">throw some grains to see the estimate settle</text>`; return; }
  const xmax = Math.max(1000, H[H.length - 1][0]), X = (n) => m.l + Math.log10(n) / Math.log10(xmax) * (w - m.l - m.r);
  const ys = H.flatMap(([, p, s]) => [p + s, Math.max(0, p - s)]), ymax = Math.max(...ys, 1) * 1.1;
  const Y = (v) => m.t + (1 - v / ymax) * (h - m.t - m.b);
  let out = "";
  for (let k = 0; k <= 4; k++) { const v = ymax * k / 4; out += `<line x1="${m.l}" x2="${w - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${m.l - 6}" y="${Y(v) + 3}" text-anchor="end">${Math.round(v).toLocaleString("en")}</text>`; }
  for (const n of [10, 100, 1000, 10000, 100000]) if (n <= xmax) out += `<text x="${X(n)}" y="${h - 10}" text-anchor="middle">${n.toLocaleString("en")}</text>`;
  const top = H.map(([n, p, s]) => `${X(n)},${Y(p + s)}`), bot = H.map(([n, p, s]) => `${X(n)},${Y(Math.max(0, p - s))}`).reverse();
  out += `<path d="M${top.join("L")}L${bot.join("L")}Z" fill="var(--accent)" fill-opacity=".18"/>`;
  out += `<path d="M${H.map(([n, p]) => `${X(n)},${Y(p)}`).join("L")}" fill="none" stroke="var(--accent)" stroke-width="2"/>`;
  out += `<text x="${w - m.r}" y="${h - 1}" text-anchor="end">grains thrown (log scale)</text>`;
  svg.innerHTML = out;
}
function mcThrow(n) {
  MC.todo += n; MC.perFrame = Math.max(MC.perFrame, Math.ceil(n / 70));
  if (MC.run) return;
  MC.run = true;
  const d = () => +document.getElementById("mcDist").value;
  const step = () => {
    const k = Math.min(MC.todo, MC.perFrame), c = MC.dots.getContext("2d"), dist = d();
    for (let i = 0; i < k; i++) {
      const g = mcGrain(dist); MC.N++; if (g.hit) MC.hits++;
      const a = Math.random() * Math.PI * 2, rr = g.orbit ? MCR + 4 : mcRad(Math.min(g.range, MC_RMAX));
      const col = g.hit ? "rgba(243,193,75,.95)" : g.D < 10 ? "rgba(170,205,255,.35)" : g.D < 100 ? "rgba(232,224,206,.35)" : "rgba(255,159,69,.45)";
      c.fillStyle = col; c.fillRect(MCW / 2 + Math.cos(a) * rr, MCW / 2 + Math.sin(a) * rr, g.hit ? 3 : 1.6, g.hit ? 3 : 1.6);
      if (g.hit) { c.strokeStyle = "rgba(243,193,75,.5)"; c.beginPath(); c.moveTo(MCW / 2, MCW / 2); c.lineTo(MCW / 2 + Math.cos(a) * mcRad(dist), MCW / 2 + Math.sin(a) * mcRad(dist)); c.stroke(); }
    }
    MC.todo -= k;
    const p = MC.hits / MC.N; MC.hist.push([MC.N, p * 1e6, 1.96 * Math.sqrt(Math.max(p * (1 - p), 1e-12) / MC.N) * 1e6]);
    mcDraw(); mcChart();
    if (MC.todo > 0 && !document.hidden) requestAnimationFrame(step); else { MC.run = false; MC.perFrame = 0; }
  };
  requestAnimationFrame(step);
}
document.getElementById("mc1k").onclick = () => mcThrow(1000);
document.getElementById("mc10k").onclick = () => mcThrow(10000);
document.getElementById("mcReset").onclick = mcReset;
document.getElementById("mcDist").onchange = mcReset;

/* =====================================================================
   UNCERTAINTY PLAYGROUND
   ===================================================================== */
const UP_LAWS = [["scaling", "Shear scaling"], ["roberts", "Roberts"], ["energy_flux", "Energy flux"]];
const UP_VELS = [["integrated", "Drag model"], ["fig5", "Lane & Metzger fit"]];
const UP = { laws: new Set(UP_LAWS.map((x) => x[0])), vels: new Set(UP_VELS.map((x) => x[0])), angs: new Set(APOLLO_ANGLES) };
const upLander = document.getElementById("upLander");
D.landers.forEach((l, i) => upLander.add(new Option(l.name.replace(/[()]/g, ""), i)));
upLander.value = D.landers.findIndex((l) => l.thrust_N === 11600);
function upChips() {
  const mk = (id, items, set, lab) => {
    document.getElementById(id).innerHTML = items.map((it, i) => `<button type="button" data-i="${i}" aria-pressed="${set.has(it[0])}">${lab(it)}</button>`).join("");
    document.querySelectorAll(`#${id} button`).forEach((b) => {
      b.onclick = () => { const v = items[+b.dataset.i][0]; set.has(v) ? set.delete(v) : set.add(v); upChips(); renderUP(); };
    });
  };
  mk("upLaw", UP_LAWS, UP.laws, (x) => x[1]);
  mk("upVel", UP_VELS, UP.vels, (x) => x[1]);
  mk("upAng", APOLLO_ANGLES.map((a) => [a]), UP.angs, (x) => `${x[0]}°`);
}
function renderUP() {
  const lander = D.landers[+upLander.value], bh = lander.by_height["1.5"], all = bh.branches || {};
  const keep = KEEP;
  const onlyMatch = document.getElementById("upMatch").checked;
  const sel = Object.entries(all).filter(([tag]) => {
    const [vm, law, ang] = tag.split("|");
    return UP.vels.has(vm) && UP.laws.has(law) && UP.angs.has(parseFloat(ang)) && (!onlyMatch || !keep || keep.has(tag));
  });
  const thr = 0.1 * MEAS;
  // same rule as the map rings: safe distance per version, then median and range
  const band = sel.length ? distanceBand(sel.map(([, y]) => y), thr) : null;
  const dists = band ? [band.lo, band.hi] : [];
  const med = band ? band.med : NaN;
  const fr = (x) => !isFinite(x) ? "> 10 km" : fmtD(x);
  document.getElementById("upResult").innerHTML = dists.length
    ? `<div><span class="label">Safe distance (median)</span><b>${fr(med)}</b></div>
       <div><span class="label">Range</span><b style="font-size:17px">${fr(dists[0])} – ${fr(dists[dists.length - 1])}</b></div>
       <div><span class="label">Model versions</span><b>${sel.length}</b></div>`
    : `<div style="grid-column:1/-1"><b style="font-size:16px">No version selected.</b> <span class="muted">Switch at least one option on in every row.</span></div>`;
  const svg = document.getElementById("upChart"), w = 520, h = 300, m = { l: 54, r: 14, t: 14, b: 40 };
  const xmin = Math.log10(R[0]), xmax = Math.log10(R[R.length - 1]);
  const X = (d) => m.l + (Math.log10(d) - xmin) / (xmax - xmin) * (w - m.l - m.r);
  const vals = sel.flatMap(([, y]) => y).filter((v) => v > 0);
  const ymax = Math.ceil(Math.log10(Math.max(...vals, MEAS * 10))), ymin = Math.max(Math.floor(Math.log10(Math.min(...vals, MEAS * 0.01))), ymax - 8);
  const Y = (v) => m.t + (ymax - Math.log10(v)) / (ymax - ymin) * (h - m.t - m.b);
  let out = "";
  for (let p = ymin; p <= ymax; p++) out += `<line x1="${m.l}" x2="${w - m.r}" y1="${Y(10 ** p)}" y2="${Y(10 ** p)}" stroke="var(--line)"/><text x="${m.l - 6}" y="${Y(10 ** p) + 3}" text-anchor="end">1e${p}</text>`;
  for (const d of [25, 100, 1000, 10000]) out += `<line x1="${X(d)}" x2="${X(d)}" y1="${m.t}" y2="${h - m.b}" stroke="var(--line)"/><text x="${X(d)}" y="${h - m.b + 14}" text-anchor="middle">${fmtD(d)}</text>`;
  for (const [tag, y] of sel) {
    const pts = R.map((d, i) => y[i] > 0 ? `${X(d)},${Y(Math.max(y[i], 10 ** ymin))}` : null).filter(Boolean);
    if (pts.length > 1) out += `<path d="M${pts.join("L")}" fill="none" stroke="${keep && keep.has(tag) ? "var(--accent)" : "#6b7280"}" stroke-opacity=".55" stroke-width="1.3"/>`;
  }
  const ty = Y(thr);
  out += `<line x1="${m.l}" x2="${w - m.r}" y1="${ty}" y2="${ty}" stroke="var(--r2)" stroke-dasharray="5 4" stroke-width="1.5"/><text x="${w - m.r - 4}" y="${ty - 5}" text-anchor="end" style="fill:var(--r2)">10× less than Surveyor 3</text>`;
  if (isFinite(med)) out += `<line x1="${X(med)}" x2="${X(med)}" y1="${m.t}" y2="${h - m.b}" stroke="var(--fg)" stroke-width="2"/><text x="${X(med) + 5}" y="${m.t + 12}" style="fill:var(--fg)">median ${fmtD(med)}</text>`;
  out += `<text x="${(m.l + w - m.r) / 2}" y="${h - 6}" text-anchor="middle" style="fill:var(--fg)">distance from lander</text>`;
  svg.innerHTML = out;
}
upLander.onchange = renderUP;
document.getElementById("upMatch").onchange = renderUP;

/* =====================================================================
   HERITAGE GALLERY (facts only from NASA mission pages / NSSDCA)
   ===================================================================== */
const HERITAGE = {
  moon: { label: "Moon", note: "Our dust model covers these. The Moon has no air, so landing dust flies flat and far, exactly what this app simulates.",
    items: [
      { n: "Surveyor 3", m: "Ocean of Storms · landed 20 Apr 1967 · last signal 4 May 1967", t: "The robot that proved the ground could hold an Apollo lander. Sandblasted by Apollo 12 in 1969.", url: "https://science.nasa.gov/mission/surveyor-3/", site: 0 },
      { n: "Apollo 12 ALSEP", m: "Ocean of Storms · set up 19 Nov 1969 · switched off 30 Sep 1977", t: "Science station with a seismometer, magnetometer and a dust detector, powered by a 70-watt nuclear battery (RTG).", url: "https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1969-099C", site: 0 },
      { n: "Apollo descent stages", m: "Apollo 11 to 17 · left on the Moon", t: "The lower half of every Apollo lander stayed behind as the launch pad for the crew's trip home. Apollo 11's Eagle is the most famous.", url: "https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1969-059C", site: 1 },
      { n: "Lunar Roving Vehicles", m: "Apollo 15, 16 and 17 · parked for good", t: "Three electric moon buggies that astronauts drove across the Moon, still parked where the crews left them.", url: "https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1971-063C" },
    ] },
  mars: { label: "Mars", note: "Mars has an atmosphere, less than 1% as dense as Earth's, so landing dust slows down and behaves differently. Our Moon model can't be used there directly. That would be the next project.",
    items: [
      { n: "Viking 1 lander", m: "Chryse Planitia · landed 20 Jul 1976 · last contact 11 Nov 1982", t: "First truly successful Mars landing and the first photo from the surface. It looks like a much bigger Surveyor! Renamed the Thomas Mutch Memorial Station in 1982.", url: "https://science.nasa.gov/mission/viking-1/" },
      { n: "Sojourner", m: "delivered by Mars Pathfinder · 1997", t: "The first rover on Mars, delivered by the Pathfinder lander. Now permanently parked.", url: "https://science.nasa.gov/mission/mars-pathfinder/" },
      { n: "Spirit and Opportunity", m: "Gusev Crater and Meridiani Planum · landed Jan 2004", t: "Twin rovers that showed Mars once had standing water. Opportunity drove 45.16 km and fell silent in 2018 when a planet-wide dust storm covered its solar panels.", url: "https://science.nasa.gov/mission/mars-exploration-rovers-spirit-and-opportunity/" },
      { n: "Phoenix and InSight", m: "two landers, both now silent", t: "Phoenix dug for water ice, InSight listened for marsquakes. Both eventually lost power.", url: "https://science.nasa.gov/mission/insight/" },
      { n: "Ingenuity", m: "Jezero Crater · 72 flights, 19 Apr 2021 to 18 Jan 2024", t: "The first aircraft on another planet. It flew 17 km in total and up to 24 m high, until rotor damage grounded it for good.", url: "https://science.nasa.gov/mission/mars-2020-perseverance/ingenuity-mars-helicopter/" },
    ] },
  space: { label: "Deep space", note: "Not on a surface, so landing dust is not the issue here. These are protected as history in a different way: we know exactly where they are.",
    items: [
      { n: "Pioneer 10 and 11", m: "leaving the solar system", t: "Early deep-space probes that explored the outer planets, now drifting silently out of the solar system.", url: "https://science.nasa.gov/mission/pioneer-10/" },
      { n: "Dawn", m: "orbiting the dwarf planet Ceres", t: "Mapped Vesta and Ceres, ran out of fuel and now circles Ceres without power.", url: "https://science.nasa.gov/mission/dawn/" },
      { n: "NEAR Shoemaker", m: "on asteroid 433 Eros", t: "The first spacecraft to orbit and land on an asteroid. It still rests on the surface of Eros.", url: "https://science.nasa.gov/mission/near-shoemaker/" },
      { n: "Kepler Space Telescope", m: "trailing behind Earth around the Sun", t: "The exoplanet hunter ran out of fuel and now drifts in an Earth-trailing orbit around the Sun.", url: "https://science.nasa.gov/mission/kepler/" },
    ] },
};
const herSeen = new Set();
let herTab = "moon";
function renderHeritage() {
  const keys = Object.keys(HERITAGE);
  document.getElementById("herTabs").innerHTML = keys.map((k) =>
    `<button type="button" role="tab" data-her="${k}" aria-pressed="${k === herTab}" aria-selected="${k === herTab}">${HERITAGE[k].label} · ${HERITAGE[k].items.length}</button>`).join("");
  document.querySelectorAll("[data-her]").forEach((b) => { b.onclick = () => { herTab = b.dataset.her; renderHeritage(); }; });
  const g = HERITAGE[herTab];
  if (currentCh === "future") herSeen.add(herTab);
  document.getElementById("herNote").textContent = g.note;
  document.getElementById("herGrid").innerHTML = g.items.map((it, i) => `<article class="her">
      <span class="meta">${it.m}</span><h3>${it.n}</h3><p>${it.t}</p>
      <div class="links"><a href="${it.url}" target="_blank" rel="noopener">NASA page ↗</a>${it.site != null ? `<button type="button" data-hsite="${i}">Show on the dust map</button>` : ""}</div>
    </article>`).join("");
  document.querySelectorAll("[data-hsite]").forEach((b) => {
    b.onclick = () => { const it = g.items[+b.dataset.hsite]; selectSite(it.site); showMap(); };
  });
  if (herSeen.size === keys.length) award("scout");
}

/* =====================================================================
   GAME AUTOPILOT (used by the tour)
   ===================================================================== */
function autopilot(s) {
  const xt = -420;
  const dvx = s.h > 12 ? Math.max(-12, Math.min(12, (xt - s.x) * 0.1)) : Math.max(-1, Math.min(1, (xt - s.x) * 0.05));
  GM.keys.right = s.vx < dvx - 0.3; GM.keys.left = s.vx > dvx + 0.3;
  const dvz = -Math.max(0.9, Math.min(8, 0.6 + s.h * 0.11));
  GM.keys.up = s.vz < dvz;
}
const _gStep = gStep;
gStep = function (now) { if (GM.auto && GM.s) autopilot(GM.s); return _gStep(now); };

/* =====================================================================
   TOUR MODE
   ===================================================================== */
const Tour = { on: false };
const tourbar = document.getElementById("tourbar");
const tWait = (ms) => new Promise((res) => { const t0 = performance.now(); const tick = () => (!Tour.on || performance.now() - t0 >= ms) ? res() : setTimeout(tick, 100); tick(); });
const tGo = async (ch) => { if (currentCh !== ch) { location.hash = "#" + ch; await tWait(500); } };
const tFocus = (id, block = "center") => { const e = document.getElementById(id); if (e) e.scrollIntoView({ behavior: "smooth", block }); };
function tCap(text, frac) { document.getElementById("tourText").textContent = text; document.getElementById("tourProg").style.width = `${Math.round(frac * 100)}%`; }
async function runTour() {
  if (Tour.on) return;
  Tour.on = true; window.__tourOn = true; document.body.classList.add("touring"); tourbar.hidden = false;
  const steps = [
    async () => { await tGo("intro"); tCap("This is the Moon. Robots and astronauts have left their machines all over it.", 0); globeFocus(-1); GLB.focus = -1; await tWait(4500); },
    async () => { globeFocus(0); tCap("In 1967 the robot Surveyor 3 landed here, in the Ocean of Storms.", .04); await tWait(5000); },
    async () => { await tGo("surveyor"); tCap("Meet Surveyor 3: a robot lander that tested whether the Moon's ground could hold a spacecraft.", .08); await tWait(4500); },
    ...PARTS.map((p, i) => async () => { tFocus("surveyorPhoto"); showPart(i); tCap(`${p.t}: ${p.b}`, .1 + i * .02); await tWait(4500); }),
    async () => { await tGo("apollo"); tCap("Two and a half years later, in November 1969, Apollo 12 landed just 155 metres away.", .22); await tWait(5000); },
    async () => { tFocus("dustScene"); await tWait(700); document.getElementById("dustPlay").click(); tCap("In the last metres the engine blasts the ground. Dust shoots out sideways, almost flat, straight at Surveyor.", .27); await tWait(8500); },
    async () => { tFocus("povScene"); await tWait(700); document.getElementById("povPlay").click(); tCap("This is what Surveyor's camera would have seen: the lander coming down, then dust hitting the lens.", .32); await tWait(11000); },
    async () => { tFocus("pitCanvas"); tCap("Back on Earth, scientists counted about 103 tiny pits in every square centimetre of Surveyor's metal.", .38); await tWait(5500); },
    async () => { await tGo("simulation"); tCap("To plan future landings, we rebuilt this dust storm in a computer model.", .42); await tWait(4000); },
    ...STEPS.map((s, i) => async () => { showStation(0); tFocus("stepCanvas"); showStep(i); tCap(s.b, .46 + i * .03); await tWait(5200); }),
    async () => { showStation(1); tFocus("mcCard", "start"); document.getElementById("mcDist").value = "155"; mcReset(); await tWait(600); mcThrow(10000); tCap("Monte Carlo means: throw thousands of random grains and count the hits. The more grains, the smaller the uncertainty.", .6); await tWait(7000); },
    async () => {
      showStation(2); tFocus("upCard", "start"); tCap("Scientists still disagree on some details, so the model tries every combination. Watch the safe distance jump.", .74);
      await tWait(2500); UP.laws = new Set(["energy_flux"]); upChips(); renderUP(); await tWait(2500);
      UP.laws = new Set(["scaling"]); upChips(); renderUP(); await tWait(2500);
      UP.laws = new Set(UP_LAWS.map((x) => x[0])); upChips(); renderUP(); await tWait(2000);
    },
    async () => {
      await tGo("future"); showStation(0, false, "future"); tCap("Now the future: new landers near moon bases and historic sites. Where should they land?", .8); await tWait(4500);
    },
    async () => { showStation(0, false, "future"); tFocus("mapbox"); await tWait(600); document.getElementById("replay").click(); tCap("On our dust map we can replay 1969. The rings show how far the dust is a problem.", .84); await tWait(14500); },
    async () => {
      const m = MISSIONS[0]; startMission(m); await tWait(1500);
      const lander = D.landers.find((l) => l.thrust_N === m.thrust);
      const need = Math.max(...SITES[m.site].objects.map((o) => ringsFor(lander, o.heightKey || "1.5", 1).find((r) => r.f === m.f).med));
      const dest = SITES[m.site].objects[m.dest].pos;
      onMapTap([dest[0] + need * 1.1, dest[1]]); await tWait(900); testLanding();
      tCap(`Mission: protect Apollo 11's Tranquility Base. Landing ${fmtD(need * 1.1)} away keeps it safe and is still walkable.`, .9); await tWait(14500);
    },
    async () => {
      showStation(2, false, "future"); tFocus("gamebox"); await tWait(600); startGame(); GM.auto = true;
      tCap("You can also land yourself. Here the autopilot shows how: slow down, land softly, and not too close.", .93);
      const t0 = performance.now(); while (Tour.on && GM.run && performance.now() - t0 < 40000) await tWait(300);
      GM.auto = false; await tWait(3500);
    },
    async () => { showStation(3, false, "future"); tFocus("learned", "start"); tCap("What we learned: dust flies flat and far, landing pads help a lot, and honest uncertainty matters.", .96); await tWait(6000); },
    async () => { await tGo("intro"); tCap("Monte Carlo Moon. Learn from the past, protect the future.", 1); await tWait(5000); },
  ];
  for (const s of steps) { if (!Tour.on) break; await s(); }
  endTour();
}
function endTour() {
  Tour.on = false; window.__tourOn = false; GM.auto = false; tourbar.hidden = true; document.body.classList.remove("touring");
  if (GM.run) stopGame(true);
}
document.getElementById("tourBtn").onclick = () => (Tour.on ? endTour() : runTour());
document.getElementById("introTour").onclick = runTour;
document.getElementById("tourStop").onclick = endTour;
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && Tour.on) endTour(); });


/* =====================================================================
   MISSION LOG: hand-drawn notebook sketches (wobbly SVG lines)
   ===================================================================== */
function wobble(points, seed, amp = 1.6) {
  const r = hash(seed, points.length, 3, 7);
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i], [x1, y1] = points[i + 1];
    const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 18));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push([x0 + (x1 - x0) * t + (r() - .5) * amp, y0 + (y1 - y0) * t + (r() - .5) * amp]);
    }
  }
  out.push(points[points.length - 1]);
  return "M" + out.map((p) => p.map((v) => v.toFixed(1)).join(",")).join("L");
}
function penPath(points, seed, color = "#23201a", w = 2, extra = "") {
  return `<path d="${wobble(points, seed)}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>` +
         `<path d="${wobble(points, seed + 11, 2.2)}" fill="none" stroke="${color}" stroke-width="${w * .45}" stroke-opacity=".5" stroke-linecap="round"/>`;
}
const HAND = `font-family="Caveat, Segoe Print, cursive"`;
function drawSketches() {
  // Equation 7 vs Figure 5: speed factor K against lander height (schematic)
  const a = document.getElementById("sketchEq7");
  if (a) {
    let s = "";
    s += penPath([[60, 250], [530, 250]], 1) + penPath([[60, 250], [60, 30]], 2);
    s += `<text x="470" y="276" ${HAND} font-size="20" fill="#23201a">height h →</text>`;
    s += `<text x="16" y="40" ${HAND} font-size="20" fill="#23201a">speed</text>`;
    const fig = [], eq = [];
    for (let i = 0; i <= 30; i++) {
      const h = 0.5 + i * 1.5, x = 60 + i * 15.5;
      const K = 1 / Math.pow(1 + Math.pow(h / 3.32, 0.913 * 6), 1 / 6);   // shape of the fitted Fig. 5 curve
      fig.push([x, 250 - 30 - 170 * K]);
      eq.push([x, 250 - 60 - 55 * Math.pow(h / 0.5, 0.195) * 0.55]);
    }
    s += penPath(fig, 3, "#1f4f8a", 3) + penPath(eq, 4, "#b3261e", 3, 'stroke-dasharray="7 6"');
    s += `<text x="80" y="58" ${HAND} font-size="23" fill="#1f4f8a">Figure 5: flat, then falls</text>`;
    s += `<text x="300" y="118" ${HAND} font-size="23" fill="#b3261e">Equation 7: keeps rising?!</text>`;
    s += penPath([[350, 150], [362, 128], [392, 122], [418, 132], [424, 152], [410, 172], [380, 176], [356, 166], [350, 150]], 9, "#b3261e", 2.2);
    s += `<text x="436" y="186" ${HAND} font-size="22" fill="#b3261e">up to 760 % off</text>`;
    a.innerHTML = s;
  }
  // Pythagoras on the Moon: Apollo 12 lander -> Surveyor 3
  const b = document.getElementById("sketchPyth");
  if (b) {
    const L = [90, 60], E = [90 + 118 * 2.6, 60], S = [90 + 118 * 2.6, 60 + 103 * 1.6];
    let s = "";
    s += penPath([L, E], 21, "#23201a", 2.4) + penPath([E, S], 22, "#23201a", 2.4) + penPath([L, S], 23, "#b3261e", 3.2);
    s += penPath([[E[0] - 16, E[1]], [E[0] - 16, E[1] + 16], [E[0], E[1] + 16]], 24, "#23201a", 1.6);
    s += `<circle cx="${L[0]}" cy="${L[1]}" r="6" fill="#23201a"/><circle cx="${S[0]}" cy="${S[1]}" r="6" fill="#23201a"/>`;
    s += `<text x="${L[0] - 70}" y="${L[1] - 16}" ${HAND} font-size="22" fill="#23201a">Apollo 12 lander</text>`;
    s += `<text x="${S[0] - 40}" y="${S[1] + 34}" ${HAND} font-size="22" fill="#23201a">Surveyor 3</text>`;
    s += `<text x="${(L[0] + E[0]) / 2 - 40}" y="${L[1] - 12}" ${HAND} font-size="24" fill="#23201a">118 m east</text>`;
    s += `<text x="${E[0] + 14}" y="${(E[1] + S[1]) / 2 + 6}" ${HAND} font-size="24" fill="#23201a">103 m south</text>`;
    s += `<text x="${(L[0] + S[0]) / 2 - 200}" y="${(L[1] + S[1]) / 2 + 74}" ${HAND} font-size="26" fill="#b3261e">√(118² + 103²) ≈ 157 m</text>`;
    b.innerHTML = s;
  }
}

/* =====================================================================
   Hook into chapter changes + init
   ===================================================================== */
const _showChapter = showChapter;
showChapter = function (ch) {
  _showChapter(ch);
  if (currentCh === "intro") startGlobe();
  if (currentCh === "log") drawSketches();
  if (currentCh === "apollo") { drawPOV(); if (SIDE) { render3(SIDE); sideHud(dustRun && dustRun.done ? "CONTACT LIGHT" : "Intrepid on final approach. Press play."); } if (PV3) { render3(PV3); drawPovFrame(POV.done ? "TOUCHDOWN" : "PRESS PLAY"); } }
  if (currentCh === "simulation") { mcDraw(); mcChart(); renderUP(); stepScene3d(stepIdx); }
};
document.querySelector(".brand").style.cursor = "pointer";
document.querySelector(".brand").onclick = () => { location.hash = "#intro"; };
initGlobe(); initScenes3d(); mcReset(); upChips(); renderUP(); drawPOV(); renderHeritage();
if (progress.sound) soundBtn.setAttribute("aria-pressed", "false");   // browsers need a click before sound
showChapter(currentCh || "intro");

/* =====================================================================
   MAP FULL SCREEN (real full screen where allowed, otherwise fill the window)
   ===================================================================== */
(function () {
  const box = document.getElementById("mapbox"), btn = document.getElementById("zfull");
  const closeMax = () => { box.classList.remove("map-max"); document.body.classList.remove("map-open"); btn.textContent = "⛶"; };
  btn.onclick = async () => {
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    if (box.classList.contains("map-max")) { closeMax(); return; }
    try { if (!box.requestFullscreen) throw new Error("no api"); await box.requestFullscreen(); }
    catch (e) { box.classList.add("map-max"); document.body.classList.add("map-open"); btn.textContent = "✕"; }
  };
  document.addEventListener("fullscreenchange", () => { btn.textContent = document.fullscreenElement ? "✕" : "⛶"; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && box.classList.contains("map-max")) closeMax(); });
})();
