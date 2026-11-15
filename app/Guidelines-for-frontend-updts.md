# Monte Carlo Moon: the app

The story site for the lunar plume model: four chapters (Surveyor 3, Apollo 12,
the model, the future) plus sources. It ships as **one self-contained
`dist/index.html`**, which opens straight from disk and deploys as is.

## Build

```txt
python export_app_data.py            # in the model repo: writes results/app_data.json
python build.py                      # writes dist/index.html
python build.py --check              # same, plus checks (see below)
python build.py --data path/to/app_data.json
```

No npm and no bundler: `build.py` uses only the Python standard library.
`--check` also parses the bundled JavaScript with Node, if Node is installed.
Edit files in `src/`, run the build, open `dist/index.html`.

## Layout

```txt
build.py            src/ -> dist/index.html (inlines partials, CSS, modules, data, images)
assets/             NASA photos and the Moon texture (inlined as data: URLs)
src/index.html      page skeleton: <!-- @include --> markers, stylesheets, entry module
src/partials/       one HTML file per chapter, plus the map (planner.html), top bar and tour bar
src/css/            base (tokens, buttons, tables) · layout (top bar, chapters, stations)
                    story (intro, ch. 1-2, 3D scenes) · model (ch. 3) · future (ch. 4, sources)
src/js/             ES modules, see below
```

### JavaScript modules

| module | what it does |
| --- | --- |
| `main.js` | builds everything once and registers the router hooks; the only place modules are wired together |
| `router.js` | chapters (URL hash) and stations; `onChapter`, `onStation`, `isShown` |
| `data.js` | the model data and constants derived from it (sites, levels, landers) |
| `exposure.js` | practical distance, distance bands, rings, grid-aware formatting; same rules as `psi_study.py` |
| `util.js` | DOM lookup, number formatting, seeded random numbers, log interpolation |
| `logchart.js` | the log-log exposure chart shared by the map and the playground |
| `scene3d.js` | the three.js landing scene used by chapters 2 and 3 |
| `icons2d.js` | flat lander icon for 2D canvases |
| `intro.js` | answer on the start screen, rotating Moon |
| `surveyor.js` | chapter 1: photo hotspots |
| `apollo.js` | chapter 2: side view, Surveyor's camera, the 1 cm² pit square |
| `model-steps.js` | chapter 3: the four model steps and their animations |
| `montecarlo.js` | chapter 3: the mini Monte Carlo |
| `playground.js` | chapter 3: switch model versions on and off |
| `map.js` | chapter 4: the sandblast map, replay, rings, objects, chart |
| `advisor.js` | chapter 4: landing advisor and the pads-and-berms table |
| `wrapup.js` | chapter 4: heritage, what we learned, limits; reading times |
| `tour.js` | the guided tour |

Rules for modules (the build checks them): named relative imports only
(`import { a } from "./x.js";`), no default exports, no `as` renames, and every
top-level name unique across all modules (they share one scope in the build).

Modules never wrap each other's functions. To run something when a chapter or
station appears, register it in `main.js` with `onChapter` / `onStation`.
Animations stop themselves when `isShown(...)` turns false.

## Data

The app reads only `app_data.json`. Distances use the same rule as the Python
side (`psi_study.practical_distance`), so the page and the study JSON agree.
If `plausible_branches.json` was applied by the export, the main numbers use
only the versions that pass the pit test.

three.js r128 loads from cdnjs. Without it (offline, no WebGL) the 3D views show
a short note and the rest of the app works.
