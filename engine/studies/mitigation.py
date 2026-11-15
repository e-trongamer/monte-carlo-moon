"""Mitigation comparison: landing pad, ring berm, and terrain shielding.

Every case is anchored to the UNMITIGATED Apollo 12 landing (what Surveyor III
actually experienced), so the numbers are directly comparable with
escalation.py. Mitigation is pure geometry:

  pad      no erosion inside mitigation.pad_radius_m (pad-edge erosion NOT modelled)
  berm     ring of height H at radius R around the landing site; trajectories
           passing below the crest are stopped (berm erosion NOT modelled)
  terrain  hardware sitting 3 m below the landing plane, the way Surveyor III
           sat inside its crater

The angle sweep tests the claim that 3-5 m berms "intercept the 1-3 degree
sheet" against steeper ejection angles. 12 and 15 degrees are HYPOTHETICAL
(steepened ejection from deep cratering or multi-engine plume interaction);
no source we could verify measures them.

Writes mitigation_results.json.

    python mitigation.py --quick
"""
from __future__ import annotations

import argparse
import os
import time

import numpy as np

import psi_simulation as P
import psi_study as S

THRUSTS = [11600.0, 44000.0]
THRESHOLD = 0.1                      # fraction of Surveyor III
BERM_R = 50.0
CASES = [  # (label, config changes, hardware height or None for nominal)
    ("no mitigation", {}, None),
    ("pad, 10 m radius", {"mitigation.pad_radius_m": 10.0}, None),
    ("pad, 30 m radius", {"mitigation.pad_radius_m": 30.0}, None),
    ("berm 1 m at 50 m", {"mitigation.berm_radius_m": BERM_R, "mitigation.berm_height_m": 1.0}, None),
    ("berm 3 m at 50 m", {"mitigation.berm_radius_m": BERM_R, "mitigation.berm_height_m": 3.0}, None),
    ("berm 5 m at 50 m", {"mitigation.berm_radius_m": BERM_R, "mitigation.berm_height_m": 5.0}, None),
    ("pad 30 m + berm 3 m", {"mitigation.pad_radius_m": 30.0, "mitigation.berm_radius_m": BERM_R,
                             "mitigation.berm_height_m": 3.0}, None),
    ("hardware 3 m below plain", {}, -3.0),
]
ANGLES = [1.4, 3.3, 8.1, 12.0, 15.0]
BERM_TEST = {"mitigation.berm_radius_m": BERM_R, "mitigation.berm_height_m": 3.0}
TEST_DISTANCES = (200.0, 1000.0)


def berm_transmission(base, thrust):
    """Exposure with a 3 m berm / without, per branch, at TEST_DISTANCES.
    Not anchored: the same branch with and without the berm."""
    out = {}
    common = base.with_(**{"engine.thrust_n": thrust, "ejection.angles_deg": ANGLES})
    for vm in S.VELOCITY_MODELS:
        plain_cfg = common.with_(**{"velocity.model": vm})
        plain = P.simulate(plain_cfg)
        berm = P.simulate(plain_cfg.with_(**BERM_TEST))
        tg = plain_cfg.targets
        iz = S.nearest(tg.heights_m, tg.hardware_height_m)
        for tag, b in plain["branches"].items():
            angle = float(tag.split("|")[1])
            n = np.asarray(b["density_total_per_cm2"])[iz]
            m = np.asarray(berm["branches"][tag]["density_total_per_cm2"])[iz]
            for d in TEST_DISTANCES:
                k = S.nearest(tg.distances_m, d)
                if n[k] > 0:
                    out.setdefault((d, angle), []).append(m[k] / n[k])
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--quick", action="store_true")
    a = ap.parse_args()
    t0 = time.time()

    base = S.base_config(a.quick)
    threshold = THRESHOLD * base.surveyor.pit_density_per_cm2
    grid_max = float(base.targets.distances_m[-1])

    practical, exposure = {}, {}
    for thrust in THRUSTS:
        for label, changes, z in CASES:
            runs = S.run_set(base.with_(**changes, **{"engine.thrust_n": thrust}))
            R, exposures, _ = S.anchored_exposure(runs, z_target=z)
            key = f"{thrust / 1000:g} kN | {label}"
            band = practical[key] = S.distance_band(R, exposures, threshold)
            exposure[key] = S.exposure_envelope(R, exposures)
            print(f"[mitigation] {thrust / 1000:5.1f} kN  {label:<26} "
                  f"{S.fmt_distance(band['median'], grid_max):>9} "
                  f"[{S.fmt_distance(band['min'], grid_max)} - "
                  f"{S.fmt_distance(band['max'], grid_max)}]  ({time.time() - t0:.0f} s)")

    transmission = {}
    for thrust in THRUSTS:
        for (d, angle), ratios in berm_transmission(base, thrust).items():
            transmission[f"{thrust / 1000:g} kN | {d:g} m | {angle:g} deg"] = float(np.median(ratios))

    S.write_json("mitigation_results.json", {
        "threshold_x_surveyor": THRESHOLD,
        "quick": a.quick,
        "berm_radius_m": BERM_R,
        "hardware_height_m": base.targets.hardware_height_m,
        "grid_max_m": grid_max,
        "null_means": "distance: beyond the grid edge; exposure: no branch hits there",
        "not_modelled": ["pad-edge erosion", "berm erosion", "bulk cratering"],
        "practical_distance": practical,
        "exposure": exposure,
        "berm3m_transmission_vs_angle": transmission,
    })
    print(f"\nwrote mitigation_results.json in {time.time() - t0:.0f} s")


if __name__ == "__main__":
    main()