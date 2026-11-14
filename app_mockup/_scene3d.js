
/* =====================================================================
   3D LANDING SCENE (three.js): side view and Surveyor's camera
   Same world for both: Apollo 12 lander at x = 0, Surveyor 3 at x = 155 m.
   ===================================================================== */
function regolithTexture() {
  const N = 512, c = document.createElement("canvas"); c.width = c.height = N;
  const x = c.getContext("2d"), r = hash(61, 2, 3, 4);
  x.fillStyle = "#8e8b85"; x.fillRect(0, 0, N, N);
  for (let i = 0; i < 26000; i++) { const v = 110 + r() * 70; x.fillStyle = `rgba(${v},${v - 3},${v - 8},${(r() * .35).toFixed(2)})`; x.fillRect(r() * N, r() * N, 1 + r() * 2, 1 + r() * 2); }
  for (let i = 0; i < 70; i++) {
    const cx = r() * N, cy = r() * N, rr = 2 + Math.pow(r(), 3) * 22;
    x.fillStyle = "rgba(40,38,35,.28)"; x.beginPath(); x.arc(cx, cy, rr, 0, Math.PI * 2); x.fill();
    x.strokeStyle = "rgba(230,226,216,.35)"; x.lineWidth = Math.max(1, rr * .15); x.beginPath(); x.arc(cx, cy, rr, Math.PI * .7, Math.PI * 1.6); x.stroke();
  }
  return c;
}
function strut3(T, a, b, r, mat) {
  const d = b.clone().sub(a), m = new T.Mesh(new T.CylinderGeometry(r, r, d.length(), 6), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize());
  m.castShadow = true; return m;
}
function buildLM(T) {
  const g = new T.Group();
  const foil = new T.MeshStandardMaterial({ color: 0xc9a04a, metalness: 0.75, roughness: 0.32 });
  const silver = new T.MeshStandardMaterial({ color: 0xc8c8c4, metalness: 0.35, roughness: 0.45 });
  const dark = new T.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.7 });
  const desc = new T.Mesh(new T.CylinderGeometry(2.1, 2.1, 1.7, 8), foil);
  desc.position.y = 1.5 + 0.85; desc.rotation.y = Math.PI / 8; desc.castShadow = true; g.add(desc);
  const asc = new T.Mesh(new T.BoxGeometry(3.6, 2.5, 3.1), silver); asc.position.y = 3.2 + 1.25; asc.castShadow = true; g.add(asc);
  const front = new T.Mesh(new T.BoxGeometry(1.8, 1.4, 0.4), silver); front.position.set(0, 4.3, -1.7); front.castShadow = true; g.add(front);
  for (const sx of [-0.55, 0.55]) { const w = new T.Mesh(new T.PlaneGeometry(0.55, 0.5), dark); w.position.set(sx, 4.55, -1.91); w.rotation.y = Math.PI; g.add(w); }
  const top = new T.Mesh(new T.CylinderGeometry(0.55, 0.55, 0.35, 12), silver); top.position.y = 5.9; g.add(top);
  const dish = new T.Mesh(new T.SphereGeometry(0.45, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), silver); dish.position.set(1.4, 6.2, 0.6); dish.rotation.z = -0.8; g.add(dish);
  const bell = new T.Mesh(new T.ConeGeometry(0.75, 1.1, 18, 1, true), dark); bell.position.y = 1.5 - 0.15; g.add(bell);
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2, cs = Math.cos(a), sn = Math.sin(a);
    const hip = new T.Vector3(cs * 1.9, 2.9, sn * 1.9), foot = new T.Vector3(cs * 4.5, 0.15, sn * 4.5), low = new T.Vector3(cs * 2.0, 1.55, sn * 2.0);
    g.add(strut3(T, hip, foot, 0.09, foil)); g.add(strut3(T, low, foot.clone().lerp(hip, 0.35), 0.05, silver));
    const pad = new T.Mesh(new T.CylinderGeometry(0.45, 0.35, 0.18, 14), silver); pad.position.copy(foot); pad.position.y = 0.09; pad.castShadow = true; g.add(pad);
  }
  return g;
}
function buildSurveyor(T) {
  const g = new T.Group();
  const white = new T.MeshStandardMaterial({ color: 0xe6e2d8, metalness: 0.15, roughness: 0.55 });
  const panel = new T.MeshStandardMaterial({ color: 0x2c3f63, metalness: 0.45, roughness: 0.35 });
  const hips = [];
  for (let k = 0; k < 3; k++) {
    const a = k * 2 * Math.PI / 3 + 0.4, cs = Math.cos(a), sn = Math.sin(a);
    const hip = new T.Vector3(cs * 0.55, 0.95, sn * 0.55), foot = new T.Vector3(cs * 1.9, 0.12, sn * 1.9);
    hips.push(hip); g.add(strut3(T, hip, foot, 0.05, white));
    const pad = new T.Mesh(new T.CylinderGeometry(0.22, 0.18, 0.1, 12), white); pad.position.copy(foot); pad.position.y = 0.06; pad.castShadow = true; g.add(pad);
  }
  for (let k = 0; k < 3; k++) g.add(strut3(T, hips[k], hips[(k + 1) % 3], 0.035, white));
  g.add(strut3(T, new T.Vector3(0, 0.9, 0), new T.Vector3(0, 3.0, 0), 0.05, white));
  const sp = new T.Mesh(new T.BoxGeometry(1.1, 0.03, 0.85), panel); sp.position.set(0.35, 3.05, 0); sp.rotation.z = -0.5; sp.castShadow = true; g.add(sp);
  const ant = new T.Mesh(new T.BoxGeometry(0.85, 0.03, 0.85), white); ant.position.set(-0.4, 2.9, 0.1); ant.rotation.z = 0.7; ant.castShadow = true; g.add(ant);
  for (const [x, z] of [[0.45, 0.25], [-0.35, -0.35]]) { const b = new T.Mesh(new T.BoxGeometry(0.5, 0.32, 0.38), white); b.position.set(x, 1.0, z); b.castShadow = true; g.add(b); }
  const cam = new T.Mesh(new T.CylinderGeometry(0.11, 0.11, 0.5, 10), white); cam.position.set(-0.2, 1.45, 0.35); cam.castShadow = true; g.add(cam);
  g.add(strut3(T, new T.Vector3(0.3, 1.0, 0.1), new T.Vector3(1.4, 0.55, -0.4), 0.03, white));   // scoop arm
  return g;
}
function glowSprite(T) {
  const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d");
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, "rgba(255,246,220,1)"); g.addColorStop(.35, "rgba(255,214,150,.45)"); g.addColorStop(1, "rgba(255,190,110,0)");
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const s = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(c), blending: T.AdditiveBlending, depthWrite: false, transparent: true }));
  s.scale.set(7, 7, 1); return s;
}
const SURV_X = 155, CAM_POV = [SURV_X - 0.2, 1.45, 0.35];
function makeLandingScene(host, mode) {
  const T = THREE;
  const renderer = new T.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.domElement.className = "scene-gl";
  host.insertBefore(renderer.domElement, host.firstChild);
  const scene = new T.Scene(); scene.background = new T.Color(0x000000);
  const cam = new T.PerspectiveCamera(mode === "side" ? 24 : 24, 16 / 7, 0.05, 4000);   // POV: narrow field, like the 100 mm lens
  // ground with craters, flattened around both spacecraft
  const gGeo = new T.PlaneGeometry(1400, 700, 260, 130); gGeo.rotateX(-Math.PI / 2);
  const pos = gGeo.attributes.position, rr = hash(3, 1, 4, 1);
  const craters = Array.from({ length: 140 }, () => [(rr() - 0.35) * 1100, (rr() - 0.5) * 650, 2 + Math.pow(rr(), 2) * 26]);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    let y = (Math.sin(x * 0.031) + Math.cos(z * 0.043)) * 0.25;
    for (const [cx, cz, r] of craters) {
      const d = Math.hypot(x - cx, z - cz) / r;
      if (d < 1) y -= 0.16 * r * (1 - d * d); else if (d < 1.35) y += 0.05 * r * (1.35 - d) / 0.35;
    }
    const flat = Math.min(1, Math.hypot(x, z) / 18) * Math.min(1, Math.hypot(x - SURV_X, z) / 9);
    pos.setY(i, y * flat);
  }
  gGeo.computeVertexNormals();
  const tex = new T.CanvasTexture(regolithTexture()); tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.repeat.set(60, 30); tex.anisotropy = 8;
  const ground = new T.Mesh(gGeo, new T.MeshStandardMaterial({ map: tex, color: 0xd2cec6, roughness: 1, metalness: 0 }));
  ground.receiveShadow = true; scene.add(ground);
  // stars
  const sp = [], rs = hash(9, 9, 1, 2);
  for (let i = 0; i < 1500; i++) { const a = rs() * Math.PI * 2, e = rs() * 1.2 + 0.05; sp.push(Math.cos(a) * Math.cos(e) * 3000, Math.sin(e) * 3000, Math.sin(a) * Math.cos(e) * 3000); }
  const sg = new T.BufferGeometry(); sg.setAttribute("position", new T.Float32BufferAttribute(sp, 3));
  scene.add(new T.Points(sg, new T.PointsMaterial({ color: 0xdedbd2, size: 1.6, sizeAttenuation: false })));
  // Sun low in the east (+x), as during the Apollo 12 landing morning: long black shadows to the west
  scene.add(new T.HemisphereLight(0xa9a6a0, 0x4a4844, 0.45));
  const sun = new T.DirectionalLight(0xfff4e2, 2.9);
  sun.position.set(330, 85, 110); sun.target.position.set(80, 0, 0); scene.add(sun.target);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -160, right: 160, top: 90, bottom: -90, near: 10, far: 700 });
  scene.add(sun);
  const lm = buildLM(T); scene.add(lm);
  const vis = mode === "side" ? 2.5 : 1;   // side view: spacecraft drawn 2.5x larger so they can be seen
  const surv = buildSurveyor(T); surv.position.set(SURV_X, 0, 0); surv.rotation.y = 2.4; surv.scale.setScalar(vis); lm.scale.setScalar(vis); scene.add(surv);
  const glow = glowSprite(T); glow.visible = false; glow.scale.multiplyScalar(mode === "side" ? vis : 0.45); scene.add(glow);
  // dust grains
  const N = mode === "side" ? 9000 : 12000;
  const P = new Float32Array(N * 3), C = new Float32Array(N * 3), V = new Float32Array(N * 3), life = new Float32Array(N);
  for (let i = 0; i < N; i++) P[i * 3 + 1] = -500;
  const dg = new T.BufferGeometry();
  dg.setAttribute("position", new T.BufferAttribute(P, 3)); dg.setAttribute("color", new T.BufferAttribute(C, 3));
  const dust = new T.Points(dg, new T.PointsMaterial({ size: mode === "side" ? 1.15 : mode === "close" ? 0.28 : 0.09, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
  dust.frustumCulled = false; scene.add(dust);
  if (mode === "side") { cam.position.set(78, 16, 215); cam.lookAt(78, 11, 0); }
  else if (mode === "close") { cam.position.set(34, 10, 58); cam.lookAt(0, 5, 0); }
  else { cam.position.set(...CAM_POV); cam.lookAt(0, 3.5, 0); }
  const S = { renderer, scene, cam, lm, glow, dust, P, C, V, life, N, next: 0, mode, host, alt: 34, engine: false };
  const resize = () => { const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); render3(S); if (S.onResize) S.onResize(); };
  new ResizeObserver(resize).observe(host); resize();
  setLanderAlt(S, 34);
  return S;
}
function setLanderAlt(S, a) {
  S.alt = a; S.lm.position.y = a;
  S.glow.position.set(0, a + 0.6, 0); S.glow.visible = S.engine;
}
function emitDust(S, dt, a) {
  const rate = (S.mode === "side" ? 2600 : 3400) * Math.max(0, 1 - a / 32);
  let n = Math.floor(rate * dt + Math.random());
  while (n-- > 0) {
    const i = S.next; S.next = (S.next + 1) % S.N;
    // POV: half of the grains are aimed into the camera's view cone so the sheet is visible
    const az = S.mode === "pov" && Math.random() < 0.55 ? (Math.random() - 0.5) * 0.25 : Math.random() * Math.PI * 2;
    const r0 = Math.random() * Math.min(Math.max(a, 3), 12), th = (1 + Math.random() * 2) * Math.PI / 180;
    const v = 70 + Math.random() * 110;   // display speed (time is compressed)
    S.P[i * 3] = Math.cos(az) * r0; S.P[i * 3 + 1] = 0.15; S.P[i * 3 + 2] = Math.sin(az) * r0;
    S.V[i * 3] = Math.cos(az) * v; S.V[i * 3 + 1] = v * Math.tan(th); S.V[i * 3 + 2] = Math.sin(az) * v;
    S.life[i] = 1;
  }
}
function stepDust(S, dt, onHit) {
  const { P, V, C, life, N } = S;
  for (let i = 0; i < N; i++) {
    if (life[i] <= 0) continue;
    const x0 = P[i * 3];
    P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
    life[i] -= dt * 0.33;
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    if (x0 < SURV_X - 1 && x >= SURV_X - 1 && Math.abs(z) < 2.2 && y < 3.6) { onHit && onHit(i, y, z); }
    if (life[i] <= 0 || Math.abs(x) > 600 || Math.abs(z) > 600) { life[i] = 0; P[i * 3 + 1] = -500; }
    const b = Math.max(0, life[i]) * 0.86;
    C[i * 3] = 0.85 * b + 0.05; C[i * 3 + 1] = 0.82 * b + 0.05; C[i * 3 + 2] = 0.76 * b + 0.05;
  }
  S.dust.geometry.attributes.position.needsUpdate = true; S.dust.geometry.attributes.color.needsUpdate = true;
}
function render3(S) { S.renderer.render(S.scene, S.cam); }
function project3(S, x, y, z) {
  const v = new THREE.Vector3(x, y, z).project(S.cam);
  return [(v.x + 1) / 2 * S.host.clientWidth, (1 - v.y) / 2 * S.host.clientHeight, v.z < 1];
}

// ---- side view (chapter 2) --------------------------------------------
let SIDE = null;
function sideHud(text2) {
  const hud = document.getElementById("dustHud"); if (!SIDE || !hud) return;
  const a = SIDE.alt;
  const [lx, ly] = project3(SIDE, 0, a + 17, 0), [sx, sy] = project3(SIDE, SURV_X, 9, 0);
  hud.innerHTML = `<span class="tag3" style="left:${lx}px;top:${ly}px">Intrepid · ${a.toFixed(1)} m</span>
    <span class="tag3" style="left:${sx}px;top:${sy}px">Surveyor 3 · 155 m</span>
    <div class="readout">${text2 || ""}</div>`;
}
function playSide() {
  if (!SIDE || (dustRun && !dustRun.done)) return;
  dustRun = { h: 34, engine: true, hits: 0, done: false };
  SIDE.life.fill(0); SIDE.P.fill(0); for (let i = 0; i < SIDE.N; i++) SIDE.P[i * 3 + 1] = -500;
  let t0 = 0, last = 0;
  const T = 9000, SETTLE = 3500;
  const step = (now) => {
    if (!t0) { t0 = now; last = now; }
    const t = now - t0, dt = Math.min((now - last) / 1000, 0.05); last = now;
    const u = Math.min(t / T, 1);
    const a = u < 1 ? 1.7 + 32.3 * Math.pow(1 - u, 1.7) : Math.max(0, 1.7 - (t - T) / 600 * 1.7);
    SIDE.engine = u < 1; dustRun.h = a; dustRun.engine = SIDE.engine;
    if (SIDE.engine) emitDust(SIDE, dt, a);
    stepDust(SIDE, dt, () => { dustRun.hits++; });
    setLanderAlt(SIDE, a); render3(SIDE);
    sideHud(SIDE.engine ? `ALT ${a.toFixed(1)} m · grains hitting Surveyor: ${dustRun.hits}` : `CONTACT LIGHT · Surveyor 3 was hit by ${dustRun.hits} grains (in this small sample)`);
    if (t < T + SETTLE && currentCh === "apollo") requestAnimationFrame(step);
    else { dustRun.done = true; dustRun.engine = false; award("witness"); }
  };
  requestAnimationFrame(step);
}

// ---- Surveyor's camera (chapter 2) ------------------------------------
let PV3 = null;
function povOverlay() {
  const ov = document.getElementById("povOverlay"); if (!ov) return null;
  const w = ov.clientWidth, h = ov.clientHeight;
  if (ov.width !== w || ov.height !== h) { ov.width = w; ov.height = h; }
  return ov.getContext("2d");
}
function drawPovFrame(text) {
  const c = povOverlay(); if (!c) return;
  const w = c.canvas.width, h = c.canvas.height;
  c.clearRect(0, 0, w, h);
  if (POV.lens) c.drawImage(POV.lens, 0, 0, w, h);
  const v = c.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, w * 0.62); v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,.85)");
  c.fillStyle = v; c.fillRect(0, 0, w, h);
  c.fillStyle = "rgba(0,0,0,.2)"; for (let y = 0; y < h; y += 3) c.fillRect(0, y, w, 1);
  c.fillStyle = "#e8e8e8"; c.font = `500 ${Math.max(11, w / 70)}px ${css("--font-data")}`;
  c.fillText("SURVEYOR 3 · TV CAMERA · 200 LINES", 18, 26);
  c.fillText(text, 18, 26 + Math.max(15, w / 50));
}
function playPov3() {
  if (!PV3 || POV.run) return;
  Object.assign(POV, { run: true, h: 34, engine: true, hits: 0, done: false });
  PV3.life.fill(0); for (let i = 0; i < PV3.N; i++) PV3.P[i * 3 + 1] = -500;
  if (!POV.lens) { POV.lens = document.createElement("canvas"); POV.lens.width = 960; POV.lens.height = 420; }
  const L = POV.lens.getContext("2d"); L.clearRect(0, 0, 960, 420);
  let t0 = 0, last = 0;
  const T = 9500, SETTLE = 3000;
  const step = (now) => {
    if (!t0) { t0 = now; last = now; }
    const t = now - t0, dt = Math.min((now - last) / 1000, 0.05); last = now;
    const u = Math.min(t / T, 1);
    const a = u < 1 ? 1.7 + 32.3 * Math.pow(1 - u, 1.7) : Math.max(0, 1.7 - (t - T) / 600 * 1.7);
    PV3.engine = u < 1; POV.h = a; POV.engine = PV3.engine;
    if (PV3.engine) emitDust(PV3, dt, a);
    // grains reaching the camera leave a pit on the lens
    stepDust(PV3, dt, (i, y, z) => {
      if (Math.abs(y - CAM_POV[1]) < 1.3 && Math.abs(z - CAM_POV[2]) < 1.3) {
        POV.hits++;
        const x = 960 * (0.1 + Math.random() * 0.8), yy = 420 * (0.1 + Math.random() * 0.8), s = 1 + Math.random() * 2.5;
        L.fillStyle = "rgba(255,255,255,.8)"; L.beginPath(); L.arc(x, yy, s, 0, Math.PI * 2); L.fill();
        L.strokeStyle = "rgba(255,255,255,.35)"; L.lineWidth = 0.8;
        for (let k = 0; k < 3; k++) { const an = Math.random() * Math.PI * 2; L.beginPath(); L.moveTo(x, yy); L.lineTo(x + Math.cos(an) * s * 4, yy + Math.sin(an) * s * 4); L.stroke(); }
      }
    });
    setLanderAlt(PV3, a); render3(PV3);
    drawPovFrame(PV3.engine ? `LANDER ALT ${a.toFixed(1)} m · 155 m AWAY` : `TOUCHDOWN · ${POV.hits} NEW PITS ON THE LENS`);
    if (t < T + SETTLE && currentCh === "apollo") requestAnimationFrame(step);
    else { POV.run = false; POV.engine = false; POV.done = true; }
  };
  requestAnimationFrame(step);
}

function initScenes3d() {
  if (!window.THREE) return;
  try {
    const sideHost = document.getElementById("dustScene"), povHost = document.getElementById("povScene");
    SIDE = makeLandingScene(sideHost, "side");
    PV3 = makeLandingScene(povHost, "pov");
    const stepHost = document.getElementById("stepScene"); if (stepHost) ST3 = makeLandingScene(stepHost, "close");
    sideHost.classList.add("is3d"); povHost.classList.add("is3d");
    document.getElementById("dustPlay").onclick = playSide;
    document.getElementById("povPlay").onclick = playPov3;
    SIDE.onResize = () => sideHud(dustRun && dustRun.done ? "CONTACT LIGHT" : "Intrepid on final approach. Press play.");
    PV3.onResize = () => drawPovFrame(POV.done ? "TOUCHDOWN" : "PRESS PLAY");
    sideHud("Intrepid on final approach. Press play.");
    drawPovFrame("PRESS PLAY");
  } catch (e) { SIDE = PV3 = null; }
}

// ---- model steps 1-2 (chapter 3): looping close-up of a hovering lander ----
let ST3 = null, st3run = false;
function stepHud3() {
  const hud = document.getElementById("stepHud"); if (!ST3 || !hud) return;
  const [nx, ny] = project3(ST3, 0, ST3.alt + 0.3, 0);
  hud.innerHTML = stepIdx === 0
    ? `<span class="tag3" style="left:${nx}px;top:${ny + 40}px">exhaust ≈ 3 km/s</span><div class="readout">The wind along the ground drags the loose top layer with it</div>`
    : `<div class="readout">Grains leave at 1–3°. No air to slow them: they keep going until gravity brings them down.</div>`;
}
function stepScene3d(i) {
  const host = document.getElementById("stepScene");
  if (!ST3 || !host) return false;
  const use = i < 2;
  host.classList.toggle("show3d", use);
  if (use && !st3run) {
    st3run = true; ST3.look = ST3.look || [0, 5, 0];
    let last = 0;
    const loop = (now) => {
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 0; last = now;
      if (!(currentCh === "simulation" && station === 0 && stepIdx < 2) || document.hidden) { st3run = false; return; }
      ST3.engine = true; emitDust(ST3, dt, 6); stepDust(ST3, dt, null);
      setLanderAlt(ST3, 6 + Math.sin(now / 900) * 0.3);
      // step 1: close look at the blast; step 2: low camera looking along the flat dust sheet
      const t = stepIdx === 0 ? [34, 10, 58, 0, 5, 0] : [16, 2.0, 20, 140, 1.4, -45];
      const c = ST3.cam.position;
      c.x += (t[0] - c.x) * 0.04; c.y += (t[1] - c.y) * 0.04; c.z += (t[2] - c.z) * 0.04;
      for (let k = 0; k < 3; k++) ST3.look[k] += (t[3 + k] - ST3.look[k]) * 0.04;
      ST3.cam.lookAt(ST3.look[0], ST3.look[1], ST3.look[2]);
      render3(ST3); stepHud3();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  return use;
}
const _showStep3 = showStep;
showStep = function (i) { _showStep3(i); stepScene3d(i); };
