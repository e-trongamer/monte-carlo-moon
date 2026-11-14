"""Build the six-panel plume and impact summary figure."""
from __future__ import annotations

import math, os, time
from datetime import datetime
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

import psi_simulation as P
import psi_study as S

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "psi_figure_revised.png")

# Use the full simulation settings for the baseline and thrust sweep.
# The sweep changes thrust only.
INHERIT_SIMULATION_CONFIG = True

BASE = dict(n_D=14, n_r=45, dh_m=2.0, mc_particles_per_model=1_000_000)
SWEEP = dict(n_D=10, n_r=35, dh_m=4.0, mc_particles_per_model=100_000)


def envelope(stack):
    """Min/median/max over branches, ignoring bins where a branch got NO
    Monte Carlo samples. A zero there means 'below sampling detection', not
    'zero flux' — flooring it would repeat the original figure's mistake.
    Returns (lo, med, hi, undetected_mask).
    """
    s = np.asarray(stack, float)
    pos = s > 0
    any_zero = ~pos.all(axis=0)
    masked = np.where(pos, s, np.nan)
    with np.errstate(invalid="ignore"):
        lo = np.nanmin(masked, axis=0)
        hi = np.nanmax(masked, axis=0)
        med = np.nanmedian(masked, axis=0)
    return lo, med, hi, any_zero & pos.any(axis=0)


def run_once(overrides):
    # Cached like every other study: a configuration that escalation.py or
    # mitigation.py already computed is read from psi_cache, not rerun.
    return P.simulate(overrides)


def main():
    plot_started = time.perf_counter()
    print(f"[plotter] started {datetime.now().astimezone().isoformat(timespec='seconds')}")
    print("running baseline ...")
    baseline_overrides = {} if INHERIT_SIMULATION_CONFIG else BASE
    sweep_overrides = {} if INHERIT_SIMULATION_CONFIG else SWEEP
    baseline_started = time.perf_counter()
    cfg, G, res = run_once(baseline_overrides)
    print(f"[plotter] baseline complete at "
          f"{datetime.now().astimezone().isoformat(timespec='seconds')} in "
          f"{time.perf_counter() - baseline_started:.1f} s")

    R = np.array(cfg["target_distances_m"], float)
    z_list = np.array(cfg["target_heights_sensitivity_m"], float)
    iz = int(np.argmin(np.abs(z_list - cfg["target_height_m"])))
    iz_cr = int(np.argmin(np.abs(z_list - cfg["surveyor_height_m"])))
    iR_s = int(np.argmin(np.abs(R - cfg["surveyor_distance_m"])))
    branches = res["branches"]

    fig, ax = plt.subplots(3, 2, figsize=(15, 16))
    fig.suptitle(
        f"Lunar PSI, {len(branches)} branches "
        f"({len(cfg['erosion_models'])} erosion laws x "
        f"{len(cfg['angle_hypotheses_deg'])} selected Apollo ejection angles)\n"
        f"target height {z_list[iz]:g} m · Surveyor distance "
        f"{cfg['surveyor_distance_m']:g} m · {cfg['mc_particles_per_model']:,} "
        f"trajectories per branch",
        fontsize=13, fontweight="bold")

    # Impact density by distance
    a = ax[0, 0]
    stack = np.array([np.array(b["density_total_per_cm2"])[iz] for b in branches.values()])
    lo, med, hi, undet = envelope(stack)
    a.fill_between(R, lo, hi, alpha=0.25, color="tab:blue",
                   label="range across model and angle cases")
    a.plot(R, med, "o-", color="tab:blue", ms=3, label="branch median")
    if undet.any():
        a.plot(R[undet], lo[undet], "v", color="tab:blue", ms=7, mfc="none",
               label="some branches below MC detection")
    for m, c in zip(cfg["erosion_models"], ("tab:green", "tab:orange", "tab:red")):
        sub = np.array([np.array(b["density_total_per_cm2"])[iz]
                        for b in branches.values() if b["model"] == m])
        _, sm, _, _ = envelope(sub)
        a.plot(R, sm, "--", lw=1.2, color=c, label=f"{m} median")
    a.plot([cfg["surveyor_distance_m"]], [cfg["pit_reference_per_cm2"]], "k*", ms=16,
           label="Surveyor III measurement", zorder=5)
    a.set_xscale("log"); a.set_yscale("log")
    a.set_xlabel("Distance from lander (m)"); a.set_ylabel("Impact density (cm$^{-2}$)")
    a.set_title("Impact density by distance")
    a.legend(fontsize=7.5); a.grid(alpha=0.3, which="both")

    # Ejecta sheet geometry
    a = ax[0, 1]
    d = np.linspace(1, 2000, 400)
    for ang in cfg["angle_hypotheses_deg"]:
        t = d / max(400 * math.cos(math.radians(ang)), 1e-9)
        zc = (d * math.tan(math.radians(ang)) - 0.5 * cfg["g_moon"] * t ** 2
              + d ** 2 / (2 * cfg["R_moon_m"]))
        a.plot(d, zc, label=f"{ang}°")
    for zz, st_ in ((z_list[iz], "-"), (z_list[iz_cr], ":")):
        a.axhline(zz, color="k", ls=st_, lw=1,
                  label=f"target z = {zz:g} m")
    a.axvline(cfg["surveyor_distance_m"], color="grey", ls="--", lw=1)
    a.set_ylim(-10, 60); a.set_xlim(0, 2000)
    a.set_xlabel("Distance from lander (m)"); a.set_ylabel("Sheet height above local surface (m)")
    a.set_title("(reference speed 400 m/s; crossing distance scales with angle)")
    a.legend(fontsize=7.5, ncol=2); a.grid(alpha=0.3)

    # Impact density by target height
    a = ax[1, 0]
    for m, c in zip(cfg["erosion_models"], ("tab:green", "tab:orange", "tab:red")):
        sub = np.array([np.array(b["density_total_per_cm2"])[:, iR_s]
                        for b in branches.values() if b["model"] == m])
        slo, smed, shi, _ = envelope(sub)
        a.fill_between(z_list, slo, shi, alpha=0.2, color=c)
        a.plot(z_list, smed, "o-", color=c, ms=4, label=m)
    a.axhline(cfg["pit_reference_per_cm2"], color="k", ls="--", lw=1.2,
              label="Surveyor III measurement")
    a.axvline(cfg["surveyor_height_m"], color="grey", ls=":", lw=1.5)
    a.annotate("Surveyor III sat ~3 m below\nthe surrounding plain,\ninside a ~200 m crater",
               xy=(cfg["surveyor_height_m"], cfg["pit_reference_per_cm2"]),
               xytext=(-5.5, 3e5), fontsize=7.5,
               arrowprops=dict(arrowstyle="->", lw=0.8))
    a.set_yscale("log")
    a.set_xlabel("Target height above the landing plane (m)")
    a.set_ylabel(f"Impact density at {cfg['surveyor_distance_m']:g} m (cm$^{{-2}}$)")
    a.set_title("Impact density by target height\n"
                "Lines show medians; shading shows branch ranges")
    a.legend(fontsize=8); a.grid(alpha=0.3, which="both")

    # Exposure versus thrust
    a = ax[1, 1]
    thrusts = [3600.0, 11600.0, 25000.0, 44000.0, 100000.0]
    print("running thrust sweep ...")
    ref_res = {}
    curves = {}
    for T in thrusts:
        sweep_started = time.perf_counter()
        print(f"[plotter] starting thrust run at {T / 1000:g} kN")
        cfg_t, _, res_t = P.simulate(dict(sweep_overrides, thrust_N=T))
        if T == S.APOLLO_LM_THRUST_N:
            ref_res = res_t
        curves[T] = (cfg_t, res_t)
        print(f"  thrust {T/1000:g} kN completed at "
              f"{datetime.now().astimezone().isoformat(timespec='seconds')} "
              f"(completed in {time.perf_counter() - sweep_started:.1f} s)")
    if not ref_res:
        _, _, ref_res = P.simulate(dict(sweep_overrides, thrust_N=S.APOLLO_LM_THRUST_N))
    c2 = next(iter(curves.values()))[0]
    z2 = c2["target_heights_sensitivity_m"]; R2 = c2["target_distances_m"]
    j = S.nearest(z2, c2["target_height_m"]); jR = S.nearest(R2, c2["surveyor_distance_m"])
    ratios = []
    for T in thrusts:
        res_t = curves[T][1]
        row = []
        for tag, b in res_t["branches"].items():
            num = np.array(b["density_total_per_cm2"])[j, jR]
            den = np.array(ref_res["branches"][tag]["density_total_per_cm2"])[j, jR]
            row.append(num / den if den > 0 and num > 0 else np.nan)
        ratios.append(row)
    ratios = np.array(ratios)
    with np.errstate(invalid="ignore"):
        r_lo, r_md, r_hi = (np.nanmin(ratios, 1), np.nanmedian(ratios, 1),
                            np.nanmax(ratios, 1))
    tk = np.array(thrusts) / 1000.0
    a.fill_between(tk, r_lo, r_hi, alpha=0.25, color="tab:purple",
                   label="range over branches")
    a.plot(tk, r_md, "o-", color="tab:purple", label="branch median")
    for expo, st_, lab in ((1.0, "--", r"$\propto$ thrust$^{1.0}$ (mass-flow law)"),
                           (2.5, ":", r"$\propto$ thrust$^{2.5}$ (Apollo video fit)")):
        a.plot(tk, (tk / (S.APOLLO_LM_THRUST_N / 1000)) ** expo, st_, color="k",
               lw=1.1, label=lab)
    a.axhline(1.0, color="grey", lw=0.8)
    a.axvspan(2 * S.APOLLO_LM_THRUST_N / 1000, tk.max() * 1.1, color="grey", alpha=0.12)
    a.set_xscale("log"); a.set_yscale("log")
    a.set_xlabel("Hover thrust (kN)")
    a.set_ylabel(f"Exposure relative to Apollo LM\n"
                 f"({c2['surveyor_distance_m']:g} m, {z2[j]:g} m high, same branch)")
    a.set_title(f"Exposure relative to Apollo 12 ({c2['velocity_model']} model)\n"
                "Grey shading marks thrusts outside the modeled regime")
    a.legend(fontsize=7.5); a.grid(alpha=0.3, which="both")

    # Launch-speed comparison
    a = ax[2, 0]
    vd = res["v_eject_max_by_D"]; lm = res["v_lane_metzger_by_D"]
    _, msg, diag = P.lane_metzger_check(cfg, G, h=1.0)
    a.plot(vd["D_um"], vd["v_m_s"], "o-", ms=3,
           label=f"{cfg['velocity_model']} branch (max over descent)")
    lm_label = "L&M Fig. 5 maximum" if cfg.get("lm_use_fig5", True) else "L&M Eq. 7 maximum"
    a.plot(lm["D_um"], lm["u_max_m_s"], "-", lw=1.8,
           color="tab:red", label=f"{lm_label} at h={cfg['h_start_m']:g} m")
    a.plot(lm["D_um"], P.lane_metzger_fig5(1.0, np.array(G["D"]), cfg), "--", lw=1.8,
           color="tab:pink", label="L&M Fig. 5 maximum at h=1 m")
    a.axhline(cfg["v_escape_m_s"], color="k", ls=":", lw=1,
              label=f"lunar escape ({cfg['v_escape_m_s']:g} m/s)")
    a.axhspan(300, 2000, color="grey", alpha=0.18,
              label="Surveyor III inferred 300–2000 m/s")
    a.set_xscale("log"); a.set_yscale("log"); a.set_ylim(1e-1, 1e4)
    a.set_xlabel("Particle diameter D (µm)"); a.set_ylabel("Max ejection velocity (m/s)")
    a.set_title(
        "Launch-speed comparison\n"
        f"Lane-Metzger Fig. 5 fit: median error {diag['median_err_pct']:.1f}% "
        f"across {diag['n_points']} points"
    )
    a.legend(fontsize=7, loc="lower left"); a.grid(alpha=0.3, which="both")

    # Sampling error and model range
    a = ax[2, 1]
    nom = [b for b in branches.values()
           if b["model"] == "scaling" and abs(b["angle_deg"] - cfg["angle_nominal_deg"]) < 1e-9]
    if nom:
        dn = np.array(nom[0]["density_total_per_cm2"])[iz]
        se = np.array(nom[0]["mc_standard_error_per_cm2"])[iz]
        m = dn > 0
        a.fill_between(R[m], np.maximum(dn[m] - 1.96 * se[m], dn[m] * 1e-3),
                       dn[m] + 1.96 * se[m],
                       color="tab:orange", alpha=0.9, label="Monte Carlo 95% (sampling only)")
    a.fill_between(R, lo, hi, color="tab:blue", alpha=0.25,
                   label="range across model and angle cases")
    a.plot(R, med, "-", color="tab:blue", lw=1.5)
    a.set_xscale("log"); a.set_yscale("log")
    a.set_xlabel("Distance from lander (m)"); a.set_ylabel("Impact density (cm$^{-2}$)")
    a.set_title("Sampling error and model range")
    a.legend(fontsize=8); a.grid(alpha=0.3, which="both")

    plot_render_started = time.perf_counter()
    fig.tight_layout(rect=[0, 0, 1, 0.965])
    fig.savefig(OUT, dpi=110)
    print(f"[plotter] figure saved in {time.perf_counter() - plot_render_started:.1f} s")
    print(f"\nwrote {OUT}")
    print(f"[validate] {msg}")
    print(f"[plotter] complete at "
          f"{datetime.now().astimezone().isoformat(timespec='seconds')} in "
          f"{time.perf_counter() - plot_started:.1f} s")


if __name__ == "__main__":
    main()