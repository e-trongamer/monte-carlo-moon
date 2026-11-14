#!/usr/bin/env python3
"""Escalation study: how far from a landing pad must hardware sit?

For each thrust class, every model branch (2 velocity laws x 3 erosion laws x
6 measured Apollo ejection angles) is anchored to Surveyor III (see
psi_study.py). The answer is a DISTANCE BAND across branches, not a number.

Thresholds are expressed as fractions of the exposure Surveyor III received
from Apollo 12. Choosing them is a TEAM ASSUMPTION about what the hardware can
tolerate; no published damage threshold exists.

Writes escalation_results.json.

    python escalation.py            # full resolution (cached; slow first time)
    python escalation.py --quick    # reduced resolution, a few minutes
"""
from __future__ import annotations

import argparse
import os
import time

import psi_study as S

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
# Above roughly twice the LM, published work expects bulk cratering
# (bearing-capacity failure, diffused gas eruption) that NO part of this model
# represents; NASA states Apollo experience cannot be extrapolated to HLS.
VALIDATED_MAX_THRUST_N = 2 * S.APOLLO_LM_THRUST_N

# Fractions of Surveyor III's exposure. Team choice.
THRESHOLD_FRACTIONS = [1.0, 0.1, 0.01]
LANDING_COUNTS = [1, 3, 10, 30, 100]


def threshold_key(f) -> str:
    return f"{f:g}x Surveyor"


def bands(R, exposures, measured):
    return {threshold_key(f): S.distance_band(R, exposures, f * measured)
            for f in THRESHOLD_FRACTIONS}


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--repeat-scenario", type=float, default=44000.0,
                    help="thrust (N) used for the repeated-landing panel")
    a = ap.parse_args()
    t0 = time.time()

    base = S.base_config(a.quick)
    meas = base.surveyor.pit_density_per_cm2

    results = {}
    for name, thrust in SCENARIOS:
        t = time.time()
        runs = S.run_set(base.with_(**{"engine.thrust_n": thrust}))
        R, exposures, excluded = S.anchored_exposure(runs)
        results[name] = {
            "thrust_N": thrust,
            "beyond_validated_regime": thrust > VALIDATED_MAX_THRUST_N,
            "excluded_branches": excluded,
            "distance_bands": bands(R, exposures, meas),
            "exposure": S.exposure_envelope(R, exposures),
        }
        print(f"[escalation] {name:<28} {len(exposures)} branches "
              f"({len(excluded)} excluded)  [{time.time() - t:.0f} s]")

    # Repeated landings at one thrust class
    rep_runs = S.run_set(base.with_(**{"engine.thrust_n": a.repeat_scenario}))
    repeat = {}
    for n in LANDING_COUNTS:
        R, exposures, _ = S.anchored_exposure(rep_runs, n_landings=n)
        repeat[str(n)] = bands(R, exposures, meas)

    grid_max = float(R[-1])
    S.write_json(os.path.join(HERE, "escalation_results.json"), {
        "anchor": {"distance_m": base.surveyor.distance_m,
                   "height_m": base.surveyor.height_m,
                   "measured_per_cm2": meas},
        "hardware_height_m": base.targets.hardware_height_m,
        "grid_max_m": grid_max,
        "quick": a.quick,
        "validated_max_thrust_N": VALIDATED_MAX_THRUST_N,
        "null_means": "distance: beyond the grid edge; exposure: no branch hits there",
        "assumptions": [
            "absolute scale from Surveyor III (one measurement)",
            "linear fluence accumulation over repeated landings",
            "Fig. 5 scaling: knee ~ thrust^0.5, K0 ~ thrust^0.25",
            "acceleration path ~ thrust^0.5",
            "no bulk cratering, no pad, no terrain shielding",
            "thresholds are team choices, not published limits",
        ],
        "scenarios": results,
        "repeated_landings": {"thrust_N": a.repeat_scenario, "by_count": repeat},
    })

    print(f"\nPractical distance for hardware at {base.targets.hardware_height_m:g} m height "
          f"(median across branches, [min - max])")
    print(f"{'':<28}" + "".join(f"{threshold_key(f):>30}" for f in THRESHOLD_FRACTIONS))
    for name, r in results.items():
        cells = ""
        for f in THRESHOLD_FRACTIONS:
            b = r["distance_bands"][threshold_key(f)]
            cells += (f"{S.fmt_distance(b['median'], grid_max):>10} "
                      f"[{S.fmt_distance(b['min'], grid_max)}-"
                      f"{S.fmt_distance(b['max'], grid_max)}]").rjust(30)
        flag = "  *beyond validated regime" if r["beyond_validated_regime"] else ""
        print(f"{name:<28}{cells}{flag}")
    print(f"\nwrote escalation_results.json in {time.time() - t0:.0f} s")


if __name__ == "__main__":
    main()