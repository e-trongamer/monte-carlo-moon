#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate a report from the current PSI simulation results."""
import json
import math
import os
import sys

import numpy as np


MODEL_NAMES = {
    "scaling": "Shear scaling",
    "roberts": "Roberts",
    "energy_flux": "Energy flux",
}


def fmt(value, digits=3):
    if value is None:
        return "—"
    value = float(value)
    if not math.isfinite(value):
        return "—"
    if value == 0:
        return "0"
    if abs(value) >= 1e5 or abs(value) < 1e-2:
        return f"{value:.{digits - 1}e}"
    return f"{value:.{digits}g}"


def nearest_index(values, target):
    return int(np.argmin(np.abs(np.asarray(values, dtype=float) - target)))


def build(out_dir):
    results_path = os.path.join(out_dir, "psi_results.json")
    with open(results_path, encoding="utf-8") as results_file:
        results = json.load(results_file)

    cfg = results["meta"]["config"]
    models = cfg["erosion_models"]
    angles = cfg["angle_hypotheses_deg"]
    heights = np.asarray(cfg["target_heights_sensitivity_m"], dtype=float)
    distances = np.asarray(cfg["target_distances_m"], dtype=float)
    nominal_height_index = nearest_index(heights, cfg["target_height_m"])
    crater_height_index = nearest_index(heights, cfg["surveyor_height_m"])
    surveyor_distance_index = nearest_index(distances, cfg["surveyor_distance_m"])
    branches = results["branches"]
    lines = []
    write = lines.append

    write("# Lunar Plume-Surface Interaction\n")
    write("## Results and limitations\n")
    write(
        f"_Generated {results['meta']['generated']} · "
        f"configuration hash `{results['meta']['config_hash']}`_\n"
    )
    write(
        f"This run compares {len(models)} erosion models across "
        f"{len(angles)} ejection-angle cases "
        f"({len(branches)} branches total). It uses "
        f"{cfg['mc_particles_per_model']:,} weighted Monte Carlo trajectories "
        "per branch, a fixed random seed of "
        f"{cfg['mc_seed']}, and target-height bins "
        f"{cfg['target_height_bin_m']:g} m wide.\n"
    )
    write(
        "The spread across branches reflects the selected model and angle "
        "assumptions. It is not a confidence interval or a "
        "probability distribution over models. Monte Carlo sampling error is "
        "reported separately in the result data.\n"
    )

    # Eroded mass is determined by the erosion model and source-grid calculation,
    # not by the ejection-angle hypothesis.
    write("## 1. Eroded mass\n")
    write("| Erosion model | Total per landing (kg) | Total (t) |")
    write("|---|---:|---:|")
    for model in models:
        mass = results["total_mass_eroded_kg"][model]
        write(f"| {MODEL_NAMES.get(model, model)} | {mass:,.0f} | {mass / 1000:.2f} |")
    write("")
    write(
        "The energy-flux branch is calibrated to the configured mass target of "
        f"{cfg.get('ef_calibrate_to_mass_t', float('nan')):g} t. Its mass is "
        "therefore a calibration target, not an independent prediction or "
        "validation. The other models are not calibrated to that target.\n"
    )

    mass_by_height = results["mass_eroded_by_h"]
    h_values = np.asarray(mass_by_height["h_m"], dtype=float)
    chosen_heights = [34, 30, 20, 15, 10, 7, 5, 3, 2]
    write("Cumulative eroded mass by descent height:\n")
    write("| Height h (m) | " + " | ".join(MODEL_NAMES.get(m, m) + " (kg)" for m in models) + " |")
    write("|---:|" + "---:|" * len(models))
    for target_h in chosen_heights:
        idx = nearest_index(h_values, target_h)
        if abs(h_values[idx] - target_h) > max(0.01, cfg["dh_m"] / 2):
            continue
        cumulative = {}
        for model in models:
            cumulative[model] = float(np.sum(mass_by_height["kg"][model][:idx + 1]))
        cells = " | ".join(f"{cumulative[m]:,.0f}" for m in models)
        write(f"| {h_values[idx]:g} | {cells} |")
    write(
        "\nCumulative values follow the configured descent sequence from "
        f"{cfg['h_start_m']:g} m downwards; they are not instantaneous erosion rates.\n"
    )

    # Gas-field diagnostic is deterministic and independent of MC trajectories.
    stress = results["tau_max_by_h"]
    write("## 2. Gas-field and velocity diagnostics\n")
    write("| Height h (m) | Maximum wall shear (Pa) | Radius at maximum (m) |")
    write("|---:|---:|---:|")
    for target_h in chosen_heights:
        idx = nearest_index(stress["h_m"], target_h)
        actual_h = float(stress["h_m"][idx])
        if abs(actual_h - target_h) > max(0.01, cfg["dh_m"] / 2):
            continue
        write(
            f"| {actual_h:g} | {stress['tau_Pa'][idx]:.3g} | "
            f"{stress['r_at_max_m'][idx]:.3g} |"
        )
    write("")

    velocity = results["v_eject_max_by_D"]
    lm_velocity = results["v_lane_metzger_by_D"]
    velocity_diameters = np.asarray(velocity["D_um"], dtype=float)
    _, lm_message, _ = _lane_metzger_diagnostic(cfg)
    write(
        f"The selected trajectory velocity branch is **{cfg['velocity_model']}**. "
        f"The Lane-Metzger branch is retained as a separate comparison; "
        f"{lm_velocity['note']}.\n"
    )
    write("| Diameter (µm) | Selected branch max speed (m/s) | L&M maximum (m/s) | L&M effective speed (m/s) |")
    write("|---:|---:|---:|---:|")
    lm_diameters = np.asarray(lm_velocity["D_um"], dtype=float)
    for target_d in (1, 2, 5, 10, 20, 50, 100, 200, 500):
        idx = nearest_index(velocity_diameters, target_d)
        lm_idx = nearest_index(lm_diameters, target_d)
        write(
            f"| {velocity_diameters[idx]:.1f} | {velocity['v_m_s'][idx]:.3g} | "
            f"{lm_velocity['u_max_m_s'][lm_idx]:.3g} | "
            f"{lm_velocity['v_effective_m_s'][lm_idx]:.3g} |"
        )
    write("")
    write(
        f"{lm_message} This compares the active branch with the traced Fig. 5 "
        "contours; it does not validate the paper's stated units or equation "
        "transcription.\n"
    )

    write("## 3. Impact density at the Surveyor distance\n")
    write(
        f"The selected distances are nearest to {distances[surveyor_distance_index]:g} m; "
        f"the height rows are nearest to the configured flat-ground height "
        f"{heights[nominal_height_index]:+g} m and crater height "
        f"{heights[crater_height_index]:+g} m. Each cell below is an individual "
        "model/angle branch, not an average over a probabilistic angle distribution.\n"
    )
    header = "| Erosion model | " + " | ".join(
        f"{angle:g}°: flat / crater (#/cm²)" for angle in angles
    ) + " |"
    write(header)
    write("|---|" + "---:|" * len(angles))
    for model in models:
        cells = []
        for angle in angles:
            branch = branches.get(f"{model}|{angle}")
            if branch is None:
                cells.append("—")
                continue
            density = np.asarray(branch["density_total_per_cm2"], dtype=float)
            flat = density[nominal_height_index, surveyor_distance_index]
            crater = density[crater_height_index, surveyor_distance_index]
            cells.append(f"{fmt(flat)} / {fmt(crater)}")
        write(f"| {MODEL_NAMES.get(model, model)} | " + " | ".join(cells) + " |")
    write("")

    envelope = results["exposure_envelope"]
    nominal_densities = []
    nominal_mc_errors = []
    for branch in branches.values():
        nominal_densities.append(
            float(branch["density_total_per_cm2"][nominal_height_index][surveyor_distance_index])
        )
        nominal_mc_errors.append(
            float(branch["mc_standard_error_per_cm2"][nominal_height_index][surveyor_distance_index])
        )
    nominal_densities = np.asarray(nominal_densities)
    nominal_mc_errors = np.asarray(nominal_mc_errors)
    max_relative_mc_error = float(np.max(
        np.divide(
            nominal_mc_errors,
            nominal_densities,
            out=np.zeros_like(nominal_mc_errors),
            where=nominal_densities > 0,
        )
    ))
    write(
        f"Across all branches, the nominal-height density at the Surveyor distance "
        f"spans {envelope['spread_decades_at_nominal']:.2f} orders of magnitude "
        "from the minimum to maximum. This wide range is driven by the chosen "
        "erosion and angle assumptions; it should not be summarized as sampling noise.\n"
    )
    write(
        f"At that same location, branch densities range from {fmt(np.min(nominal_densities))} "
        f"to {fmt(np.max(nominal_densities))} impacts/cm² (median "
        f"{fmt(np.median(nominal_densities))}); branch-conditional Monte Carlo "
        f"standard errors range from {fmt(np.min(nominal_mc_errors))} to "
        f"{fmt(np.max(nominal_mc_errors))} impacts/cm². The largest relative "
        f"standard error among these branches is {max_relative_mc_error:.1%}. "
        "That sampling error is distinct from the much broader between-branch range.\n"
    )

    comparison = results["surveyor_comparison"]
    write("## 4. Comparison with Surveyor III\n")
    write(
        f"The reference value in the configuration is "
        f"{comparison['measured_pit_density_per_cm2']:g} pits/cm², with "
        f"a mean pit opening of {comparison['measured_pit_size_um'][0]:g} × "
        f"{comparison['measured_pit_size_um'][1]:g} µm and depths up to "
        f"{comparison.get('measured_pit_depth_um', float('nan')):g} µm "
        "(Immer et al. 2011, coupons 2050/2051). The measured value refers "
        "to identified pits, while the simulation density counts modeled impacts "
        "over its configured particle-size range. These are not directly "
        "like-for-like unless a matching size and detection threshold is applied; "
        "pit_calibration.py does that by fitting K_D per branch.\n"
    )
    write(
        f"The comparison height is {comparison['crater_height_m']:+g} m, versus "
        f"{comparison['nominal_height_m']:+g} m above the landing plane for the "
        "flat-ground case. The simulation's target is an axisymmetric finite-height "
        "bin, not the physical geometry of Surveyor III.\n"
    )
    write(comparison["note"] + "\n")
    write("| Model / angle | Flat-ground density (#/cm²) | Flat-height MC SE (#/cm²) | Crater-height density (#/cm²) | Mean depth at flat height (µm) |")
    write("|---|---:|---:|---:|---:|")
    for tag, values in comparison["by_branch"].items():
        model, angle = tag.split("|", maxsplit=1)
        branch = branches[tag]
        mc_se = branch["mc_standard_error_per_cm2"][nominal_height_index][surveyor_distance_index]
        write(
            f"| {MODEL_NAMES.get(model, model)} / {angle}° | "
            f"{fmt(values['at_nominal_height'])} | {fmt(mc_se)} | "
            f"{fmt(values['at_surveyor_crater_height'])} | "
            f"{fmt(values['mean_depth_um_nominal'])} |"
        )
    write("")

    write("## 5. Interpretation and limitations\n")
    write(
        "- Monte Carlo sampling applies to particle trajectories, not the gas field "
        "or erosion law. "
        "Erosion rates are evaluated on a deterministic height/size/radius grid; "
        "sampled source conditions and ejection angles are then propagated ballistically.\n"
    )
    write(
        "- The listed Apollo angles are separate scenarios, not random samples "
        "from a known population. Their min-to-max "
        "spread is scenario uncertainty, not a statistical confidence interval.\n"
    )
    write(
        "- Sampling uncertainty is conditional on a branch. The reported "
        "Monte Carlo standard errors do not cover uncertainty in the gas model, "
        "erosion laws, angle choices, material response, or target geometry.\n"
    )
    write(
        "- The energy-flux coefficient is calibrated to the mass target. "
        "Agreement with that target is imposed by calibration; it does not "
        "independently validate impact density or particle trajectories.\n"
    )
    write(
        "- Lane-Metzger Eq. 7 remains uncertain. The "
        "implementation has reconstructed choices for diameter units and scale. "
        "The plot/report comparison is not proof that the paper's stated units, "
        "equation transcription, and figure are mutually consistent.\n"
    )
    write(
        "- Ballistic propagation omits particle-particle collisions and dust-cloud "
        "feedback. Ejection speeds above lunar escape speed and simplified "
        "target-bin geometry are additional limits on interpretation.\n"
    )

    write("## 6. Configuration and reproducibility\n")
    write("| Setting | Value |")
    write("|---|---:|")
    settings = (
        ("Engine thrust", f"{cfg['thrust_N'] / 1000:g} kN"),
        ("Descent range", f"{cfg['h_start_m']:g} to {cfg['h_end_m']:g} m"),
        ("Descent rate", f"{cfg['descent_rate_m_s']:g} m/s"),
        ("Particle mass median D50", f"{cfg['psd_D50_mass_um']:g} µm"),
        ("Geometric standard deviation", f"{cfg['psd_sigma_g']:g}"),
        ("Target height-bin width", f"{cfg['target_height_bin_m']:g} m"),
        ("Monte Carlo trajectories per branch", f"{cfg['mc_particles_per_model']:,}"),
        ("Random seed", str(cfg["mc_seed"])),
        ("Selected velocity model", cfg["velocity_model"]),
    )
    for label, value in settings:
        write(f"| {label} | {value} |")
    write("")

    write("## Sources cited by the model\n")
    write("- Immer, Metzger, Hintze, Nick, Horan (2011): Apollo 12 Lunar Module exhaust plume impingement on Lunar Surveyor III, *Icarus* 211, 1089-1102.")
    write("- Immer, Lane, Metzger, Clements: *Apollo Video Photogrammetry Estimation of Plume Impingement Effects* (NASA NTRS 20130012063).")
    write("- Lane & Metzger: *Image Analysis Based Estimates of Regolith Erosion Due to Plume Impingement Effects* (NASA NTRS 20150000173); *Acta Geophysica* 63, 568-599 (2015).")
    write("- Metzger et al. (2008/2021): *Modification of Roberts' Theory for Rocket Exhaust Plumes Eroding Lunar Soil* (arXiv:2104.05198).")
    write("- Metzger (2024): energy-flux erosion model; see the assumptions and calibration warning above.")
    write("- NASA TM-20240003496, Fig. 20: independent particle-size/velocity anchor used by the Lane-Metzger shape check.")
    write("- Brownlee et al. (1972); Sheldon & Kanhere (1972); Shao & Lu (2000); Carrier (2003).\n")

    report_path = os.path.join(out_dir, "psi_report.md")
    with open(report_path, "w", encoding="utf-8") as report_file:
        report_file.write("\n".join(lines) + "\n")
    return report_path


def _lane_metzger_diagnostic(cfg):
    import psi_simulation

    grids = psi_simulation.build_grids(cfg)
    return psi_simulation.lane_metzger_check(cfg, grids, h=1.0)


if __name__ == "__main__":
    output_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
    print(build(output_dir))
