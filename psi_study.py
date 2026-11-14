"""Shared calculations for the escalation and sensitivity studies.

Each scenario is compared with the same model branch at Apollo 12's Surveyor III
geometry. The ratio is scaled by the measured pit density:

    anchored(d, z) = density_scenario(d, z) / density_LM(d_S, z_S) * N_measured

This anchors the result to Surveyor III and uses the model to estimate changes
with distance, target height, thrust and landing count. Errors common to both
runs may partly cancel.

Exposure from repeated landings is assumed to add linearly. Crater growth and
pad degradation are not modelled.

Variant filter: by default only the model variants listed in
plausible_branches.json are used (written by pit_calibration.py: the variants
whose calibrated pit counts can match the Surveyor III coupons). Without that
file, or with only_plausible=False, all variants are used.
"""
from __future__ import annotations

import json
import os

import numpy as np

import psi_simulation as P

# Reduced resolution for quick looks and the sensitivity study.
QUICK = dict(n_D=12, n_r=45, dh_m=2.0, mc_particles_per_model=50_000)
VELOCITY_MODELS = ("integrated", "fig5")
APOLLO_LM_THRUST_N = 11600.0
MITIGATION_KEYS = ("pad_radius_m", "berm_radius_m", "berm_height_m")
PLAUSIBLE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                              "plausible_branches.json")


def plausible_branches():
    """Set of variant keys ("velocity_model|law|angle") kept by pit_calibration.py,
    or None if the file does not exist yet."""
    if not os.path.exists(PLAUSIBLE_FILE):
        return None
    with open(PLAUSIBLE_FILE, encoding="utf-8") as f:
        return set(json.load(f)["kept"])


def nearest(values, x):
    return int(np.argmin(np.abs(np.asarray(values, float) - x)))


def run_set(overrides, velocity_models=VELOCITY_MODELS, quick=False, cache_dir=None):
    """Run the Apollo LM reference and one scenario for each velocity model.

    Returns {velocity_model: (cfg_scenario, res_scenario, res_reference)}.
    Reference runs differ from the scenario only in thrust, so any other
    override (plume, regolith, angles...) applies to both and cancels as far
    as the physics allows.
    """
    base = dict(QUICK) if quick else {}
    out = {}
    for vm in velocity_models:
        o = dict(base, **overrides, velocity_model=vm)
        cfg_s, _, res_s = P.simulate(o, cache_dir=cache_dir)
        # The anchor is what Apollo 12 did to Surveyor III: no pad, no berm.
        ref = {k: v for k, v in o.items() if k not in MITIGATION_KEYS}
        ref["thrust_N"] = APOLLO_LM_THRUST_N
        _, _, res_r = P.simulate(ref, cache_dir=cache_dir)
        out[vm] = (cfg_s, res_s, res_r)
    return out


def anchored_exposure(runs, z_target=None, anchor_distance=None, anchor_height=None,
                      n_landings=1.0, only_plausible=True):
    """Branch-wise anchored exposure vs distance, impacts per cm^2.

    Returns (distances, {tag: array}, excluded_tags). A branch is excluded when
    its own Apollo exposure at the anchor is zero (nothing to scale from).
    With only_plausible, variants missing from plausible_branches.json are
    left out as well (silently, they are not counted as excluded).
    """
    keep = plausible_branches() if only_plausible else None
    out, excluded = {}, []
    for vm, (cfg, res_s, res_r) in runs.items():
        z_list = cfg["target_heights_sensitivity_m"]
        R = np.asarray(cfg["target_distances_m"], float)
        iz = nearest(z_list, cfg["target_height_m"] if z_target is None else z_target)
        iza = nearest(z_list, cfg["surveyor_height_m"] if anchor_height is None else anchor_height)
        iRa = nearest(R, cfg["surveyor_distance_m"] if anchor_distance is None else anchor_distance)
        meas = cfg["pit_reference_per_cm2"]
        for tag, b in res_s["branches"].items():
            ref = np.asarray(res_r["branches"][tag]["density_total_per_cm2"])[iza, iRa]
            key = f"{vm}|{tag}"
            if keep is not None and key not in keep:
                continue
            if ref <= 0:
                excluded.append(key)
                continue
            dens = np.asarray(b["density_total_per_cm2"])[iz]
            out[key] = n_landings * dens / ref * meas
    return R, out, excluded


def practical_distance(R, y, threshold):
    """Find the last threshold crossing on the distance grid.

    Log-log interpolation at the last crossing. Returns R[0] if it is below
    everywhere, and +inf if it remains above threshold at the grid edge.
    Earlier dips do not count; exposure must stay below threshold beyond the
    returned distance.
    """
    R = np.asarray(R, float); y = np.asarray(y, float)
    above = np.where(y >= threshold)[0]
    if len(above) == 0:
        return float(R[0])
    i = above[-1]
    if i == len(R) - 1:
        return float("inf")
    y0, y1 = y[i], y[i + 1]
    if y1 <= 0 or y0 <= 0:
        return float(R[i + 1])
    f = (np.log(threshold) - np.log(y0)) / (np.log(y1) - np.log(y0))
    return float(np.exp(np.log(R[i]) + f * (np.log(R[i + 1]) - np.log(R[i]))))


def distance_band(R, exposures, threshold):
    """Practical distance per branch, and its spread across branches."""
    d = np.array([practical_distance(R, y, threshold) for y in exposures.values()])
    finite = np.isfinite(d)
    return {
        "per_branch": dict(zip(exposures.keys(), d.tolist())),
        "min": float(np.min(d)), "median": float(np.median(d)), "max": float(np.max(d)),
        "n_beyond_grid": int((~finite).sum()), "n": int(len(d)),
    }


def fmt_distance(d, grid_max):
    if not np.isfinite(d):
        return f">{grid_max/1000:g} km"
    return f"{d/1000:.2f} km" if d >= 1000 else f"{d:.0f} m"