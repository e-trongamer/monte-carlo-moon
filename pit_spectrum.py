#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pit-size distribution at Surveyor III, compared with the returned hardware.

Reads the cached Monte Carlo results of psi_simulation.py (it does NOT rerun or
change the simulation; editing psi_simulation.py would invalidate the cache).
The simulation already stores, for every grain-size class and target bin, the
impact density and the summed crater depth (Sheldon-Kanhere, hemispherical
crater). From that this script builds the cumulative pit-size spectrum
N(pit diameter >= p) per model branch and compares it with:

  coupons 2050/2051  103 pits/cm^2, mean entry 83.7 x 74.5 um, depth 88.4 um
                     (Immer et al. 2011, Icarus 211)
  polished Al tube   pits >= 20 um counted, up to 40 per mm^2 (4000/cm^2)
                     in the most affected areas (LPSC 1971)
  screw              6 low-velocity craters from ~1 um particles (MPI, NTRS)

    python pit_spectrum.py            # full-resolution cache
    python pit_spectrum.py --quick    # quick-resolution cache
"""
from __future__ import annotations

import argparse, json, os

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

import psi_simulation as P
import psi_study as S

HERE = os.path.dirname(os.path.abspath(__file__))
PIT_SIZES_UM = [1, 2, 5, 10, 20, 50, 80, 100, 150, 200, 300]
MEASURED = {
    "coupons": {"per_cm2": 103.0, "mean_entry_um": (83.7, 74.5), "depth_um": 88.4,
                "source": "Immer et al. 2011, Icarus 211 (coupons 2050/2051)"},
    "tube": {"min_pit_um": 20.0, "max_per_cm2": 4000.0,
             "source": "LPSC 1971 (polished Al tube, most affected areas)"},
    "screw": {"particle_um": 1.0, "source": "MPI Kernphysik, NTRS 19720019104"},
}


def cached_checkpoint(cfg):
    """Same cache path as psi_simulation.simulate(), without running anything."""
    run_dir = os.path.join(HERE, "psi_cache", f"{P.config_hash(cfg)}_{P.code_tag()}")
    path = os.path.join(run_dir, "checkpoint.json")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        st = json.load(f)
    return st if st.get("status") == "COMPLETED" else None


def spectrum(n_D, depth_D):
    """Cumulative N(pit diameter >= p) and mean pit size for one target bin."""
    diam = 2.0 * depth_D                         # hemispherical crater: diameter = 2 x depth
    cum = [float(n_D[diam >= p].sum()) for p in PIT_SIZES_UM]
    big = diam >= 20
    mean20 = float((n_D[big] * diam[big]).sum() / n_D[big].sum()) if n_D[big].sum() > 0 else None
    return cum, mean20


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--thrust", type=float, default=S.APOLLO_LM_THRUST_N)
    a = ap.parse_args()

    out = {"quick": a.quick, "thrust_N": a.thrust, "pit_sizes_um": PIT_SIZES_UM,
           "measured": MEASURED, "crater_model": "Sheldon-Kanhere, K_D = CONFIG['K_D'], "
           "hemispherical crater, Al target", "branches": {}}
    missing = []
    for vm in S.VELOCITY_MODELS:
        cfg = dict(P.CONFIG)
        cfg.update(dict(S.QUICK) if a.quick else {})
        cfg.update(thrust_N=a.thrust, velocity_model=vm)
        st = cached_checkpoint(cfg)
        if st is None:
            missing.append(vm); continue
        G = P.build_grids(cfg)
        z_list, R_list = cfg["target_heights_sensitivity_m"], cfg["target_distances_m"]
        iz = S.nearest(z_list, cfg["surveyor_height_m"])
        iR = S.nearest(R_list, cfg["surveyor_distance_m"])
        out.setdefault("geometry", {"distance_m": R_list[iR], "height_m": z_list[iz],
                                    "K_D": cfg["K_D"], "H_vickers_Pa": cfg["H_vickers_Pa"]})
        for tag, d in st["accumulated_results"]["mc"].items():
            dens = np.array(d["density"])[iz, iR]          # per cm^2, per grain class
            dsum = np.array(d["depth_sum"])[iz, iR]
            with np.errstate(invalid="ignore", divide="ignore"):
                depth = np.where(dens > 0, dsum / np.where(dens > 0, dens, 1), 0.0)
            cum, mean20 = spectrum(dens, depth)
            out["branches"][f"{vm}|{tag}"] = {
                "cumulative_per_cm2": cum, "mean_pit_um_ge20": mean20,
                "by_grain": {"D_um": (G["D"] * 1e6).round(2).tolist(),
                             "per_cm2": dens.tolist(), "pit_diameter_um": (2 * depth).tolist()},
            }
    if not out["branches"]:
        raise SystemExit(f"No completed cached runs found for {missing}; run escalation.py first.")

    # --- comparisons -----------------------------------------------------
    i20, i80 = PIT_SIZES_UM.index(20), PIT_SIZES_UM.index(80)
    rows = []
    for tag, b in out["branches"].items():
        c = b["cumulative_per_cm2"]
        rows.append({"branch": tag, "N_ge20": c[i20], "N_ge80": c[i80],
                     "ratio_20_80": c[i20] / c[i80] if c[i80] > 0 else None,
                     "mean_pit_um_ge20": b["mean_pit_um_ge20"]})
    out["comparison"] = rows
    ok = [r for r in rows if r["N_ge80"] > 0]

    def med(k, subset):
        v = [r[k] for r in subset if r[k] is not None]
        return float(np.median(v)) if v else None
    maxpit = [max([p for p, n in zip(b["by_grain"]["pit_diameter_um"], b["by_grain"]["per_cm2"]) if n > 0],
                  default=0.0) for b in out["branches"].values()]
    out["summary"] = {
        "n_branches": len(rows), "n_with_large_pits": len(ok),
        "largest_pit_um_any_branch": float(max(maxpit)),
        "median_N_ge20_per_cm2": med("N_ge20", rows), "median_N_ge80_per_cm2": med("N_ge80", rows),
        "median_ratio_20_to_80": med("ratio_20_80", ok),
        "median_mean_pit_um_ge20": med("mean_pit_um_ge20", rows),
        "measured_ratio_upper_bound": MEASURED["tube"]["max_per_cm2"] / MEASURED["coupons"]["per_cm2"],
    }
    with open(os.path.join(HERE, "pit_spectrum_results.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)

    # --- printout ----------------------------------------------------------
    g = out["geometry"]; s = out["summary"]
    print(f"Pit-size spectrum at Surveyor III ({g['distance_m']} m, {g['height_m']:+g} m), "
          f"{a.thrust/1000:g} kN, {'quick' if a.quick else 'full'} cache, {s['n_branches']} branches")
    f3 = lambda x: "none" if x is None else f"{x:.3g}"
    print(f"  N(pits >= 20 um)  median {f3(s['median_N_ge20_per_cm2'])}/cm^2   "
          f"[tube: up to {MEASURED['tube']['max_per_cm2']:.0f}/cm^2 in worst areas]")
    print(f"  N(pits >= 80 um)  median {f3(s['median_N_ge80_per_cm2'])}/cm^2   "
          f"[coupons: {MEASURED['coupons']['per_cm2']:.0f}/cm^2, mean size ~79 um]")
    print(f"  mean size of pits >= 20 um: {f3(s['median_mean_pit_um_ge20'])} um   [coupons ~79 um]")
    print(f"  largest pit in any branch: {s['largest_pit_um_any_branch']:.0f} um; "
          f"branches with any pit >= 80 um: {s['n_with_large_pits']} of {s['n_branches']}")

    # --- figure --------------------------------------------------------------
    fig, ax = plt.subplots(figsize=(8.5, 5.5))
    stack = np.array([b["cumulative_per_cm2"] for b in out["branches"].values()])
    with np.errstate(invalid="ignore"):
        pos = np.where(stack > 0, stack, np.nan)
        lo, md, hi = np.nanmin(pos, 0), np.nanmedian(pos, 0), np.nanmax(pos, 0)
    ax.fill_between(PIT_SIZES_UM, lo, hi, alpha=0.25, color="tab:blue", label="range across branches")
    ax.plot(PIT_SIZES_UM, md, "o-", color="tab:blue", label="branch median (model, uncalibrated)")
    ax.plot([79], [103], "k*", ms=15, label="coupons 2050/2051: 103/cm², mean ~79 µm")
    ax.plot([20], [4000], "rv", ms=11, label="Al tube: up to 4000/cm² (≥20 µm, worst areas)")
    ax.set_xscale("log"); ax.set_yscale("log")
    ax.set_xlabel("Pit diameter p (µm)"); ax.set_ylabel("Pits per cm² with diameter ≥ p")
    ax.set_title(f"Pit-size spectrum at Surveyor III, {a.thrust/1000:g} kN "
                 f"({'quick' if a.quick else 'full'} resolution)\n"
                 f"crater model: Sheldon-Kanhere, K_D = {g['K_D']:g} (placeholder), Al target")
    ax.grid(alpha=0.3, which="both"); ax.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(os.path.join(HERE, "pit_spectrum.png"), dpi=110)
    print(f"wrote pit_spectrum_results.json and pit_spectrum.png")


if __name__ == "__main__":
    main()
