#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Export compact app data (app_data.json) from cached simulation runs.

Reads the same cached runs as escalation.py and mitigation.py (run those
first; this script then only post-processes and finishes in seconds). It does
not change psi_simulation.py or its physics, and it never starts a simulation:
configurations that are not cached yet are skipped with a message.

Variant filter: the app's main numbers use only the model variants listed in
plausible_branches.json (variants whose calibrated pit counts match Surveyor
III, see pit_calibration.py). Results over all variants are kept alongside
under "all_branches" for comparison.

    python export_app_data.py --quick     # after escalation.py/mitigation.py --quick
    python export_app_data.py             # after the full-resolution runs
"""
from __future__ import annotations

import argparse, json, os
from datetime import datetime, timezone

import numpy as np

import psi_simulation as P
import psi_study as S
import escalation as E
import mitigation as M
import pit_spectrum as PS

HERE = os.path.dirname(os.path.abspath(__file__))
# -3 m = Surveyor III's crater setting (the anchor height); the rest are
# hardware heights above flat ground.
HARDWARE_HEIGHTS = [-3.0, 0.0, 1.5, 3.0, 5.0, 8.0]
MIT_THRUSTS, MIT_THRESHOLD, MIT_CASES = M.THRUSTS, M.THRESHOLD, M.CASES


def load_filter():
    if not os.path.exists(S.PLAUSIBLE_FILE):
        return None, None
    with open(S.PLAUSIBLE_FILE, encoding="utf-8") as f:
        info = json.load(f)
    return set(info["kept"]), info


def is_cached(overrides, quick):
    """True if run_set(overrides) would only read the cache (scenario + Apollo reference)."""
    for vm in S.VELOCITY_MODELS:
        o = dict(dict(S.QUICK) if quick else {}, **overrides, velocity_model=vm)
        ref = {k: v for k, v in o.items() if k not in S.MITIGATION_KEYS}
        ref["thrust_N"] = S.APOLLO_LM_THRUST_N
        for ov in (o, ref):
            cfg = dict(P.CONFIG); cfg.update(ov)
            if PS.cached_checkpoint(cfg) is None:
                return False
    return True


def envelope(exposures):
    if not exposures:
        return {"min": None, "median": None, "max": None}
    st = np.array(list(exposures.values()), float)
    with np.errstate(invalid="ignore", all="ignore"):
        pos = np.where(st > 0, st, np.nan)
        lo, md, hi = np.nanmin(pos, 0), np.nanmedian(pos, 0), np.nanmax(pos, 0)
    clean = lambda a: [None if not np.isfinite(x) else float(f"{x:.4g}") for x in a]
    return {"min": clean(lo), "median": clean(md), "max": clean(hi)}


def band(b):
    f = lambda x: None if not np.isfinite(x) else round(float(x), 1)
    return {"min": f(b["min"]), "median": f(b["median"]), "max": f(b["max"]),
            "n_beyond_grid": b["n_beyond_grid"], "n": b["n"]}


def summarize(R, exp_, meas, fractions):
    return {"exposure": envelope(exp_),
            "distance_bands": {f"{f:g}": band(S.distance_band(R, exp_, f * meas)) for f in fractions},
            "n_branches": len(exp_)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    a = ap.parse_args()

    keep, finfo = load_filter()
    pick = (lambda d: {k: v for k, v in d.items() if k in keep}) if keep else (lambda d: d)

    out = {"generated": datetime.now(timezone.utc).isoformat(), "quick": a.quick,
           "units": "impacts per cm^2 per landing, anchored to Surveyor III",
           "thresholds_x_surveyor": E.THRESHOLD_FRACTIONS,
           "validated_max_thrust_N": E.VALIDATED_MAX_THRUST_N,
           "hardware_heights_m": HARDWARE_HEIGHTS, "landers": [], "skipped": [],
           "branch_filter": ({"applied": True, "n_kept": finfo["n_kept"], "n_total": finfo["n_total"],
                              "rule": finfo["rule"], "kept": finfo["kept"]} if keep else {"applied": False})}

    meas = None
    for name, thrust in E.SCENARIOS:
        if not is_cached({"thrust_N": thrust}, a.quick):
            out["skipped"].append(name); print(f"[export] {name}: not cached yet, skipped"); continue
        runs = S.run_set({"thrust_N": thrust}, quick=a.quick)
        cfg = runs[S.VELOCITY_MODELS[0]][0]
        meas = cfg["pit_reference_per_cm2"]
        out.setdefault("anchor", {"distance_m": cfg["surveyor_distance_m"],
                                  "height_m": cfg["surveyor_height_m"],
                                  "measured_per_cm2": meas})
        entry = {"name": name, "thrust_N": thrust, "by_height": {}}
        for z in HARDWARE_HEIGHTS:
            R, exp_all, excl = S.anchored_exposure(runs, z_target=z, only_plausible=False)
            out.setdefault("distances_m", [float(x) for x in R])
            main_ = summarize(R, pick(exp_all), meas, E.THRESHOLD_FRACTIONS)
            main_["n_excluded"] = len(excl)
            main_["all_branches"] = summarize(R, exp_all, meas, E.THRESHOLD_FRACTIONS)
            # per-variant curves: the app derives its rings from these with
            # the same per-variant method as psi_study.distance_band
            main_["branches"] = {k: [float(f"{x:.3g}") for x in np.asarray(v, float)]
                                 for k, v in exp_all.items()}
            entry["by_height"][f"{z:g}"] = main_
        out["landers"].append(entry)
        print(f"[export] {name}: {len(pick(exp_all))} of {len(exp_all)} variants used")

    # Repeated landings (same thrust class as escalation.py's default panel)
    rep_T = 44000.0
    rep_runs = None
    if is_cached({"thrust_N": rep_T}, a.quick):
        rep_runs = S.run_set({"thrust_N": rep_T}, quick=a.quick)
        out["repeated_landings"] = {"thrust_N": rep_T, "by_count": {}}
        for n in E.LANDING_COUNTS:
            R, exp_n, _ = S.anchored_exposure(rep_runs, n_landings=n, only_plausible=False)
            out["repeated_landings"]["by_count"][str(n)] = {
                f"{f:g}": band(S.distance_band(R, pick(exp_n), f * meas)) for f in E.THRESHOLD_FRACTIONS}

    # Descent profile of the Apollo LM reference run: cumulative eroded mass vs
    # altitude (median over erosion laws), used by the replay animation.
    ref_runs = rep_runs or (S.run_set({"thrust_N": S.APOLLO_LM_THRUST_N}, quick=a.quick)
                            if is_cached({"thrust_N": S.APOLLO_LM_THRUST_N}, a.quick) else None)
    if ref_runs:
        first = next(iter(ref_runs.values()))
        mh = first[2]["mass_eroded_by_h"]
        fr = [np.cumsum(kg) / np.sum(kg) for kg in mh["kg"].values() if np.sum(kg) > 0]
        out["descent_profile"] = {
            "thrust_N": S.APOLLO_LM_THRUST_N,
            "descent_rate_m_s": float(first[0]["descent_rate_m_s"]),
            "h_m": [float(h) for h in mh["h_m"]],
            "cum_fraction": [round(float(x), 4) for x in np.median(fr, axis=0)],
            "total_kg": {m: round(float(np.sum(kg)), 1) for m, kg in mh["kg"].items()},
            "note": "median over erosion laws; rings in the replay scale with this fraction",
        }

    # Mitigation, recomputed from the cache with the same variant filter
    mit = {"threshold_x_surveyor": MIT_THRESHOLD, "filtered": bool(keep),
           "practical_distance": {}, "all_branches": {}, "missing": []}
    for T in MIT_THRUSTS:
        for label, ovr, z in MIT_CASES:
            key = f"{T/1000:g} kN | {label}"
            o = dict(ovr, thrust_N=T)
            if not is_cached(o, a.quick):
                mit["missing"].append(key); continue
            runs = S.run_set(o, quick=a.quick)
            R, exp_all, _ = S.anchored_exposure(runs, z_target=z, only_plausible=False)
            m0 = next(iter(runs.values()))[0]["pit_reference_per_cm2"]
            mit["practical_distance"][key] = band(S.distance_band(R, pick(exp_all), MIT_THRESHOLD * m0))
            mit["all_branches"][key] = band(S.distance_band(R, exp_all, MIT_THRESHOLD * m0))
    if mit["practical_distance"]:
        out["mitigation"] = mit
    if mit["missing"]:
        print(f"[export] mitigation: {len(mit['missing'])} cases not cached yet, skipped")

    path = os.path.join(HERE, "app_data.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
