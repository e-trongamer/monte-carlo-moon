"""Export compact app data (app_data.json) from cached simulation runs.

Reads the same cached runs as escalation.py and mitigation.py (run those
first; this script then only post-processes and finishes in seconds). It never
starts a simulation: configurations that are not cached yet are skipped with a
message.

Variant filter: if plausible_branches.json exists (see pit_calibration.py),
the app's main numbers use only the variants listed there. Results over all
variants are kept alongside under "all_branches" for comparison.

    python export_app_data.py --quick     # after escalation.py/mitigation.py --quick
    python export_app_data.py             # after the full-resolution runs
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

import engine.studies.escalation as E
import engine.studies.mitigation as M
import engine.studies.psi_study as S

HERE = Path(__file__).parent.parent
# -3 m = Surveyor III's crater setting (the anchor height); the rest are
# hardware heights above flat ground.
HARDWARE_HEIGHTS = [-3.0, 0.0, 1.5, 3.0, 5.0, 8.0]
REPEAT_THRUST_N = 44000.0          # same as escalation.py's default


def envelope(R, exposures):
    if not exposures:
        return {"min": None, "median": None, "max": None}
    env = S.exposure_envelope(R, exposures)
    round4 = lambda xs: [None if x is None or not np.isfinite(x) else float(f"{x:.4g}") for x in xs]
    return {"min": round4(env["min_per_cm2"]), "median": round4(env["median_per_cm2"]),
            "max": round4(env["max_per_cm2"])}


def band(R, exposures, threshold):
    if not exposures:
        return {"min": None, "median": None, "max": None, "n_beyond_grid": 0, "n": 0}
    b = S.distance_band(R, exposures, threshold)
    f = lambda x: round(float(x), 1) if np.isfinite(x) else None
    return {"min": f(b["min"]), "median": f(b["median"]), "max": f(b["max"]),
            "n_beyond_grid": b["n_beyond_grid"], "n": b["n"]}


def summarize(R, exposures, measured):
    return {"exposure": envelope(R, exposures),
            "distance_bands": {f"{f:g}": band(R, exposures, f * measured)
                               for f in E.THRESHOLD_FRACTIONS},
            "n_branches": len(exposures)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    a = ap.parse_args()

    base = S.base_config(a.quick)
    meas = base.surveyor.pit_density_per_cm2
    keep, finfo = S.load_branch_filter()
    pick = (lambda d: {k: v for k, v in d.items() if k in keep}) if keep else (lambda d: d)
    if keep and finfo.get("quick", a.quick) != a.quick:
        print("[export] warning: plausible_branches.json was made at a different resolution")

    out = {"generated": datetime.now(timezone.utc).isoformat(), "quick": a.quick,
           "units": "impacts per cm^2 per landing, anchored to Surveyor III",
           "thresholds_x_surveyor": E.THRESHOLD_FRACTIONS,
           "validated_max_thrust_N": E.VALIDATED_MAX_THRUST_N,
           "anchor": {"distance_m": base.surveyor.distance_m, "height_m": base.surveyor.height_m,
                      "measured_per_cm2": meas},
           "distances_m": [float(x) for x in base.targets.distances_m],
           "hardware_heights_m": HARDWARE_HEIGHTS, "landers": [], "skipped": [],
           "branch_filter": ({"applied": True, "n_kept": finfo["n_kept"], "n_total": finfo["n_total"],
                              "rule": finfo["rule"], "kept": finfo["kept"]} if keep
                             else {"applied": False})}

    for name, thrust in E.SCENARIOS:
        cfg = base.with_(**{"engine.thrust_n": thrust})
        if not S.is_cached(cfg):
            out["skipped"].append(name)
            print(f"[export] {name}: not cached yet, skipped")
            continue
        runs = S.run_set(cfg)
        entry = {"name": name, "thrust_N": thrust, "by_height": {}}
        for z in HARDWARE_HEIGHTS:
            R, exposures, excluded = S.anchored_exposure(runs, z_target=z)
            main_ = summarize(R, pick(exposures), meas)
            main_["n_excluded"] = len(excluded)
            main_["all_branches"] = summarize(R, exposures, meas)
            # per-variant curves: the app derives its rings from these with
            # the same per-variant method as psi_study.distance_band
            main_["branches"] = {k: [float(f"{x:.3g}") for x in v] for k, v in exposures.items()}
            entry["by_height"][f"{z:g}"] = main_
        out["landers"].append(entry)
        print(f"[export] {name}: {len(pick(exposures))} of {len(exposures)} variants used")

    # Repeated landings
    rep_cfg = base.with_(**{"engine.thrust_n": REPEAT_THRUST_N})
    rep_runs = S.run_set(rep_cfg) if S.is_cached(rep_cfg) else None
    if rep_runs:
        out["repeated_landings"] = {"thrust_N": REPEAT_THRUST_N, "by_count": {}}
        for n in E.LANDING_COUNTS:
            R, exposures, _ = S.anchored_exposure(rep_runs, n_landings=n)
            out["repeated_landings"]["by_count"][str(n)] = {
                f"{f:g}": band(R, pick(exposures), f * meas) for f in E.THRESHOLD_FRACTIONS}

    # Descent profile of the Apollo LM reference run: cumulative eroded mass vs
    # altitude (median over erosion laws), used by the replay animation.
    apollo_cfg = base.with_(**{"engine.thrust_n": S.APOLLO_LM_THRUST_N})
    ref_runs = rep_runs or (S.run_set(apollo_cfg) if S.is_cached(apollo_cfg) else None)
    if ref_runs:
        first = next(iter(ref_runs.values()))
        mh = first.reference["mass_eroded_by_h"]
        fractions = [np.cumsum(kg) / np.sum(kg) for kg in mh["kg"].values() if np.sum(kg) > 0]
        out["descent_profile"] = {
            "thrust_N": S.APOLLO_LM_THRUST_N,
            "descent_rate_m_s": first.cfg.descent.rate_m_s,
            "h_m": [float(h) for h in mh["h_m"]],
            "cum_fraction": [round(float(x), 4) for x in np.median(fractions, axis=0)],
            "total_kg": {law: round(float(np.sum(kg)), 1) for law, kg in mh["kg"].items()},
            "note": "median over erosion laws; rings in the replay scale with this fraction",
        }

    # Mitigation, recomputed from the cache with the same variant filter
    mit = {"threshold_x_surveyor": M.THRESHOLD, "filtered": bool(keep),
           "practical_distance": {}, "all_branches": {}, "missing": []}
    for thrust in M.THRUSTS:
        for label, changes, z in M.CASES:
            key = f"{thrust / 1000:g} kN | {label}"
            cfg = base.with_(**changes, **{"engine.thrust_n": thrust})
            if not S.is_cached(cfg):
                mit["missing"].append(key)
                continue
            R, exposures, _ = S.anchored_exposure(S.run_set(cfg), z_target=z)
            mit["practical_distance"][key] = band(R, pick(exposures), M.THRESHOLD * meas)
            mit["all_branches"][key] = band(R, exposures, M.THRESHOLD * meas)
    if mit["practical_distance"]:
        out["mitigation"] = mit
    if mit["missing"]:
        print(f"[export] mitigation: {len(mit['missing'])} cases not cached yet, skipped")

    path = HERE / "app_data.json"
    S.write_json(path, out)
    print(f"wrote {path}")


if __name__ == "__main__":
    main()