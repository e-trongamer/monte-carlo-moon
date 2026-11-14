#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Derive the Fig. 5 constants in psi_simulation.CONFIG from the digitized traces.

Lane & Metzger (2015), arXiv:1503.00154, Fig. 5 shows the maximum speed of
ejected grains as contours over nozzle height h and grain diameter D for the
Apollo LM. The contours were traced with WebPlotDigitizer into fig5_traces/:

    <u>.csv        one file per contour u = 16 ... 1600 m/s, columns "h; D"
                   (metres; microns), semicolons, decimal commas
    boundary.csv   the no-lift edge (above it grains do not lift)

This script reproduces every number quoted in CONFIG's Fig. 5 comments:

  1. Collapse: K = u * sqrt(D_um) is the same on all contours at a given
     height, so u(h, D) = K(h) / sqrt(D_um).
  2. Fit K(h) = K0 * (1 + (h/h_k)^(n*s))^(-1/s)  ->  lm_fig5_K0, _hk_m, _n, _s
  3. Fit the no-lift edge log10(D_um) + c1*log10(h) = c0  ->  lm_fig5_cut_c0, _c1
  4. Check Eq. 7 as printed against the same traces (it does not match).

It only reads and reports; it never changes psi_simulation.py. If a refit
should be used, copy the printed values into CONFIG by hand (that changes the
cache tag, so the studies will be rerun).

    python fig5_analyze.py            # report + fig5_analysis.png
"""
from __future__ import annotations

import argparse, os

import numpy as np
from scipy.optimize import least_squares
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

import psi_simulation as P

HERE = os.path.dirname(os.path.abspath(__file__))
TRACE_DIR = os.path.join(HERE, "fig5_traces")


def read_csv(path):
    """Two columns "x; y" with decimal commas -> two arrays."""
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            if line.strip():
                rows.append([float(v.replace(",", ".")) for v in line.split(";")])
    a = np.array(rows)
    return a[:, 0], a[:, 1]


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
    c1, c0 = np.polyfit(np.log10(h), np.log10(D), 1)   # log D = c0' + slope*log h
    return -c1, c0                                        # c1 = -slope, c0 = intercept


def eq7(h, D_um, cfg, d_units):
    c = dict(cfg, lm_use_fig5=False, lm_scale=1.0, lm_D_units=d_units)
    return P.lane_metzger_umax(h, D_um * 1e-6, c)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.parse_args()
    cfg = P.CONFIG

    u, h, D = P.load_fig5_traces(TRACE_DIR)
    hb, Db = read_csv(os.path.join(TRACE_DIR, "boundary.csv"))
    print(f"Traces: {len(u)} points on {np.unique(u).size} contours "
          f"({u.min():g}-{u.max():g} m/s), h = {h.min():.2f}-{h.max():.1f} m; "
          f"no-lift edge: {len(hb)} points")

    # 1 + 2: collapse and K(h) fit
    K = u * np.sqrt(D)
    p_fit = fit_K(h, K)
    p_cfg = (cfg["lm_fig5_K0"], cfg["lm_fig5_hk_m"], cfg["lm_fig5_n"], cfg["lm_fig5_s"])
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
    for name, p in (("fit", p_fit), ("CONFIG", p_cfg)):
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
    for name, (a0, a1) in (("fit", (c0, c1)),
                           ("CONFIG", (cfg["lm_fig5_cut_c0"], cfg["lm_fig5_cut_c1"]))):
        e = np.abs(edge(a0, a1) / Db - 1.0)
        print(f"   {name:12} c0 = {a0:.3f}  c1 = {a1:.3f}   median {100 * np.median(e):.1f}% in D")
    print(f"   printed in the paper: c0 = {cfg['lm_c0']} (D in m -> {cfg['lm_c0'] + 6:.3f} "
          f"with D in um), c1 = {cfg['lm_c1']}")

    # 4: Eq. 7 as printed
    print("\n4. Eq. 7 as printed, with the best single scale factor")
    for units in ("um", "m"):
        m0 = eq7(h, D, cfg, units)
        on = m0 > 0
        scale = float(np.exp(np.median(np.log(u[on] / m0[on]))))
        e = np.abs(scale * m0[on] / u[on] - 1.0)
        print(f"   D in {units:2}: scale {scale:9.4g}, median error {100 * np.median(e):5.0f}%, "
              f"max {100 * e.max():6.0f}%  ({on.sum()} of {len(u)} points above the cutoff)")
    print(f"   CONFIG lm_scale = {cfg['lm_scale']:g} (D in um)")

    # same check the simulation runs at start-up
    ok, msg, _ = P.lane_metzger_check(dict(cfg), None)
    print("\n" + msg)

    # figure
    fig, ax = plt.subplots(1, 2, figsize=(13, 5.2))
    hh = np.geomspace(0.5, 60, 300)
    levels = np.unique(u)
    colors = plt.cm.viridis(np.linspace(0, 0.92, len(levels)))
    for uc, c in zip(levels, colors):
        m = u == uc
        ax[0].scatter(h[m], K[m], s=14, color=c, label=f"{uc:g} m/s")
    ax[0].plot(hh, K_model(hh, *p_cfg), "k-", lw=1.5, label="K(h), CONFIG")
    ax[0].set_xscale("log"); ax[0].set_yscale("log")
    ax[0].set_xlabel("nozzle height h (m)"); ax[0].set_ylabel("K = u·√D  (m/s·µm^0.5)")
    ax[0].set_title("All 11 contours collapse onto one curve")
    ax[0].legend(fontsize=7, ncol=2); ax[0].grid(alpha=0.3, which="both")

    for uc, c in zip(levels, colors):
        m = u == uc
        ax[1].plot(h[m], D[m], "o", ms=3, color=c)
        ax[1].plot(hh, (K_model(hh, *p_cfg) / uc) ** 2, "-", lw=0.8, color=c)
    ax[1].plot(hb, Db, "ks", ms=4, label="no-lift edge (traced)")
    ax[1].plot(hh, 10 ** (cfg["lm_fig5_cut_c0"] - cfg["lm_fig5_cut_c1"] * np.log10(hh)),
               "k--", lw=1, label="no-lift edge, CONFIG")
    ax[1].set_xscale("log"); ax[1].set_yscale("log")
    ax[1].set_xlim(0.5, 60); ax[1].set_ylim(1, 2e4)
    ax[1].set_xlabel("nozzle height h (m)"); ax[1].set_ylabel("grain diameter D (µm)")
    ax[1].set_title("Traced contours (points) vs u = K(h)/√D (lines)")
    ax[1].legend(fontsize=8); ax[1].grid(alpha=0.3, which="both")
    fig.suptitle("Lane & Metzger (2015) Fig. 5, digitized", fontweight="bold")
    fig.tight_layout()
    out = os.path.join(HERE, "fig5_analysis.png")
    fig.savefig(out, dpi=110)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
