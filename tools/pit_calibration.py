"""Test calibration of the crater-size constant K_D against Surveyor III.

Separate test: reads the cached Monte Carlo results (no rerun) and leaves
psi_simulation.py and config.py untouched.

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
plausible_branches.json. Only export_app_data.py applies that filter (and
keeps the unfiltered numbers next to it); escalation.py and mitigation.py
always report every branch.

    python pit_calibration.py [--quick]

Writes pit_calibration_results.json and plausible_branches.json.
"""
from __future__ import annotations

import argparse
import math
import os

import numpy as np

import pit_spectrum as PS
import psi_study as S

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


def calibrate(pits, count_min_um):
    """Fit K_D per variant for one counting threshold. Returns (rows, summary)."""
    rows = []
    for key, (n, diam) in pits.items():
        means = np.array([mean_ge(n, k * diam, count_min_um) for k in K_GRID])
        hit = np.where(means >= TARGET_MEAN_UM)[0]
        row = {"branch": key, "total_per_cm2": float(n.sum())}
        if n.sum() <= 0 or len(hit) == 0:
            row.update(k=None, K_D=None, N_ge20=None, N_ge80=None,
                       status="no solution", plausible=False)
        else:
            k = float(K_GRID[hit[0]])
            dk = k * diam
            row.update(k=k, K_D=k ** 3, status="ok",
                       N_ge20=float(n[dk >= 20].sum()), N_ge80=float(n[dk >= 80].sum()),
                       mean_ge20=mean_ge(n, dk, 20),
                       cumulative_per_cm2=[float(n[dk >= p].sum()) for p in PS.PIT_SIZES_UM])
            row["plausible"] = PLAUSIBLE_RANGE[0] <= row["N_ge20"] <= PLAUSIBLE_RANGE[1]
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
    return rows, summary


def print_threshold(count_min_um, rows, s):
    print(f"\nCounting threshold {count_min_um:g} um: {s['n_solved']} of {s['n_branches']} variants solvable")
    if not s["n_solved"]:
        return
    print(f"  K_D needed: median {s['K_D_median']:.3g}  (10-90 %: {s['K_D_p10']:.3g} - "
          f"{s['K_D_p90']:.3g});  code uses 1")
    print(f"  model N(pits >= 20 um) after calibration: median {s['N_ge20_median']:.3g}/cm^2 "
          f"(10-90 %: {s['N_ge20_p10']:.3g} - {s['N_ge20_p90']:.3g})")
    print(f"  variants between ~1/3 x coupons and tube maximum: "
          f"{s['n_within_coupon_to_tube']} of {s['n_solved']}")
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

    pits, _, missing = PS.surveyor_pits(S.base_config(a.quick), S.APOLLO_LM_THRUST_N)
    if missing:
        raise SystemExit(f"no completed cached run for {missing}; run escalation.py first")

    results = {}
    for t in COUNT_THRESHOLDS_UM:
        rows, summary = calibrate(pits, t)
        results[f"count_min_{t:g}um"] = {"summary": summary, "branches": rows}

    print(f"K_D calibration at Surveyor III ({'quick' if a.quick else 'full'} cache)")
    print(f"  measured: coupons {COUPONS_PER_CM2:g}/cm^2 (average), tube up to "
          f"{TUBE_MAX_PER_CM2:g}/cm^2 (worst areas)")
    for t in COUNT_THRESHOLDS_UM:
        r = results[f"count_min_{t:g}um"]
        print_threshold(t, r["branches"], r["summary"])

    S.write_json(os.path.join(HERE, "pit_calibration_results.json"),
                 {"quick": a.quick, "pit_sizes_um": PS.PIT_SIZES_UM, "by_threshold": results})

    by_threshold = {k: sorted(r["branch"] for r in v["branches"] if r["plausible"])
                    for k, v in results.items()}
    kept = sorted(set().union(*by_threshold.values()))
    S.write_json(S.PLAUSIBLE_FILE, {
        "rule": ("keep a variant if, after calibrating K_D to the coupons' mean pit size "
                 f"({TARGET_MEAN_UM:.0f} um), its absolute N(pits >= 20 um) at Surveyor III lies "
                 f"between 1/3 x {COUPONS_PER_CM2:g}/cm^2 (coupon average) and "
                 f"{TUBE_MAX_PER_CM2:g}/cm^2 (tube maximum), for at least one assumed counting "
                 "threshold (" + " or ".join(f"{t:g}" for t in COUNT_THRESHOLDS_UM) + " um)"),
        "source": f"pit_calibration.py on the {'quick' if a.quick else 'full-resolution'} "
                  f"{S.APOLLO_LM_THRUST_N / 1000:g} kN cache",
        "quick": a.quick,
        "n_total": len(pits), "n_kept": len(kept), "kept": kept, "by_threshold": by_threshold,
    })
    print(f"\n{len(kept)} of {len(pits)} variants plausible -> {os.path.basename(S.PLAUSIBLE_FILE)}")
    print("wrote pit_calibration_results.json and plausible_branches.json")


if __name__ == "__main__":
    main()