#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Estimate landing-site separation distances across a range of thrusts.

Results cover two velocity models, three erosion laws and six ejection angles,
anchored to the Surveyor III measurements (see psi_study.py). Thresholds are
fractions of Surveyor III's exposure; they are working assumptions because no
published hardware damage threshold is available.

    python escalation.py            # full resolution (cached; slow first time)
    python escalation.py --quick    # reduced resolution, a few minutes
"""
from __future__ import annotations

import argparse
import json
import os
import time

import psi_study as S
from config import Config

HERE = os.path.dirname(os.path.abspath(__file__))

# Thrust classes. Hover thrust ~ landed weight on the Moon (mass x 1.62).
SCENARIOS = [
    ("3.6 kN (Nova-C class)", 3600.0),
    ("7.5 kN (Chang'e-5 class)", 7500.0),
    ("11.6 kN (Apollo LM hover)", 11600.0),
    ("25 kN", 25000.0),
    ("44 kN (BE-7 max thrust)", 44000.0),
    ("100 kN", 100000.0),
]
# Above roughly twice the LM thrust, published work expects bulk cratering.
# This model does not cover that regime, so Apollo-based extrapolation is weak.
VALIDATED_MAX_THRUST_N = 2 * S.APOLLO_LM_THRUST_N

# Fractions of Surveyor III's exposure used as thresholds.
THRESHOLD_FRACTIONS = [1.0, 0.1, 0.01]
LANDING_COUNTS = [1, 3, 10, 30, 100]


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--repeat-scenario", type=float, default=44000.0,
                    help="thrust (N) used for the repeated-landing panel")
    a = ap.parse_args()
    t0 = time.time()

    results, exposures = {}, {}
    for name, thrust in SCENARIOS:
        t = time.time()
        runs = S.run_set({"thrust_N": thrust}, quick=a.quick)
        R, exp_, excluded = S.anchored_exposure(runs)
        exposures[name] = exp_
        cfg = runs[S.VELOCITY_MODELS[0]][0]
        meas = cfg["pit_reference_per_cm2"]
        results[name] = {
            "thrust_N": thrust,
            "excluded_branches": excluded,
            "distance_bands": {
                f"{f:g}x Surveyor": S.distance_band(R, exp_, f * meas)
                for f in THRESHOLD_FRACTIONS},
        }
        print(f"[escalation] {name:<28} {len(exp_)} branches "
              f"({len(excluded)} excluded)  [{time.time()-t:.0f} s]")

    # Repeated landings at one thrust class
    rep_runs = S.run_set({"thrust_N": a.repeat_scenario}, quick=a.quick)
    repeat = {}
    for n in LANDING_COUNTS:
        R, exp_n, _ = S.anchored_exposure(rep_runs, n_landings=n)
        repeat[n] = {f"{f:g}x Surveyor": S.distance_band(R, exp_n, f * meas)
                     for f in THRESHOLD_FRACTIONS}

    grid_max = float(R[-1])
    summary = {
        "anchor": {"distance_m": cfg["surveyor_distance_m"],
                   "height_m": cfg["surveyor_height_m"],
                   "measured_per_cm2": meas},
        "hardware_height_m": cfg["target_height_m"],
        "quick": a.quick,
        "validated_max_thrust_N": VALIDATED_MAX_THRUST_N,
        "assumptions": [
            "absolute scale from Surveyor III (one measurement)",
            "linear fluence accumulation over repeated landings",
            "Fig. 5 scaling: knee ~ thrust^0.5, K0 ~ thrust^0.25",
            "acceleration path ~ thrust^0.5",
            "no bulk cratering, no pad, no terrain shielding",
            "thresholds are team choices, not published limits",
        ],
        "scenarios": results,
        "repeated_landings": {"thrust_N": a.repeat_scenario,
                              "by_count": {str(k): v for k, v in repeat.items()}},
    }
    with open(os.path.join(HERE, "escalation_results.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=1)

    # ------------------------------------------------------------- printout
    print(f"\nPractical distance for hardware at {cfg['target_height_m']:g} m height "
          f"(median across branches, [min - max])")
    hdr = "".join(f"{f'{f:g}x Surveyor':>30}" for f in THRESHOLD_FRACTIONS)
    print(f"{'':<28}{hdr}")
    for name, r in results.items():
        cells = ""
        for f in THRESHOLD_FRACTIONS:
            b = r["distance_bands"][f"{f:g}x Surveyor"]
            cells += (f"{S.fmt_distance(b['median'], grid_max):>10} "
                      f"[{S.fmt_distance(b['min'], grid_max)}-{S.fmt_distance(b['max'], grid_max)}]").rjust(30)
        flag = "  *outside modeled regime" if r["thrust_N"] > VALIDATED_MAX_THRUST_N else ""
        print(f"{name:<28}{cells}{flag}")


if __name__ == "__main__":
    main()