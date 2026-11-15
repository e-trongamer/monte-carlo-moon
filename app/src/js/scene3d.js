/* three.js landing scene, shared by the chapter 2 views (side view and
   Surveyor's camera) and the chapter 3 close-up. One world for all of them:
   the Apollo 12 lander at x = 0, Surveyor 3 at x = 155 m, metres throughout.

   This module only builds and animates scenes; the chapters decide when to play.
   three.js comes from a CDN <script>, so window.THREE can be missing (offline):
   callers check hasWebGL() first. */

import { APOLLO_ANGLES } from "./data.js";
import { seededRandom } from "./util.js";

export const SURVEYOR_X = 155;
export const SURVEYOR_CAMERA = [SURVEYOR_X - 0.2, 1.45, 0.35];   // where its TV camera sits

let webglAvailable = null;
export function hasWebGL() {
  if (webglAvailable == null) {
    try { webglAvailable = !!window.THREE && !!document.createElement("canvas").getContext("webgl"); }
    catch (e) { webglAvailable = false; }
  }
  return webglAvailable;
}

function regolithTexture() {
  const N = 512, c = document.createElement("canvas"); c.width = c.height = N;
  const x = c.getContext("2d"), r = seededRandom(61, 2, 3, 4);
  x.fillStyle = "#8e8b85"; x.fillRect(0, 0, N, N);
  for (let i = 0; i < 26000; i++) {
    const v = 110 + r() * 70;
    x.fillStyle = `rgba(${v},${v - 3},${v - 8},${(r() * .35).toFixed(2)})`;
    x.fillRect(r() * N, r() * N, 1 + r() * 2, 1 + r() * 2);
  }
  for (let i = 0; i < 70; i++) {
    const cx = r() * N, cy = r() * N, rr = 2 + Math.pow(r(), 3) * 22;
    x.fillStyle = "rgba(40,38,35,.28)"; x.beginPath(); x.arc(cx, cy, rr, 0, Math.PI * 2); x.fill();
    x.strokeStyle = "rgba(230,226,216,.35)"; x.lineWidth = Math.max(1, rr * .15);
    x.beginPath(); x.arc(cx, cy, rr, Math.PI * .7, Math.PI * 1.6); x.stroke();
  }
  return c;
}

// A cylinder from point a to point b (legs and struts).
function strut(T, a, b, r, mat) {
  const d = b.clone().sub(a), m = new T.Mesh(new T.CylinderGeometry(r, r, d.length(), 6), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize());
  m.castShadow = true;
  return m;
}

function buildLunarModule(T) {
  const g = new T.Group();
  const foil = new T.MeshStandardMaterial({ color: 0xc9a04a, metalness: 0.75, roughness: 0.32 });
  const silver = new T.MeshStandardMaterial({ color: 0xc8c8c4, metalness: 0.35, roughness: 0.45 });
  const dark = new T.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.7 });
  const descent = new T.Mesh(new T.CylinderGeometry(2.1, 2.1, 1.7, 8), foil);
  descent.position.y = 2.35; descent.rotation.y = Math.PI / 8; descent.castShadow = true; g.add(descent);
  const ascent = new T.Mesh(new T.BoxGeometry(3.6, 2.5, 3.1), silver);
  ascent.position.y = 4.45; ascent.castShadow = true; g.add(ascent);
  const front = new T.Mesh(new T.BoxGeometry(1.8, 1.4, 0.4), silver);
  front.position.set(0, 4.3, -1.7); front.castShadow = true; g.add(front);
  for (const sx of [-0.55, 0.55]) {
    const w = new T.Mesh(new T.PlaneGeometry(0.55, 0.5), dark);
    w.position.set(sx, 4.55, -1.91); w.rotation.y = Math.PI; g.add(w);
  }
  const top = new T.Mesh(new T.CylinderGeometry(0.55, 0.55, 0.35, 12), silver); top.position.y = 5.9; g.add(top);
  const dish = new T.Mesh(new T.SphereGeometry(0.45, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), silver);
  dish.position.set(1.4, 6.2, 0.6); dish.rotation.z = -0.8; g.add(dish);
  const bell = new T.Mesh(new T.ConeGeometry(0.75, 1.1, 18, 1, true), dark); bell.position.y = 1.35; g.add(bell);
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2, cs = Math.cos(a), sn = Math.sin(a);
    const hip = new T.Vector3(cs * 1.9, 2.9, sn * 1.9), foot = new T.Vector3(cs * 4.5, 0.15, sn * 4.5);
    const low = new T.Vector3(cs * 2.0, 1.55, sn * 2.0);
    g.add(strut(T, hip, foot, 0.09, foil));
    g.add(strut(T, low, foot.clone().lerp(hip, 0.35), 0.05, silver));
    const pad = new T.Mesh(new T.CylinderGeometry(0.45, 0.35, 0.18, 14), silver);
    pad.position.copy(foot); pad.position.y = 0.09; pad.castShadow = true; g.add(pad);
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
    hips.push(hip); g.add(strut(T, hip, foot, 0.05, white));
    const pad = new T.Mesh(new T.CylinderGeometry(0.22, 0.18, 0.1, 12), white);
    pad.position.copy(foot); pad.position.y = 0.06; pad.castShadow = true; g.add(pad);
  }
  for (let k = 0; k < 3; k++) g.add(strut(T, hips[k], hips[(k + 1) % 3], 0.035, white));
  g.add(strut(T, new T.Vector3(0, 0.9, 0), new T.Vector3(0, 3.0, 0), 0.05, white));          // mast
  const solar = new T.Mesh(new T.BoxGeometry(1.1, 0.03, 0.85), panel);
  solar.position.set(0.35, 3.05, 0); solar.rotation.z = -0.5; solar.castShadow = true; g.add(solar);
  const antenna = new T.Mesh(new T.BoxGeometry(0.85, 0.03, 0.85), white);
  antenna.position.set(-0.4, 2.9, 0.1); antenna.rotation.z = 0.7; antenna.castShadow = true; g.add(antenna);
  for (const [x, z] of [[0.45, 0.25], [-0.35, -0.35]]) {
    const box = new T.Mesh(new T.BoxGeometry(0.5, 0.32, 0.38), white);
    box.position.set(x, 1.0, z); box.castShadow = true; g.add(box);
  }
  const camera = new T.Mesh(new T.CylinderGeometry(0.11, 0.11, 0.5, 10), white);
  camera.position.set(-0.2, 1.45, 0.35); camera.castShadow = true; g.add(camera);
  g.add(strut(T, new T.Vector3(0.3, 1.0, 0.1), new T.Vector3(1.4, 0.55, -0.4), 0.03, white));   // scoop arm
  return g;
}

function engineGlow(T) {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const x = c.getContext("2d"), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,246,220,1)"); g.addColorStop(.35, "rgba(255,214,150,.45)"); g.addColorStop(1, "rgba(255,190,110,0)");
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const s = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(c), blending: T.AdditiveBlending, depthWrite: false, transparent: true }));
  s.scale.set(7, 7, 1);
  return s;
}

function cratered(T) {
  // Ground with craters, flattened around both spacecraft.
  const geo = new T.PlaneGeometry(1400, 700, 260, 130); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, r = seededRandom(3, 1, 4, 1);
  const craters = Array.from({ length: 140 }, () => [(r() - 0.35) * 1100, (r() - 0.5) * 650, 2 + Math.pow(r(), 2) * 26]);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    let y = (Math.sin(x * 0.031) + Math.cos(z * 0.043)) * 0.25;
    for (const [cx, cz, cr] of craters) {
      const d = Math.hypot(x - cx, z - cz) / cr;
      if (d < 1) y -= 0.16 * cr * (1 - d * d); else if (d < 1.35) y += 0.05 * cr * (1.35 - d) / 0.35;
    }
    const flat = Math.min(1, Math.hypot(x, z) / 18) * Math.min(1, Math.hypot(x - SURVEYOR_X, z) / 9);
    pos.setY(i, y * flat);
  }
  geo.computeVertexNormals();
  const tex = new T.CanvasTexture(regolithTexture());
  tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.repeat.set(60, 30); tex.anisotropy = 8;
  const ground = new T.Mesh(geo, new T.MeshStandardMaterial({ map: tex, color: 0xd2cec6, roughness: 1, metalness: 0 }));
  ground.receiveShadow = true;
  return ground;
}

function starfield(T) {
  const p = [], r = seededRandom(9, 9, 1, 2);
  for (let i = 0; i < 1500; i++) {
    const a = r() * Math.PI * 2, e = r() * 1.2 + 0.05;
    p.push(Math.cos(a) * Math.cos(e) * 3000, Math.sin(e) * 3000, Math.sin(a) * Math.cos(e) * 3000);
  }
  const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(p, 3));
  return new T.Points(g, new T.PointsMaterial({ color: 0xdedbd2, size: 1.6, sizeAttenuation: false }));
}

/* mode: "side"  wide view from the side, spacecraft drawn 2.5x larger
         "pov"   through Surveyor's camera, 155 m from the lander
         "close" close-up of the hovering lander (chapter 3) */
export function makeLandingScene(host, mode) {
  const T = THREE;
  const renderer = new T.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.domElement.className = "scene-gl";
  host.insertBefore(renderer.domElement, host.firstChild);

  const scene = new T.Scene(); scene.background = new T.Color(0x000000);
  const cam = new T.PerspectiveCamera(24, 16 / 7, 0.05, 4000);      // narrow field, like the 100 mm lens
  scene.add(cratered(T), starfield(T));
  // Sun low in the east (+x), as on the Apollo 12 landing morning: long shadows to the west.
  scene.add(new T.HemisphereLight(0xa9a6a0, 0x4a4844, 0.45));
  const sun = new T.DirectionalLight(0xfff4e2, 2.9);
  sun.position.set(330, 85, 110); sun.target.position.set(80, 0, 0); scene.add(sun.target);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -160, right: 160, top: 90, bottom: -90, near: 10, far: 700 });
  scene.add(sun);

  const enlarge = mode === "side" ? 2.5 : 1;
  const lm = buildLunarModule(T); lm.scale.setScalar(enlarge); scene.add(lm);
  const surveyor = buildSurveyor(T);
  surveyor.position.set(SURVEYOR_X, 0, 0); surveyor.rotation.y = 2.4; surveyor.scale.setScalar(enlarge); scene.add(surveyor);
  const glow = engineGlow(T); glow.visible = false; glow.scale.multiplyScalar(mode === "side" ? enlarge : 0.45); scene.add(glow);

  // Dust grains: a ring buffer of points.
  const N = mode === "side" ? 9000 : 12000;
  const P = new Float32Array(N * 3), C = new Float32Array(N * 3), V = new Float32Array(N * 3), life = new Float32Array(N);
  for (let i = 0; i < N; i++) P[i * 3 + 1] = -500;
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.BufferAttribute(P, 3)); geo.setAttribute("color", new T.BufferAttribute(C, 3));
  const size = mode === "side" ? 1.15 : mode === "close" ? 0.28 : 0.09;
  const dust = new T.Points(geo, new T.PointsMaterial({ size, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
  dust.frustumCulled = false; scene.add(dust);

  if (mode === "side") { cam.position.set(78, 16, 215); cam.lookAt(78, 11, 0); }
  else if (mode === "close") { cam.position.set(34, 10, 58); cam.lookAt(0, 5, 0); }
  else { cam.position.set(...SURVEYOR_CAMERA); cam.lookAt(0, 3.5, 0); }

  const S = { renderer, scene, cam, lm, glow, dust, P, C, V, life, N, next: 0, mode, host, alt: 34, engine: false, onResize: null };
  const resize = () => {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
    renderScene(S);
    if (S.onResize) S.onResize();
  };
  new ResizeObserver(resize).observe(host);
  resize();
  setLanderAltitude(S, 34);
  return S;
}

export function setLanderAltitude(S, a) {
  S.alt = a; S.lm.position.y = a;
  S.glow.position.set(0, a + 0.6, 0); S.glow.visible = S.engine;
}

export function clearDust(S) {
  S.life.fill(0);
  for (let i = 0; i < S.N; i++) S.P[i * 3 + 1] = -500;
}

// Launch grains from under the lander at altitude a. Angles are the measured
// Apollo angles (+-0.5 deg), speeds are display speeds because time is compressed.
export function emitDust(S, dt, a) {
  const rate = (S.mode === "side" ? 2600 : 3400) * Math.max(0, 1 - a / 32);
  let n = Math.floor(rate * dt + Math.random());
  while (n-- > 0) {
    const i = S.next; S.next = (S.next + 1) % S.N;
    // POV: half of the grains are aimed into the camera's view cone so the sheet is visible
    const az = S.mode === "pov" && Math.random() < 0.55 ? (Math.random() - 0.5) * 0.25 : Math.random() * Math.PI * 2;
    const r0 = Math.random() * Math.min(Math.max(a, 3), 12);
    const deg = APOLLO_ANGLES[Math.floor(Math.random() * APOLLO_ANGLES.length)] + (Math.random() - 0.5);
    const th = Math.max(0.3, deg) * Math.PI / 180, v = 70 + Math.random() * 110;
    S.P[i * 3] = Math.cos(az) * r0; S.P[i * 3 + 1] = 0.15; S.P[i * 3 + 2] = Math.sin(az) * r0;
    S.V[i * 3] = Math.cos(az) * v; S.V[i * 3 + 1] = v * Math.tan(th); S.V[i * 3 + 2] = Math.sin(az) * v;
    S.life[i] = 1;
  }
}

// Move every live grain; onPass(i, y, z) is called when a grain crosses Surveyor's x.
export function stepDust(S, dt, onPass = null) {
  const { P, V, C, life, N } = S;
  for (let i = 0; i < N; i++) {
    if (life[i] <= 0) continue;
    const x0 = P[i * 3];
    P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
    life[i] -= dt * 0.33;
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    if (onPass && x0 < SURVEYOR_X - 1 && x >= SURVEYOR_X - 1) onPass(i, y, z);
    if (life[i] <= 0 || Math.abs(x) > 600 || Math.abs(z) > 600) { life[i] = 0; P[i * 3 + 1] = -500; }
    const b = Math.max(0, life[i]) * 0.86;
    C[i * 3] = 0.85 * b + 0.05; C[i * 3 + 1] = 0.82 * b + 0.05; C[i * 3 + 2] = 0.76 * b + 0.05;
  }
  S.dust.geometry.attributes.position.needsUpdate = true;
  S.dust.geometry.attributes.color.needsUpdate = true;
}

export const renderScene = (S) => S.renderer.render(S.scene, S.cam);

// World point -> pixel position in the host element: [x, y, inFront]
export function projectToHost(S, x, y, z) {
  const v = new THREE.Vector3(x, y, z).project(S.cam);
  return [(v.x + 1) / 2 * S.host.clientWidth, (1 - v.y) / 2 * S.host.clientHeight, v.z < 1];
}

// Lander altitude during a compressed descent: 34 m -> 1.7 m over `ms`, then the drop.
export function descentAltitude(t, ms) {
  const u = Math.min(t / ms, 1);
  return u < 1 ? 1.7 + 32.3 * Math.pow(1 - u, 1.7) : Math.max(0, 1.7 - (t - ms) / 600 * 1.7);
}