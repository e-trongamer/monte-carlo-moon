/* Start screen: the answer first, then a rotating Moon with three marked sites. */

import { APOLLO_THRUST_N, DATA, LANDERS, landerIndex } from "./data.js";
import { $, seededRandom } from "./util.js";
import { fmtPractical, ringsFor } from "./exposure.js";
import { isShown } from "./router.js";

const GLOBE_SITES = [
  { name: "Apollo 12 + Surveyor 3", lat: -3.01, lon: -23.42 },
  { name: "Apollo 11", lat: 0.67, lon: 23.47 },
  { name: "South pole (Artemis region)", lat: -88.5, lon: 0 },
];
const MOON_TEXTURE = "assets/moon_2k.jpg";      // NASA SVS CGI Moon Kit (LRO); inlined by build.py
const globe = { ok: false, running: false, focus: -1 };

export function renderAnswer() {
  const ring = ringsFor(LANDERS[landerIndex(APOLLO_THRUST_N)], "1.5").find((r) => r.f === 0.1);
  const pad = DATA.mitigation && DATA.mitigation.practical_distance["11.6 kN | pad, 30 m radius"];
  const el = $("heroAnswer");
  if (!ring || !isFinite(ring.med)) { el.hidden = true; return; }
  el.innerHTML = `<b>Our answer, in short:</b> an Apollo-size lander should touch down about <b>${fmtPractical(ring.med)}</b> from hardware on the Moon, so it gets less than a tenth of the sandblasting Surveyor 3 got.`
    + (pad && pad.median != null ? ` On a 30 m landing pad, about <b>${fmtPractical(pad.median)}</b> is enough.` : "")
    + "<small>A rule of thumb from our model, not a safety rule. The story shows how we got there.</small>";
}

/* ------------------------------------------------------------ the globe */
function toSphere(lat, lon, r) {
  const phi = (lon + 180) / 360 * 2 * Math.PI, th = (90 - lat) / 180 * Math.PI;
  return new THREE.Vector3(-r * Math.cos(phi) * Math.sin(th), r * Math.cos(th), r * Math.sin(phi) * Math.sin(th));
}

function buildGlobe(el) {
  const T = THREE;
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  el.insertBefore(renderer.domElement, el.firstChild);
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 0, 4.4);
  const group = new T.Group(); group.rotation.order = "XYZ"; scene.add(group);
  const mat = new T.MeshStandardMaterial({ color: 0x8f8c86, roughness: 1, metalness: 0 });
  new T.TextureLoader().load(MOON_TEXTURE, (tx) => { mat.map = tx; mat.color.set(0xc9c6c0); mat.needsUpdate = true; });
  group.add(new T.Mesh(new T.SphereGeometry(1, 96, 64), mat));
  scene.add(new T.AmbientLight(0xffffff, 0.22));
  const sun = new T.DirectionalLight(0xfff6e8, 1.2); sun.position.set(-3, 1.1, 2.6); scene.add(sun);
  const stars = [], rs = seededRandom(2, 4, 6, 8);
  for (let i = 0; i < 900; i++) {
    const u = rs() * 2 - 1, a = rs() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    stars.push(30 * s * Math.cos(a), 30 * u, 30 * s * Math.sin(a));
  }
  const sg = new T.BufferGeometry(); sg.setAttribute("position", new T.Float32BufferAttribute(stars, 3));
  scene.add(new T.Points(sg, new T.PointsMaterial({ color: 0xd8d6cf, size: 0.05 })));
  const markers = GLOBE_SITES.map((s) => {
    const m = new T.Mesh(new T.SphereGeometry(0.022, 16, 12), new T.MeshBasicMaterial({ color: 0xf3c14b }));
    m.position.copy(toSphere(s.lat, s.lon, 1.005)); group.add(m);
    const label = document.createElement("span"); label.textContent = s.name; $("globeLabels").appendChild(label);
    return { m, label };
  });
  Object.assign(globe, { ok: true, renderer, scene, camera, group, markers, el, rx: 0.15, ry: -0.6, tz: 4.4, goalX: 0.15, goalY: -0.6 });
  group.rotation.set(globe.rx, globe.ry, 0);
  new ResizeObserver(() => {
    const w = el.clientWidth; if (!w) return;
    renderer.setSize(w, w, false); camera.aspect = 1; camera.updateProjectionMatrix();
  }).observe(el);
}

// Turn the globe to site i (-1: back to slow spinning).
export function focusGlobe(i) {
  globe.focus = i;
  GLOBE_SITES.forEach((_, k) => $("gchip-" + k).setAttribute("aria-pressed", k === i ? "true" : "false"));
  if (!globe.ok) return;
  if (i < 0) { globe.goalX = 0.15; globe.tz = 4.4; return; }
  const p = toSphere(GLOBE_SITES[i].lat, GLOBE_SITES[i].lon, 1), a = -Math.atan2(p.x, p.z);
  globe.goalY = a; globe.goalX = Math.atan2(p.y, -p.x * Math.sin(a) + p.z * Math.cos(a)); globe.tz = 3.35;
  while (globe.goalY - globe.ry > Math.PI) globe.goalY -= 2 * Math.PI;      // shortest way round
  while (globe.goalY - globe.ry < -Math.PI) globe.goalY += 2 * Math.PI;
}

function globeFrame() {
  if (!globe.ok || !isShown("intro")) { globe.running = false; return; }
  if (globe.focus < 0) globe.goalY += 0.0025;
  globe.ry += (globe.goalY - globe.ry) * 0.05; globe.rx += (globe.goalX - globe.rx) * 0.05;
  globe.camera.position.z += (globe.tz - globe.camera.position.z) * 0.05;
  globe.group.rotation.set(globe.rx, globe.ry, 0);
  globe.renderer.render(globe.scene, globe.camera);
  const w = globe.el.clientWidth, v = new THREE.Vector3();
  for (const { m, label } of globe.markers) {
    m.getWorldPosition(v);
    const facing = v.clone().normalize().dot(globe.camera.position.clone().normalize()) > 0.15;
    v.project(globe.camera);
    label.style.left = `${(v.x + 1) / 2 * w}px`; label.style.top = `${(1 - v.y) / 2 * w}px`;
    label.style.opacity = facing && Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.95 ? 1 : 0;
    label.style.transform = v.x > 0.25 ? "translate(calc(-100% - 10px), -50%)" : "translate(10px, -50%)";
  }
  requestAnimationFrame(globeFrame);
}

export function startGlobe() {
  if (globe.ok && !globe.running) { globe.running = true; requestAnimationFrame(globeFrame); }
}

export function initIntro(webgl) {
  renderAnswer();
  $("siteChips").innerHTML = GLOBE_SITES.map((s, i) => `<button type="button" id="gchip-${i}" aria-pressed="false">${s.name}</button>`).join("");
  GLOBE_SITES.forEach((_, i) => { $("gchip-" + i).onclick = () => focusGlobe(i); });
  const el = $("globe");
  if (!webgl) { el.hidden = true; return; }
  try { buildGlobe(el); } catch (e) { el.hidden = true; globe.ok = false; }
}