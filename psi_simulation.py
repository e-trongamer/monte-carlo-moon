#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Monte Carlo model of the Apollo 12 lunar-module plume and regolith.

Run with ``python psi_simulation.py``. The script resumes from its checkpoint;
use ``--reset`` to start over or ``--max-steps`` to pause the source-grid pass.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
import time
import uuid
from datetime import datetime, timezone

import numpy as np
from scipy.special import erf, ndtri

try:
    # used for acceleration and caching
    from numba import get_num_threads, get_thread_id, njit, prange
    NUMBA_AVAILABLE = True
except ImportError:
    NUMBA_AVAILABLE = False

    def njit(*args, **kwargs):
        def decorate(func):
            return func
        return decorate

    def prange(*args):
        return range(*args)

    def get_num_threads():
        return 1

    def get_thread_id():
        return 0

CONFIG = {
    # Environment
    "g_moon": 1.62,
    "R_moon_m": 1.7374e6,
    "v_escape_m_s": 2380.0,

    # Lander / engine (Apollo LM DPS, final hover)
    # LMDE exit conditions are not available in the sources used here.
    # Chang'e-5 ground-test values are an alternative if a measured plume is
    # preferred.
    "thrust_N": 11600.0,
    "v_exhaust": 3050.0,
    "T0_K": 2900.0,
    "gamma": 1.24,
    "R_gas": 400.0,
    "plume_cos_exponent": 4.0,
    "T_wall_K": 300.0,
    "recovery_factor": 0.85,
    "mu_ref": 1.663e-5, "T_ref": 273.15, "S_suth": 107.0,

    # Descent
    "h_start_m": 34.0, "h_end_m": 2.0, "dh_m": 0.5, "descent_rate_m_s": 0.5,

    # Regolith
    "rho_particle": 3100.0,
    "rho_bulk": 1500.0,              # bulk density, for the energy-flux law
    "psd_D50_mass_um": 70.0,
    "psd_sigma_g": 3.0,
    "D_min_um": 1.0, "D_max_um": 500.0, "n_D": 40,
    "shields_A_N": 0.0123,
    "cohesion_gamma_N_m": 3.0e-4,
    # Shao & Lu (2000) is a terrestrial aeolian threshold. Its minimum
    # sits at sqrt(gamma/(rho g)) = 244 um, so fines are the hardest to lift.
    # Only the "scaling" and "roberts" branches use it; "energy_flux" does not.

    # Erosion branch (a): shear scaling law, Lane & Metzger 2015
    # 0.0222 is tied to the earlier 2.6 t Apollo calibration.
    # Metzger & Mantovani later used 0.03119. Current estimate is 11-26 t.
    "mdot_coeff": 0.0222, "mdot_exp": 2.52,

    # Erosion branch (c): Metzger 2024 energy-flux law
    #   mdot = rho_b * eps * (E - E_th) / (rho_b * g * <D> + alpha)
    #   E    = rho_g * v_g^2 * v_thermal / 12
    # Epsilon was fitted against Metzger's CFD flow field, not the point-source
    # plume used here. The coefficient and gas model should be treated as a pair.
    "ef_epsilon": 0.0029,
    "ef_E_th_W_m2": 0.123,
    "ef_Dmean_over_D84": 1.5,
    "ef_alpha0_J_m3": 0.289,
    "ef_calibrated_epsilon": None,   # filled in by the mass calibration below
    # Calibrate epsilon to the literature mass estimate; pit density is then
    # an output rather than a calibration target.
    "ef_calibrate_to_mass_t": 18.0,   # midpoint of Metzger 2024's 11-26 t
    "ef_calibrate": True,
    "ef_reference_overrides": 
        {
            "thrust_N": 11600.0, 
            "h_start_m": 34.0, 
            "h_end_m": 2.0,
            "descent_rate_m_s": 0.5,
        },

    # Erosion branches to run
    "erosion_models": ["scaling", "roberts", "energy_flux"],

    # Radial grid
    "r_min_m": 0.05, "r_max_m": 120.0, "n_r": 140,

    # Drag is integrated over a path length from each grain's launch point.
    # The 10 m reference follows the Lagrangian PTM study (Fig. 8). For other
    # vehicles the path length scales with nozzle size, approximated as
    # thrust^0.5; set the exponent to zero to keep it fixed.
    "r_accel_path_m": 10.0,
    "r_accel_path_thrust_exp": 0.5,
    "ds_rel": 0.02,

    # Velocity branch: "integrated" (drag model) or "fig5" (drag-model
    # launch-radius profile, rescaled to Lane & Metzger Fig. 5's maximum).
    "velocity_model": "integrated",

    # Lane & Metzger 2015, arXiv:1503.00154.
    #
    # ---- Fig. 5, digitized --------------------------------------
    # Traced with WebPlotDigitizer: 11 contours (16-1600 m/s, 133 points) plus
    # the no-lift edge (13 points); see fig5_traces/ and fig5_analyze.py.
    # Computing K = u*sqrt(D_um) at every traced point, all 11 contours collapse
    # onto ONE curve: at every height from 0.8 to 45 m the contours scatter by
    # about 1% (SD; at most 1.7%, full range up to ~6% near the knee). So the
    # figure is separable to within tracing accuracy:
    #
    #     u(h, D) = K(h) / sqrt(D_um)          [m/s, D in microns, h in m]
    #     K(h)    = K0 * (1 + (h/h_k)^(n*s))^(-1/s)
    #
    # Fitted to all 133 points: K0 = 2054 m/s*um^0.5, h_k = 3.32 m, n = 0.913,
    # s = 36 (i.e. an almost sharp corner). Median residual 1.2%, max 5.1%.
    # Physically: below ~3.3 m the nozzle height does not matter; above it the
    # speed of every size class falls as h^-0.91.
    "lm_use_fig5": True,
    "lm_fig5_K0": 2054.0, "lm_fig5_hk_m": 3.32, "lm_fig5_n": 0.913, "lm_fig5_s": 36.0,
    # No-lift edge, straight in log-log (median residual 1.7% in D):
    #     log10(D_um) + c1*log10(h) > c0  ->  grains of that size do not lift
    # The fitted slope c1 = 3.58 matches the printed 3.53. The intercept does
    # not: 7.08 with D in um is 1.08 with D in m, against a printed 2.212.
    "lm_fig5_cut_c0": 7.082, "lm_fig5_cut_c1": 3.579,

    # Eq. 7 as printed. Retained for comparison; it does not match Fig. 5.
    #   u = 10^[(b1 + b2 log h) tanh(b3 + b4 log h)] / [b0 (h^(9/20) + D^(1/2))]
    # Constants verbatim from the paper.
    # The equation does not reproduce Fig. 5. Even with the
    # best overall scale it misses the traced contours by 18% median, 760% max
    # (D in um), or 84% median (D in m). The figure is exactly separable in D,
    # which a sum h^(9/20) + D^(1/2) cannot be; its K(h) is flat then falls as
    # h^-0.91, while the printed numerator RISES as h^+0.195 (the tanh is
    # saturated at 1 over the whole plotted range). Whatever the authors
    # plotted, it was not this expression as printed.
    "lm_b0": 0.2964, "lm_b1": -0.225, "lm_b2": 0.1954,
    "lm_b3": 5.0, "lm_b4": 4.343, "lm_c0": 2.212, "lm_c1": 3.53,
    "lm_denominator": "sum",
    "lm_D_units": "um",
    "lm_scale": 952.0,        # best single scale against the traces; not in the paper
    "lm_eta": 0.125,          # effective/maximum speed ratio, their Eq. 8
    "lm_theta_deg": 3.0,
    # eta*sin(theta) = 0.0065. This effective speed is for the optical-
    # extinction model; it is not a launch speed.

    # scaling Fig. 5 beyond the Apollo LM. 
    # ASSUMPTION, not from the paper. For an engine at the same chamber pressure and expansion ratio,
    # exit diameter De ~ thrust^0.5. The knee h_k (~2x the LM's De) is taken
    # ~ De, and K0 ~ sqrt(acceleration length) ~ De^0.5 ~ thrust^0.25, since
    # u ~ D^-1/2 is the signature of acceleration-length-limited drag.
    # Breaks down for multi-engine clusters and for cratering regimes.
    "fig5_ref_thrust_N": 11600.0,
    "fig5_K0_thrust_exp": 0.25,
    "fig5_hk_thrust_exp": 0.5,

    # Published anchor for the shape test, independent of Lane & Metzger:
    # NASA TM-20240003496 Fig. 20, single-engine plume at r = 70 m.
    "lm_anchor": 
        {
        "D_small_um": 0.8,
        "D_large_um": 11.0,
        "ratio": 2.5,
        "source": "NASA TM-20240003496 Fig. 20",
        },

    # Variation in ejection angle.
    # These Apollo mission angles are from Immer and Metzger's photogrammetry
    # (arXiv:2104.07669, Table 1). No error bars are reported for individual
    # angles, so each is treated as a separate scenario. Their spread represents
    # scenario uncertainty, separate from Monte Carlo sampling error.
    "angle_hypotheses_deg": [1.4, 2.0, 2.4, 2.6, 3.3, 8.1],
    "angle_nominal_deg": 3.3,
    "eject_angle_sd_deg": 0.5,
    # The within-sheet angular spread is not measured; 0.5 degrees is an
    # assumption, and results may depend on it.

    # mitigation geometry. 0 disables.
    "pad_radius_m": 0.0,      # no erosion source inside this radius
    "berm_radius_m": 0.0,     # ring berm around the landing site...
    "berm_height_m": 0.0,     # ...blocks trajectories below this crest height

    # Target
    "surveyor_distance_m": 155.0,
    # SP-284 gives 155 m. Metzger's estimate of about 3 divots/cm^2 uses 180 m.
    "target_height_m": 1.5,
    # Surveyor III sat several metres below the surrounding plain inside a
    # roughly 200 m crater; this height represents that setting.
    "surveyor_height_m": -3.0,
    "target_heights_sensitivity_m": [-6.0, -3.0, 0.0, 1.5, 3.0, 5.0, 8.0],
    "target_distances_m": [25, 50, 75, 100, 125, 155, 160, 180, 200, 250, 300,
                           400, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000],

    # Target material: Al alloy, ~107 HV
    "H_vickers_Pa": 1.05e9,
    "K_D": 1.0,
    # K_D is a placeholder. Sheldon & Kanhere's constant is an empirical
    # fit, not unity. The formula is dimensionally homogeneous (yields m^3) so
    # K_D is dimensionless. The pits measured on the returned Surveyor III
    # coupons are much larger than K_D=1 predicts (about 84 x 75 um across,
    # up to ~88 um deep). pit_calibration.py fits K_D per model branch against
    # 103 pits/cm^2; the median fitted value is ~130 (pits counted from 50 um)
    # to ~5700 (counted from 20 um), and only 18 of the 36 branches match the
    # measured pit count afterwards (plausible_branches.json).
    # Treat absolute depths from this file as order-of-magnitude estimates.

    # Monte Carlo
    "mc_particles_per_model": 10_000_000,
    "mc_seed": 20261107,
    "target_height_bin_m": 0.25,

    # Post-processing settings; these do not affect the simulation cache key.
    "damage_thresholds": [0.01, 0.001],
    "pit_reference_per_cm2": 103.0,
    # Used as a comparison reference, not to calibrate the impact model.
}

# ef_calibrated_epsilon is derived deterministically from the hashed keys, so
# it is excluded from the hash to avoid churn on resume.
POST_KEYS = {"damage_thresholds", "pit_reference_per_cm2", "ef_calibrated_epsilon"}
STATE_VERSION = 6


def config_hash(cfg: dict) -> str:
    sim = {k: v for k, v in cfg.items() if k not in POST_KEYS}
    return hashlib.sha256(json.dumps(sim, sort_keys=True).encode()).hexdigest()[:16]


# Grids
def build_grids(cfg):
    n_h = int(round((cfg["h_start_m"] - cfg["h_end_m"]) / cfg["dh_m"])) + 1
    h = np.linspace(cfg["h_start_m"], cfg["h_end_m"], n_h)
    dt = cfg["dh_m"] / cfg["descent_rate_m_s"]

    edges_D = np.logspace(math.log10(cfg["D_min_um"]), math.log10(cfg["D_max_um"]),
                          cfg["n_D"] + 1) * 1e-6
    D = np.sqrt(edges_D[:-1] * edges_D[1:])
    lnsg = math.log(cfg["psd_sigma_g"])
    ln_D50_mass = math.log(cfg["psd_D50_mass_um"] * 1e-6)
    # Number-weighted lognormal has its median shifted down by 3*ln^2(sigma_g)
    ln_D50_number = ln_D50_mass - 3 * lnsg ** 2

    cdf_mass = 0.5 * (1 + erf((np.log(edges_D) - ln_D50_mass) / (math.sqrt(2) * lnsg)))
    cdf_number = 0.5 * (1 + erf((np.log(edges_D) - ln_D50_number) / (math.sqrt(2) * lnsg)))

    w_mass = np.diff(cdf_mass)
    w_mass = w_mass / w_mass.sum()

    edges_r = np.geomspace(cfg["r_min_m"], cfg["r_max_m"], cfg["n_r"] + 1)
    r = np.sqrt(edges_r[:-1] * edges_r[1:])
    area_r = np.pi * (edges_r[1:] ** 2 - edges_r[:-1] ** 2)

    # Keep the number-weighted median for inverse-CDF sampling.
    return dict(h=h, dt=dt, D=D, edges_D=edges_D, cdf_D_number=cdf_number,
                w_mass=w_mass, r=r, edges_r=edges_r, area_r=area_r,
                D50_number_m=math.exp(ln_D50_number), ln_sigma=lnsg)


# Gas field and shear stress
def sutherland(T, cfg):
    return (cfg["mu_ref"] * (T / cfg["T_ref"]) ** 1.5
            * (cfg["T_ref"] + cfg["S_suth"]) / (T + cfg["S_suth"]))


def gas_field(r, h, cfg):
    """Gas state at the boundary-layer edge and wall shear stress at radius r."""
    r = np.maximum(np.asarray(r, float), 1e-4)
    F, ve, n = cfg["thrust_N"], cfg["v_exhaust"], cfg["plume_cos_exponent"]
    cp = cfg["gamma"] * cfg["R_gas"] / (cfg["gamma"] - 1)
    R2 = r * r + h * h
    c = h / np.sqrt(R2)
    s = r / np.sqrt(R2)
    phi = F * (n + 1) / (2 * np.pi * R2) * c ** n
    rho_inf = phi / ve ** 2
    p_w = rho_inf * (ve * c) ** 2
    u_e = ve * s
    # Here u_e approaches the exhaust speed at large radius, so the particle
    # acceleration path is limited (see r_accel_path_m).
    T_e = np.maximum(cfg["T0_K"] - u_e ** 2 / (2 * cp), 50.0)
    T_r = T_e + cfg["recovery_factor"] * u_e ** 2 / (2 * cp)
    T_ref = 0.5 * (T_e + cfg["T_wall_K"]) + 0.22 * (T_r - T_e)
    rho_ref = p_w / (cfg["R_gas"] * T_ref)
    mu_r = sutherland(T_ref, cfg)
    c_fs = 0.332 + (1.2326 - 0.332) * np.exp(-(r / h) ** 2)
    dvdz = c_fs * u_e * np.sqrt(np.maximum(u_e, 1e-9) * rho_ref / (mu_r * r))
    tau = mu_r * dvdz
    rho_e = np.maximum(p_w / (cfg["R_gas"] * T_e), rho_inf)
    # Molecular thermal speed and downward energy flux.
    v_thermal = np.sqrt(8 * cfg["R_gas"] * T_e / math.pi)
    E_flux = rho_e * u_e ** 2 * v_thermal / 12.0
    return dict(u=u_e, rho=rho_e, T=T_e, tau=tau, dvdz=dvdz, mu=mu_r, p_w=p_w,
                v_thermal=v_thermal, E=E_flux)


def tau_threshold(D, cfg):
    """Threshold shear stress (Shao & Lu 2000, terrestrial), lunar gravity."""
    return cfg["shields_A_N"] * (cfg["rho_particle"] * cfg["g_moon"] * D
                                 + cfg["cohesion_gamma_N_m"] / D)


def energy_flux_erosion(E, cfg):
    """Metzger 2024 Eq. 16; returns kg m^-2 s^-1."""
    eps = cfg["ef_calibrated_epsilon"] or cfg["ef_epsilon"]
    rho_b = cfg["rho_bulk"]
    D84 = cfg["psd_D50_mass_um"] * 1e-6 * cfg["psd_sigma_g"]
    D_mean = cfg["ef_Dmean_over_D84"] * D84
    denom = rho_b * cfg["g_moon"] * D_mean + cfg["ef_alpha0_J_m3"]
    return np.where(E > cfg["ef_E_th_W_m2"],
                    rho_b * eps * (E - cfg["ef_E_th_W_m2"]) / denom, 0.0)


def calibrate_epsilon(cfg, grids):
    """Solve for eps so the energy-flux branch reproduces a target total mass.

    mdot is linear in eps above threshold, so this is one pass and a division.
    Returns (eps_calibrated, uncalibrated_total_kg).
    """
    # Calibrate on the Apollo reference vehicle so scenarios share the anchor.
    ref = dict(cfg)
    ref.update(cfg.get("ef_reference_overrides") or {})
    ref["ef_calibrated_epsilon"] = None            # evaluate at the published eps
    grids = build_grids(ref)
    total = 0.0
    for h in grids["h"]:
        E = gas_field(grids["r"], h, ref)["E"]
        total += float((energy_flux_erosion(E, ref) * grids["area_r"]).sum() * grids["dt"])
    if total <= 0:
        return cfg["ef_epsilon"], 0.0
    target_kg = cfg["ef_calibrate_to_mass_t"] * 1000.0
    return cfg["ef_epsilon"] * target_kg / total, total


def lane_metzger_umax(h, D, cfg):
    """Lane & Metzger 2015 Eq. 7, maximum particle speed [m/s].

    u = 0                                           if log D + c1 log h > c0
    u = 10^[(b1 + b2 log h) tanh(b3 + b4 log h)] / [b0 (h^(9/20) + D^(1/2))]

    Height is in metres. The cutoff uses diameter in metres; the square-root
    term uses the configured units and scale. Those choices are reconstructions
    documented in CONFIG. The paper does not specify a logarithm base, so base
    10 is used.
    """
    h = np.maximum(np.asarray(h, float), 1e-6)
    D = np.maximum(np.asarray(D, float), 1e-12)
    if cfg.get("lm_use_fig5", True):
        return lane_metzger_fig5(h, D, cfg)
    log_h, log_D = np.log10(h), np.log10(D)
    cutoff = log_D + cfg["lm_c1"] * log_h > cfg["lm_c0"]
    expo = (cfg["lm_b1"] + cfg["lm_b2"] * log_h) * np.tanh(cfg["lm_b3"] + cfg["lm_b4"] * log_h)
    D_term = D * 1e6 if cfg["lm_D_units"] == "um" else D
    root_h = h ** (9 / 20)
    denom = (cfg["lm_b0"] * root_h * np.sqrt(D_term) if cfg["lm_denominator"] == "product"
             else cfg["lm_b0"] * (root_h + np.sqrt(D_term)))
    u = cfg["lm_scale"] * 10.0 ** expo / denom
    return np.where(cutoff, 0.0, u)


def lane_metzger_fig5(h, D, cfg):
    """Digitized Lane & Metzger (2015) Fig. 5: maximum particle speed [m/s].

    u = K(h)/sqrt(D_um), K(h) = K0 (1 + (h/h_k)^(n s))^(-1/s). Fitted to 133
    traced points on 11 contours, median error 1.2%. Valid for the plotted
    range h = 0.7-45 m, D = 1-10^4 um, for the Apollo LM descent engine.
    """
    h = np.maximum(np.asarray(h, float), 1e-6)
    D_um = np.maximum(np.asarray(D, float), 1e-12) * 1e6
    s = cfg["lm_fig5_s"]
    K = cfg["lm_fig5_K0"] * (1.0 + (h / cfg["lm_fig5_hk_m"]) ** (cfg["lm_fig5_n"] * s)) ** (-1.0 / s)
    u = K / np.sqrt(D_um)
    cutoff = np.log10(D_um) + cfg["lm_fig5_cut_c1"] * np.log10(h) > cfg["lm_fig5_cut_c0"]
    return np.where(cutoff, 0.0, u)


def thrust_ratio(cfg):
    """Thrust relative to the Apollo LM reference used by the scaling rules."""
    return cfg["thrust_N"] / cfg["fig5_ref_thrust_N"]


def lane_metzger_fig5_scaled(h, D, cfg):
    """Fig. 5 maximum speed, scaled to this run's thrust.

    Identical to lane_metzger_fig5 at the reference thrust. Elsewhere the knee
    moves as thrust^fig5_hk_thrust_exp and K0 as thrust^fig5_K0_thrust_exp,
    and the no-lift edge moves with the knee (same exit conditions, bigger
    nozzle -> same physics at the same h/De). This is an assumption; see CONFIG.
    """
    lam = thrust_ratio(cfg)
    lam_h = lam ** cfg["fig5_hk_thrust_exp"]
    lam_K = lam ** cfg["fig5_K0_thrust_exp"]
    h = np.maximum(np.asarray(h, float), 1e-6) / lam_h
    # No grain can outrun the gas. Fig. 5 tops out at 0.67 v_exhaust for the
    # LM, so the cap never binds there, but the scaled 1/sqrt(D) law overshoots
    # the exhaust speed for fines above ~60 kN.
    return np.minimum(lam_K * lane_metzger_fig5(h, D, cfg), cfg["v_exhaust"])


def lane_metzger_effective(h, D, cfg):
    """Effective ejection speed v = eta sin(theta) u_max (their Eq. 8)."""
    return (cfg["lm_eta"] * math.sin(math.radians(cfg["lm_theta_deg"]))
            * lane_metzger_umax(h, D, cfg))


FIG5_LEVELS = [16, 25, 40, 63, 100, 160, 250, 400, 630, 1000, 1600]


def load_fig5_traces(folder=None):
    """Read the WebPlotDigitizer traces (semicolon CSV, decimal commas).

    Returns arrays (u_contour [m/s], h [m], D [um]) or None if absent.
    """
    if folder is None:
        module_dir = os.path.dirname(os.path.abspath(__file__))
        folders = [
            os.path.join(module_dir, "fig5_traces"),
            os.path.join(os.path.dirname(module_dir), "fig5_traces"),
        ]
    else:
        folders = [folder]

    selected_files = None
    incomplete = None
    for candidate_folder in folders:
        if not os.path.isdir(candidate_folder):
            continue
        files = {}
        missing = []
        for u in FIG5_LEVELS:
            paths = (
                os.path.join(candidate_folder, f"{u}.csv"),
                os.path.join(candidate_folder, f"{u} (1).csv"),
            )
            path = next((p for p in paths if os.path.isfile(p)), None)
            if path is None:
                missing.append(u)
            else:
                files[u] = path
        if not missing:
            selected_files = files
            break
        if incomplete is None:
            incomplete = (candidate_folder, missing)
    if selected_files is None:
        if incomplete is not None:
            path, missing = incomplete
            raise FileNotFoundError(
                f"Incomplete Fig. 5 traces in {path}; missing contours: "
                + ", ".join(map(str, missing))
            )
        return None

    rows = []
    for u in FIG5_LEVELS:
        with open(selected_files[u], encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    hh, dd = (float(x.replace(",", ".")) for x in line.split(";"))
                    rows.append((u, hh, dd))
    return np.array(rows).T if rows else None


def lane_metzger_check(cfg, grids, h=None):
    """Score the active L&M branch against the traced Fig. 5 contours.

    Every traced point is a (h, D) where the published u equals the contour
    value, so the branch is evaluated there and compared directly.
    Returns (ok, message, diagnostics).
    """
    tr = load_fig5_traces()
    diag = {"branch": "fig5" if cfg.get("lm_use_fig5", True) else "eq7_as_printed"}
    if tr is None:
        return False, "L&M check: fig5_traces/ not found; branch unvalidated.", diag
    u_obs, h_tr, D_tr = tr
    u_mod = lane_metzger_umax(h_tr, D_tr * 1e-6, cfg)
    on = u_mod > 0
    err = np.abs(u_mod[on] / u_obs[on] - 1.0)
    cutoff_margin = (
        np.log10(D_tr) + cfg["lm_fig5_cut_c1"] * np.log10(h_tr)
        - cfg["lm_fig5_cut_c0"]
    )
    cutoff_mismatch = (~on) & (cutoff_margin > 0.01)
    diag.update(n_points=int(len(u_obs)), n_cut_off=int(cutoff_mismatch.sum()),
                n_cutoff_within_tolerance=int(((~on) & ~cutoff_mismatch).sum()),
                median_err_pct=float(100 * np.median(err)),
                max_err_pct=float(100 * np.max(err)))
    ok = diag["median_err_pct"] < 5.0 and diag["n_cut_off"] == 0
    msg = (f"L&M branch '{diag['branch']}' vs {diag['n_points']} traced Fig. 5 "
           f"points: median error {diag['median_err_pct']:.1f}%, max "
           f"{diag['max_err_pct']:.0f}%"
           + (f", {diag['n_cut_off']} points wrongly in the no-lift region"
              if diag["n_cut_off"] else "")
           + (". Fit is within tolerance." if ok else ". Fit is outside tolerance."))
    return ok, msg, diag


# Backwards-compatible alias
def lane_metzger_sanity(cfg, grids):
    ok, msg, _ = lane_metzger_check(cfg, grids)
    return ok, msg


# Particle acceleration
def drag_coefficient(Re, Kn, s, T_ratio):
    Re = np.maximum(Re, 1e-8)
    c_cont = 24.0 / Re * (1 + 0.15 * Re ** 0.687) + 0.42 / (1 + 42500.0 * Re ** -1.16)
    s = np.maximum(s, 1e-2)
    c_fm = ((2 * s ** 2 + 1) / (math.sqrt(math.pi) * s ** 3) * np.exp(-s ** 2)
            + (4 * s ** 4 + 4 * s ** 2 - 1) / (2 * s ** 4) * erf(s)
            + 2 * math.sqrt(math.pi) / (3 * s) * np.sqrt(T_ratio))
    return (c_cont + Kn * c_fm) / (1 + Kn)


def acceleration_path_m(cfg):
    """Drag-integration path length for this vehicle."""
    return cfg["r_accel_path_m"] * thrust_ratio(cfg) ** cfg["r_accel_path_thrust_exp"]


def ejection_velocity(r0, D, h, cfg):
    """Integrate dv/dt = 3 C_D rho_g |w| w / (4 rho_p D) from r0 to r0 + L.

    The path length starts at each grain's launch point, including grains
    launched far from the nozzle.
    """
    rho_p = cfg["rho_particle"]
    r = np.asarray(r0, float).copy()
    v = np.zeros_like(r)
    r_end = r + acceleration_path_m(cfg)
    active = r < r_end
    for _ in range(20000):
        if not active.any():
            break
        ra = r[active]
        g = gas_field(ra, h, cfg)
        w = g["u"] - v[active]
        aw = np.abs(w) + 1e-9
        mu_g = sutherland(g["T"], cfg)
        Re = g["rho"] * aw * D / mu_g
        lam = mu_g / g["rho"] * math.sqrt(math.pi / (2 * cfg["R_gas"])) / np.sqrt(g["T"])
        Kn = lam / D
        s = aw / np.sqrt(2 * cfg["R_gas"] * g["T"])
        cd = drag_coefficient(Re, Kn, s, cfg["T_wall_K"] / g["T"])
        tau_p = 4 * rho_p * D / (3 * cd * g["rho"] * aw)
        ds = cfg["ds_rel"] * np.maximum(ra, 0.2 * h)
        dt1 = ds / np.maximum(v[active], 1.0)
        v1 = g["u"] - w * np.exp(-dt1 / tau_p)
        dt = ds / np.maximum(0.5 * (v[active] + v1), 1.0)
        v_new = g["u"] - w * np.exp(-dt / tau_p)
        r[active] = ra + 0.5 * (v[active] + v_new) * dt
        v[active] = v_new
        active = r < r_end
    return v


# Monte Carlo trajectories
def divot_volume(v, D, cfg):
    """Sheldon & Kanhere (1972). Dimensionally homogeneous -> m^3."""
    return cfg["K_D"] * v ** 3 * D ** 3 * cfg["rho_particle"] ** 1.5 * cfg["H_vickers_Pa"] ** -1.5


def divot_depth_um(V):
    return (3 * V / (2 * np.pi)) ** (1 / 3) * 1e6


@njit(parallel=True)
def _accumulate_impact_chunk(D, book, speed, angle, r0, distances, heights,
                             height_bin_m, g_moon, moon_radius_m, v_escape,
                             rho_particle, hardness, K_D, n_diameters,
                             berm_r, berm_h):
    """Accumulate one sampled chunk using per-thread bins to avoid races."""
    n_threads = get_num_threads()
    n_samples = len(D)
    n_heights = len(heights)
    n_distances = len(distances)
    shape = (n_threads, n_heights, n_distances, n_diameters)
    hits = np.zeros(shape, dtype=np.int64)
    velocity_cubed = np.zeros(shape)
    depth_sum = np.zeros(shape)
    coverage = np.zeros(shape)
    escaped = np.zeros(n_threads, dtype=np.int64)
    half_bin = height_bin_m / 2.0
    pi = math.pi

    for i in prange(n_samples):
        thread_id = get_thread_id()
        particle_speed = speed[i]
        particle_angle = angle[i]
        if particle_speed >= v_escape:
            escaped[thread_id] += 1
        horizontal_speed = particle_speed * math.cos(particle_angle)
        sin_angle_speed = particle_speed * math.sin(particle_angle)

        for iR in range(n_distances):
            horizontal_distance = distances[iR] - r0[i]
            if (horizontal_distance <= 0.5 or particle_angle <= 0.0
                    or horizontal_speed <= 0.5):
                continue
            # A ring berm stops trajectories that pass below its crest.
            if berm_h > 0.0 and r0[i] < berm_r < distances[iR]:
                hb = berm_r - r0[i]
                tb = hb / horizontal_speed
                zb = (hb * math.tan(particle_angle) - 0.5 * g_moon * tb * tb
                      + hb * hb / (2.0 * moon_radius_m))
                if zb < berm_h:
                    continue
            flight_time = horizontal_distance / horizontal_speed
            impact_height = (
                horizontal_distance * math.tan(particle_angle)
                - 0.5 * g_moon * flight_time * flight_time
                + horizontal_distance * horizontal_distance / (2.0 * moon_radius_m)
            )
            impact_speed = math.hypot(
                horizontal_speed, sin_angle_speed - g_moon * flight_time
            )
            diameter_bin = book[i]

            for iz in range(n_heights):
                if abs(impact_height - heights[iz]) > half_bin:
                    continue
                volume = (K_D * impact_speed ** 3 * D[i] ** 3
                          * rho_particle ** 1.5 * hardness ** -1.5)
                depth = (3.0 * volume / (2.0 * pi)) ** (1.0 / 3.0) * 1e6
                hits[thread_id, iz, iR, diameter_bin] += 1
                velocity_cubed[thread_id, iz, iR, diameter_bin] += impact_speed ** 3
                depth_sum[thread_id, iz, iR, diameter_bin] += depth
                coverage[thread_id, iz, iR, diameter_bin] += pi * (depth * 1e-4) ** 2

    return hits, velocity_cubed, depth_sum, coverage, escaped.sum()


def _accumulate_impact_chunk_numpy(D, book, speed, angle, r0, cfg, nD):
    """Vectorized fallback used when Numba is unavailable."""
    heights = np.asarray(cfg["target_heights_sensitivity_m"], float)
    distances = np.asarray(cfg["target_distances_m"], float)
    shape = (len(heights), len(distances), nD)
    hits = np.zeros(shape, dtype=np.int64)
    v3 = np.zeros(shape); dep = np.zeros(shape); cov = np.zeros(shape)
    escaped = int(np.count_nonzero(speed >= cfg["v_escape_m_s"]))
    vh = speed * np.cos(angle)
    vz = speed * np.sin(angle)
    half = cfg["target_height_bin_m"] / 2
    for iR, dist in enumerate(distances):
        hd = dist - r0
        ok = (hd > 0.5) & (angle > 0) & (vh > 0.5)
        if not ok.any():
            continue
        t = np.where(ok, hd / np.where(ok, vh, 1.0), 0.0)
        z = hd * np.tan(angle) - 0.5 * cfg["g_moon"] * t ** 2 + hd ** 2 / (2 * cfg["R_moon_m"])
        br, bh = cfg["berm_radius_m"], cfg["berm_height_m"]
        if bh > 0 and br < dist:                      # ring berm
            hb = br - r0
            cross = ok & (hb > 0)
            tb = np.where(cross, hb / np.where(ok, vh, 1.0), 0.0)
            zb = hb * np.tan(angle) - 0.5 * cfg["g_moon"] * tb ** 2 + hb ** 2 / (2 * cfg["R_moon_m"])
            ok = ok & ~(cross & (zb < bh))
        vi = np.hypot(vh, vz - cfg["g_moon"] * t)
        for iz, th in enumerate(heights):
            m = ok & (np.abs(z - th) <= half)
            if not m.any():
                continue
            b = book[m]
            d_um = divot_depth_um(divot_volume(vi[m], D[m], cfg))
            hits[iz, iR] += np.bincount(b, minlength=nD)
            v3[iz, iR] += np.bincount(b, weights=vi[m] ** 3, minlength=nD)
            dep[iz, iR] += np.bincount(b, weights=d_um, minlength=nD)
            cov[iz, iR] += np.bincount(b, weights=np.pi * (d_um * 1e-4) ** 2, minlength=nD)
    return hits, v3, dep, cov, escaped


def interpolate_sampled_velocity(h_idx, D, r0, velocity_grid, grids):
    D_grid, r_grid = grids["D"], grids["r"]

    def bracket(grid, values):
        if len(grid) == 1:
            z = np.zeros(values.shape, dtype=int)
            return z, z, np.zeros(values.shape)
        hi = np.clip(np.searchsorted(grid, values, side="right"), 1, len(grid) - 1)
        lo = hi - 1
        frac = (values - grid[lo]) / (grid[hi] - grid[lo])
        return lo, hi, np.clip(frac, 0.0, 1.0)

    r_lo, r_hi, rf = bracket(r_grid, r0)
    d_lo, d_hi, df = bracket(np.log(D_grid), np.log(D))
    v00 = velocity_grid[h_idx, d_lo, r_lo]
    v01 = velocity_grid[h_idx, d_lo, r_hi]
    v10 = velocity_grid[h_idx, d_hi, r_lo]
    v11 = velocity_grid[h_idx, d_hi, r_hi]
    return (v00 + rf * (v01 - v00)) + df * ((v10 + rf * (v11 - v10)) - (v00 + rf * (v01 - v00)))


def sample_impacts(key, angle_mean_deg, source_counts, velocity_grid, grids, cfg):
    """Sample emissions and accumulate weighted hits in axisymmetric bins.
    """
    n_samples = int(cfg["mc_particles_per_model"])
    nD = len(grids["D"])
    nZ = len(cfg["target_heights_sensitivity_m"])
    nR = len(cfg["target_distances_m"])
    shape = (nZ, nR, nD)
    hits = np.zeros(shape, dtype=np.int64)
    density = np.zeros(shape)
    velocity_cubed = np.zeros(shape)
    depth_sum = np.zeros(shape)
    coverage = np.zeros(shape)
    escaped = 0

    flat_counts = source_counts.ravel()
    total_emitted = float(flat_counts.sum())
    empty = {
        "hit_counts": hits,
        "density": density,
        "velocity_cubed": velocity_cubed,
        "depth_sum": depth_sum, 
        "coverage": coverage,
        "total_emitted": total_emitted,
        "escaped_fraction": 0.0,
    }
    if total_emitted <= 0 or n_samples <= 0:
        return empty

    seed = int(cfg["mc_seed"]) + 1000 * cfg["erosion_models"].index(key) \
        + int(round(angle_mean_deg * 10))
    rng = np.random.default_rng(seed)
    cdf = np.cumsum(flat_counts / total_emitted)
    cdf[-1] = 1.0
    cdf_D = grids["cdf_D_number"]
    ln_sigma = grids["ln_sigma"]
    D50_number = grids["D50_number_m"]
    edges_D = grids["edges_D"]
    angle_mean = math.radians(angle_mean_deg)
    angle_sd = math.radians(cfg["eject_angle_sd_deg"])
    sample_weight = total_emitted / n_samples
    area_cm2 = 2 * np.pi * np.asarray(cfg["target_distances_m"]) * cfg["target_height_bin_m"] * 1e4
    chunk = 25_000
    _, _, n_r = source_counts.shape

    for start in range(0, n_samples, chunk):
        size = min(chunk, n_samples - start)
        cell = np.minimum(
            np.searchsorted(
                cdf,
                rng.random(size),
                side="right",
            ),
            len(flat_counts) - 1,
        )
        r_idx = cell % n_r
        D_idx = (cell // n_r) % nD
        h_idx = cell // (nD * n_r)

        re = grids["edges_r"]
        r0 = np.sqrt(re[r_idx] ** 2 + rng.random(size) * (re[r_idx + 1] ** 2 - re[r_idx] ** 2))

        q = cdf_D[D_idx] + rng.random(size) * (cdf_D[D_idx + 1] - cdf_D[D_idx])
        q = np.clip(q, np.finfo(float).eps, 1 - np.finfo(float).eps)
        D = D50_number * np.exp(ln_sigma * ndtri(q))
        book = np.clip(np.searchsorted(edges_D, D, side="right") - 1, 0, nD - 1)

        angle = rng.normal(angle_mean, angle_sd, size)
        speed = interpolate_sampled_velocity(h_idx, D, r0, velocity_grid, grids)
        if not NUMBA_AVAILABLE:
            ch, cv, cd, cc, ce = _accumulate_impact_chunk_numpy(
                D, book, speed, angle, r0, cfg, nD)
            escaped += ce
            factor = sample_weight / area_cm2[None, :, None]
            hits += ch
            density += ch * factor
            velocity_cubed += cv * factor
            depth_sum += cd * factor
            coverage += cc * factor
            continue
        chunk_hits, chunk_v3, chunk_depth, chunk_coverage, chunk_escaped = (
            _accumulate_impact_chunk(
                D, book, speed, angle, r0,
                np.asarray(cfg["target_distances_m"], dtype=float),
                np.asarray(cfg["target_heights_sensitivity_m"], dtype=float),
                cfg["target_height_bin_m"], cfg["g_moon"], cfg["R_moon_m"],
                cfg["v_escape_m_s"], cfg["rho_particle"], cfg["H_vickers_Pa"],
                cfg["K_D"], nD, float(cfg["berm_radius_m"]), float(cfg["berm_height_m"]),
            )
        )
        chunk_hits = chunk_hits.sum(axis=0)
        escaped += int(chunk_escaped)
        factor = sample_weight / area_cm2[None, :, None]
        hits += chunk_hits
        density += chunk_hits * factor
        velocity_cubed += chunk_v3.sum(axis=0) * factor
        depth_sum += chunk_depth.sum(axis=0) * factor
        coverage += chunk_coverage.sum(axis=0) * factor

    return {"hit_counts": hits, "density": density, "velocity_cubed": velocity_cubed,
            "depth_sum": depth_sum, "coverage": coverage,
            "total_emitted": total_emitted, "escaped_fraction": escaped / n_samples}


# Checkpointing
def new_state(cfg, grids):
    nD, nr = len(grids["D"]), len(grids["r"])
    nz, nR = len(cfg["target_heights_sensitivity_m"]), len(cfg["target_distances_m"])
    nH = len(grids["h"])
    z0 = np.zeros
    models = cfg["erosion_models"]
    angles = cfg["angle_hypotheses_deg"]
    return {
        "version": STATE_VERSION,
        "config_hash": config_hash(cfg),
        "status": "IN_PROGRESS",
        "created": datetime.now(timezone.utc).isoformat(),
        "updated": None,
        "steps_done": 0,
        "steps_total": nH * nD,
        "last_processed_step": {"h_index": -1, "D_index": -1, "r_index": -1},
        "monte_carlo_done": {f"{m}|{a}": False for m in models for a in angles},
        "accumulated_results": {
            "total_mass_eroded": {m: 0.0 for m in models},
            "mass_outer_ring": {m: 0.0 for m in models},
            "mass_eroded_by_h": {m: [0.0] * nH for m in models},
            "mass_eroded_by_D": {m: [0.0] * nD for m in models},
            "mc": {},
            "v_eject_max_by_D": [0.0] * nD,
            "v_eject_max_by_hD": z0((nH, nD)).tolist(),
            "tau_max_by_h_Pa": [0.0] * nH,
            "E_max_by_h_W_m2": [0.0] * nH,
            "r_tau_max_by_h_m": [0.0] * nH,
        },
        "_array_state": {f"source_{m}": z0((nH, nD, nr)) for m in models}
                        | {"velocity_grid": z0((nH, nD, nr))},
    }


def save_checkpoint(path, state):
    state["updated"] = datetime.now(timezone.utc).isoformat()
    previous = state.get("array_checkpoint")
    array_path = path + "." + uuid.uuid4().hex + ".npz"
    tmp_arr = array_path + ".tmp"
    try:
        with open(tmp_arr, "wb") as f:
            np.savez_compressed(f, **state["_array_state"])
        os.replace(tmp_arr, array_path)
    except BaseException:
        if os.path.exists(tmp_arr):
            os.remove(tmp_arr)
        raise
    # Stored without its folder so the cache can be moved or shared.
    state["array_checkpoint"] = os.path.basename(array_path)
    arrays = state.pop("_array_state")
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(state, f)
        for attempt in range(10):
            try:
                os.replace(tmp, path)
                break
            except PermissionError:
                time.sleep(0.2 * (attempt + 1))
        else:
            raise PermissionError(f"Could not replace checkpoint {path}")
    finally:
        state["_array_state"] = arrays
    previous = _array_path(path, previous)
    if (previous and os.path.abspath(previous) != os.path.abspath(array_path)
            and os.path.exists(previous)):
        os.remove(previous)


def _array_path(ckpt_path, stored):
    """Locate a checkpoint's .npz file.

    Older checkpoints store an absolute path. If the cache folder was moved,
    renamed or copied to another computer, the file is looked up next to the
    checkpoint instead.
    """
    if not stored:
        return None
    if os.path.isabs(stored) and os.path.exists(stored):
        return stored
    name = stored.replace("\\", "/").rsplit("/", 1)[-1]
    return os.path.join(os.path.dirname(os.path.abspath(ckpt_path)), name)


def load_checkpoint(path, cfg):
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        st = json.load(f)
    if st.get("version") != STATE_VERSION:
        print(f"[checkpoint] {path} uses an older format; starting a new run.")
        return None
    if st.get("config_hash") != config_hash(cfg):
        print(f"[checkpoint] {path} does not match the current configuration "
              f"-> ignoring it (restart with --reset).")
        sys.exit(2)
    ap = _array_path(path, st.get("array_checkpoint"))
    if not ap or not os.path.exists(ap):
        raise FileNotFoundError(f"Checkpoint array data is missing: {ap}")
    st["array_checkpoint"] = ap
    with np.load(ap, allow_pickle=False) as arrays:
        st["_array_state"] = {n: arrays[n] for n in arrays.files}
    return st


# Simulation loop
def run(cfg, ckpt_path, max_steps=None, save_interval=2.0):
    run_started_at = datetime.now().astimezone()
    run_started = time.perf_counter()
    print(f"[timing] run started {run_started_at.isoformat(timespec='seconds')}")
    if cfg["mc_particles_per_model"] <= 0:
        raise ValueError("mc_particles_per_model must be greater than zero")
    if cfg["target_height_bin_m"] <= 0:
        raise ValueError("target_height_bin_m must be greater than zero")
    G = build_grids(cfg)
    h_arr, D_arr, r_arr = G["h"], G["D"], G["r"]
    area_r, w_mass, dt = G["area_r"], G["w_mass"], G["dt"]
    nD, nr = len(D_arr), len(r_arr)
    rho_p = cfg["rho_particle"]
    models = cfg["erosion_models"]

    if cfg["velocity_model"] == "lane_metzger":
        print("[config] velocity_model 'lane_metzger' used the 0.65% effective "
              "speed; switching to 'fig5'")
        cfg["velocity_model"] = "fig5"
    if cfg["velocity_model"] not in ("integrated", "fig5"):
        raise ValueError(f"unknown velocity_model {cfg['velocity_model']!r}")
    ok_lm, msg_lm = lane_metzger_sanity(cfg, G)
    print(f"[validate] {msg_lm}")
    print(f"[config] velocity model {cfg['velocity_model']!r}, thrust "
          f"{cfg['thrust_N']/1000:g} kN, acceleration path {acceleration_path_m(cfg):.1f} m")
    if cfg["pad_radius_m"] > 0 or cfg["berm_height_m"] > 0:
        print(f"[config] mitigation: pad radius {cfg['pad_radius_m']:g} m, berm "
              f"{cfg['berm_height_m']:g} m high at {cfg['berm_radius_m']:g} m")
    print("[performance] "
          + ("Numba-parallel trajectory accumulation enabled"
             if NUMBA_AVAILABLE else
             "Numba unavailable; using the compatible Python fallback"))

    if "energy_flux" in models and cfg["ef_calibrate"]:
        eps_cal, raw_total = calibrate_epsilon(cfg, G)
        cfg["ef_calibrated_epsilon"] = eps_cal
        print(f"[calibrate] energy-flux branch: published eps = {cfg['ef_epsilon']:.4g} "
              f"gives {raw_total/1000:.4g} t, which is {raw_total/1000/cfg['ef_calibrate_to_mass_t']:.3g}x "
              f"the {cfg['ef_calibrate_to_mass_t']:.0f} t literature value.")
        print(f"[calibrate] eps was fitted to Metzger's own CFD field, not to a "
              f"point-source cos^n plume; the coefficient and the flow model are "
              f"a matched pair and do not transfer.")
        print(f"[calibrate] rescaled eps = {eps_cal:.4g} so total mass = "
              f"{cfg['ef_calibrate_to_mass_t']:.0f} t. Pit density is now a "
              f"prediction, not a fitted quantity.")

    st = load_checkpoint(ckpt_path, cfg)
    if st is not None and st["status"] == "COMPLETED":
        print(f"[checkpoint] Status COMPLETED; nothing to do ({ckpt_path}).")
        print(f"[timing] no work performed; elapsed {time.perf_counter() - run_started:.1f} s")
        return st, G
    if st is None:
        st = new_state(cfg, G)
        print("[start] starting new run")
    else:
        lp = st["last_processed_step"]
        print(f"[resume] continuing after h={lp['h_index']}, D={lp['D_index']} "
              f"({st['steps_done']}/{st['steps_total']} source steps)")

    acc = st["accumulated_results"]
    vmax_hD = np.array(acc["v_eject_max_by_hD"])
    arrays = st["_array_state"]
    source = {m: arrays[f"source_{m}"] for m in models}
    velocity_grid = arrays["velocity_grid"]

    lp = st["last_processed_step"]
    start_flat = (lp["h_index"] * nD + lp["D_index"] + 1) if lp["h_index"] >= 0 else 0
    steps_this_run = 0
    last_save = time.time()
    source_started = time.perf_counter()
    height_started = source_started
    timed_height_index = None

    for flat in range(start_flat, len(h_arr) * nD):
        k, i = divmod(flat, nD)
        if k != timed_height_index:
            timed_height_index = k
            height_started = time.perf_counter()
        h, D = h_arr[k], D_arr[i]
        gas = gas_field(r_arr, h, cfg)
        tau, E = gas["tau"], gas["E"]
        if i == 0:
            j = int(np.argmax(tau))
            acc["tau_max_by_h_Pa"][k] = float(tau[j])
            acc["r_tau_max_by_h_m"][k] = float(r_arr[j])
            acc["E_max_by_h_W_m2"][k] = float(E.max())

        dtau = tau - tau_threshold(D, cfg)
        erod = dtau > 0
        m_p = rho_p * math.pi / 6 * D ** 3
        emit = erod | ((E > cfg["ef_E_th_W_m2"]) if "energy_flux" in models else False)

        v_ej = np.zeros(nr)
        if emit.any():
            if cfg["velocity_model"] == "fig5":
                v_full = ejection_velocity(r_arr, D, h, cfg)
                vmax_drag = v_full.max()
                u_fig5 = float(lane_metzger_fig5_scaled(h, np.array([D]), cfg)[0])
                if vmax_drag > 0:
                    v_ej[emit] = v_full[emit] * (u_fig5 / vmax_drag)
            else:
                v_ej[emit] = ejection_velocity(r_arr[emit], D, h, cfg)
        velocity_grid[k, i] = v_ej
        vmax_hD[k, i] = float(v_ej.max())

        launched = (v_ej > 0) & (r_arr >= cfg["pad_radius_m"])
        erod = erod & launched
        rates = {}
        if "scaling" in models:
            rates["scaling"] = np.where(erod, w_mass[i] * cfg["mdot_coeff"]
                                        * tau ** cfg["mdot_exp"], 0.0)
        if "roberts" in models:
            u_safe = np.maximum(v_ej, 1.0)
            dndt = np.where(erod, w_mass[i] * 12 * dtau
                            / (math.pi * rho_p * u_safe * D ** 3), 0.0)
            rates["roberts"] = dndt * m_p
        if "energy_flux" in models:
            rates["energy_flux"] = np.where(launched, w_mass[i] * energy_flux_erosion(E, cfg), 0.0)

        outer = r_arr > 0.8 * r_arr[-1]
        for m in models:
            mdot = rates[m]
            source[m][k, i] = mdot / m_p * area_r * dt
            mass = float((mdot * area_r).sum() * dt)
            acc["mass_outer_ring"][m] += float((mdot * area_r)[outer].sum() * dt)
            acc["total_mass_eroded"][m] += mass
            acc["mass_eroded_by_h"][m][k] += mass
            acc["mass_eroded_by_D"][m][i] += mass

        st["last_processed_step"] = {"h_index": k, "D_index": i, "r_index": nr - 1}
        st["steps_done"] = flat + 1
        steps_this_run += 1

        now = time.time()
        stop = max_steps is not None and steps_this_run >= max_steps
        if i == nD - 1 or now - last_save >= save_interval or stop:
            acc["v_eject_max_by_hD"] = vmax_hD.tolist()
            acc["v_eject_max_by_D"] = vmax_hD.max(axis=0).tolist()
            save_checkpoint(ckpt_path, st)
            last_save = now
        if i == nD - 1:
            pct = 100 * st["steps_done"] / st["steps_total"]
            tot = " ".join(f"{m}={acc['total_mass_eroded'][m]:.3g}kg" for m in models)
            completed_at = datetime.now().astimezone().isoformat(timespec="seconds")
            print(f"  h={h:5.1f} m  tau_max={acc['tau_max_by_h_Pa'][k]:7.3f} Pa  "
                  f"{tot}  [{pct:5.1f}%] "
                  f"step={time.perf_counter() - height_started:.1f}s "
                  f"completed={completed_at}")
        if stop:
            break

    if st["steps_done"] < st["steps_total"]:
        acc["v_eject_max_by_hD"] = vmax_hD.tolist()
        acc["v_eject_max_by_D"] = vmax_hD.max(axis=0).tolist()
        save_checkpoint(ckpt_path, st)
        elapsed = time.perf_counter() - run_started
        print("[log] source grid incomplete; resume to start Monte Carlo sampling")
        print(f"[timing] source-grid work this run: "
              f"{time.perf_counter() - source_started:.1f} s")
        print(f"[timing] paused after {elapsed:.1f} s total "
              f"({st['steps_done']}/{st['steps_total']} source steps complete)")
        return st, G

    print(f"[timing] source grid complete in "
          f"{time.perf_counter() - source_started:.1f} s")
    for m in models:
        tot = acc["total_mass_eroded"][m]
        frac = acc["mass_outer_ring"][m] / tot if tot > 0 else 0.0
        if frac > 0.01:
            print(f"[warning] {m}: {100*frac:.1f}% of eroded mass lies in the outer "
                  f"20% of the source grid; raise r_max_m, the footprint is truncated")

    for m in models:
        for a in cfg["angle_hypotheses_deg"]:
            tag = f"{m}|{a}"
            if st["monte_carlo_done"].get(tag):
                continue
            print(f"[monte carlo] {m}, ejection angle {a} deg, "
                  f"{cfg['mc_particles_per_model']:,} trajectories")
            branch_started = time.perf_counter()
            s = sample_impacts(m, a, source[m], velocity_grid, G, cfg)
            acc["mc"][tag] = {
                "density": s["density"].tolist(),
                "velocity_cubed": s["velocity_cubed"].tolist(),
                "depth_sum": s["depth_sum"].tolist(),
                "coverage": s["coverage"].tolist(),
                "hit_counts": s["hit_counts"].tolist(),
                "total_emitted": s["total_emitted"],
                "escaped_fraction": s["escaped_fraction"],
            }
            st["monte_carlo_done"][tag] = True
            save_checkpoint(ckpt_path, st)
            completed_at = datetime.now().astimezone().isoformat(timespec="seconds")
            print(f"[timing] branch {tag} complete at {completed_at} in "
                  f"{time.perf_counter() - branch_started:.1f} s; "
                  f"run elapsed {time.perf_counter() - run_started:.1f} s")

    st["status"] = "COMPLETED"
    save_checkpoint(ckpt_path, st)
    completed_at = datetime.now().astimezone().isoformat(timespec="seconds")
    print(f"[timing] simulation complete at {completed_at} in "
          f"{time.perf_counter() - run_started:.1f} s")
    return st, G


# Results and post-processing
def postprocess(st, G, cfg, out_dir):
    acc = st["accumulated_results"]
    D_um = G["D"] * 1e6
    z_list = cfg["target_heights_sensitivity_m"]
    R_list = cfg["target_distances_m"]
    models = cfg["erosion_models"]
    angles = cfg["angle_hypotheses_deg"]

    def nearest(lst, val):
        return int(np.argmin(np.abs(np.asarray(lst, float) - val)))

    iz_nom = nearest(z_list, cfg["target_height_m"])
    iz_surv = nearest(z_list, cfg["surveyor_height_m"])
    iR_surv = nearest(R_list, cfg["surveyor_distance_m"])
    ia_nom = nearest(angles, cfg["angle_nominal_deg"])

    res = {"meta": 
        {
            "generated": datetime.now(timezone.utc).isoformat(),
            "config": cfg,
            "config_hash": config_hash(cfg),
            "velocity_model": cfg["velocity_model"],
            "thrust_N": cfg["thrust_N"],
            "uncertainty": 
                "scenario spread across angle hypotheses and erosion "
                "branches; MC sampling error reported separately and is "
                "much smaller in this run",
        },
    }
    res["total_mass_eroded_kg"] = acc["total_mass_eroded"]
    res["mass_eroded_by_h"] = {"h_m": G["h"].tolist(), "kg": acc["mass_eroded_by_h"]}
    res["tau_max_by_h"] = {"h_m": G["h"].tolist(), "tau_Pa": acc["tau_max_by_h_Pa"],
                           "E_W_m2": acc["E_max_by_h_W_m2"],
                           "r_at_max_m": acc["r_tau_max_by_h_m"]}
    res["v_eject_max_by_D"] = {"D_um": D_um.tolist(), "v_m_s": acc["v_eject_max_by_D"]}
    res["v_lane_metzger_by_D"] = {
        "D_um": D_um.tolist(),
        "u_max_m_s": lane_metzger_umax(cfg["h_start_m"], G["D"], cfg).tolist(),
        "v_effective_m_s": lane_metzger_effective(cfg["h_start_m"], G["D"], cfg).tolist(),
        "note": "independent validation branch; not used by trajectories "
                "unless velocity_model == 'lane_metzger'",
    }

    n_samp = int(cfg["mc_particles_per_model"])
    branches = {}
    for m in models:
        for a in angles:
            tag = f"{m}|{a}"
            d = acc["mc"].get(tag)
            if d is None:
                continue
            dens = np.array(d["density"])
            cov = np.array(d["coverage"]).sum(axis=2)
            depth_sum = np.array(d["depth_sum"])
            hits = np.array(d["hit_counts"])
            total = dens.sum(axis=2)
            mean_depth = np.where(total > 0, depth_sum.sum(axis=2)
                                  / np.where(total > 0, total, 1), 0.0)
            p_hit = hits.sum(axis=2) / n_samp
            area_cm2 = 2 * np.pi * np.asarray(R_list) * cfg["target_height_bin_m"] * 1e4
            se = (d["total_emitted"] / area_cm2[None, :]) * np.sqrt(
                np.maximum(p_hit * (1 - p_hit), 0) / n_samp)
            branches[tag] = {
                "model": m, "angle_deg": a,
                "density_total_per_cm2": total,
                "mc_standard_error_per_cm2": se,
                "mean_depth_um": mean_depth,
                "coverage_fraction": cov,
                "escaped_fraction": d["escaped_fraction"],
            }

    # Epistemic envelope across all branches at each (height, distance)
    stack = np.array([b["density_total_per_cm2"] for b in branches.values()])
    env = {"min": stack.min(axis=0), "median": np.median(stack, axis=0),
           "max": stack.max(axis=0)}
    res["exposure_envelope"] = {
        "target_heights_m": z_list, "distances_m": R_list,
        "density_min_per_cm2": env["min"].tolist(),
        "density_median_per_cm2": env["median"].tolist(),
        "density_max_per_cm2": env["max"].tolist(),
        "n_branches": len(branches),
        "spread_decades_at_nominal": float(
            np.log10(max(env["max"][iz_nom, iR_surv], 1e-300))
            - np.log10(max(env["min"][iz_nom, iR_surv], 1e-300))),
    }
    res["branches"] = {
        t: {"model": b["model"], "angle_deg": b["angle_deg"],
            "escaped_fraction": b["escaped_fraction"],
            "density_total_per_cm2": b["density_total_per_cm2"].tolist(),
            "mc_standard_error_per_cm2": b["mc_standard_error_per_cm2"].tolist(),
            "mean_depth_um": b["mean_depth_um"].tolist(),
            "coverage_fraction": b["coverage_fraction"].tolist()}
        for t, b in branches.items()}

    # Comparison against the Surveyor III measurement, at ITS geometry
    comp = {}
    for t, b in branches.items():
        comp[t] = {
            "at_nominal_height": float(b["density_total_per_cm2"][iz_nom, iR_surv]),
            "at_surveyor_crater_height": float(b["density_total_per_cm2"][iz_surv, iR_surv]),
            "mean_depth_um_nominal": float(b["mean_depth_um"][iz_nom, iR_surv]),
        }
    res["surveyor_comparison"] = {
        "distance_m": cfg["surveyor_distance_m"],
        "nominal_height_m": z_list[iz_nom],
        "crater_height_m": z_list[iz_surv],
        "measured_pit_density_per_cm2": cfg["pit_reference_per_cm2"],
        "measured_pit_size_um": [83.7, 74.5],
        "measured_pit_depth_um": 88.4,
        "note": "Surveyor III sat inside a ~200 m crater, below the surrounding "
                "plain. The crater-height row is the closer geometry comparison. "
                "SP-284 gives 155 m; Metzger's ~3 divots/cm^2 is tied to 180 m. "
                "SP-284 also concludes the blast cleaned rather than coated the "
                "spacecraft, and no hypervelocity features were confirmed.",
        "by_branch": comp,
    }

    with open(os.path.join(out_dir, "psi_results.json"), "w", encoding="utf-8") as f:
        json.dump(res, f, indent=1)
    return res


def code_tag(path=None):
    """Short hash of this file's code, used in cache folder names.

    Comments, docstrings, blank lines and indentation width are ignored, so
    tidying the file keeps the cache. Any change to the code itself (a
    formula, a constant, a renamed variable) gives a new tag, and the
    affected configurations are computed again.
    """
    import tokenize
    skip = {tokenize.COMMENT, tokenize.NL, tokenize.ENCODING}
    import io
    with open(path or os.path.abspath(__file__), "rb") as f:
        src = f.read().replace(b"\r\n", b"\n")          # Windows and Unix line endings give the same tag
    toks = [t for t in tokenize.tokenize(io.BytesIO(src).readline) if t.type not in skip]
    parts = []
    for i, t in enumerate(toks):
        prev = toks[i - 1].type if i else tokenize.NEWLINE
        nxt = toks[i + 1].type if i + 1 < len(toks) else tokenize.NEWLINE
        if (t.type == tokenize.STRING and nxt == tokenize.NEWLINE
                and prev in (tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT)):
            continue                              # a docstring on its own line
        parts.append(f"{t.type}:{'' if t.type == tokenize.INDENT else t.string}")
    return hashlib.sha256("\n".join(parts).encode()).hexdigest()[:8]


def migrate_cache(old_tag, cache_dir=None):
    """Rename cache folders from an older code tag to the current one.

    Only use this after a change that does not touch the physics (renaming,
    reformatting, splitting functions), otherwise old results would be
    reused for new code.
    """
    cache_dir = cache_dir or os.path.join(os.path.dirname(os.path.abspath(__file__)), "psi_cache")
    new = code_tag()
    n = 0
    for d in sorted(os.listdir(cache_dir)):
        if d.endswith("_" + old_tag):
            dst = os.path.join(cache_dir, d[: -len(old_tag)] + new)
            if not os.path.exists(dst):
                os.rename(os.path.join(cache_dir, d), dst)
                n += 1
    print(f"renamed {n} cache folders: {old_tag} -> {new}")
    return n


def simulate(overrides=None, cache_dir=None, quiet=True, base=None):
    """Run one configuration and return (cfg, grids, results).

    Results are cached under cache_dir/<config hash>/ using the existing
    checkpoint machinery, so re-running an escalation or sensitivity study
    only computes configurations it has not seen before.
    """
    import contextlib, io
    cfg = dict(CONFIG if base is None else base)
    cfg.update(overrides or {})
    if cfg["velocity_model"] == "lane_metzger":      # F10, before hashing
        cfg["velocity_model"] = "fig5"
    cache_dir = cache_dir or os.path.join(os.path.dirname(os.path.abspath(__file__)), "psi_cache")
    # Key on the config AND this file's code, so editing the physics can
    # never silently reuse results computed by older code.
    run_dir = os.path.join(cache_dir, f"{config_hash(cfg)}_{code_tag()}")
    os.makedirs(run_dir, exist_ok=True)
    sink = io.StringIO() if quiet else None
    with (contextlib.redirect_stdout(sink) if quiet else contextlib.nullcontext()):
        st, G = run(cfg, os.path.join(run_dir, "checkpoint.json"), None, 30.0)
        res = postprocess(st, G, cfg, run_dir)
    return cfg, G, res


def print_summary(res, cfg):
    print("\nResults")
    print("-------")
    print("\nTotal eroded mass per landing:")
    for m, v in res["total_mass_eroded_kg"].items():
        print(f"  {m:<14} {v:>12.1f} kg  ({v/1000:.2f} t)")
    print("  Metzger (2024) estimate: 11-26 t; earlier estimate: 2.6 t")

    env = res["exposure_envelope"]
    print(f"\nSpread across {env['n_branches']} model and angle cases:")
    print(f"  {env['spread_decades_at_nominal']:.1f} orders of magnitude "
          "at the Surveyor distance")

    sc = res["surveyor_comparison"]
    print(f"\nSurveyor III comparison at {sc['distance_m']:.0f} m "
          f"(measured ~{sc['measured_pit_density_per_cm2']:.0f}/cm^2, pits "
          f"~{sc['measured_pit_size_um'][0]:.0f} x {sc['measured_pit_size_um'][1]:.0f} um, "
          f"up to {sc['measured_pit_depth_um']:.0f} um deep):")
    print(f"  {'branch':<26} {'flat +1.5m':>14} {'in-crater -3m':>15} {'depth um':>10}")
    for t, c in sc["by_branch"].items():
        print(f"  {t:<26} {c['at_nominal_height']:>14.4g} "
              f"{c['at_surveyor_crater_height']:>15.4g} "
              f"{c['mean_depth_um_nominal']:>10.2f}")

    lm = res["v_lane_metzger_by_D"]
    own = res["v_eject_max_by_D"]
    print("\nVelocity comparison:")
    print(f"  {'D um':>8} {'integrated':>12} {'L&M u_max':>12} {'L&M effective':>14}")
    n = len(lm["D_um"])
    for i in sorted({0, n // 4, n // 2, 3 * n // 4, n - 1}):
        print(f"  {lm['D_um'][i]:>8.1f} {own['v_m_s'][i]:>12.1f} "
              f"{lm['u_max_m_s'][i]:>12.1f} {lm['v_effective_m_s'][i]:>14.3f}")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out-dir", default=os.path.dirname(os.path.abspath(__file__)))
    ap.add_argument("--checkpoint", default=None)
    ap.add_argument("--max-steps", type=int, default=None)
    ap.add_argument("--save-interval", type=float, default=2.0)
    ap.add_argument("--reset", action="store_true")
    ap.add_argument("--velocity-model", choices=["integrated", "fig5"], default=None)
    ap.add_argument("--mc", type=int, default=None, help="Monte Carlo samples per branch")
    ap.add_argument("--code-tag", action="store_true",
                    help="print the cache tag of this file and exit")
    ap.add_argument("--migrate-cache", metavar="OLD_TAG", default=None,
                    help="rename psi_cache folders from OLD_TAG to the current tag "
                         "(only after changes that do not touch the physics)")
    a = ap.parse_args()
    if a.code_tag:
        print(code_tag())
        return
    if a.migrate_cache:
        migrate_cache(a.migrate_cache)
        return
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    if a.velocity_model:
        CONFIG["velocity_model"] = a.velocity_model
    if a.mc:
        CONFIG["mc_particles_per_model"] = a.mc
    os.makedirs(a.out_dir, exist_ok=True)
    ckpt = a.checkpoint or os.path.join(a.out_dir, "psi_checkpoint.json")
    if a.reset and os.path.exists(ckpt):
        try:
            with open(ckpt, encoding="utf-8") as f:
                old = json.load(f)
        except json.JSONDecodeError:
            old = {}
        ap_old = _array_path(ckpt, old.get("array_checkpoint"))
        if (ap_old and ap_old.startswith(ckpt + ".") and ap_old.endswith(".npz")
                and os.path.exists(ap_old)):
            os.remove(ap_old)
        os.remove(ckpt)
    st, G = run(CONFIG, ckpt, a.max_steps, a.save_interval)
    if st["status"] == "COMPLETED":
        res = postprocess(st, G, CONFIG, a.out_dir)
        print_summary(res, CONFIG)


if __name__ == "__main__":
    main()