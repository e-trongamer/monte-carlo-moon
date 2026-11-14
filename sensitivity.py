#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Check how assumptions affect the estimated landing distance.

Each input is changed separately while the others stay at their default
values. The output is the median distance at which anchored exposure falls
below a chosen threshold (default 0.1 times the Surveyor III reference).

Three kinds of input:
  physics   requires simulations (results are cached)
  post      changes geometry or threshold only
  branch    compares velocity, erosion and angle choices

    python sensitivity.py --quick              # reduced resolution
    python sensitivity.py --thrust 44000       # 44 kN class instead of the Apollo LM

The default is the Apollo LM thrust (11.6 kN), the only thrust the anchoring
to Surveyor III was measured at. Only variants in plausible_branches.json are
used (see psi_study.py).
"""
from __future__ import annotations

import argparse, json, os, time
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

import psi_study as S

HERE = os.path.dirname(os.path.abspath(__file__))

# (config key, label, low, high). Nominal values come from psi_simulation.CONFIG.
PHYSICS = [
    ("eject_angle_sd_deg", "spread of ejection angle within the sheet (deg)", 0.25, 1.0),
    ("r_accel_path_m", "drag acceleration path (m)", 5.0, 20.0),
    ("cohesion_gamma_N_m", "regolith cohesion (N/m)", 1e-4, 1e-3),
    ("psd_D50_mass_um", "median grain size (µm)", 45.0, 100.0),
    ("h_end_m", "engine cut-off height (m)", 1.0, 4.0),
    ("plume_cos_exponent", "plume concentration exponent", 2.0, 8.0),
    ("fig5_K0_thrust_exp", "Fig. 5 speed-vs-thrust exponent", 0.0, 0.5),
    ("fig5_hk_thrust_exp", "Fig. 5 knee-vs-thrust exponent", 0.25, 1.0),
    ("r_accel_path_thrust_exp", "path-length-vs-thrust exponent", 0.0, 1.0),
]
# (name, label, low, high) handled in post-processing
POST = [
    ("target_height", "hardware height above ground (m)", 0.0, 3.0),
    ("anchor_height", "Surveyor III depth in its crater (m)", -6.0, 0.0),
    ("anchor_distance", "Surveyor III distance, 155 vs 180 m", 155.0, 180.0),
    ("threshold", "damage threshold (x Surveyor III)", 1.0, 0.01),
]


def metric(runs, threshold_frac, **kw):
    R, exp_, excl = S.anchored_exposure(runs, **kw)
    cfg = next(iter(runs.values()))[0]
    band = S.distance_band(R, exp_, threshold_frac * cfg["pit_reference_per_cm2"])
    d = band["median"]
    return (min(d, float(R[-1])), not np.isfinite(d), band["n"], len(excl))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--thrust", type=float, default=S.APOLLO_LM_THRUST_N)
    ap.add_argument("--threshold", type=float, default=0.1, help="fraction of Surveyor III")
    a = ap.parse_args()
    t0 = time.time()
    base_ovr = {"thrust_N": a.thrust}

    nominal_runs = S.run_set(base_ovr, quick=a.quick)
    nom, nom_cap, n_br, n_ex = metric(nominal_runs, a.threshold)
    print(f"[sensitivity] nominal: {S.fmt_distance(nom, 1e4)} "
          f"({n_br} branches, {n_ex} excluded)")
    rows = []

    import psi_simulation as P
    for key, label, lo, hi in PHYSICS:
        vals = []
        for v in (lo, hi):
            runs = S.run_set(dict(base_ovr, **{key: v}), quick=a.quick)
            vals.append(metric(runs, a.threshold))
        rows.append(dict(kind="physics", key=key, label=label,
                         nominal=P.CONFIG[key], low=lo, high=hi,
                         d_low=vals[0][0], d_high=vals[1][0],
                         capped=bool(vals[0][1] or vals[1][1])))
        print(f"[sensitivity] {label:<50} {S.fmt_distance(vals[0][0], 1e4):>9} .. "
              f"{S.fmt_distance(vals[1][0], 1e4):<9} ({time.time()-t0:.0f} s)")

    for name, label, lo, hi in POST:
        vals = []
        for v in (lo, hi):
            if name == "threshold":
                vals.append(metric(nominal_runs, v))
            else:
                vals.append(metric(nominal_runs, a.threshold, **{
                    "target_height": {"z_target": v},
                    "anchor_height": {"anchor_height": v},
                    "anchor_distance": {"anchor_distance": v}}[name]))
        rows.append(dict(kind="post", key=name, label=label, low=lo, high=hi,
                         d_low=vals[0][0], d_high=vals[1][0],
                         capped=bool(vals[0][1] or vals[1][1])))

    # Branch axes: restrict to each axis value, median over the rest
    R, exp_, _ = S.anchored_exposure(nominal_runs)
    thr = a.threshold * next(iter(nominal_runs.values()))[0]["pit_reference_per_cm2"]
    dist = {k: min(S.practical_distance(R, y, thr), float(R[-1])) for k, y in exp_.items()}
    for axis, label in ((0, "velocity law (drag model vs Fig. 5)"),
                        (1, "erosion law (shear / Roberts / energy flux)"),
                        (2, "measured Apollo ejection angle (1.4°-8.1°)")):
        groups = {}
        for k, d in dist.items():
            groups.setdefault(k.split("|")[axis], []).append(d)
        meds = {g: float(np.median(v)) for g, v in groups.items()}
        rows.append(dict(kind="branch", key=f"axis{axis}", label=label,
                         low=min(meds, key=meds.get), high=max(meds, key=meds.get),
                         d_low=min(meds.values()), d_high=max(meds.values()),
                         capped=bool(max(meds.values()) >= R[-1]), groups=meds))

    for r in rows:
        r["span_decades"] = float(abs(np.log10(r["d_high"]) - np.log10(r["d_low"])))
    rows.sort(key=lambda r: r["span_decades"])

    with open(os.path.join(HERE, "sensitivity_results.json"), "w", encoding="utf-8") as f:
        json.dump({"thrust_N": a.thrust, "threshold_x_surveyor": a.threshold,
                   "nominal_m": nom, "quick": a.quick, "rows": rows[::-1]}, f, indent=1)

    print("\nRanking (decades of practical distance between low and high):")
    for r in rows[::-1]:
        print(f"  {r['span_decades']:5.2f}  [{r['kind']:<7}] {r['label']}"
              + ("   (hits the 10 km grid edge)" if r["capped"] else ""))

    # ---------------------------------------------------------------- tornado
    colors = {"physics": "tab:blue", "post": "tab:orange", "branch": "tab:purple"}
    fig, ax = plt.subplots(figsize=(11, 0.45 * len(rows) + 2))
    for i, r in enumerate(rows):
        lo_d, hi_d = sorted((r["d_low"], r["d_high"]))
        ax.barh(i, hi_d - lo_d, left=lo_d, color=colors[r["kind"]], alpha=0.75)
        if r["kind"] != "branch":
            ax.text(r["d_low"], i, f"{r['low']:g} ", ha="right" if r["d_low"] <= r["d_high"] else "left",
                    va="center", fontsize=7)
            ax.text(r["d_high"], i, f" {r['high']:g}", ha="left" if r["d_high"] >= r["d_low"] else "right",
                    va="center", fontsize=7)
    ax.axvline(nom, color="k", lw=1.2)
    ax.set_yticks(range(len(rows)))
    ax.set_yticklabels([r["label"] for r in rows], fontsize=8.5)
    ax.set_xscale("log")
    ax.set_xlabel(f"Practical distance (m) for exposure below {a.threshold:g}x Surveyor III")
    ax.set_title(f"Sensitivity at {a.thrust/1000:g} kN\n"
                 f"black line = nominal ({S.fmt_distance(nom, 1e4)}); "
                 "blue = physics input, orange = geometry/threshold choice, "
                 "purple = model-choice axis", fontsize=10)
    ax.grid(alpha=0.3, which="both", axis="x")
    fig.tight_layout()
    out = os.path.join(HERE, "sensitivity.png")
    fig.savefig(out, dpi=110)
    print(f"\nwrote {out} and sensitivity_results.json in {time.time()-t0:.0f} s")


if __name__ == "__main__":
    main()