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

```txt
python app/build.py                              # reads results/app_data.json
python app/build.py --check                      # same, plus checks on the bundled code
python app/build.py --data path/to/app_data.json # if it is somewhere else
```

Then open `app/dist/index.html`. It is one self-contained file (data,
images and code inlined), so it opens straight from disk and deploys as is. The
app has four chapters: Surveyor 3, Apollo 12, the model, and the future, where
you plan landings, compare pads and berms and see which hardware is still on
the Moon. A fifth page lists every source with links.

The app's code is split into small parts: one HTML file per chapter in
`app/src/partials/`, stylesheets in `src/css/` and ES modules in
`src/js/`. `build.py` puts them together. Edit `src/`, never `dist/`.
[app/Guidelines-for-frontend-updts.md](app/Guidelines-for-frontend-updts.md) explains what each module does.

## Repository layout

```txt
engine/        the model and the studies (Python), plus fig5_traces/
results/       JSON written by the studies; app_data.json is what the app reads
app/           the app: src/ (partials, css, js), assets/ (NASA photos), build.py
```

## Requirements

Python 3.10+ with `numpy` and `scipy`. Numba is optional; install the
accelerated backend with `python -m pip install -r requirements-accelerated.txt`
using the same Python interpreter as `run_simulations.py`. Without Numba, the
simulation uses its slower NumPy fallback. The app build needs only the Python standard library;
`build.py --check` also uses Node, if it is installed, to parse the bundled
JavaScript.

The Monte Carlo cache (`psi_cache/`, about 430 MB) is not in this repository.
Without it, `escalation.py` and `mitigation.py` recompute everything, which
takes hours at full resolution. All results the app needs are already in
`results/app_data.json`, so rebuilding the app only needs step 7.

## Simulation pipeline

Plume-surface interaction model for the Apollo 12 landing next to Surveyor III,
plus the studies and the app built on it.

### Order of the scripts

Run the end-to-end studies and app-data export with:

```txt
python run_simulations.py --quick  # reduced resolution
python run_simulations.py          # full resolution; may take hours
```

The runner supplies the repository, studies, and tools directories to each
child process's `PYTHONPATH`, then runs the studies in dependency order.
The app build is separate: `python app/build.py`.

| Step | Script | Needs | Writes |
| --- | --- | --- | --- |
| 1 | `psi_simulation.py` | – | the model; every study calls `simulate()`, which caches each configuration in `psi_cache/` |
| 2 | `escalation.py` | – (fills the cache, hours at full resolution) | `results/escalation_results.json` |
| 3 | `pit_calibration.py` | 11.6 kN runs from step 2 | `results/pit_calibration_results.json`, **`results/plausible_branches.json`** |
| 4 | `mitigation.py` | – (16 more configurations) | `results/mitigation_results.json` |
| 5 | `export_app_data.py` | steps 2–4 (never simulates) | `results/app_data.json` |
| 6 | `app/build.py` | step 5 | `app/dist/index.html` |

All studies write JSON only; there are no plots. Every script keeps its
command-line options (`--help` lists them).

Optional: `fig5_analyze.py` (where the Fig. 5 constants come from), `pit_spectrum.py`,
`mitigation.py --with-angles` (extra berm panel, several hours of new runs).

`--quick` on any study uses the reduced resolution in `psi_study.QUICK`.

`escalation.py` and `mitigation.py` first compute every configuration they
need that is not cached yet, several at a time in separate processes, and then
read the cache. `PSI_JOBS` sets how many run side by side (default: a quarter
of the CPU cores, at most 4; `PSI_JOBS=1` runs them one after another). The
results do not depend on it.

### Variant filter

The model has 36 variants (3 erosion laws × 2 velocity models × 6 Apollo
ejection angles). `pit_calibration.py` fits the crater constant K_D for each one
against the Surveyor III coupons (counting pits ≥ 20 µm, as the 1971 tube count
did) and keeps those whose pit counts then match the measurement. A variant
also needs at least 20 simulated grains at Surveyor III, both in total and among
the counted pits; with fewer, chance decides the verdict (a 0.3 % change in
lunar gravity once flipped six variants). `psi_study.anchored_exposure()` uses only these by default
(`only_plausible=False` gives all 36). `export_app_data.py` stores both.

### Estimated distance

For every variant, the distance where its exposure last drops below the
threshold (`psi_study.practical_distance`), then median, min and max over the
variants (`psi_study.distance_band`). The app computes its rings the same way
from the per-variant curves in `app_data.json`.

Landers above 23.2 kN (twice the Apollo LM, `VALIDATED_MAX_THRUST_N`) are
outside the range we checked; the app labels them that way. The cut-off is our
own choice, not a published threshold.

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

`fig5_analyze.py` derives the `lm_fig5_*` constants in `Config` from the traced
contours in `engine/fig5_traces/` (K0 = 2054, h_k = 3.32 m, n = 0.913, s = 36; no-lift
edge c0 = 7.082, c1 = 3.579) and shows that Eq. 7 as printed does not match the
figure. It only reports; never edits `psi_simulation.py`.

## Sources

All sources, with links, are listed in the app under "Sources"
(`app/src/partials/sources.html`).\
Photos: NASA. 3D scenes: three.js
(MIT licence), loaded from cdnjs; without it the rest of the app still works.
