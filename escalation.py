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

import argparse, json, os, time
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

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

    # --------------------------------------------------------------- figure
    fig, ax = plt.subplots(1, 3, figsize=(18, 5.6))
    cmap = plt.get_cmap("viridis")

    a0 = ax[0]
    for j, (name, exp_) in enumerate(exposures.items()):
        st = np.array(list(exp_.values()))
        with np.errstate(invalid="ignore"):
            pos = np.where(st > 0, st, np.nan)
            lo, md, hi = np.nanmin(pos, 0), np.nanmedian(pos, 0), np.nanmax(pos, 0)
        c = cmap(j / (len(exposures) - 1))
        a0.fill_between(R, lo, hi, color=c, alpha=0.12)
        a0.plot(R, md, "-", color=c, lw=2, label=name)
    for f in THRESHOLD_FRACTIONS:
        a0.axhline(f * meas, color="k", ls=":", lw=1)
        a0.text(R[-1], f * meas, f" {f:g}x Surveyor", va="center", fontsize=7)
    a0.plot([cfg["surveyor_distance_m"]], [meas], "r*", ms=14, label="Surveyor III (anchor)")
    a0.set_xscale("log"); a0.set_yscale("log")
    a0.set_xlabel("Distance from landing site (m)")
    a0.set_ylabel(f"Impacts per cm² at {cfg['target_height_m']:g} m height, per landing")
    a0.set_title("Exposure anchored to Surveyor III\nmedian across branches, band = min-max")
    a0.legend(fontsize=7, loc="lower left"); a0.grid(alpha=0.3, which="both")

    a1 = ax[1]
    tk = np.array([r["thrust_N"] for r in results.values()]) / 1000
    for f, c in zip(THRESHOLD_FRACTIONS, ("tab:red", "tab:orange", "tab:blue")):
        key = f"{f:g}x Surveyor"
        md = np.array([r["distance_bands"][key]["median"] for r in results.values()])
        lo = np.array([r["distance_bands"][key]["min"] for r in results.values()])
        hi = np.array([r["distance_bands"][key]["max"] for r in results.values()])
        cap = lambda x: np.where(np.isfinite(x), x, grid_max)
        a1.fill_between(tk, cap(lo), cap(hi), color=c, alpha=0.15)
        a1.plot(tk, cap(md), "o-", color=c, label=f"below {key}")
    a1.axvspan(VALIDATED_MAX_THRUST_N / 1000, tk.max() * 1.1, color="grey", alpha=0.15)
    a1.text(VALIDATED_MAX_THRUST_N / 1000 * 1.05, grid_max * 0.6,
            "bulk cratering expected;\nnot included", fontsize=7.5, va="top")
    a1.axhline(grid_max, color="k", lw=0.8, ls="--")
    # NASA's 2 km recommendation for approaching Apollo heritage sites
    # (NASA-USG Lunar Historic Sites, 2011): a non-mandatory guideline, chosen
    # because the lunar horizon (~1.8 km for a person) blocks line of sight.
    # It does not scale with lander size. Shown for comparison only.
    a1.axhline(2000.0, color="tab:green", lw=1.2, ls="-.")
    a1.text(tk.min(), 2000.0 * 1.08, "NASA 2 km heritage-site recommendation (non-mandatory)",
            color="tab:green", fontsize=7.5)
    a1.set_xscale("log"); a1.set_yscale("log")
    a1.set_xlabel("Hover thrust (kN)  ~  landed weight")
    a1.set_ylabel("Practical distance (m)")
    a1.set_title("Practical landing distance vs lander size\n"
                 f"dashed line = edge of the {grid_max/1000:g} km grid")
    a1.legend(fontsize=8, loc="lower right"); a1.grid(alpha=0.3, which="both")

    a2 = ax[2]
    ns = np.array(LANDING_COUNTS, float)
    for f, c in zip(THRESHOLD_FRACTIONS, ("tab:red", "tab:orange", "tab:blue")):
        key = f"{f:g}x Surveyor"
        md = np.array([repeat[n][key]["median"] for n in LANDING_COUNTS])
        lo = np.array([repeat[n][key]["min"] for n in LANDING_COUNTS])
        hi = np.array([repeat[n][key]["max"] for n in LANDING_COUNTS])
        cap = lambda x: np.where(np.isfinite(x), x, grid_max)
        a2.fill_between(ns, cap(lo), cap(hi), color=c, alpha=0.15)
        a2.plot(ns, cap(md), "o-", color=c, label=f"below {key}")
    a2.axhline(grid_max, color="k", lw=0.8, ls="--")
    a2.set_xscale("log"); a2.set_yscale("log")
    a2.set_xlabel("Number of landings at the same site")
    a2.set_ylabel("Practical distance (m)")
    a2.set_title(f"Repeated landings at {a.repeat_scenario/1000:g} kN\n"
                 "assumes fluence adds linearly; crater growth not modelled")
    a2.legend(fontsize=8, loc="lower right"); a2.grid(alpha=0.3, which="both")

    fig.suptitle("How close can a lunar base sit to its landing pad? "
                 f"({'quick' if a.quick else 'full'} resolution, "
                 f"hardware {cfg['target_height_m']:g} m tall, open terrain, no pad)",
                 fontsize=12, fontweight="bold")
    fig.tight_layout(rect=[0, 0, 1, 0.94])
    out = os.path.join(HERE, "escalation.png")
    fig.savefig(out, dpi=110)
    print(f"\nwrote {out} and escalation_results.json in {time.time()-t0:.0f} s")


if __name__ == "__main__":
    main()