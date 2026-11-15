"""Derive the Fig. 5 constants in config.Fig5Fit from the digitized traces.

Lane & Metzger (2015), arXiv:1503.00154, Fig. 5 shows the maximum speed of
ejected grains as contours over nozzle height h and grain diameter D for the
Apollo LM. The contours were traced with WebPlotDigitizer into fig5_traces/:

    <u>.csv        one file per contour u = 16 ... 1600 m/s, columns "h; D"
                   (metres; microns), semicolons, decimal commas
    boundary.csv   the no-lift edge (above it grains do not lift)

This script reproduces every number quoted in Fig5Fit's docstring:

  1. Collapse: K = u * sqrt(D_um) is the same on all contours at a given
     height, so u(h, D) = K(h) / sqrt(D_um).
  2. Fit K(h) = K0 * (1 + (h/h_k)^(n*s))^(-1/s)  ->  k0, knee_height_m, slope, sharpness
  3. Fit the no-lift edge log10(D_um) + c1*log10(h) = c0  ->  no_lift_c0, no_lift_c1
  4. Check Eq. 7 as printed against the same traces (it does not match).

It only reads and reports. If a refit should be used, copy the printed values
into config.Fig5Fit by hand (that changes the run hash, so the studies rerun).

    python fig5_analyze.py
"""
from __future__ import annotations

import argparse
import os

import numpy as np
from scipy.optimize import least_squares

import engine.psi.psi_simulation as P
from engine.psi.config import Config

# Lane & Metzger (2015) Eq. 7 as printed. Kept here only to show that it does
# not reproduce Fig. 5; the model uses the digitized fit (CHANGELOG.md).
EQ7 = {"b0": 0.2964, "b1": -0.225, "b2": 0.1954, "b3": 5.0, "b4": 4.343,
       "c0": 2.212, "c1": 3.53}


def eq7_umax(h, D_um, d_units):
    """u = 10^[(b1 + b2 log h) tanh(b3 + b4 log h)] / [b0 (h^(9/20) + D^(1/2))],
    0 where log D + c1 log h > c0 (D in metres there, as printed). The units of
    D in the sqrt term are not stated, so both are tried; no scale factor."""
    h = np.maximum(np.asarray(h, float), 1e-6)
    D_m = np.maximum(np.asarray(D_um, float), 1e-6) * 1e-6
    log_h = np.log10(h)
    expo = (EQ7["b1"] + EQ7["b2"] * log_h) * np.tanh(EQ7["b3"] + EQ7["b4"] * log_h)
    D_term = D_m * 1e6 if d_units == "um" else D_m
    u = 10.0 ** expo / (EQ7["b0"] * (h ** (9 / 20) + np.sqrt(D_term)))
    return np.where(np.log10(D_m) + EQ7["c1"] * log_h > EQ7["c0"], 0.0, u)


def K_model(h, K0, hk, n, s):
    return K0 * (1.0 + (h / hk) ** (n * s)) ** (-1.0 / s)


def collapse(u, h, D, heights):
    """Scatter of K = u*sqrt(D) across contours at common heights.

    Each contour's K is interpolated (log-log) to the height; returns rows
    (h, number of contours, relative SD in %, full range max/min-1 in %).
    """
    K = u * np.sqrt(D)
    rows = []
    for g in heights:
        logs = []
        for uc in np.unique(u):
            m = u == uc
            o = np.argsort(h[m])
            hs, ks = h[m][o], K[m][o]
            if hs[0] <= g <= hs[-1]:
                logs.append(np.interp(np.log(g), np.log(hs), np.log(ks)))
        if len(logs) >= 2:
            rows.append((g, len(logs), 100 * np.std(logs),
                         100 * (np.exp(max(logs) - min(logs)) - 1)))
    return rows


def fit_K(h, K):
    """Least squares in log K. s is bounded: large s = sharp corner."""
    x0 = [2000.0, 3.0, 0.9, 10.0]
    res = least_squares(lambda p: np.log(K_model(h, *p)) - np.log(K), x0,
                        bounds=([100, 0.3, 0.2, 1.0], [1e5, 30, 3.0, 36.0]))
    return res.x


def fit_edge(h, D):
    """log10(D) + c1*log10(h) = c0, fitted as a straight line in log-log."""
    slope, c0 = np.polyfit(np.log10(h), np.log10(D), 1)
    return -slope, c0


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.parse_args()
    cfg = Config()
    fit = cfg.velocity.fig5

    trace_dir = P.find_fig5_traces()
    if trace_dir is None:
        raise SystemExit("fig5_traces/ not found next to psi_simulation.py or one level up")
    u, h, D = P.load_fig5_traces(trace_dir)
    hb, Db = P.read_trace_csv(os.path.join(trace_dir, "boundary.csv"))
    print(f"Traces: {len(u)} points on {np.unique(u).size} contours "
          f"({u.min():g}-{u.max():g} m/s), h = {h.min():.2f}-{h.max():.1f} m; "
          f"no-lift edge: {len(hb)} points")

    # 1 + 2: collapse and K(h) fit
    K = u * np.sqrt(D)
    p_fit = fit_K(h, K)
    p_cfg = (fit.k0, fit.knee_height_m, fit.slope, fit.sharpness)
    rel = lambda p: np.abs(K_model(h, *p) / K - 1.0)
    print("\n1. Collapse: K = u*sqrt(D_um) on different contours at the same height")
    rows = collapse(u, h, D, np.geomspace(0.8, 45, 40))
    for g, n, sd, rng in rows[::4]:
        print(f"   h {g:5.2f} m: {n:2d} contours, scatter {sd:3.1f} % (SD), full range {rng:3.1f} %")
    sd_all = [r[2] for r in rows]
    print(f"   over 0.8-45 m: SD median {np.median(sd_all):.1f} %, max {max(sd_all):.1f} %; "
          f"full range at most {max(r[3] for r in rows):.1f} % (near the knee)")

    print("\n2. K(h) = K0 (1 + (h/h_k)^(n s))^(-1/s)")
    print(f"   {'':12} {'K0':>8} {'h_k [m]':>8} {'n':>7} {'s':>6} {'median':>8} {'max':>7}")
    for name, p in (("fit", p_fit), ("Fig5Fit", p_cfg)):
        e = rel(p)
        print(f"   {name:12} {p[0]:8.0f} {p[1]:8.2f} {p[2]:7.3f} {p[3]:6.1f} "
              f"{100 * np.median(e):7.1f}% {100 * e.max():6.1f}%")
    print("   s sits at its upper bound: the corner is practically sharp. s is not well")
    print("   constrained; with K0, h_k and n refitted for a fixed s:")
    for s_ in (10, 20, 100):
        r = least_squares(lambda p: np.log(K_model(h, *p, s_)) - np.log(K), p_fit[:3])
        e = np.abs(K_model(h, *r.x, s_) / K - 1.0)
        print(f"     s = {s_:3d}: median {100 * np.median(e):.1f} %, max {100 * e.max():.1f} %")

    # 3: no-lift edge
    c1, c0 = fit_edge(hb, Db)
    edge = lambda c0_, c1_: 10 ** (c0_ - c1_ * np.log10(hb))
    print("\n3. No-lift edge: log10(D_um) + c1 log10(h) = c0")
    for name, (a0, a1) in (("fit", (c0, c1)), ("Fig5Fit", (fit.no_lift_c0, fit.no_lift_c1))):
        e = np.abs(edge(a0, a1) / Db - 1.0)
        print(f"   {name:12} c0 = {a0:.3f}  c1 = {a1:.3f}   median {100 * np.median(e):.1f}% in D")
    print(f"   printed in the paper: c0 = {EQ7['c0']} (D in m -> {EQ7['c0'] + 6:.3f} "
          f"with D in um), c1 = {EQ7['c1']}")

    # 4: Eq. 7 as printed
    print("\n4. Eq. 7 as printed, with the best single scale factor")
    for units in ("um", "m"):
        m0 = eq7_umax(h, D, units)
        on = m0 > 0
        scale = float(np.exp(np.median(np.log(u[on] / m0[on]))))
        e = np.abs(scale * m0[on] / u[on] - 1.0)
        print(f"   D in {units:2}: scale {scale:9.4g}, median error {100 * np.median(e):5.0f}%, "
              f"max {100 * e.max():6.0f}%  ({on.sum()} of {len(u)} points above the cutoff)")

    # the same check the simulation runs at start-up
    ok, msg = P.fig5_check(cfg)
    print(f"\n{msg}")


if __name__ == "__main__":
    main()