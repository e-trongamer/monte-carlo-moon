/* Chapter 3, station 3: switch model versions on and off and watch the
   estimated distance move. Uses the same rule as the map rings. */

import { APOLLO_ANGLES, APOLLO_THRUST_N, KEPT, LANDERS, MEASURED, landerIndex, landerLabel, outsideRange } from "./data.js";
import { $ } from "./util.js";
import { distanceBand, fmtDist } from "./exposure.js";
import { logChart } from "./logchart.js";

const LAWS = [["scaling", "Shear scaling"], ["roberts", "Roberts"], ["energy_flux", "Energy flux"]];
const SPEED_MODELS = [["integrated", "Drag model"], ["fig5", "Lane & Metzger fit"]];
export const playground = {
  laws: new Set(LAWS.map((x) => x[0])),
  speeds: new Set(SPEED_MODELS.map((x) => x[0])),
  angles: new Set(APOLLO_ANGLES),
};

function chipRow(id, items, set, label) {
  $(id).innerHTML = items.map((it, i) => `<button type="button" data-i="${i}" aria-pressed="${set.has(it[0])}">${label(it)}</button>`).join("");
  $(id).querySelectorAll("button").forEach((b) => {
    b.onclick = () => {
      const v = items[+b.dataset.i][0];
      if (set.has(v)) set.delete(v); else set.add(v);
      renderPlayground();
    };
  });
}

export function renderPlayground() {
  chipRow("upLaw", LAWS, playground.laws, (x) => x[1]);
  chipRow("upVel", SPEED_MODELS, playground.speeds, (x) => x[1]);
  chipRow("upAng", APOLLO_ANGLES.map((a) => [a]), playground.angles, (x) => `${x[0]}°`);

  const lander = LANDERS[+$("upLander").value], onlyKept = $("upMatch").checked;
  const selected = Object.entries(lander.by_height["1.5"].branches || {}).filter(([tag]) => {
    const [speed, law, angle] = tag.split("|");
    return playground.speeds.has(speed) && playground.laws.has(law) && playground.angles.has(parseFloat(angle))
      && (!onlyKept || !KEPT || KEPT.has(tag));
  });
  const thr = 0.1 * MEASURED;
  const band = selected.length ? distanceBand(selected.map(([, y]) => y), thr) : null;
  $("upResult").innerHTML = band
    ? `<div><span class="label">Estimated distance (median)</span><b>${fmtDist(band.med)}</b></div>
       <div><span class="label">Range</span><b style="font-size:17px">${fmtDist(band.lo)} – ${fmtDist(band.hi)}</b></div>
       <div><span class="label">Model versions</span><b>${selected.length}</b></div>`
    : `<div style="grid-column:1/-1"><b style="font-size:16px">No version selected.</b> <span class="muted">Switch at least one option on in every row.</span></div>`;
  $("upWarn").hidden = !outsideRange(lander);

  const chart = logChart(selected.flatMap(([, y]) => y), { floor: MEASURED * 0.01, ceil: MEASURED * 10 });
  let out = chart.axes;
  for (const [tag, y] of selected) {
    const color = KEPT && KEPT.has(tag) ? "var(--data-hi)" : "#6b7280";
    out += `<path d="${chart.path(y)}" fill="none" stroke="${color}" stroke-opacity=".55" stroke-width="1.3"/>`;
  }
  out += chart.level(thr, "var(--r2)", "10× less than Surveyor 3");
  if (band && isFinite(band.med)) {
    const x = chart.X(band.med);
    out += `<line x1="${x}" x2="${x}" y1="${chart.top}" y2="${chart.bottom}" stroke="var(--fg)" stroke-width="2"/>`
      + `<text x="${x + 5}" y="${chart.top + 12}" style="fill:var(--fg)">median ${fmtDist(band.med)}</text>`;
  }
  $("upChart").innerHTML = out;
}

export function initPlayground() {
  const sel = $("upLander");
  LANDERS.forEach((l, i) => sel.add(new Option(landerLabel(l) + (outsideRange(l) ? " · outside modelled range" : ""), i)));
  sel.value = landerIndex(APOLLO_THRUST_N);
  sel.onchange = renderPlayground;
  $("upMatch").onchange = renderPlayground;
}