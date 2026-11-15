/* Chapter 1: tap the five parts of Surveyor 3 on photo AS12-48-7100. */

import { $ } from "./util.js";

// Positions are percentages of the photo (1200 x 865 px).
export const PARTS = [
  { x: 47.9, y: 28.5, title: "Solar panel and antenna",
    body: "On top of the mast sit a solar panel, which turned sunlight into electricity, and a flat antenna that beamed pictures and measurements to Earth.",
    fact: "No sunlight, no power. That is why the two-week lunar night was so dangerous for Surveyor." },
  { x: 56.1, y: 49.0, title: "TV camera",
    body: "The camera looked into a tilting mirror to photograph the landscape all around. Surveyor 3 sent 6,326 pictures to Earth.",
    fact: "In 1969 Pete Conrad cut this camera off and brought it home. Scientists then studied the pits on it." },
  { x: 80.2, y: 63.4, title: "Scoop arm",
    body: "A folding arm with a small scoop at the end. It reached 1.5 m from the lander and dug up to 18 cm deep to test how firm the ground is.",
    fact: "Surveyor 3 was the first Surveyor that could dig on the Moon." },
  { x: 62.1, y: 79.5, title: "Landing legs",
    body: "Three legs with crushable footpads softened the landing. Surveyor 3's engine didn't switch off in time, so it bounced twice, first 10 m and then 3 m high.",
    fact: "The marks from those bounces showed engineers how the soil squashes." },
  { x: 40.7, y: 60.7, title: "Electronics boxes",
    body: "These boxes held the electronics. Their mirror-like tops reflected sunlight so the electronics wouldn't overheat during the long lunar day.",
    fact: "In sunlight the Moon's surface gets hotter than boiling water. At night it is colder than -150 °C." },
];

const seenParts = new Set();

function renderParts(active) {
  PARTS.forEach((_, i) => {
    const b = $("part-" + i);
    b.classList.toggle("seen", seenParts.has(i));
    b.setAttribute("aria-pressed", i === active ? "true" : "false");
  });
  $("partDots").innerHTML = PARTS.map((_, i) => `<i class="${seenParts.has(i) ? "on" : ""}"></i>`).join("");
  $("partCount").textContent = `${seenParts.size} of ${PARTS.length} checked`;
}

export function showPart(i) {
  const p = PARTS[i];
  seenParts.add(i);
  $("partTitle").textContent = p.title;
  $("partText").textContent = p.body;
  const fact = $("partFact");
  fact.textContent = p.fact; fact.hidden = false;
  renderParts(i);
}

export function initSurveyor() {
  const photo = $("surveyorPhoto");
  PARTS.forEach((p, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "hotspot"; b.id = "part-" + i;
    b.style.left = p.x + "%"; b.style.top = p.y + "%";
    b.setAttribute("aria-label", p.title);
    b.onclick = () => showPart(i);
    photo.appendChild(b);
  });
  renderParts(-1);
}