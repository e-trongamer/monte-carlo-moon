/* The short guided tour: walks through the chapters by itself, with a caption
   bar at the bottom. Every step is an async function; Stop or Escape ends it. */

import { $ } from "./util.js";
import { currentChapter, showStation } from "./router.js";
import { focusGlobe } from "./intro.js";
import { PARTS, showPart } from "./surveyor.js";
import { playApolloPov, playApolloSide } from "./apollo.js";
import { STEPS, showStep } from "./model-steps.js";
import { resetMiniMc, throwGrains } from "./montecarlo.js";
import { playground, renderPlayground } from "./playground.js";
import { replayApollo } from "./map.js";

const tour = { on: false };

// Wait ms, but return early once the tour is stopped.
const pause = (ms) => new Promise((done) => {
  const t0 = performance.now();
  const tick = () => (!tour.on || performance.now() - t0 >= ms ? done() : setTimeout(tick, 100));
  tick();
});
const goTo = async (ch) => { if (currentChapter() !== ch) { location.hash = "#" + ch; await pause(500); } };
function focus(id, block = "center") {
  const el = $(id), station = el.closest(".station"), chapter = el.closest(".chapter");
  if (station && station.hidden) showStation(chapter.dataset.ch, +station.dataset.station);
  el.scrollIntoView({ behavior: "smooth", block });
}
function caption(text, progress) {
  $("tourText").textContent = text;
  $("tourProg").style.width = `${Math.round(progress * 100)}%`;
}

const TOUR_STEPS = [
  async () => { await goTo("intro"); focusGlobe(-1); caption("This is the Moon. Robots and astronauts have left their machines all over it.", 0); await pause(4500); },
  async () => { focusGlobe(0); caption("In 1967 the robot Surveyor 3 landed here, in the Ocean of Storms.", .05); await pause(5000); },
  async () => { await goTo("surveyor"); caption("Meet Surveyor 3: a robot lander that tested whether the Moon's ground could hold a spacecraft.", .1); await pause(4500); },
  ...PARTS.map((p, i) => async () => { focus("surveyorPhoto"); showPart(i); caption(`${p.title}: ${p.body}`, .12 + i * .02); await pause(4500); }),
  async () => { await goTo("apollo"); caption("Two and a half years later, in November 1969, Apollo 12 landed just 155 metres away.", .24); await pause(5000); },
  async () => { focus("dustScene"); await pause(700); playApolloSide(); caption("In the last metres the engine blasts the ground. Dust shoots out sideways, almost flat, straight at Surveyor.", .3); await pause(11000); },
  async () => { focus("povScene"); await pause(700); playApolloPov(); caption("This is what Surveyor's camera would have seen: the lander coming down, then dust pitting the side that faced it.", .36); await pause(12000); },
  async () => { focus("pitCanvas"); caption("Back on Earth, scientists counted about 103 tiny pits in every square centimetre of Surveyor's metal.", .44); await pause(5500); },
  async () => { await goTo("simulation"); caption("To plan future landings, we rebuilt this dust storm in a computer model.", .48); await pause(4000); },
  ...STEPS.map((s, i) => async () => { showStation("simulation", 0); focus("stepScene"); showStep(i); caption(s.text, .52 + i * .04); await pause(5200); }),
  async () => {
    focus("mcCard", "start"); $("mcDist").value = "155"; resetMiniMc(); await pause(600); throwGrains(10000);
    caption("Monte Carlo means: throw thousands of random grains and count the hits. The more grains, the smaller the uncertainty.", .7); await pause(7000);
  },
  async () => {
    focus("upCard", "start");
    caption("Researchers still disagree on how exhaust lifts dust, so the model runs 36 versions and shows the spread. Watch how much the estimate moves.", .78);
    const all = new Set(playground.laws);
    await pause(2500); playground.laws.clear(); playground.laws.add("energy_flux"); renderPlayground();
    await pause(2500); playground.laws.clear(); playground.laws.add("scaling"); renderPlayground();
    await pause(2500); all.forEach((x) => playground.laws.add(x)); renderPlayground(); await pause(2000);
  },
  async () => { await goTo("future"); showStation("future", 0); caption("Now the future: new landers near moon bases and historic sites. Where should they land?", .85); await pause(4500); },
  async () => { focus("mapbox"); await pause(600); replayApollo(); caption("On our sandblast map we can replay 1969. The rings show how far the dust is a problem.", .9); await pause(14500); },
  async () => { focus("learned", "start"); caption("What we learned: dust flies flat and far, landing pads help a lot, and honest uncertainty matters.", .96); await pause(6000); },
  async () => { await goTo("intro"); caption("Monte Carlo Moon. Learn from the past, protect the future.", 1); await pause(5000); },
];

export async function runTour() {
  if (tour.on) return;
  tour.on = true; document.body.classList.add("touring"); $("tourbar").hidden = false;
  for (const step of TOUR_STEPS) { if (!tour.on) break; await step(); }
  endTour();
}

export function endTour() {
  tour.on = false; $("tourbar").hidden = true; document.body.classList.remove("touring");
}

export function initTour() {
  $("tourBtn").onclick = () => (tour.on ? endTour() : runTour());
  $("introTour").onclick = runTour;
  $("tourStop").onclick = endTour;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && tour.on) endTour(); });
}