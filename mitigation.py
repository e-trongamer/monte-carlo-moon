#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Compare landing pads, ring berms and terrain shielding.

Cases are anchored to the Apollo 12 landing and use simplified geometry:

  pad      no erosion inside pad_radius_m; edge erosion is omitted
  berm     blocks trajectories below its crest; berm erosion is omitted
  terrain  target sits 3 m below the landing plane

With --with-angles, a third panel compares Apollo-like angles with
hypothetical 12 and 15 degree ejection angles that might occur with deep
cratering or interacting plumes. That needs its own simulations (several
hours at full resolution), so it is off by default.

Only variants in plausible_branches.json are used (see psi_study.py).

    python mitigation.py --quick
    python mitigation.py --with-angles
"""
from __future__ import annotations

import argparse, json, os, time
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

import psi_simulation as P
import psi_study as S

HERE = os.path.dirname(os.path.abspath(__file__))
THRUSTS = [11600.0, 44000.0]
THRESHOLD = 0.1                      # fraction of Surveyor III
BERM_R = 50.0
CASES = [  # (label, config overrides, hardware height or None for nominal)
    ("no mitigation", {}, None),
    ("pad, 10 m radius", {"pad_radius_m": 10.0}, None),
    ("pad, 30 m radius", {"pad_radius_m": 30.0}, None),
    ("berm 1 m at 50 m", {"berm_radius_m": BERM_R, "berm_height_m": 1.0}, None),
    ("berm 3 m at 50 m", {"berm_radius_m": BERM_R, "berm_height_m": 3.0}, None),
    ("berm 5 m at 50 m", {"berm_radius_m": BERM_R, "berm_height_m": 5.0}, None),
    ("pad 30 m + berm 3 m", {"pad_radius_m": 30.0, "berm_radius_m": BERM_R,
                             "berm_height_m": 3.0}, None),
    ("hardware 3 m below plain", {}, -3.0),
]
ANGLES = [1.4, 3.3, 8.1, 12.0, 15.0]


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--with-angles", action="store_true",
                    help="also run the berm-vs-ejection-angle panel (extra simulations)")
    a = ap.parse_args()
    t0 = time.time()

    table, curves = {}, {}
    for T in THRUSTS:
        for label, ovr, z in CASES:
            runs = S.run_set(dict(ovr, thrust_N=T), quick=a.quick)
            R, exp_, excl = S.anchored_exposure(runs, z_target=z)
            cfg = next(iter(runs.values()))[0]
            thr = THRESHOLD * cfg["pit_reference_per_cm2"]
            band = S.distance_band(R, exp_, thr)
            table[(T, label)] = band
            st = np.array(list(exp_.values()))
            with np.errstate(invalid="ignore"):
                curves[(T, label)] = np.nanmedian(np.where(st > 0, st, np.nan), axis=0)
            print(f"[mitigation] {T/1000:5.1f} kN  {label:<26} "
                  f"{S.fmt_distance(band['median'], R[-1]):>9} "
                  f"[{S.fmt_distance(band['min'], R[-1])} - {S.fmt_distance(band['max'], R[-1])}]"
                  f"  ({time.time()-t0:.0f} s)")

    # Berm effectiveness vs ejection angle (unanchored: berm / no berm, same branch)
    berm_vs_angle = {}
    for T in (THRUSTS if a.with_angles else []):
        base = dict(S.QUICK) if a.quick else {}
        common = dict(base, thrust_N=T, angle_hypotheses_deg=ANGLES)
        for vm in S.VELOCITY_MODELS:
            cfg0, _, r_none = P.simulate(dict(common, velocity_model=vm))
            _, _, r_berm = P.simulate(dict(common, velocity_model=vm,
                                           berm_radius_m=BERM_R, berm_height_m=3.0))
            Rg = cfg0["target_distances_m"]; zl = cfg0["target_heights_sensitivity_m"]
            iz = S.nearest(zl, cfg0["target_height_m"])
            for tag in r_none["branches"]:
                ang = float(tag.split("|")[1])
                n = np.array(r_none["branches"][tag]["density_total_per_cm2"])[iz]
                b = np.array(r_berm["branches"][tag]["density_total_per_cm2"])[iz]
                for d in (200.0, 1000.0):
                    k = S.nearest(Rg, d)
                    if n[k] > 0:
                        berm_vs_angle.setdefault((T, d, ang), []).append(b[k] / n[k])

    out = {
        "threshold_x_surveyor": THRESHOLD, "quick": a.quick, "berm_radius_m": BERM_R,
        "practical_distance": {f"{T/1000:g} kN | {lab}": table[(T, lab)]
                               for T in THRUSTS for lab, _, _ in CASES},
        "berm3m_transmission_vs_angle": None if not a.with_angles else {
            f"{T/1000:g} kN | {d:g} m | {ang:g} deg": float(np.median(v))
            for (T, d, ang), v in berm_vs_angle.items()},
    }
    with open(os.path.join(HERE, "mitigation_results.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)

    # ------------------------------------------------------------------ figure
    fig, ax = plt.subplots(1, 3 if a.with_angles else 2,
                           figsize=(19 if a.with_angles else 13, 6.2))
    grid_max = float(R[-1])
    cap = lambda x: min(x, grid_max)

    a0 = ax[0]
    labels = [lab for lab, _, _ in CASES]
    y = np.arange(len(labels))
    for k, (T, c) in enumerate(zip(THRUSTS, ("tab:blue", "tab:red"))):
        off = (k - 0.5) * 0.3
        md = [cap(table[(T, lab)]["median"]) for lab in labels]
        lo = [cap(table[(T, lab)]["min"]) for lab in labels]
        hi = [cap(table[(T, lab)]["max"]) for lab in labels]
        a0.hlines(y + off, lo, hi, color=c, lw=5, alpha=0.3)
        a0.plot(md, y + off, "o", color=c, label=f"{T/1000:g} kN (median, bar = branch range)")
    a0.set_yticks(y); a0.set_yticklabels(labels, fontsize=8.5); a0.invert_yaxis()
    a0.axvline(grid_max, color="k", ls="--", lw=0.8)
    a0.set_xscale("log")
    a0.set_xlabel(f"Practical distance (m): exposure below {THRESHOLD:g}x Surveyor III")
    a0.set_title("Mitigation options compared\nanchored to the unmitigated Apollo 12 landing")
    a0.legend(fontsize=8, loc="upper center", bbox_to_anchor=(0.5, -0.12), ncol=2)
    a0.grid(alpha=0.3, which="both", axis="x")

    a1 = ax[1]
    T = THRUSTS[-1]
    for lab, c in zip(("no mitigation", "pad, 30 m radius", "berm 3 m at 50 m",
                       "pad 30 m + berm 3 m", "hardware 3 m below plain"),
                      ("k", "tab:green", "tab:orange", "tab:purple", "tab:brown")):
        a1.plot(R, curves[(T, lab)], "-", color=c, lw=2, label=lab)
    a1.axhline(THRESHOLD * cfg["pit_reference_per_cm2"], color="grey", ls=":", lw=1)
    a1.axvline(BERM_R, color="tab:orange", ls="--", lw=0.8)
    a1.text(BERM_R * 1.05, 0.97, "berm", color="tab:orange", fontsize=8,
            transform=a1.get_xaxis_transform(), va="top")
    a1.set_xscale("log"); a1.set_yscale("log")
    a1.set_xlabel("Distance from landing site (m)")
    a1.set_ylabel("Impacts per cm², 1.5 m height (median across branches)")
    a1.set_title(f"Exposure vs distance at {T/1000:g} kN\n"
                 "a berm only stops ejecta eroded INSIDE it")
    a1.legend(fontsize=8); a1.grid(alpha=0.3, which="both")

    if a.with_angles:
        a2 = ax[2]
        for T, ls, mk in zip(THRUSTS, ("-", "--"), ("o", "s")):
            for d, c in ((200.0, "tab:orange"), (1000.0, "tab:blue")):
                stopped = [1.0 - np.median(berm_vs_angle[(T, d, g)])
                           if (T, d, g) in berm_vs_angle else np.nan for g in ANGLES]
                a2.plot(ANGLES, stopped, mk + ls, color=c, ms=7,
                        label=f"{T/1000:g} kN, hardware at {d:g} m")
        a2.axvspan(10, 16, color="grey", alpha=0.15)
        a2.text(10.3, 0.55, "hypothetical\nsteep ejection\n(cratering /\nmulti-engine)", fontsize=8)
        a2.axvspan(1.4, 3.3, color="tab:green", alpha=0.12)
        a2.text(1.5, 0.03, "Apollo\nmeasured", fontsize=8, color="tab:green")
        a2.set_ylim(-0.03, 1.03); a2.set_xlim(0.5, 16)
        a2.set_xlabel("Ejection angle (deg)")
        a2.set_ylabel("Fraction of exposure stopped by a 3 m berm at 50 m")
        a2.set_title("Effect of a 3 m berm\n"
                     "Transmission depends on ejection angle")
        a2.legend(fontsize=7.5, loc="center right"); a2.grid(alpha=0.3)

    fig.suptitle(f"Mitigation, hardware 1.5 m tall ({'quick' if a.quick else 'full'} resolution). "
                 "Pad-edge erosion, berm erosion and bulk cratering are not modelled.",
                 fontsize=11.5, fontweight="bold")
    fig.tight_layout(rect=[0, 0, 1, 0.94])
    outp = os.path.join(HERE, "mitigation.png")
    fig.savefig(outp, dpi=110)
    print(f"\nwrote {outp} and mitigation_results.json in {time.time()-t0:.0f} s")


if __name__ == "__main__":
    main()