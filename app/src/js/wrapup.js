/* Chapter 4, station 3 (heritage on the Moon, what we learned, model limits)
   and the reading-time line under every chapter title. Numbers come from the
   model data, so they follow the latest export. */

import { APOLLO_THRUST_N, DATA, FILTER, LANDERS, OUTSIDE_RANGE_WHY, landerIndex, landerShortName, outsideRange } from "./data.js";
import { $ } from "./util.js";
import { fmtDist, fmtPractical, ringsFor } from "./exposure.js";
import { selectSite, refreshMap } from "./map.js";
import { showStation } from "./router.js";

// Facts from NASA mission pages and the NSSDCA catalogue.
const HERITAGE = [
  { name: "Surveyor 3", meta: "Ocean of Storms · landed 20 Apr 1967 · last signal 4 May 1967",
    text: "The robot that proved the ground could hold an Apollo lander. Sandblasted by Apollo 12 in 1969.",
    url: "https://science.nasa.gov/mission/surveyor-3/", site: 0 },
  { name: "Apollo 12 ALSEP", meta: "Ocean of Storms · set up 19 Nov 1969 · switched off 30 Sep 1977",
    text: "Science station with a seismometer, magnetometer and a dust detector, powered by a 70-watt nuclear battery (RTG).",
    url: "https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1969-099C", site: 0 },
  { name: "Apollo descent stages", meta: "Apollo 11 to 17 · left on the Moon",
    text: "The lower half of every Apollo lander stayed behind as the launch pad for the crew's trip home. Apollo 11's Eagle is the most famous.",
    url: "https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1969-059C", site: 1 },
  { name: "Lunar Roving Vehicles", meta: "Apollo 15, 16 and 17 · parked for good",
    text: "Three electric moon buggies that astronauts drove across the Moon, still parked where the crews left them.",
    url: "https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1971-063C" },
];

function renderHeritage() {
  $("herGrid").innerHTML = HERITAGE.map((it, i) => `<article class="her">
      <span class="meta">${it.meta}</span><h3>${it.name}</h3><p>${it.text}</p>
      <div class="links"><a href="${it.url}" target="_blank" rel="noopener">NASA page ↗</a>${it.site != null ? `<button type="button" data-hsite="${i}">Show on the sandblast map</button>` : ""}</div>
    </article>`).join("");
  $("herGrid").querySelectorAll("[data-hsite]").forEach((b) => {
    b.onclick = () => {
      selectSite(HERITAGE[+b.dataset.hsite].site);
      showStation("future", 0);
      requestAnimationFrame(() => { refreshMap(); $("mapbox").scrollIntoView({ behavior: "smooth", block: "center" }); });
    };
  });
}

// "3.6 kN: 2.1 km, 7.5 kN: 2.6 km and 11.6 kN: 3.0 km" for the landers inside the modelled range.
function sizeCard() {
  const inside = LANDERS.filter((l) => !outsideRange(l)).sort((a, b) => a.thrust_N - b.thrust_N);
  const d = inside.map((l) => ringsFor(l, "1.5").find((r) => r.f === 0.1).med);
  const list = inside.map((l, i) => `${(l.thrust_N / 1000).toLocaleString("en")} kN (${landerShortName(l)}) ${fmtDist(d[i])}`)
    .join(", ").replace(/, ([^,]*)$/, " and $1");
  const grows = d.every((x, i) => i === 0 || x >= d[i - 1]);
  return `Within the range our model covers, ${grows ? "bigger landers need more room" : "the distance does not simply grow with lander size"}: ${list}. `
    + `${OUTSIDE_RANGE_WHY} That means it can't say how far a heavy cargo lander should stay away.`;
}

function renderLearned() {
  const apollo = ringsFor(LANDERS[landerIndex(APOLLO_THRUST_N)], "1.5").find((r) => r.f === 0.1);
  const M = DATA.mitigation, p0 = M && M.practical_distance["11.6 kN | no mitigation"], p30 = M && M.practical_distance["11.6 kN | pad, 30 m radius"];
  const cards = [
    ["Dust flies flat and far", `Grains leave at only a few degrees and keep going. For an Apollo-size lander, hardware closer than about ${fmtDist(apollo.med)} gets more than 10% of the sandblasting Surveyor 3 got.`],
    ["Size matters, but our model stops early", sizeCard()],
    ["Pads and berms help a lot", p0 && p30
      ? `In the model, a 30 m landing pad cuts the estimated distance for an Apollo-size lander from ${fmtPractical(p0.median)} to ${fmtPractical(p30.median)}. That's a best case: pad edges and berms also erode in reality.`
      : "A landing pad stops the blast from digging up dust right under the engine. Pad results are still being computed."],
    ["Honest uncertainty", `Different model versions disagree: for an Apollo-size lander the estimated distance ranges from ${fmtDist(apollo.lo)} to ${fmtDist(apollo.hi)}. One measurement on Surveyor 3 can't pin everything down. Like several weather forecasts for the same day, we show the whole range instead of pretending to know the exact answer.`],
  ];
  $("learned").innerHTML = cards.map(([h, p]) => `<div class="card"><h3>${h}</h3><p>${p}</p></div>`).join("");
}

function renderLimits() {
  const limits = [
    `The absolute scale comes from one measurement (Surveyor 3, ${DATA.anchor.measured_per_cm2} pits/cm²).`,
    FILTER ? `The crater-size constant is tuned to the pit size on the Surveyor coupons; model versions whose pit count then misses the measured range, or that rest on fewer than ${FILTER.min_grains || 20} simulated grains there, are left out.` : null,
    OUTSIDE_RANGE_WHY,
    "Repeated landings add up linearly; worn pads and growing craters are not modelled.",
    "Ejected grains fly ballistically; collisions inside the dust sheet are ignored.",
  ].filter(Boolean);
  $("limits").innerHTML = limits.map((t) => `<li>${t}</li>`).join("");
  const tag = $("dataTag");
  tag.textContent = DATA.quick ? "quick-resolution data" : "full-resolution data";
  tag.classList.toggle("warn", !!DATA.quick);
}

// "Chapter 2 of 4 · about 5 min": visible story text at 220 words per minute + 1 min per station.
function renderReadingTimes() {
  const order = ["surveyor", "apollo", "simulation", "future"];
  let total = 0;
  order.forEach((ch, k) => {
    const root = $("ch-" + ch), copy = root.cloneNode(true);
    copy.querySelectorAll("details, select, script, [hidden]:not(.station)").forEach((n) => n.remove());
    const words = copy.textContent.split(/\s+/).filter(Boolean).length;
    const min = Math.max(2, Math.round(words / 220) + root.querySelectorAll("section.station").length);
    total += min;
    root.querySelector(".chap-meta").innerHTML = `<span>Chapter ${k + 1} of ${order.length}</span><span>about ${min} min</span>`;
  });
  $("ctaMeta").textContent = `${order.length} chapters · about ${total} min · or the short tour`;
}

export function initWrapup() {
  renderHeritage(); renderLearned(); renderLimits(); renderReadingTimes();
}