/* Chapters and stations. One chapter is on screen at a time (selected by the
   URL hash), and inside a chapter one station. Other modules do not wrap these
   functions; they register hooks:

     onChapter("apollo", fn)       fn() runs every time the chapter is shown
     onStation("future", 0, fn)    fn() runs every time that station is shown
     isShown("simulation", 0)      true while that chapter (and station) is on screen

   Animations use isShown() to stop themselves when the reader moves on. */

import { $ } from "./util.js";

export const CHAPTERS = ["intro", "surveyor", "apollo", "simulation", "future", "sources"];
const chapterHooks = {}, stationHooks = {};
const stationOf = {};            // chapter -> index of its current station
let current = "";

export const onChapter = (ch, fn) => { (chapterHooks[ch] ||= []).push(fn); };
export const onStation = (ch, i, fn) => { (stationHooks[`${ch}:${i}`] ||= []).push(fn); };
export const currentChapter = () => current;
export const isShown = (ch, station = null) =>
  current === ch && !document.hidden && (station == null || stationOf[ch] === station);

export function showChapter(ch) {
  if (!CHAPTERS.includes(ch)) ch = "intro";
  for (const c of CHAPTERS) $("ch-" + c).hidden = c !== ch;
  document.querySelectorAll(".chapnav a").forEach((a) =>
    a.setAttribute("aria-current", a.dataset.ch === ch ? "page" : "false"));
  if (current && current !== ch) window.scrollTo(0, 0);
  current = ch;
  (chapterHooks[ch] || []).forEach((fn) => fn());
  if (stationOf[ch] != null) showStation(ch, stationOf[ch]);
}

export function showStation(ch, i, { scroll = false } = {}) {
  const root = $("ch-" + ch);
  stationOf[ch] = i;
  root.querySelectorAll("section.station").forEach((s) => { s.hidden = +s.dataset.station !== i; });
  root.querySelectorAll(".stations button").forEach((b) => {
    const k = +b.dataset.station;
    b.setAttribute("aria-current", k === i ? "step" : "false");
    if (k === i) b.classList.add("seen");
  });
  if (current === ch) (stationHooks[`${ch}:${i}`] || []).forEach((fn) => fn());
  if (scroll) root.querySelector(".stations").scrollIntoView({ behavior: "smooth", block: "start" });
}

// Wire the navigation markup: chapter links, station tabs and "next" buttons.
export function startRouter() {
  for (const ch of CHAPTERS) if ($("ch-" + ch).querySelector(".stations")) stationOf[ch] = 0;
  document.querySelectorAll(".stations button").forEach((b) => {
    b.onclick = () => showStation(b.closest(".chapter").dataset.ch, +b.dataset.station);
  });
  document.querySelectorAll("[data-station-go]").forEach((b) => {
    b.onclick = () => showStation(b.closest(".chapter").dataset.ch, +b.dataset.stationGo, { scroll: true });
  });
  document.querySelectorAll("[data-go]").forEach((b) => { b.onclick = () => { location.hash = "#" + b.dataset.go; }; });
  $("brand").onclick = () => { location.hash = "#intro"; };
  window.addEventListener("hashchange", () => showChapter(location.hash.slice(1)));
  document.addEventListener("visibilitychange", () => { if (!document.hidden && current) showChapter(current); });
  showChapter(location.hash.slice(1) || "intro");
}