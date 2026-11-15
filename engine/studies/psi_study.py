"""Shared helpers for escalation.py and mitigation.py.

The central idea: never trust the model's ABSOLUTE impact density. Instead,
for every branch, divide a scenario's exposure by the SAME branch's exposure
for the Apollo 12 LM at Surveyor III's own geometry, then multiply by what
Surveyor III actually recorded:

    anchored(d, z) = density_scenario(d, z) / density_LM(d_S, z_S) * N_measured

Surveyor III sets the absolute scale; the model only supplies the scaling with
distance, hardware height, thrust and number of landings. Calibration errors
common to both runs (erosion coefficient, damage law, plume model) cancel.

Repeated landings: fluence is assumed to add linearly, so n landings give
n times the single-landing exposure. No published study quantifies this;
crater deepening and pad degradation are NOT modelled.
"""
from __future__ import annotations

import json
import math
import os
import time
import warnings
from concurrent.futures import ProcessPoolExecutor, as_completed
from typing import NamedTuple

import numpy as np

import engine.psi.psi_simulation as P
from engine.psi.config import Config, Mitigation, VelocityModels, RESULTS_DIR

HERE = os.path.dirname(os.path.abspath(__file__))

# Reduced resolution for quick looks.
QUICK = {"regolith.n_size_bins": 12, "source.n_rings": 45, "descent.height_step_m": 2.0,
         "monte_carlo.particles_per_branch": 50_000}
VELOCITY_MODELS = tuple(VelocityModels)
# The anchor is always the Apollo LM, whatever the config's default thrust is.
APOLLO_LM_THRUST_N = 11_600.0
# Optional branch filter written by pit_calibration.py. Only export_app_data.py
# applies it; escalation.py and mitigation.py always report every branch.
PLAUSIBLE_FILE = RESULTS_DIR / "plausible_branches.json"
# Configurations computed side by side by prefetch(). Each one's source stage
# runs on one core and its Monte Carlo stage shares the cores with the others.
# Override with the environment variable PSI_JOBS (1 = one after another).
JOBS = int(os.environ.get("PSI_JOBS", 0)) or max(1, min(4, (os.cpu_count() or 1) // 4))


class Run(NamedTuple):
    cfg: Config          # the scenario's configuration
    scenario: dict       # its results
    reference: dict      # results for the Apollo LM, same physics, no mitigation


def base_config(quick: bool) -> Config:
    return Config().with_(**QUICK) if quick else Config()


def nearest(values, x) -> int:
    return int(np.argmin(np.abs(np.asarray(values, float) - x)))


def reference_config(scenario: Config) -> Config:
    """The anchor run for a scenario: what Apollo 12 did to Surveyor III, i.e.
    the Apollo LM with the same physics and no pad or berm."""
    return scenario.with_(**{"engine.thrust_n": APOLLO_LM_THRUST_N, "mitigation": Mitigation()})


def run_set(cfg: Config, velocity_models=VELOCITY_MODELS, cache_dir=None) -> dict:
    """Run a scenario and its Apollo LM reference for each velocity model.

    The reference differs from the scenario only in thrust and mitigation, so
    every other choice applies to both and cancels as far as the physics allows.
    """
    out = {}
    for vm in velocity_models:
        scenario = cfg.with_(**{"velocity.model": vm})
        out[vm] = Run(scenario, P.simulate(scenario, cache_dir=cache_dir),
                      P.simulate(reference_config(scenario), cache_dir=cache_dir))
    return out


def run_set_configs(cfg: Config, velocity_models=VELOCITY_MODELS) -> list[Config]:
    """Every configuration run_set(cfg) needs: scenario and reference per model."""
    out = []
    for vm in velocity_models:
        scenario = cfg.with_(**{"velocity.model": vm})
        out += [scenario, reference_config(scenario)]
    return out


def describe(cfg: Config) -> str:
    m = cfg.mitigation
    extra = (f", pad {m.pad_radius_m:g} m" if m.pad_radius_m else "") + \
            (f", berm {m.berm_height_m:g} m at {m.berm_radius_m:g} m" if m.berm_height_m else "")
    return f"{cfg.engine.thrust_n / 1000:g} kN, {cfg.velocity.model.value}{extra}"


def _simulate_in_worker(cfg: Config, cache_dir, threads: int) -> None:
    P.set_threads(threads)
    P.simulate(cfg, cache_dir=cache_dir)


def prefetch(configs, cache_dir=None, jobs=None, label="prefetch") -> None:
    """Compute every configuration that is not cached yet, `jobs` at a time in
    separate processes, so the study loop afterwards only reads the cache.
    Results are identical to running them one after another."""
    jobs = jobs or JOBS
    todo = {}
    for c in configs:
        if not P.is_completed(c, cache_dir):
            todo.setdefault(P.run_directory(c, cache_dir), c)
    if not todo:
        return
    t0 = time.time()
    print(f"[{label}] {len(todo)} configurations to compute, {min(jobs, len(todo))} at a time")
    if jobs <= 1 or len(todo) == 1:
        for i, c in enumerate(todo.values(), 1):
            P.simulate(c, cache_dir=cache_dir)
            print(f"[{label}] {i}/{len(todo)} {describe(c)}  ({time.time() - t0:.0f} s)")
        return
    threads = max(1, (os.cpu_count() or 1) // jobs)
    with ProcessPoolExecutor(max_workers=jobs) as pool:
        futures = {pool.submit(_simulate_in_worker, c, cache_dir, threads): c for c in todo.values()}
        for i, f in enumerate(as_completed(futures), 1):
            f.result()
            print(f"[{label}] {i}/{len(todo)} {describe(futures[f])}  ({time.time() - t0:.0f} s)")


def is_cached(cfg: Config, velocity_models=VELOCITY_MODELS, cache_dir=None) -> bool:
    """True if run_set(cfg) would only read the cache."""
    return all(P.is_completed(c, cache_dir) for c in run_set_configs(cfg, velocity_models))


def load_branch_filter():
    """(set of kept branch keys, file contents), or (None, None) if
    pit_calibration.py has not written a filter."""
    if not os.path.exists(PLAUSIBLE_FILE):
        return None, None
    with open(PLAUSIBLE_FILE, encoding="utf-8") as f:
        info = json.load(f)
    return set(info["kept"]), info


def anchored_exposure(runs: dict, z_target=None, n_landings=1.0):
    """Branch-wise anchored exposure vs distance, impacts per cm^2.

    Returns (distances, {"<velocity model>|<law>|<angle>": array}, excluded).
    A branch is excluded when its own Apollo exposure at the anchor is zero
    (nothing to scale from).
    """
    out, excluded = {}, []
    for vm, run in runs.items():
        tg, sv = run.cfg.targets, run.cfg.surveyor
        R = np.asarray(tg.distances_m, float)
        iz = nearest(tg.heights_m, tg.hardware_height_m if z_target is None else z_target)
        iz_anchor, iR_anchor = nearest(tg.heights_m, sv.height_m), nearest(R, sv.distance_m)
        for tag, branch in run.scenario["branches"].items():
            key = f"{vm.value}|{tag}"
            ref = np.asarray(run.reference["branches"][tag]["density_total_per_cm2"])[iz_anchor, iR_anchor]
            if ref <= 0:
                excluded.append(key)
                continue
            density = np.asarray(branch["density_total_per_cm2"])[iz]
            out[key] = n_landings * density / ref * sv.pit_density_per_cm2
    return R, out, excluded


def practical_distance(R, y, threshold) -> float:
    """Smallest distance beyond which exposure stays below threshold.

    Log-log interpolation at the last crossing. Returns R[0] if it is below
    everywhere on the grid and +inf if it never drops below within the grid.
    Close-in dips (the ejecta sheet passing below or above a target) do not
    count: hardware must be safe at every distance beyond the answer.
    """
    R, y = np.asarray(R, float), np.asarray(y, float)
    above = np.where(y >= threshold)[0]
    if len(above) == 0:
        return float(R[0])
    i = above[-1]
    if i == len(R) - 1:
        return math.inf
    y0, y1 = y[i], y[i + 1]
    if y1 <= 0 or y0 <= 0:
        return float(R[i + 1])
    f = (np.log(threshold) - np.log(y0)) / (np.log(y1) - np.log(y0))
    return float(np.exp(np.log(R[i]) + f * (np.log(R[i + 1]) - np.log(R[i]))))


def distance_band(R, exposures: dict, threshold) -> dict:
    """Practical distance per branch, and its spread across branches."""
    d = np.array([practical_distance(R, y, threshold) for y in exposures.values()])
    return {
        "per_branch": dict(zip(exposures.keys(), d.tolist())),
        "min": float(np.min(d)), "median": float(np.median(d)), "max": float(np.max(d)),
        "n_beyond_grid": int((~np.isfinite(d)).sum()), "n": int(len(d)),
    }


def exposure_envelope(R, exposures: dict) -> dict:
    """Min / median / max across branches at each distance. Branches with no
    hits at a distance are left out there, so the median is of nonzero values."""
    stack = np.array(list(exposures.values()))
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)    # all-NaN columns
        positive = np.where(stack > 0, stack, np.nan)
        return {"distances_m": np.asarray(R).tolist(),
                "min_per_cm2": np.nanmin(positive, axis=0).tolist(),
                "median_per_cm2": np.nanmedian(positive, axis=0).tolist(),
                "max_per_cm2": np.nanmax(positive, axis=0).tolist()}


def fmt_distance(d, grid_max) -> str:
    if not np.isfinite(d):
        return f">{grid_max / 1000:g} km"
    return f"{d / 1000:.2f} km" if d >= 1000 else f"{d:.0f} m"


def _strict(obj):
    """NaN and +-inf -> null, numpy scalars -> Python, so browsers can parse it."""
    if isinstance(obj, dict):
        return {str(k): _strict(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_strict(v) for v in obj]
    if isinstance(obj, np.generic):
        obj = obj.item()
    if isinstance(obj, float) and not math.isfinite(obj):
        return None
    return obj


def write_json(path, obj):
    """Write strict JSON: plain json.dump would emit NaN / Infinity, which
    JSON.parse rejects. null means "beyond the grid edge" for a distance and
    "no branch hits here" for an exposure."""
    p = RESULTS_DIR / path if isinstance(path, str) else path
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(_strict(obj), f, indent=1, allow_nan=False)