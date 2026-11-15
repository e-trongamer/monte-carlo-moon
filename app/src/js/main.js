/* Entry point: build every part of the page once, then tell the router what to
   run when a chapter or station comes on screen. This is the only place where
   modules are wired together. */

import { $ } from "./util.js";
import { onChapter, onStation, startRouter } from "./router.js";
import { hasWebGL } from "./scene3d.js";
import { initIntro, startGlobe } from "./intro.js";
import { initSurveyor } from "./surveyor.js";
import { initApollo } from "./apollo.js";
import { initModelSteps, startStepLoop } from "./model-steps.js";
import { drawMiniMc, initMiniMc } from "./montecarlo.js";
import { initPlayground, renderPlayground } from "./playground.js";
import { initMap, refreshMap } from "./map.js";
import { initAdvisor } from "./advisor.js";
import { initWrapup } from "./wrapup.js";
import { initTour } from "./tour.js";

// Nerd mode: one switch opens every formula and detail box. Remembered per browser.
function initNerdMode() {
  const btn = $("nerdBtn");
  const set = (on) => {
    document.body.classList.toggle("nerd", on);
    document.querySelectorAll("details.nerd").forEach((d) => { d.open = on; });
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    try { localStorage.setItem("mcm-nerd", on ? "1" : "0"); } catch (e) { /* storage blocked */ }
  };
  btn.onclick = () => set(!document.body.classList.contains("nerd"));
  try { if (localStorage.getItem("mcm-nerd") === "1") set(true); } catch (e) { /* storage blocked */ }
}

const webgl = hasWebGL();
initIntro(webgl);
initSurveyor();
initApollo();
initModelSteps();
initMiniMc();
initPlayground();
initMap();
initAdvisor();
initWrapup();
initTour();
initNerdMode();

onChapter("intro", startGlobe);
onStation("simulation", 0, startStepLoop);
onStation("simulation", 1, drawMiniMc);
onStation("simulation", 2, renderPlayground);
onStation("future", 0, refreshMap);

startRouter();