#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Test calibration of the crater-size constant K_D against Surveyor III.

Separate test: reads the cached Monte Carlo results (no rerun) and leaves
psi_simulation.py and its CONFIG untouched.

Why this works in post-processing: in Sheldon & Kanhere the crater volume is
V = K_D * v^3 D^3 rho^1.5 H^-1.5, and the code converts V into a hemispherical
crater, so every pit diameter scales as K_D^(1/3). Changing K_D only stretches
the pit-size axis; impact counts stay the same.

Calibration (per model branch, done once for each counting threshold):
  1. Counted pits are assumed to be those >= the threshold. 20 um is the
     threshold of the 1971 optical count on the polished tube; the coupon
     paper does not state one, so 50 um is tried as well (an ASSUMPTION
     either way).
  2. Find k = K_D^(1/3) such that the mean diameter of model pits above the
     threshold at Surveyor III (155 m, -3 m) equals the coupons' mean entry
     size, sqrt(83.7 x 74.5) = 79 um.
  3. Test, without any further scaling: model N(pits >= 20 um) against the
     coupons (103/cm^2, average) and the tube (up to 4000/cm^2, worst areas).

A variant is called plausible if step 3 lands between 1/3 x 103/cm^2 and
4000/cm^2 for at least one threshold. Those variants are written to
plausible_branches.json, which psi_study.py, escalation.py, mitigation.py and
export_app_data.py use as their variant filter.

    python pit_calibration.py [--quick]

Writes pit_calibration_results.json, plausible_branches.json and
pit_calibration.png.
"""
from __future__ import annotations

import argparse, json, math, os

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

import psi_simulation as P
import psi_study as S
import pit_spectrum as PS

HERE = os.path.dirname(os.path.abspath(__file__))
COUNT_THRESHOLDS_UM = (20.0, 50.0)              # assumed lower limits of the pit count
TARGET_MEAN_UM = math.sqrt(83.7 * 74.5)        # 79.0 um, coupons 2050/2051
COUPONS_PER_CM2 = 103.0
TUBE_MAX_PER_CM2 = 4000.0
PLAUSIBLE_RANGE = (COUPONS_PER_CM2 / 3, TUBE_MAX_PER_CM2)   # N(>= 20 um) per cm^2
K_GRID = np.logspace(0, math.log10(60), 600)    # k = K_D^(1/3) from 1 to 60


def mean_ge(n, d, pmin):
    m = d >= pmin
    return float((n[m] * d[m]).sum() / n[m].sum()) if n[m].sum() > 0 else float("nan")


def surveyor_pits(quick):
    """Per-variant pit counts and diameters (K_D = 1) at Surveyor III, from the cache."""
    out = {}
    for vm in S.VELOCITY_MODELS:
        cfg = dict(P.CONFIG)
        cfg.update(dict(S.QUICK) if quick else {})
        cfg.update(thrust_N=S.APOLLO_LM_THRUST_N, velocity_model=vm)
        st = PS.cached_checkpoint(cfg)
        if st is None:
            raise SystemExit(f"no completed cached run for {vm}; run escalation.py first")
        zl, Rl = cfg["target_heights_sensitivity_m"], cfg["target_distances_m"]
        iz, iR = S.nearest(zl, cfg["surveyor_height_m"]), S.nearest(Rl, cfg["surveyor_distance_m"])
        for tag, d in st["accumulated_results"]["mc"].items():
            n = np.array(d["density"])[iz, iR]
            ds = np.array(d["depth_sum"])[iz, iR]
            with np.errstate(invalid="ignore", divide="ignore"):
                diam = np.where(n > 0, 2 * ds / np.where(n > 0, n, 1), 0.0)
            out[f"{vm}|{tag}"] = (n, diam)
    return out


def calibrate(pits, count_min_um):
    """Fit K_D per variant for one counting threshold. Returns (rows, curves, summary)."""
    rows, curves = [], {}
    for key, (n, diam) in pits.items():
        means = np.array([mean_ge(n, k * diam, count_min_um) for k in K_GRID])
        hit = np.where(means >= TARGET_MEAN_UM)[0]
        row = {"branch": key, "total_per_cm2": float(n.sum())}
        if n.sum() <= 0 or len(hit) == 0:
            row.update(k=None, K_D=None, N_ge20=None, N_ge80=None, status="no solution")
        else:
            k = float(K_GRID[hit[0]])
            dk = k * diam
            row.update(k=k, K_D=k ** 3, status="ok",
                       N_ge20=float(n[dk >= 20].sum()), N_ge80=float(n[dk >= 80].sum()),
                       mean_ge20=mean_ge(n, dk, 20))
            row["plausible"] = PLAUSIBLE_RANGE[0] <= row["N_ge20"] <= PLAUSIBLE_RANGE[1]
            curves[key] = [float(n[dk >= p].sum()) for p in PS.PIT_SIZES_UM]
        rows.append(row)

    ok = [r for r in rows if r["status"] == "ok"]
    med = lambda key: float(np.median([r[key] for r in ok])) if ok else None
    q = lambda key, p: float(np.percentile([r[key] for r in ok], p)) if ok else None
    summary = {
        "assumption": f"counted pits >= {count_min_um:g} um; target mean diameter {TARGET_MEAN_UM:.1f} um",
        "n_branches": len(rows), "n_solved": len(ok),
        "K_D_median": med("K_D"), "K_D_p10": q("K_D", 10), "K_D_p90": q("K_D", 90),
        "N_ge20_median": med("N_ge20"), "N_ge20_p10": q("N_ge20", 10), "N_ge20_p90": q("N_ge20", 90),
        "coupons_per_cm2": COUPONS_PER_CM2, "tube_max_per_cm2": TUBE_MAX_PER_CM2,
        "n_within_coupon_to_tube": sum(1 for r in ok if r["plausible"]),
    }
    return rows, curves, summary


def print_threshold(count_min_um, rows, s):
    print(f"\nCounting threshold {count_min_um:g} um: {s['n_solved']} of {s['n_branches']} variants solvable")
    print(f"  K_D needed: median {s['K_D_median']:.3g}  (10-90 %: {s['K_D_p10']:.3g} - {s['K_D_p90']:.3g});  "
          f"code uses 1")
    print(f"  model N(pits >= 20 um) after calibration: median {s['N_ge20_median']:.3g}/cm^2 "
          f"(10-90 %: {s['N_ge20_p10']:.3g} - {s['N_ge20_p90']:.3g})")
    print(f"  variants between ~1/3 x coupons and tube maximum: {s['n_within_coupon_to_tube']} of {s['n_solved']}")
    print("\n  variant                             K_D     N>=20/cm2   N>=80/cm2")
    for r in rows:
        if r["status"] == "ok":
            flag = "  plausible" if r["plausible"] else ""
            print(f"  {r['branch']:<34} {r['K_D']:7.3g}  {r['N_ge20']:10.3g}  {r['N_ge80']:10.3g}{flag}")
        else:
            print(f"  {r['branch']:<34}  no solution (total {r['total_per_cm2']:.3g}/cm2)")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--quick", action="store_true")
    a = ap.parse_args()

    pits = surveyor_pits(a.quick)
    results, all_curves = {}, {}
    for t in COUNT_THRESHOLDS_UM:
        rows, curves, summary = calibrate(pits, t)
        results[f"count_min_{t:g}um"] = {"summary": summary, "branches": rows}
        all_curves[t] = (curves, summary)

    print(f"K_D calibration at Surveyor III ({'quick' if a.quick else 'full'} cache)")
    print(f"  measured: coupons {COUPONS_PER_CM2:g}/cm^2 (average), tube up to "
          f"{TUBE_MAX_PER_CM2:g}/cm^2 (worst areas)")
    for t in COUNT_THRESHOLDS_UM:
        r = results[f"count_min_{t:g}um"]
        print_threshold(t, r["branches"], r["summary"])

    with open(os.path.join(HERE, "pit_calibration_results.json"), "w", encoding="utf-8") as f:
        json.dump({"quick": a.quick, "by_threshold": results}, f, indent=1)

    by_threshold = {k: sorted(r["branch"] for r in v["branches"] if r.get("plausible"))
                    for k, v in results.items()}
    kept = sorted(set().union(*by_threshold.values()))
    plausible = {
        "rule": ("keep a variant if, after calibrating K_D to the coupons' mean pit size "
                 f"({TARGET_MEAN_UM:.0f} um), its absolute N(pits >= 20 um) at Surveyor III lies "
                 f"between 1/3 x {COUPONS_PER_CM2:g}/cm^2 (coupon average) and "
                 f"{TUBE_MAX_PER_CM2:g}/cm^2 (tube maximum), for at least one assumed counting "
                 "threshold (" + " or ".join(f"{t:g}" for t in COUNT_THRESHOLDS_UM) + " um)"),
        "source": f"pit_calibration.py on the {'quick' if a.quick else 'full-resolution'} "
                  f"{S.APOLLO_LM_THRUST_N/1000:g} kN cache",
        "n_total": len(pits), "n_kept": len(kept), "kept": kept, "by_threshold": by_threshold,
    }
    with open(S.PLAUSIBLE_FILE, "w", encoding="utf-8") as f:
        json.dump(plausible, f, indent=1)
    print(f"\n{len(kept)} of {len(pits)} variants plausible -> {os.path.basename(S.PLAUSIBLE_FILE)}")

    fig, ax = plt.subplots(figsize=(8.5, 5.5))
    for (t, (curves, s)), c in zip(all_curves.items(), ("tab:green", "tab:blue")):
        if not curves:
            continue
        stack = np.array(list(curves.values()))
        with np.errstate(invalid="ignore"):
            pos = np.where(stack > 0, stack, np.nan)
            lo, md, hi = np.nanmin(pos, 0), np.nanmedian(pos, 0), np.nanmax(pos, 0)
        ax.fill_between(PS.PIT_SIZES_UM, lo, hi, alpha=0.18, color=c)
        ax.plot(PS.PIT_SIZES_UM, md, "o-", color=c,
                label=f"count >= {t:g} µm: median over variants (K_D median {s['K_D_median']:.3g}), "
                      "band = range")
    ax.plot([TARGET_MEAN_UM], [COUPONS_PER_CM2], "k*", ms=15, label="coupons: 103/cm², mean ~79 µm")
    ax.plot([20], [TUBE_MAX_PER_CM2], "rv", ms=11, label="Al tube: up to 4000/cm² ≥20 µm (worst areas)")
    ax.set_xscale("log"); ax.set_yscale("log")
    ax.set_xlabel("Pit diameter p (µm)"); ax.set_ylabel("Pits per cm² with diameter ≥ p")
    ax.set_title("Surveyor III pits after K_D calibration, two assumed counting thresholds\n"
                 "counts are NOT rescaled: this compares the model's absolute numbers")
    ax.grid(alpha=0.3, which="both"); ax.legend(fontsize=7.5)
    fig.tight_layout(); fig.savefig(os.path.join(HERE, "pit_calibration.png"), dpi=110)
    print("wrote pit_calibration_results.json, plausible_branches.json and pit_calibration.png")


if __name__ == "__main__":
    main()
