"""Plume-surface interaction model: Apollo 12 LM -> Surveyor III, and beyond.

One run, for one configuration (config.Config):

  1. source   For every nozzle height h and grain size D: the gas field on a
              ring grid, each erosion law's rate, and the launch speed.
  2. sample   For every (erosion law, ejection angle) branch: Monte Carlo
              ballistic trajectories into axisymmetric target bins.
  3. results  Impact density per branch, the envelope across branches, and
              the comparison with Surveyor III at its own geometry.

Absolute densities are NOT trusted on their own; psi_study.py anchors every
branch to Surveyor III. Sources and assumptions are in config.py; the history
of fixes is in CHANGELOG.md.

    python psi_simulation.py                         # run or resume
    python psi_simulation.py --max-steps 300         # pause after 300 source steps
    python psi_simulation.py --reset                 # discard the checkpoint
    python psi_simulation.py --velocity-model fig5 --thrust 44000 --mc 200000
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import io
import json
import math
import os
import sys
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import NamedTuple

import numpy as np
from scipy.special import erf, ndtri

if __package__:
    from .config import Config, ErosionLaws, Fig5Fit, Sutherland, VelocityModels
else:
    from config import Config, ErosionLaws, Fig5Fit, Sutherland, VelocityModels

try:
    from numba import get_num_threads, get_thread_id, njit, prange, set_num_threads
    from numba import config as _numba_config
    NUMBA_AVAILABLE = True
except ImportError:
    NUMBA_AVAILABLE = False

    def njit(*args, **kwargs):
        return lambda func: func

    prange = range

    def get_num_threads():
        return 1

    def get_thread_id():
        return 0


def set_threads(n: int) -> None:
    """Limit the Monte Carlo stage to n threads (for running several
    configurations side by side). No effect without numba."""
    if NUMBA_AVAILABLE:
        set_num_threads(max(1, min(int(n), _numba_config.NUMBA_NUM_THREADS)))

HERE = os.path.dirname(os.path.abspath(__file__))
STATE_VERSION = 8


def branch_tag(law: ErosionLaws, angle_deg: float) -> str:
    """Key of one model branch, e.g. "roberts|3.3"."""
    return f"{law.value}|{angle_deg}"


# 1. Grids
@dataclass(frozen=True)
class Grids:
    h: np.ndarray               # nozzle heights over the descent [m]
    dt: float                   # time per height step [s]
    D: np.ndarray               # grain-size bin centres [m]
    edges_D: np.ndarray
    cdf_D_number: np.ndarray    # number-weighted CDF at edges_D
    w_mass: np.ndarray          # mass fraction per size bin
    r: np.ndarray               # source ring centres [m]
    edges_r: np.ndarray
    area_r: np.ndarray          # ring areas [m^2]
    d50_number_m: float         # number median of the size distribution
    ln_sigma: float


def build_grids(cfg: Config) -> Grids:
    descent, reg, src = cfg.descent, cfg.regolith, cfg.source
    n_h = int(round((descent.start_height_m - descent.cutoff_height_m)
                    / descent.height_step_m)) + 1
    h = np.linspace(descent.start_height_m, descent.cutoff_height_m, n_h)

    edges_D = np.logspace(math.log10(reg.d_min_um), math.log10(reg.d_max_um),
                          reg.n_size_bins + 1) * 1e-6
    ln_sigma = math.log(reg.geometric_sd)
    ln_d50_mass = math.log(reg.d50_mass_um * 1e-6)
    # A mass-lognormal's number median sits 3 ln^2(sigma_g) lower.
    ln_d50_number = ln_d50_mass - 3 * ln_sigma ** 2

    def lognormal_cdf(ln_median):
        return 0.5 * (1 + erf((np.log(edges_D) - ln_median) / (math.sqrt(2) * ln_sigma)))

    w_mass = np.diff(lognormal_cdf(ln_d50_mass))
    edges_r = np.geomspace(src.r_min_m, src.r_max_m, src.n_rings + 1)
    return Grids(
        h=h, dt=descent.height_step_m / descent.rate_m_s,
        D=np.sqrt(edges_D[:-1] * edges_D[1:]), edges_D=edges_D,
        cdf_D_number=lognormal_cdf(ln_d50_number), w_mass=w_mass / w_mass.sum(),
        r=np.sqrt(edges_r[:-1] * edges_r[1:]), edges_r=edges_r,
        area_r=np.pi * (edges_r[1:] ** 2 - edges_r[:-1] ** 2),
        d50_number_m=math.exp(ln_d50_number), ln_sigma=ln_sigma,
    )


# 2. Gas field
class Gas(NamedTuple):
    u: np.ndarray      # speed at the boundary-layer edge [m/s]
    rho: np.ndarray    # density [kg/m^3]
    T: np.ndarray      # temperature [K]
    tau: np.ndarray    # wall shear stress [Pa]
    E: np.ndarray      # downward energy flux, Metzger 2024 [W/m^2]


def sutherland(T, visc: Sutherland) -> float:
    return visc.mu_ref_pa_s * (T / visc.t_ref_k) ** 1.5 * (visc.t_ref_k + visc.s_k) / (T + visc.s_k)


def gas_field(r, h, cfg: Config) -> Gas:
    """Point-source cos^n plume turned into a radial wall jet, at radius r."""
    eng = cfg.engine
    r = np.maximum(np.asarray(r, float), 1e-4)
    ve, n, R_gas = eng.exhaust_speed_m_s, eng.plume_cos_exponent, eng.gas_constant_j_kg_k
    cp = eng.gamma * R_gas / (eng.gamma - 1)
    R2 = r * r + h * h
    cos_t, sin_t = h / np.sqrt(R2), r / np.sqrt(R2)

    momentum_flux = eng.thrust_n * (n + 1) / (2 * np.pi * R2) * cos_t ** n
    rho_inf = momentum_flux / ve ** 2
    p_wall = rho_inf * (ve * cos_t) ** 2
    # u -> v_exhaust for r >> h: this wall jet never decays, which is why the
    # acceleration path has to be limited (Velocity.accel_path_m).
    u = ve * sin_t
    T = np.maximum(eng.chamber_temp_k - u ** 2 / (2 * cp), 50.0)

    # Eckert reference temperature, flat-plate laminar shear with a
    # stagnation-point correction near the axis.
    T_recovery = T + eng.recovery_factor * u ** 2 / (2 * cp)
    T_ref = 0.5 * (T + eng.wall_temp_k) + 0.22 * (T_recovery - T)
    rho_ref = p_wall / (R_gas * T_ref)
    mu_ref = sutherland(T_ref, eng.viscosity)
    c_fs = 0.332 + (1.2326 - 0.332) * np.exp(-(r / h) ** 2)
    tau = mu_ref * c_fs * u * np.sqrt(np.maximum(u, 1e-9) * rho_ref / (mu_ref * r))

    rho = np.maximum(p_wall / (R_gas * T), rho_inf)
    v_thermal = np.sqrt(8 * R_gas * T / math.pi)
    return Gas(u=u, rho=rho, T=T, tau=tau, E=rho * u ** 2 * v_thermal / 12.0)


# 3. Erosion laws
def tau_threshold(D, cfg: Config) -> float:
    """Shao & Lu (2000) threshold shear stress at lunar gravity."""
    reg = cfg.regolith
    return reg.threshold_coefficient * (reg.grain_density_kg_m3 * cfg.moon.gravity_m_s2 * D
                                        + reg.cohesion_n_m / D)


def energy_flux_rate(E, cfg: Config, epsilon: float) -> float:
    """Metzger (2024) Eq. 16, total over all sizes [kg m^-2 s^-1]."""
    law, reg = cfg.erosion.energy_flux, cfg.regolith
    d_mean = law.mean_over_d84 * reg.d50_mass_um * 1e-6 * reg.geometric_sd
    denom = reg.bulk_density_kg_m3 * cfg.moon.gravity_m_s2 * d_mean + law.cohesion_energy_j_m3
    excess = E - law.threshold_w_m2
    return np.where(excess > 0, reg.bulk_density_kg_m3 * epsilon * excess / denom, 0.0)


def calibrated_epsilon(cfg: Config) -> tuple[float, float]:
    """eps for the energy-flux law, and the mass the published eps gives [kg].

    The published eps was fitted to Metzger's CFD field, not to this plume, so
    it is rescaled until the CALIBRATION vehicle (always Apollo) erodes the
    literature mass. Rate is linear in eps, so this is one pass and a ratio.
    """
    law = cfg.erosion.energy_flux
    if not law.calibrate:
        return law.epsilon, float("nan")
    # Take the vehicle's physics but keep this run's height step, so a coarse
    # run still erodes exactly the target mass on the calibration vehicle.
    vd = law.calibration_vehicle.descent
    ref = cfg.with_(**{"engine.thrust_n": law.calibration_vehicle.thrust_n,
                       "descent.start_height_m": vd.start_height_m,
                       "descent.cutoff_height_m": vd.cutoff_height_m,
                       "descent.rate_m_s": vd.rate_m_s})
    G = build_grids(ref)
    total_kg = sum(float((energy_flux_rate(gas_field(G.r, h, ref).E, ref, law.epsilon)
                          * G.area_r).sum() * G.dt) for h in G.h)
    if total_kg <= 0:
        return law.epsilon, total_kg
    return law.epsilon * law.calibrate_to_mass_t * 1000.0 / total_kg, total_kg


def erosion_rates(laws, gas: Gas, D, w_mass, v_launch, launched, cfg: Config, epsilon):
    """Mass erosion rate per law for one size class on every ring [kg m^-2 s^-1].

    Shear laws erode where tau exceeds the threshold; the energy-flux law has
    its own threshold (E_th). Nothing erodes where grains cannot launch.
    """
    excess_tau = gas.tau - tau_threshold(D, cfg)
    shear_erodes = (excess_tau > 0) & launched
    rho_p = cfg.regolith.grain_density_kg_m3
    rates = {}
    for law in laws:
        if law is ErosionLaws.SCALING:
            s = cfg.erosion.shear_scaling
            rates[law] = np.where(shear_erodes, w_mass * s.coefficient * gas.tau ** s.exponent, 0.0)
        elif law is ErosionLaws.ROBERTS:
            grains_per_s = 12 * excess_tau / (math.pi * rho_p * np.maximum(v_launch, 1.0) * D ** 3)
            rates[law] = np.where(shear_erodes, w_mass * grains_per_s * rho_p * math.pi / 6 * D ** 3, 0.0)
        elif law is ErosionLaws.ENERGY_FLUX:
            rates[law] = np.where(launched, w_mass * energy_flux_rate(gas.E, cfg, epsilon), 0.0)
    return rates


def emits_anywhere(laws, gas: Gas, D, cfg: Config):
    """Rings where at least one law could release this size class."""
    emit = gas.tau > tau_threshold(D, cfg)
    if ErosionLaws.ENERGY_FLUX in laws:
        emit = emit | (gas.E > cfg.erosion.energy_flux.threshold_w_m2)
    return emit


# 4. Launch speed
def thrust_ratio(cfg: Config) -> float:
    """Thrust relative to the Apollo LM, used by every scaling ASSUMPTION."""
    return cfg.engine.thrust_n / cfg.velocity.fig5_reference_thrust_n


def acceleration_path_m(cfg: Config) -> float:
    """Drag-integration path from each grain's launch point, ~ nozzle size."""
    return cfg.velocity.accel_path_m * thrust_ratio(cfg) ** cfg.velocity.accel_path_thrust_exp


def fig5_speed(h, D, fit: Fig5Fit):
    """Digitized Lane & Metzger (2015) Fig. 5, Apollo LM only [m/s].

    u = K(h)/sqrt(D_um), K(h) = K0 (1 + (h/h_k)^(n s))^(-1/s); zero in the
    no-lift region. Valid for h = 0.7-45 m, D = 1-10^4 um.
    """
    h = np.maximum(np.asarray(h, float), 1e-6)
    D_um = np.maximum(np.asarray(D, float), 1e-12) * 1e6
    s = fit.sharpness
    K = fit.k0 * (1.0 + (h / fit.knee_height_m) ** (fit.slope * s)) ** (-1.0 / s)
    no_lift = np.log10(D_um) + fit.no_lift_c1 * np.log10(h) > fit.no_lift_c0
    return np.where(no_lift, 0.0, K / np.sqrt(D_um))


def fig5_speed_scaled(h, D, cfg: Config):
    """Fig. 5 for this run's thrust (ASSUMPTION, see config.Velocity): the
    knee and the no-lift edge move as thrust^knee_exp, K0 as thrust^k0_exp.
    No grain outruns the exhaust; that cap only binds above ~60 kN."""
    vel = cfg.velocity
    lam = thrust_ratio(cfg)
    h = np.maximum(np.asarray(h, float), 1e-6) / lam ** vel.fig5_knee_thrust_exp
    u = lam ** vel.fig5_k0_thrust_exp * fig5_speed(h, D, vel.fig5)
    return np.minimum(u, cfg.engine.exhaust_speed_m_s)


def drag_coefficient(Re, Kn, s, T_ratio):
    """Continuum (Clift-Gauvin) bridged to free-molecular by Knudsen number."""
    Re = np.maximum(Re, 1e-8)
    c_cont = 24.0 / Re * (1 + 0.15 * Re ** 0.687) + 0.42 / (1 + 42500.0 * Re ** -1.16)
    s = np.maximum(s, 1e-2)
    c_fm = ((2 * s ** 2 + 1) / (math.sqrt(math.pi) * s ** 3) * np.exp(-s ** 2)
            + (4 * s ** 4 + 4 * s ** 2 - 1) / (2 * s ** 4) * erf(s)
            + 2 * math.sqrt(math.pi) / (3 * s) * np.sqrt(T_ratio))
    return (c_cont + Kn * c_fm) / (1 + Kn)


def integrate_launch_speed(r0, D, h, cfg: Config):
    """Integrate dv/dt = 3 C_D rho_g |w| w / (4 rho_p D) from r0 to r0 + L."""
    eng, rho_p = cfg.engine, cfg.regolith.grain_density_kg_m3
    r = np.asarray(r0, float).copy()
    v = np.zeros_like(r)
    r_end = r + acceleration_path_m(cfg)
    active = r < r_end
    for _ in range(20_000):
        if not active.any():
            break
        ra, va = r[active], v[active]
        g = gas_field(ra, h, cfg)
        w = g.u - va
        aw = np.abs(w) + 1e-9
        mu = sutherland(g.T, eng.viscosity)
        Kn = mu / g.rho * math.sqrt(math.pi / (2 * eng.gas_constant_j_kg_k)) / np.sqrt(g.T) / D
        cd = drag_coefficient(
            Re=g.rho * aw * D / mu,
            Kn=Kn,
            s=aw / np.sqrt(2 * eng.gas_constant_j_kg_k * g.T),
            T_ratio=eng.wall_temp_k / g.T,
        )
        tau_p = 4 * rho_p * D / (3 * cd * g.rho * aw)
        # Exponential (exact for frozen gas) update with a midpoint time step.
        ds = cfg.velocity.step_rel * np.maximum(ra, 0.2 * h)
        v_pred = g.u - w * np.exp(-ds / np.maximum(va, 1.0) / tau_p)
        dt = ds / np.maximum(0.5 * (va + v_pred), 1.0)
        v_new = g.u - w * np.exp(-dt / tau_p)
        r[active] = ra + 0.5 * (va + v_new) * dt
        v[active] = v_new
        active = r < r_end
    return v


def launch_speed(r, D, h, emit, cfg: Config):
    """Launch speed of size class D from every ring (0 where nothing emits)."""
    v = np.zeros(len(r))
    if not emit.any():
        return v
    model = cfg.velocity.model
    if model is VelocityModels.INTEGRATED:
        v[emit] = integrate_launch_speed(r[emit], D, h, cfg)
    elif model is VelocityModels.FIG5:
        # The drag model's radial profile, rescaled so its maximum equals Fig. 5.
        profile = integrate_launch_speed(r, D, h, cfg)
        if profile.max() > 0:
            target = float(fig5_speed_scaled(h, np.array([D]), cfg)[0])
            v[emit] = profile[emit] * target / profile.max()
    else:
        raise NotImplementedError(model)
    return v


# 5. Fig. 5 validation against the traced contours
FIG5_LEVELS = (16, 25, 40, 63, 100, 160, 250, 400, 630, 1000, 1600)


def find_fig5_traces(folder=None):
    """The folder holding the traced contours: `folder` if given, else
    fig5_traces/ next to this file or one level up. None if not found."""
    candidates = [folder] if folder else [os.path.join(HERE, "fig5_traces"),
                                          os.path.join(os.path.dirname(HERE), "fig5_traces")]
    return next(filter(os.path.isdir, candidates), None)


def read_trace_csv(path):
    """Two columns "x;y" with decimal commas -> (x, y) arrays."""
    with open(path, encoding="utf-8") as f:
        rows = [[float(v.replace(",", ".")) for v in line.split(";")]
                for line in map(str.strip, f) if line]
    a = np.array(rows)
    return a[:, 0], a[:, 1]


def load_fig5_traces(folder=None):
    """WebPlotDigitizer traces ("h;D", decimal commas), one file per contour.
    Returns (u [m/s], h [m], D [um]) arrays, or None if no folder is found."""
    path = find_fig5_traces(folder)
    if path is None:
        return None
    files = {u: next((p for p in (os.path.join(path, f"{u}.csv"),
                                  os.path.join(path, f"{u} (1).csv"))
                      if os.path.isfile(p)), None) for u in FIG5_LEVELS}
    missing = [u for u, p in files.items() if p is None]
    if missing:
        raise FileNotFoundError(f"{path}: missing Fig. 5 contours {missing}")
    u, h, D = [], [], []
    for level, p in files.items():
        hs, Ds = read_trace_csv(p)
        u += [level] * len(hs)
        h += hs.tolist()
        D += Ds.tolist()
    return np.array(u, float), np.array(h), np.array(D)


def fig5_check(cfg: Config) -> tuple[bool, str]:
    """Score the Fig. 5 fit against the traced points. Returns (ok, message)."""
    traces = load_fig5_traces()
    if traces is None:
        return False, "Fig. 5 check: fig5_traces/ not found; fit unvalidated."
    u_obs, h, D_um = traces
    fit = cfg.velocity.fig5
    u_fit = fig5_speed(h, D_um * 1e-6, fit)
    lifted = u_fit > 0
    err = np.abs(u_fit[lifted] / u_obs[lifted] - 1.0)
    # Points on a contour that the fit puts clearly inside the no-lift region
    wrongly_cut = (~lifted) & (np.log10(D_um) + fit.no_lift_c1 * np.log10(h) - fit.no_lift_c0 > 0.01)
    ok = np.median(err) < 0.05 and not wrongly_cut.any()
    
    msg = (
        f"Fig. 5 fit vs {len(u_obs)} traced points: median error "
        f"{100 * np.median(err):.1f}%, max {100 * np.max(err):.0f}%"
        + (f", {wrongly_cut.sum()} wrongly in the no-lift region" if wrongly_cut.any() else "")
        + (". OK." if ok else ". Does NOT reproduce the figure.")
    )
    
    return ok, msg


# 6. Trajectories and impacts
def divot_volume(v, D, cfg: Config):
    """Sheldon & Kanhere (1972) [m^3]. The coefficient is a placeholder."""
    dmg = cfg.damage
    return (dmg.divot_coefficient * v ** 3 * D ** 3
            * cfg.regolith.grain_density_kg_m3 ** 1.5 * dmg.target_hardness_pa ** -1.5)


def divot_depth_um(volume):
    return (3 * volume / (2 * np.pi)) ** (1 / 3) * 1e6


@njit(parallel=True)
def _accumulate_numba(D, size_bin, speed, angle, r0, distances, heights, height_bin_m,
                      g_moon, moon_radius_m, v_escape, rho_particle, hardness, k_divot,
                      n_sizes, berm_r, berm_h):
    """Bin one chunk of trajectories. Per-thread arrays avoid write races."""
    n_threads = get_num_threads()
    shape = (n_threads, len(heights), len(distances), n_sizes)
    hits = np.zeros(shape, dtype=np.int64)
    v_cubed = np.zeros(shape)
    depth_sum = np.zeros(shape)
    coverage = np.zeros(shape)
    escaped = np.zeros(n_threads, dtype=np.int64)
    half_bin = height_bin_m / 2.0

    for i in prange(len(D)):
        t_id = get_thread_id()
        if speed[i] >= v_escape:
            escaped[t_id] += 1
        vh = speed[i] * math.cos(angle[i])
        vz = speed[i] * math.sin(angle[i])
        for iR in range(len(distances)):
            dx = distances[iR] - r0[i]
            if dx <= 0.5 or angle[i] <= 0.0 or vh <= 0.5:
                continue
            if berm_h > 0.0 and r0[i] < berm_r < distances[iR]:
                xb = berm_r - r0[i]
                tb = xb / vh
                zb = xb * math.tan(angle[i]) - 0.5 * g_moon * tb * tb + xb * xb / (2.0 * moon_radius_m)
                if zb < berm_h:
                    continue
            t = dx / vh
            z = dx * math.tan(angle[i]) - 0.5 * g_moon * t * t + dx * dx / (2.0 * moon_radius_m)
            v_imp = math.hypot(vh, vz - g_moon * t)
            for iz in range(len(heights)):
                if abs(z - heights[iz]) > half_bin:
                    continue
                volume = k_divot * v_imp ** 3 * D[i] ** 3 * rho_particle ** 1.5 * hardness ** -1.5
                depth = (3.0 * volume / (2.0 * math.pi)) ** (1.0 / 3.0) * 1e6
                b = size_bin[i]
                hits[t_id, iz, iR, b] += 1
                v_cubed[t_id, iz, iR, b] += v_imp ** 3
                depth_sum[t_id, iz, iR, b] += depth
                coverage[t_id, iz, iR, b] += math.pi * (depth * 1e-4) ** 2
    return (hits.sum(axis=0), v_cubed.sum(axis=0), depth_sum.sum(axis=0),
            coverage.sum(axis=0), escaped.sum())


def _accumulate_numpy(D, size_bin, speed, angle, r0, cfg: Config, n_sizes):
    """Vectorized twin of _accumulate_numba, used when numba is missing."""
    tg, g, R_moon = cfg.targets, cfg.moon.gravity_m_s2, cfg.moon.radius_m
    berm_r, berm_h = cfg.mitigation.berm_radius_m, cfg.mitigation.berm_height_m
    shape = (len(tg.heights_m), len(tg.distances_m), n_sizes)
    hits = np.zeros(shape, dtype=np.int64)
    v_cubed, depth_sum, coverage = np.zeros(shape), np.zeros(shape), np.zeros(shape)
    vh, vz = speed * np.cos(angle), speed * np.sin(angle)
    vh_safe = np.where(vh > 0.5, vh, 1.0)

    def height_at(dx):
        t = dx / vh_safe
        return dx * np.tan(angle) - 0.5 * g * t ** 2 + dx ** 2 / (2 * R_moon), t

    for iR, dist in enumerate(tg.distances_m):
        dx = dist - r0
        ok = (dx > 0.5) & (angle > 0) & (vh > 0.5)
        if berm_h > 0 and berm_r < dist:
            crosses = ok & (r0 < berm_r)
            zb, _ = height_at(berm_r - r0)
            ok &= ~(crosses & (zb < berm_h))
        if not ok.any():
            continue
        z, t = height_at(dx)
        v_imp = np.hypot(vh, vz - g * t)
        for iz, zt in enumerate(tg.heights_m):
            m = ok & (np.abs(z - zt) <= tg.height_bin_m / 2)
            if not m.any():
                continue
            b, depth = size_bin[m], divot_depth_um(divot_volume(v_imp[m], D[m], cfg))
            hits[iz, iR] += np.bincount(b, minlength=n_sizes)
            v_cubed[iz, iR] += np.bincount(b, weights=v_imp[m] ** 3, minlength=n_sizes)
            depth_sum[iz, iR] += np.bincount(b, weights=depth, minlength=n_sizes)
            coverage[iz, iR] += np.bincount(b, weights=np.pi * (depth * 1e-4) ** 2, minlength=n_sizes)
    return hits, v_cubed, depth_sum, coverage, int(np.count_nonzero(speed >= cfg.moon.escape_speed_m_s))


def _accumulate(D, size_bin, speed, angle, r0, cfg: Config, n_sizes):
    if not NUMBA_AVAILABLE:
        return _accumulate_numpy(D, size_bin, speed, angle, r0, cfg, n_sizes)
    tg, mit = cfg.targets, cfg.mitigation
    return _accumulate_numba(
        D, size_bin, speed, angle, r0,
        np.asarray(tg.distances_m, float), np.asarray(tg.heights_m, float), tg.height_bin_m,
        cfg.moon.gravity_m_s2, cfg.moon.radius_m, cfg.moon.escape_speed_m_s,
        cfg.regolith.grain_density_kg_m3, cfg.damage.target_hardness_pa,
        cfg.damage.divot_coefficient, n_sizes, float(mit.berm_radius_m), float(mit.berm_height_m))


def interpolate_speed(h_idx, D, r0, speed_grid, G: Grids):
    """Bilinear in (log D, r) on the launch-speed grid at descent step h_idx."""
    def bracket(grid, x):
        hi = np.clip(np.searchsorted(grid, x, side="right"), 1, len(grid) - 1)
        return hi - 1, hi, np.clip((x - grid[hi - 1]) / (grid[hi] - grid[hi - 1]), 0.0, 1.0)

    r_lo, r_hi, fr = bracket(G.r, r0)
    d_lo, d_hi, fd = bracket(np.log(G.D), np.log(D))
    lo = speed_grid[h_idx, d_lo, r_lo] + fr * (speed_grid[h_idx, d_lo, r_hi] - speed_grid[h_idx, d_lo, r_lo])
    hi = speed_grid[h_idx, d_hi, r_lo] + fr * (speed_grid[h_idx, d_hi, r_hi] - speed_grid[h_idx, d_hi, r_lo])
    return lo + fd * (hi - lo)


def sample_impacts(law: ErosionLaws, angle_deg, emitted, speed_grid, G: Grids, cfg: Config,
                   chunk=25_000):
    """Monte Carlo over one branch: sample emitted grains in proportion to
    `emitted` (grains per (h, D, ring) cell), fly them, and bin the impacts.

    Densities are per cm^2 of the cylindrical target band at each distance.
    """
    n_samples = cfg.monte_carlo.particles_per_branch
    tg = cfg.targets
    n_sizes = len(G.D)
    shape = (len(tg.heights_m), len(tg.distances_m), n_sizes)
    out = {"hit_counts": np.zeros(shape, dtype=np.int64), "density": np.zeros(shape),
           "velocity_cubed": np.zeros(shape), "depth_sum": np.zeros(shape),
           "coverage": np.zeros(shape)}
    flat = emitted.ravel()
    total = float(flat.sum())
    out["total_emitted"], out["escaped_fraction"] = total, 0.0
    if total <= 0:
        return out

    # Same seeds as before the refactor, so results are reproducible across it.
    seed = (cfg.monte_carlo.seed + 1000 * cfg.erosion.laws.index(law)
            + int(round(angle_deg * 10)))
    rng = np.random.default_rng(seed)
    cdf = np.cumsum(flat / total)
    cdf[-1] = 1.0
    n_rings = emitted.shape[2]
    angle_mean = math.radians(angle_deg)
    angle_sd = math.radians(cfg.ejection.spread_sd_deg)
    band_area_cm2 = 2 * np.pi * np.asarray(tg.distances_m) * tg.height_bin_m * 1e4
    weight = (total / n_samples) / band_area_cm2[None, :, None]
    escaped = 0

    for start in range(0, n_samples, chunk):
        size = min(chunk, n_samples - start)
        cell = np.minimum(np.searchsorted(cdf, rng.random(size), side="right"), len(flat) - 1)
        r_idx, D_idx, h_idx = cell % n_rings, (cell // n_rings) % n_sizes, cell // (n_sizes * n_rings)

        # Area-uniform launch radius within the ring
        e = G.edges_r
        r0 = np.sqrt(e[r_idx] ** 2 + rng.random(size) * (e[r_idx + 1] ** 2 - e[r_idx] ** 2))
        # Diameter from the NUMBER distribution, within the sampled size bin
        q = G.cdf_D_number[D_idx] + rng.random(size) * (G.cdf_D_number[D_idx + 1] - G.cdf_D_number[D_idx])
        q = np.clip(q, np.finfo(float).eps, 1 - np.finfo(float).eps)
        D = G.d50_number_m * np.exp(G.ln_sigma * ndtri(q))
        size_bin = np.clip(np.searchsorted(G.edges_D, D, side="right") - 1, 0, n_sizes - 1)

        angle = rng.normal(angle_mean, angle_sd, size)
        speed = interpolate_speed(h_idx, D, r0, speed_grid, G)
        hits, v3, depth, cov, esc = _accumulate(D, size_bin, speed, angle, r0, cfg, n_sizes)
        escaped += int(esc)
        out["hit_counts"] += hits
        out["density"] += hits * weight
        out["velocity_cubed"] += v3 * weight
        out["depth_sum"] += depth * weight
        out["coverage"] += cov * weight

    out["escaped_fraction"] = escaped / n_samples
    return out


# ---------------------------------------------------------------------------
# 7. Checkpoint (JSON state + compressed arrays)
# ---------------------------------------------------------------------------
def new_state(cfg: Config, G: Grids) -> dict:
    laws = cfg.erosion.laws
    nH, nD, nr = len(G.h), len(G.D), len(G.r)
    return {
        "version": STATE_VERSION,
        "run_hash": cfg.run_hash(),
        "status": "IN_PROGRESS",
        "created": datetime.now(timezone.utc).isoformat(),
        "updated": None,
        "steps_done": 0,
        "steps_total": nH * nD,
        "branches_done": {branch_tag(l, a): False for l in laws for a in cfg.ejection.angles_deg},
        "acc": {
            "mass_kg": {l.value: 0.0 for l in laws},
            "mass_outer_ring_kg": {l.value: 0.0 for l in laws},
            "mass_by_h_kg": {l.value: [0.0] * nH for l in laws},
            "mass_by_D_kg": {l.value: [0.0] * nD for l in laws},
            "tau_max_by_h_Pa": [0.0] * nH,
            "r_tau_max_by_h_m": [0.0] * nH,
            "E_max_by_h_W_m2": [0.0] * nH,
            "mc": {},
        },
        "_arrays": {f"emitted_{l.value}": np.zeros((nH, nD, nr)) for l in laws}
                   | {"speed": np.zeros((nH, nD, nr))},
    }


MC_ARRAYS = ("hit_counts", "density", "velocity_cubed", "depth_sum", "coverage")


def mc_key(tag: str, name: str) -> str:
    """Name of one branch's Monte Carlo array in the checkpoint's .npz."""
    return f"mc {tag} {name}"


def branch_mc(st, tag: str) -> dict:
    """One branch's Monte Carlo sums: the scalars from the JSON state plus
    its per-grain-class arrays, shaped (heights, distances, sizes)."""
    d = dict(st["acc"]["mc"][tag])
    d.update({name: st["_arrays"][mc_key(tag, name)] for name in MC_ARRAYS})
    return d


def _array_path(checkpoint_path, array_file):
    """The .npz sits next to checkpoint.json; only its file name is stored,
    so a cache folder can be moved or copied to another computer."""
    return os.path.join(os.path.dirname(os.path.abspath(checkpoint_path)), os.path.basename(array_file))


def save_checkpoint(path, state):
    state["updated"] = datetime.now(timezone.utc).isoformat()
    previous = state.get("array_file")
    array_path = f"{path}.{uuid.uuid4().hex}.npz"
    tmp = array_path + ".tmp"
    try:
        with open(tmp, "wb") as f:
            np.savez_compressed(f, **state["_arrays"])
        os.replace(tmp, array_path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    state["array_file"] = os.path.basename(array_path)
    arrays = state.pop("_arrays")
    try:
        with open(path + ".tmp", "w", encoding="utf-8") as f:
            json.dump(state, f)
        for attempt in range(10):           # Windows: the file may be locked briefly
            try:
                os.replace(path + ".tmp", path)
                break
            except PermissionError:
                time.sleep(0.2 * (attempt + 1))
        else:
            raise PermissionError(f"could not replace checkpoint {path}")
    finally:
        state["_arrays"] = arrays
    if previous:
        previous = _array_path(path, previous)
        if previous != os.path.abspath(array_path) and os.path.exists(previous):
            os.remove(previous)


def load_checkpoint(path, cfg: Config):
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        st = json.load(f)
    if st.get("version") != STATE_VERSION:
        print(f"[checkpoint] {path} is from an older version; starting over.")
        return None
    if st.get("run_hash") != cfg.run_hash():
        sys.exit(f"[checkpoint] {path} belongs to a different configuration; "
                 f"rerun with --reset.")
    _load_arrays(path, st)
    return st


def _load_arrays(path, st):
    with np.load(_array_path(path, st["array_file"]), allow_pickle=False) as arrays:
        st["_arrays"] = {name: arrays[name] for name in arrays.files}


def delete_checkpoint(path):
    if not os.path.exists(path):
        return
    try:
        with open(path, encoding="utf-8") as f:
            array_file = json.load(f).get("array_file")
    except json.JSONDecodeError:
        array_file = None
    if array_file:
        array_file = _array_path(path, array_file)
        if os.path.basename(array_file).startswith(os.path.basename(path) + ".") and os.path.exists(array_file):
            os.remove(array_file)
    os.remove(path)


# ---------------------------------------------------------------------------
# 8. Run
# ---------------------------------------------------------------------------
def run(cfg: Config, checkpoint_path, max_steps=None, save_interval_s=2.0):
    """Compute (or resume) one configuration. Returns (state, grids)."""
    t_start = time.perf_counter()
    G = build_grids(cfg)
    laws = cfg.erosion.laws
    epsilon, raw_kg = (calibrated_epsilon(cfg) if ErosionLaws.ENERGY_FLUX in laws
                       else (cfg.erosion.energy_flux.epsilon, float("nan")))
    _report_setup(cfg, epsilon, raw_kg)

    st = load_checkpoint(checkpoint_path, cfg)
    if st is not None and st["status"] == "COMPLETED":
        print(f"[checkpoint] already complete ({checkpoint_path}).")
        return st, G
    if st is None:
        st = new_state(cfg, G)
    else:
        print(f"[resume] {st['steps_done']}/{st['steps_total']} source steps done")
    st["epsilon_energy_flux"] = epsilon

    # --- stage 1: source grid, one (height, size) step at a time ----------
    acc, arrays = st["acc"], st["_arrays"]
    emitted = {l: arrays[f"emitted_{l.value}"] for l in laws}
    speed_grid = arrays["speed"]
    nD = len(G.D)
    outer_rings = G.r > 0.8 * G.r[-1]
    steps_this_run, last_save = 0, time.time()

    for step in range(st["steps_done"], st["steps_total"]):
        k, i = divmod(step, nD)
        h, D = G.h[k], G.D[i]
        gas = gas_field(G.r, h, cfg)
        if i == 0:
            j = int(np.argmax(gas.tau))
            acc["tau_max_by_h_Pa"][k], acc["r_tau_max_by_h_m"][k] = float(gas.tau[j]), float(G.r[j])
            acc["E_max_by_h_W_m2"][k] = float(gas.E.max())

        v = launch_speed(G.r, D, h, emits_anywhere(laws, gas, D, cfg), cfg)
        speed_grid[k, i] = v
        # A grain with no launch speed is not ejected (under fig5 that is the
        # figure's no-lift region); nothing launches from a paved pad.
        launched = (v > 0) & (G.r >= cfg.mitigation.pad_radius_m)
        rates = erosion_rates(laws, gas, D, G.w_mass[i], v, launched, cfg, epsilon)

        grain_mass = cfg.regolith.grain_density_kg_m3 * math.pi / 6 * D ** 3
        for law, rate in rates.items():
            per_ring_kg = rate * G.area_r * G.dt
            emitted[law][k, i] = per_ring_kg / grain_mass
            key = law.value
            acc["mass_kg"][key] += float(per_ring_kg.sum())
            acc["mass_outer_ring_kg"][key] += float(per_ring_kg[outer_rings].sum())
            acc["mass_by_h_kg"][key][k] += float(per_ring_kg.sum())
            acc["mass_by_D_kg"][key][i] += float(per_ring_kg.sum())

        st["steps_done"] = step + 1
        steps_this_run += 1
        paused = max_steps is not None and steps_this_run >= max_steps
        if paused or time.time() - last_save >= save_interval_s:
            save_checkpoint(checkpoint_path, st)
            last_save = time.time()
        if i == nD - 1:
            masses = " ".join(f"{l}={acc['mass_kg'][l]:.3g} kg" for l in acc["mass_kg"])
            print(f"  h={h:5.1f} m  tau_max={acc['tau_max_by_h_Pa'][k]:7.3f} Pa  {masses}  "
                  f"[{100 * st['steps_done'] / st['steps_total']:5.1f}%]")
        if paused:
            print(f"[pause] {st['steps_done']}/{st['steps_total']} source steps; "
                  f"run again to continue ({time.perf_counter() - t_start:.0f} s)")
            return st, G

    if steps_this_run:
        save_checkpoint(checkpoint_path, st)    # the finished source grid
    _warn_truncated_footprint(acc)

    # --- stage 2: Monte Carlo per branch ----------------------------------
    # The source grid does not depend on the ejection angle, so the angle
    # sweep reuses it and costs only trajectories.
    for law in laws:
        for angle in cfg.ejection.angles_deg:
            tag = branch_tag(law, angle)
            if st["branches_done"][tag]:
                continue
            t0 = time.perf_counter()
            s = sample_impacts(law, angle, emitted[law], speed_grid, G, cfg)
            for name in MC_ARRAYS:
                arrays[mc_key(tag, name)] = s[name]
            acc["mc"][tag] = {k: v for k, v in s.items() if k not in MC_ARRAYS}
            st["branches_done"][tag] = True
            save_checkpoint(checkpoint_path, st)
            print(f"[monte carlo] {tag}: {cfg.monte_carlo.particles_per_branch:,} "
                  f"trajectories in {time.perf_counter() - t0:.1f} s")

    st["status"] = "COMPLETED"
    save_checkpoint(checkpoint_path, st)
    print(f"[done] {time.perf_counter() - t_start:.0f} s")
    return st, G


def _report_setup(cfg: Config, epsilon, raw_kg):
    print(f"[validate] {fig5_check(cfg)[1]}")
    print(f"[config] velocity model {cfg.velocity.model.value}, thrust "
          f"{cfg.engine.thrust_n / 1000:g} kN, acceleration path {acceleration_path_m(cfg):.1f} m, "
          f"{'numba' if NUMBA_AVAILABLE else 'NumPy fallback'}")
    mit = cfg.mitigation
    if mit.pad_radius_m > 0 or mit.berm_height_m > 0:
        print(f"[config] mitigation: pad {mit.pad_radius_m:g} m, berm "
              f"{mit.berm_height_m:g} m high at {mit.berm_radius_m:g} m")
    law = cfg.erosion.energy_flux
    if ErosionLaws.ENERGY_FLUX in cfg.erosion.laws and law.calibrate:
        print(f"[calibrate] energy flux: published eps {law.epsilon:.4g} erodes "
              f"{raw_kg / 1000:.4g} t on the calibration vehicle; rescaled to "
              f"{epsilon:.4g} for {law.calibrate_to_mass_t:g} t.")


def _warn_truncated_footprint(acc):
    for law, total in acc["mass_kg"].items():
        frac = acc["mass_outer_ring_kg"][law] / total if total > 0 else 0.0
        if frac > 0.01:
            print(f"[warning] {law}: {100 * frac:.1f}% of eroded mass is in the outer "
                  f"20% of the source grid; raise source.r_max_m")


# ---------------------------------------------------------------------------
# 9. Results
# ---------------------------------------------------------------------------
def nearest(values, x) -> int:
    return int(np.argmin(np.abs(np.asarray(values, float) - x)))


def postprocess(st, G: Grids, cfg: Config) -> dict:
    """Per-branch densities, the envelope across branches, and the Surveyor
    III comparison, as plain JSON-ready types."""
    acc, tg, sv = st["acc"], cfg.targets, cfg.surveyor
    n_samples = cfg.monte_carlo.particles_per_branch
    band_area_cm2 = 2 * np.pi * np.asarray(tg.distances_m) * tg.height_bin_m * 1e4

    branches = {}
    for law in cfg.erosion.laws:
        for angle in cfg.ejection.angles_deg:
            if branch_tag(law, angle) not in acc["mc"]:
                continue
            d = branch_mc(st, branch_tag(law, angle))
            density = np.array(d["density"]).sum(axis=2)
            depth_sum = np.array(d["depth_sum"]).sum(axis=2)
            p_hit = np.array(d["hit_counts"]).sum(axis=2) / n_samples
            branches[branch_tag(law, angle)] = {
                "model": law.value, "angle_deg": angle,
                "escaped_fraction": d["escaped_fraction"],
                "density_total_per_cm2": density,
                "mc_standard_error_per_cm2": (d["total_emitted"] / band_area_cm2[None, :])
                                             * np.sqrt(p_hit * (1 - p_hit) / n_samples),
                "mean_depth_um": np.divide(depth_sum, density, out=np.zeros_like(density),
                                           where=density > 0),
                "coverage_fraction": np.array(d["coverage"]).sum(axis=2),
            }

    iz_hw, iz_sv = nearest(tg.heights_m, tg.hardware_height_m), nearest(tg.heights_m, sv.height_m)
    iR_sv = nearest(tg.distances_m, sv.distance_m)
    stack = np.array([b["density_total_per_cm2"] for b in branches.values()])
    lo, hi = stack.min(axis=0), stack.max(axis=0)
    at_surveyor = stack[:, iz_hw, iR_sv]
    hit = at_surveyor[at_surveyor > 0]

    to_list = lambda b: {k: (v.tolist() if isinstance(v, np.ndarray) else v) for k, v in b.items()}
    D_um = G.D * 1e6
    return {
        "meta": {
            "generated": datetime.now(timezone.utc).isoformat(),
            "config": cfg.to_dict(),
            "run_hash": cfg.run_hash(),
            "epsilon_energy_flux": st.get("epsilon_energy_flux"),
            "uncertainty": "epistemic = spread across branches; the Monte Carlo "
                           "standard error is reported per branch and is far smaller",
        },
        "total_mass_eroded_kg": acc["mass_kg"],
        "mass_eroded_by_h": {"h_m": G.h.tolist(), "kg": acc["mass_by_h_kg"]},
        "tau_max_by_h": {"h_m": G.h.tolist(), "tau_Pa": acc["tau_max_by_h_Pa"],
                         "E_W_m2": acc["E_max_by_h_W_m2"], "r_at_max_m": acc["r_tau_max_by_h_m"]},
        "v_eject_max_by_D": {"D_um": D_um.tolist(),
                             "v_m_s": st["_arrays"]["speed"].max(axis=(0, 2)).tolist()},
        "fig5_speed_by_D": {"D_um": D_um.tolist(), "h_m": cfg.descent.start_height_m,
                            "u_max_m_s": fig5_speed_scaled(cfg.descent.start_height_m, G.D, cfg).tolist()},
        "exposure_envelope": {
            "target_heights_m": list(tg.heights_m), "distances_m": list(tg.distances_m),
            "density_min_per_cm2": lo.tolist(),
            "density_median_per_cm2": np.median(stack, axis=0).tolist(),
            "density_max_per_cm2": hi.tolist(),
            "n_branches": len(branches),
            # Over branches that hit at all; a zero has no logarithm.
            "spread_decades_at_nominal": float(np.log10(hit.max() / hit.min())) if hit.size else None,
            "n_zero_at_nominal": int((at_surveyor <= 0).sum()),
        },
        "branches": {tag: to_list(b) for tag, b in branches.items()},
        "surveyor_comparison": {
            "distance_m": sv.distance_m,
            "nominal_height_m": tg.heights_m[iz_hw],
            "crater_height_m": tg.heights_m[iz_sv],
            "measured_pit_density_per_cm2": sv.pit_density_per_cm2,
            "note": "Surveyor III sat inside a ~200 m crater, below the plain, so the "
                    "crater-height column is the like-for-like comparison. SP-284 gives "
                    "155 m; Metzger's ~3 divots/cm^2 is tied to 180 m. SP-284 also "
                    "concludes the blast cleaned rather than coated the spacecraft.",
            "by_branch": {tag: {
                "at_nominal_height": float(b["density_total_per_cm2"][iz_hw, iR_sv]),
                "at_surveyor_crater_height": float(b["density_total_per_cm2"][iz_sv, iR_sv]),
                "mean_depth_um_nominal": float(b["mean_depth_um"][iz_hw, iR_sv]),
            } for tag, b in branches.items()},
        },
    }


def run_directory(cfg: Config, cache_dir=None) -> str:
    """Cache folder of one configuration: its run hash plus a hash of this
    file, so editing the physics never silently reuses old results."""
    with open(os.path.abspath(__file__), "rb") as f:
        code_tag = hashlib.sha256(f.read()).hexdigest()[:8]
    return os.path.join(cache_dir or os.path.join(HERE, "psi_cache"),
                        f"{cfg.run_hash()}_{code_tag}")


def cached_state(cfg: Config, cache_dir=None):
    """The completed checkpoint state of a cached run, or None. Never runs
    anything. branch_mc(state, tag) gives the per-grain-class Monte Carlo
    sums, which results{} only keeps summed."""
    found = _completed_json(cfg, cache_dir)
    if found is None:
        return None
    path, st = found
    _load_arrays(path, st)
    return st


def is_completed(cfg: Config, cache_dir=None) -> bool:
    """True if this configuration is cached and complete (reads only the JSON)."""
    return _completed_json(cfg, cache_dir) is not None


def _completed_json(cfg: Config, cache_dir=None):
    path = os.path.join(run_directory(cfg, cache_dir), "checkpoint.json")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        st = json.load(f)
    if st.get("version") != STATE_VERSION or st.get("status") != "COMPLETED":
        return None
    return path, st


def simulate(cfg: Config, cache_dir=None, quiet=True) -> dict:
    """Run one configuration with caching and return its results."""
    run_dir = run_directory(cfg, cache_dir)
    os.makedirs(run_dir, exist_ok=True)
    with contextlib.redirect_stdout(io.StringIO()) if quiet else contextlib.nullcontext():
        st, G = run(cfg, os.path.join(run_dir, "checkpoint.json"), save_interval_s=30.0)
    return postprocess(st, G, cfg)


def print_summary(res: dict):
    print("\n" + "=" * 74 + "\nRESULTS\n" + "=" * 74)
    print("\nTotal eroded mass per landing:")
    for law, kg in res["total_mass_eroded_kg"].items():
        print(f"  {law:<14} {kg:>12.1f} kg  ({kg / 1000:.2f} t)")
    print("  literature: 11-26 t (Metzger 2024), superseding 2.6 t")

    env = res["exposure_envelope"]
    spread = env["spread_decades_at_nominal"]
    print(f"\nAt the Surveyor distance, {env['n_zero_at_nominal']} of {env['n_branches']} "
          f"branches give no hits; the rest span "
          + (f"{spread:.1f} decades" if spread is not None else "nothing"))

    sc = res["surveyor_comparison"]
    print(f"\nSurveyor III at {sc['distance_m']:g} m (measured ~{sc['measured_pit_density_per_cm2']:g} pits/cm^2):")
    flat, crater = f"{sc['nominal_height_m']:+g} m", f"{sc['crater_height_m']:+g} m"
    print(f"  {'branch':<22} {flat:>12} {crater:>12} {'depth um':>10}")
    for tag, c in sc["by_branch"].items():
        print(f"  {tag:<22} {c['at_nominal_height']:>12.4g} "
              f"{c['at_surveyor_crater_height']:>12.4g} {c['mean_depth_um_nominal']:>10.2f}")

    own, fig5 = res["v_eject_max_by_D"], res["fig5_speed_by_D"]
    print(f"\nLaunch speed, max over the descent vs Fig. 5 at h = {fig5['h_m']:g} m:")
    print(f"  {'D um':>8} {'this run':>10} {'Fig. 5':>10}")
    n = len(own["D_um"])
    for i in sorted({0, n // 4, n // 2, 3 * n // 4, n - 1}):
        print(f"  {own['D_um'][i]:>8.1f} {own['v_m_s'][i]:>10.1f} {fig5['u_max_m_s'][i]:>10.1f}")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out-dir", default=HERE)
    ap.add_argument("--checkpoint", default=None)
    ap.add_argument("--max-steps", type=int, default=None)
    ap.add_argument("--save-interval", type=float, default=2.0)
    ap.add_argument("--reset", action="store_true")
    ap.add_argument("--velocity-model", type=VelocityModels, choices=list(VelocityModels))
    ap.add_argument("--thrust", type=float, help="hover thrust [N]")
    ap.add_argument("--mc", type=int, help="Monte Carlo trajectories per branch")
    a = ap.parse_args()
    with contextlib.suppress(AttributeError):
        sys.stdout.reconfigure(encoding="utf-8")

    changes = {"velocity.model": a.velocity_model, "engine.thrust_n": a.thrust,
               "monte_carlo.particles_per_branch": a.mc}
    cfg = Config().with_(**{k: v for k, v in changes.items() if v is not None})

    os.makedirs(a.out_dir, exist_ok=True)
    checkpoint = a.checkpoint or os.path.join(a.out_dir, "psi_checkpoint.json")
    if a.reset:
        delete_checkpoint(checkpoint)
    st, G = run(cfg, checkpoint, a.max_steps, a.save_interval)
    if st["status"] == "COMPLETED":
        res = postprocess(st, G, cfg)
        with open(os.path.join(a.out_dir, "psi_results.json"), "w", encoding="utf-8") as f:
            json.dump(res, f, indent=1)
        print_summary(res)


if __name__ == "__main__":
    main()