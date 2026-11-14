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
"""
from __future__ import annotations

import json
import os
import time
import numpy as np

import psi_simulation as P
import psi_study as S
from config import Config 

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
    grid_max = float(R[-1])
    cap = lambda x: min(x, grid_max)

    labels = [lab for lab, _, _ in CASES]
    y = np.arange(len(labels))
    for k, (T, c) in enumerate(zip(THRUSTS, ("tab:blue", "tab:red"))):
        off = (k - 0.5) * 0.3
        md = [cap(table[(T, lab)]["median"]) for lab in labels]
        lo = [cap(table[(T, lab)]["min"]) for lab in labels]
        hi = [cap(table[(T, lab)]["max"]) for lab in labels]


    T = THRUSTS[-1]
    for lab, c in zip(("no mitigation", "pad, 30 m radius", "berm 3 m at 50 m",
                       "pad 30 m + berm 3 m", "hardware 3 m below plain"),
                      ("k", "tab:green", "tab:orange", "tab:purple", "tab:brown")):


    if a.with_angles:
        for T, ls, mk in zip(THRUSTS, ("-", "--"), ("o", "s")):
            for d, c in ((200.0, "tab:orange"), (1000.0, "tab:blue")):
                stopped = [1.0 - np.median(berm_vs_angle[(T, d, g)])
                           if (T, d, g) in berm_vs_angle else np.nan for g in ANGLES]


if __name__ == "__main__":
    main()