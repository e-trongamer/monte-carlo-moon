"""Pit-size distribution at Surveyor III, compared with the returned hardware.

Reads the cached Monte Carlo results of psi_simulation.py (it does NOT rerun or
change the simulation). The simulation stores, for every grain-size class and
target bin, the impact density and the summed crater depth (Sheldon-Kanhere,
hemispherical crater). From that this script builds the cumulative pit-size
spectrum N(pit diameter >= p) per model branch and compares it with:

  coupons 2050/2051  103 pits/cm^2, mean entry 83.7 x 74.5 um, depth 88.4 um
                     (Immer et al. 2011, Icarus 211)
  polished Al tube   pits >= 20 um counted, up to 40 per mm^2 (4000/cm^2)
                     in the most affected areas (LPSC 1971)
  screw              6 low-velocity craters from ~1 um particles (MPI, NTRS)

Writes pit_spectrum_results.json.

    python pit_spectrum.py            # full-resolution cache
    python pit_spectrum.py --quick    # quick-resolution cache
"""
from __future__ import annotations

import argparse
import os

import numpy as np

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


def surveyor_pits(base, thrust):
    """Per-branch pits at Surveyor III's bin (distance, crater height), from
    the cache. Returns ({"<vm>|<law>|<angle>": (per_cm2, pit_diameter_um)},
    geometry, missing velocity models); both arrays are per grain class.
    Diameter = 2 x depth (hemispherical crater)."""
    pits, geometry, missing = {}, None, []
    for vm in S.VELOCITY_MODELS:
        cfg = base.with_(**{"engine.thrust_n": thrust, "velocity.model": vm})
        st = P.cached_state(cfg)
        if st is None:
            missing.append(vm.value)
            continue
        tg, sv = cfg.targets, cfg.surveyor
        iz, iR = S.nearest(tg.heights_m, sv.height_m), S.nearest(tg.distances_m, sv.distance_m)
        geometry = geometry or {"distance_m": tg.distances_m[iR], "height_m": tg.heights_m[iz],
                                "K_D": cfg.damage.divot_coefficient,
                                "H_vickers_Pa": cfg.damage.target_hardness_pa}
        for tag, d in st["acc"]["mc"].items():
            n = np.array(d["density"])[iz, iR]
            depth = np.divide(np.array(d["depth_sum"])[iz, iR], n,
                              out=np.zeros_like(n), where=n > 0)
            pits[f"{vm.value}|{tag}"] = (n, 2.0 * depth)
    return pits, geometry, missing


def spectrum(n, diam):
    """Cumulative N(pit diameter >= p) and mean diameter of pits >= 20 um."""
    cum = [float(n[diam >= p].sum()) for p in PIT_SIZES_UM]
    big = diam >= 20
    mean20 = float((n[big] * diam[big]).sum() / n[big].sum()) if n[big].sum() > 0 else None
    return cum, mean20


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--thrust", type=float, default=S.APOLLO_LM_THRUST_N)
    a = ap.parse_args()

    base = S.base_config(a.quick)
    pits, geometry, missing = surveyor_pits(base, a.thrust)
    if not pits:
        raise SystemExit(f"No completed cached runs found for {missing}; run escalation.py first.")
    D_um = (P.build_grids(base).D * 1e6).round(2).tolist()

    branches = {}
    for key, (n, diam) in pits.items():
        cum, mean20 = spectrum(n, diam)
        branches[key] = {"cumulative_per_cm2": cum, "mean_pit_um_ge20": mean20,
                         "by_grain": {"D_um": D_um, "per_cm2": n.tolist(),
                                      "pit_diameter_um": diam.tolist()}}

    i20, i80 = PIT_SIZES_UM.index(20), PIT_SIZES_UM.index(80)
    rows = []
    for key, b in branches.items():
        c = b["cumulative_per_cm2"]
        rows.append({"branch": key, "N_ge20": c[i20], "N_ge80": c[i80],
                     "ratio_20_80": c[i20] / c[i80] if c[i80] > 0 else None,
                     "mean_pit_um_ge20": b["mean_pit_um_ge20"]})
    with_large = [r for r in rows if r["N_ge80"] > 0]

    def median(key, subset):
        v = [r[key] for r in subset if r[key] is not None]
        return float(np.median(v)) if v else None

    largest = max((float(diam[n > 0].max()) for n, diam in pits.values() if (n > 0).any()), default=0.0)
    summary = {
        "n_branches": len(rows), "n_with_large_pits": len(with_large),
        "largest_pit_um_any_branch": largest,
        "median_N_ge20_per_cm2": median("N_ge20", rows),
        "median_N_ge80_per_cm2": median("N_ge80", rows),
        "median_ratio_20_to_80": median("ratio_20_80", with_large),
        "median_mean_pit_um_ge20": median("mean_pit_um_ge20", rows),
        "measured_ratio_upper_bound": MEASURED["tube"]["max_per_cm2"] / MEASURED["coupons"]["per_cm2"],
    }
    S.write_json(os.path.join(HERE, "pit_spectrum_results.json"), {
        "quick": a.quick, "thrust_N": a.thrust, "pit_sizes_um": PIT_SIZES_UM,
        "measured": MEASURED, "geometry": geometry, "missing_velocity_models": missing,
        "crater_model": f"Sheldon-Kanhere, K_D = {geometry['K_D']:g} (placeholder), "
                        "hemispherical crater, Al target",
        "branches": branches, "comparison": rows, "summary": summary,
    })

    s, f3 = summary, (lambda x: "none" if x is None else f"{x:.3g}")
    print(f"Pit-size spectrum at Surveyor III ({geometry['distance_m']} m, {geometry['height_m']:+g} m), "
          f"{a.thrust / 1000:g} kN, {'quick' if a.quick else 'full'} cache, {s['n_branches']} branches")
    print(f"  N(pits >= 20 um)  median {f3(s['median_N_ge20_per_cm2'])}/cm^2   "
          f"[tube: up to {MEASURED['tube']['max_per_cm2']:.0f}/cm^2 in worst areas]")
    print(f"  N(pits >= 80 um)  median {f3(s['median_N_ge80_per_cm2'])}/cm^2   "
          f"[coupons: {MEASURED['coupons']['per_cm2']:.0f}/cm^2, mean size ~79 um]")
    print(f"  mean size of pits >= 20 um: {f3(s['median_mean_pit_um_ge20'])} um   [coupons ~79 um]")
    print(f"  largest pit in any branch: {s['largest_pit_um_any_branch']:.0f} um; "
          f"branches with any pit >= 80 um: {s['n_with_large_pits']} of {s['n_branches']}")
    print("wrote pit_spectrum_results.json")


if __name__ == "__main__":
    main()