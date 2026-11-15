/* Chapter 4, station 2: the landing advisor and the pads-and-berms table. */

import { APOLLO_THRUST_N, DATA, DISTANCES, LANDERS, OUTSIDE_RANGE_WHY, SITES, VALIDATED_MAX_N, landerIndex, landerLabel, outsideRange, thrustKey } from "./data.js";
import { $, fmtD } from "./util.js";
import { bermRadiusOf, fmtDist, fmtPractical, ringsFor } from "./exposure.js";
import { showLandingOnMap } from "./map.js";
import { showStation } from "./router.js";

const MITIGATION = DATA.mitigation;
const ADVISOR_ROWS = ["no mitigation", "pad, 10 m radius", "pad, 30 m radius", "berm 3 m at 50 m", "pad 30 m + berm 3 m"];
const PROTECTED = SITES.flatMap((s, si) => s.objects.map((o) => ({ ...o, si, label: `${o.name} · ${s.name}` })));
const capitalize = (s) => s[0].toUpperCase() + s.slice(1);
const mitigationValue = (label, band) => fmtPractical(band && band.median, { bermRadius: bermRadiusOf(label) });
// Smallest to largest version; a berm row's lower end is "behind the berm", not a distance.
const rangeText = (label, band) => {
  const lo = fmtPractical(band.min, { bermRadius: bermRadiusOf(label) }), hi = fmtPractical(band.max);
  return lo.startsWith("behind") ? `from behind the berm to ${hi}` : `${lo} – ${hi}`;
};

// Position on the 25 m .. 10 km log axis of the range bar, in percent.
function logPos(d) {
  const a = Math.log10(DISTANCES[0]), b = Math.log10(DISTANCES[DISTANCES.length - 1]);
  const x = Math.min(Math.max(d, DISTANCES[0]), DISTANCES[DISTANCES.length - 1]);
  return (Math.log10(x) - a) / (b - a) * 100;
}

// Warning for landers above the validated thrust. If the model even puts this
// lander closer than the Apollo LM, say so: that trend is not trustworthy.
function outsideNote(lander, o, level, ring) {
  const apollo = ringsFor(LANDERS[landerIndex(APOLLO_THRUST_N)], o.heightKey || "1.5").find((r) => r.f === level);
  const closer = isFinite(ring.med) && isFinite(apollo.med) && ring.med < apollo.med
    ? ` Here it even comes out closer than for the Apollo LM (${fmtDist(ring.med)} vs ${fmtDist(apollo.med)}), which we do not trust.` : "";
  return `<p class="warn-note"><b>Outside the modelled range.</b> ${OUTSIDE_RANGE_WHY} The trend with lander size rests on our scaling assumptions.${closer}</p>`;
}

function renderAdvisor() {
  const o = PROTECTED[+$("advObj").value], lander = LANDERS[+$("advLander").value];
  const level = +$("advLevel").value, accuracy = +$("advAcc").value;
  $("advAccVal").textContent = `± ${accuracy} m`;
  const ring = ringsFor(lander, o.heightKey || "1.5").find((r) => r.f === level);
  const rec = isFinite(ring.med) ? ring.med + accuracy : Infinity;

  let pads;
  const key = thrustKey(lander);
  if (MITIGATION && level === MITIGATION.threshold_x_surveyor && MITIGATION.practical_distance[`${key} | no mitigation`]) {
    const rows = ADVISOR_ROWS.map((lab) => [lab, MITIGATION.practical_distance[`${key} | ${lab}`]]).filter(([, v]) => v);
    pads = `<span class="label">With a landing pad or berm</span><div class="pads">`
      + rows.map(([lab, v]) => `<div class="row"><span>${capitalize(lab)}</span><span>${mitigationValue(lab, v)}</span></div>`).join("")
      + `</div><p class="note">Pad-edge and berm erosion are not modelled, so these are best cases.</p>`;
  } else {
    const thrusts = MITIGATION ? [...new Set(Object.keys(MITIGATION.practical_distance).map((k) => k.split(" | ")[0]))].join(" and ") : "";
    pads = `<p class="note">Pads and berms were computed for ${thrusts || "two landers"} at the “10× less” level.</p>`;
  }
  const mark = (x, cls) => (isFinite(x) ? `<span class="mk ${cls}" style="left:calc(${logPos(x)}% - 1px)"></span>` : "");
  const spanEnd = isFinite(ring.hi) ? logPos(ring.hi) : 100;
  $("advOut").innerHTML = `
    <span class="label">Flight control recommends at least</span>
    <div class="big">${fmtDist(rec)} <small>from ${o.name}</small></div>
    <p class="note">${fmtDist(ring.med)} is where the median model version drops below ${level}× Surveyor 3's exposure, plus ± ${accuracy} m for landing accuracy.
      The versions range from ${fmtDist(ring.lo)} to ${fmtDist(ring.hi)}; ${isFinite(ring.hi)
        ? `to stay outside all of them, land beyond ${fmtDist(ring.hi + accuracy)}.`
        : "in the most pessimistic version the exposure never drops below this level within the 10 km we computed."}
      ${o.heightKey ? "Evaluated 3 m below the plain, like Surveyor 3." : "Hardware 1.5 m tall, one landing."}</p>
    ${outsideRange(lander) ? outsideNote(lander, o, level, ring) : ""}
    <div class="rangebar" aria-hidden="true"><span class="track"></span>
      ${isFinite(ring.lo) ? `<span class="span" style="left:${logPos(ring.lo)}%;width:${spanEnd - logPos(ring.lo)}%"></span>` : ""}
      ${mark(ring.lo, "")}${mark(ring.med, "med")}${mark(ring.hi, "")}
      ${[25, 100, 1000, 10000].map((d) => `<span class="tick" style="left:${logPos(d)}%">${fmtD(d)}</span>`).join("")}</div>
    <button class="btn" type="button" id="advShow">Show this landing on the map</button>
    ${pads}`;
  $("advShow").onclick = () => {
    const dist = isFinite(rec) ? rec : 10000;
    showLandingOnMap({ site: o.si, lander: +$("advLander").value, at: [o.pos[0], o.pos[1] - dist] });
    showStation("future", 0);
    requestAnimationFrame(() => $("mapbox").scrollIntoView({ behavior: "smooth", block: "center" }));
  };
}

function renderMitigationTable() {
  const tbl = $("mit"), note = $("mitNote");
  if (!MITIGATION) { note.textContent = "Mitigation results not computed yet."; tbl.innerHTML = ""; return; }
  const rows = {};
  for (const [k, v] of Object.entries(MITIGATION.practical_distance)) {
    const [thrust, label] = k.split(" | ");
    (rows[label] ||= {})[thrust] = v;
  }
  const thrusts = [...new Set(Object.keys(MITIGATION.practical_distance).map((k) => k.split(" | ")[0]))];
  const outside = (t) => parseFloat(t) * 1000 > VALIDATED_MAX_N;
  const head = thrusts.map((t) => `<th class="n">${t}${outside(t) ? '<small class="out">outside modelled range</small>' : ""}</th>`).join("");
  const cell = (label, b) => !b ? "<td class='n'>—</td>"
    : `<td class="n">${mitigationValue(label, b)}<small>${rangeText(label, b)}</small></td>`;
  tbl.innerHTML = `<thead><tr><th>Option</th>${head}</tr></thead><tbody>`
    + Object.entries(rows).map(([label, v]) => `<tr><td>${capitalize(label)}</td>${thrusts.map((t) => cell(label, v[t])).join("")}</tr>`).join("")
    + "</tbody>";
  note.innerHTML = `Estimated distance at which hardware 1.5 m tall gets less than ${MITIGATION.threshold_x_surveyor}× Surveyor 3's exposure, per landing`
    + (MITIGATION.filtered ? ", using only the model versions that pass the pit test" : "")
    + `. Small print under each value: smallest to largest version. “≤ 25 m” means below that level everywhere we computed; “behind the berm” means anything sheltered by the berm qualifies.`
    + ` Pad-edge erosion, berm erosion and bulk cratering are not modelled, so pads and berms look better here than they will in reality.`;
}

export function initAdvisor() {
  const obj = $("advObj"), lander = $("advLander");
  PROTECTED.forEach((o, i) => obj.add(new Option(o.label, i)));
  LANDERS.forEach((l, i) => lander.add(new Option(landerLabel(l) + (outsideRange(l) ? " · outside modelled range" : ""), i)));
  lander.value = landerIndex(APOLLO_THRUST_N);
  obj.value = PROTECTED.findIndex((o) => o.si === 1);
  for (const id of ["advObj", "advLander", "advLevel", "advAcc"]) $(id).addEventListener("input", renderAdvisor);
  renderAdvisor();
  renderMitigationTable();
}