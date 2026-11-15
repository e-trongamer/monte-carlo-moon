# Monte Carlo Moon

NASA Space Apps Challenge 2026 project by two students.

In 1969 Apollo 12 landed 155 m from the robot lander Surveyor 3. The engine
blast sandblasted it: back on Earth, scientists counted about 103 tiny pits per
cm² on its metal. The project contains a Monte Carlo simulation of that dust storm, calibrated
against the returned Surveyor 3 samples, to explore how far future landers
must stay from heritage sites and moon bases.

The authoritative account of preparation and hackathon work is in
[TIMELINE.md](TIMELINE.md).

**Finding:** Eq. 7 in Lane & Metzger (2015, [arXiv:1503.00154](https://arxiv.org/abs/1503.00154))
does not reproduce their own Fig. 5, so our model uses a fit to the figure
instead. Details in the [Fig. 5 constants section below](#fig-5-constants).

## Try the app

**Live preview available [right here](https://e-trongamer.github.io/monte-carlo-moon/)**

Build the self-contained browser app with `python app_mockup/build_mockup.py --assemble`,
then open `app_mockup/index.html`. It contains four chapters: Surveyor 3, Apollo 12,
the model, and the future, where you plan landings, build pads and berms and
test them.

## Requirements

Python 3.10+ with `numpy`, `scipy` and `numba` _(optional for acceleration of simulations)_.

The Monte Carlo cache (`psi_cache/`, about 430 MB) is not in this repository.
Without it, `escalation.py` and `mitigation.py` recompute everything, which
takes hours at full resolution. All results the app needs are already in
`app_data.json`, so rebuilding the app only needs step 7.

## Simulation pipeline

Plume-surface interaction model for the Apollo 12 landing next to Surveyor III,
plus the studies and the app built on it.

### Order of the scripts

| Step | Script | Needs | Writes |
| --- | --- | --- | --- |
| 1 | `psi_simulation.py` | – | the model; every study calls `simulate()`, which caches each configuration in `psi_cache/` |
| 2 | `escalation.py` | – (fills the cache, hours at full resolution) | `escalation_results.json` |
| 3 | `pit_calibration.py` | 11.6 kN runs from step 2 | `pit_calibration_results.json`, **`plausible_branches.json`** |
| 4 | `escalation.py` again | step 3 | now uses only the plausible variants (seconds, from cache) |
| 5 | `mitigation.py` | – (16 more configurations) | `mitigation_results.json` |
| 6 | `export_app_data.py` | steps 2–5 (never simulates) | `app_data.json` |
| 7 | `app_mockup/build_mockup.py --assemble` | step 6 | `app_mockup/index.html` |

Optional: `fig5_analyze.py` (where the Fig. 5 constants come from), `pit_spectrum.py`,
`mitigation.py --with-angles` (extra berm panel, several hours of new runs).

`--quick` on any study uses the reduced resolution in `psi_study.QUICK`.

`--plot` on any study also saves its figure as a PNG next to the script
(`escalation.png`, `pit_calibration.png`, `mitigation.png`, `pit_spectrum.png`,
`fig5_analysis.png`). The app never uses these figures; only `fig5_analysis.png`
is kept in the repository, as the evidence for the Eq. 7 finding.

### Variant filter

The model has 36 variants (3 erosion laws × 2 velocity models × 6 Apollo
ejection angles). `pit_calibration.py` fits the crater constant K_D for each one
against the Surveyor III coupons and keeps the 18 whose pit counts then match
the measurement. `psi_study.anchored_exposure()` uses only these by default
(`only_plausible=False` gives all 36). `export_app_data.py` stores both.

### Estimated distance

For every variant, the distance where its exposure last drops below the
threshold (`psi_study.practical_distance`), then median, min and max over the
variants (`psi_study.distance_band`). The app computes its rings the same way
from the per-variant curves in `app_data.json`.

### Cache

Folder names are `<config hash>_<code tag>`. The code tag
(`python psi_simulation.py --code-tag`) ignores comments, docstrings and blank
lines, so tidying `psi_simulation.py` keeps the cache. Any change to the code
itself gives a new tag and new runs. After a pure refactor (renaming,
reformatting), the old results can be kept with
`python psi_simulation.py --migrate-cache <old tag>`; never do this after a
change to the physics.

Checkpoints find their `.npz` next to `checkpoint.json`, so `psi_cache/` can be
copied to another computer.

### Fig. 5 constants

`fig5_analyze.py` derives the `lm_fig5_*` constants in `CONFIG` from the traced
contours in `engine/fig5_traces/` (K0 = 2054, h_k = 3.32 m, n = 0.913, s = 36; no-lift
edge c0 = 7.082, c1 = 3.579) and shows that Eq. 7 as printed does not match the
figure. It only reports; never edits `psi_simulation.py`.

## Sources

All sources, with links, are listed in the app under "Sources". Photos: NASA.
