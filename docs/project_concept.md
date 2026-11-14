# Monte Carlo Moon – Project concept

> **About this document:** this is a concept and planning note. It describes the
> intended project, model, app structure and division of responsibilities; it is
> not a record of work completed or evidence that implementation existed before
> the hackathon. For the actual chronology, see [TIMELINE.md](../TIMELINE.md),
> which is the authoritative account of when work took place.

## Overview

We tell school kids the story of Surveyor 3, which was sandblasted in 1969 by
the dust of the Apollo 12 landing, and use our own model to compute how far
future landings must stay from moon bases and historic sites.

- **Challenge:** NASA Space Apps Challenge 2026, theme: NASA hardware left
  behind on the Moon, on Mars and in space, told for school-age space fans.
- **Team name (proposal):** Monte Carlo Moon
- **Motto:** Learn from the past, protect the future.
- **What sets us apart:** research on landing dust already exists, but only for
  experts. We combine a story for kids with a simulation to try out yourself
  and real math in nerd mode.

## The story

Surveyor 3 landed on the Moon in 1967. Two and a half years later the Apollo 12
lunar module touched down about 155 m away and blasted it with lunar dust.

| Event | What happened |
| --- | --- |
| 1967: Surveyor 3 lands | Tests the lunar soil with its arm and scoop, sends live pictures to Earth |
| 19 Nov 1969: Apollo 12 lands | The lunar module lands about 155 m west of Surveyor 3 in Mare Cognitum |
| The dust | The engine plume throws dust away very flat (about 1–3 degrees) and very fast; it hits Surveyor |
| The visit | Pete Conrad and Alan Bean walk to Surveyor 3, cut off the camera, cables and struts and bring them back to Earth |
| The analysis | The parts show sandblasting marks, mostly on the side facing the lunar module |
| Lucky break | According to research the damage would have been much worse if a crater had not partly shielded Surveyor |

**Story scenes from Surveyor's point of view (draft):**

1. Launch and landing in 1967
2. My job: testing the soil, sending pictures
3. Falling asleep in the lunar night and the long wait
4. The visit in 1969: dust storm, then two astronauts
5. Parts of me travel to Earth and get examined
6. Looking ahead: Artemis and new moon bases

**Still to check:** the story of bacteria in Surveyor's camera is now
considered most likely contamination that happened later on Earth. Only
include it in the story with this note.

## Project structure

The app has three levels so that both kids and judges get something out of it.

| Level | For whom | Content |
| --- | --- | --- |
| Story | Kids (about 10–14 years) | Surveyor 3 tells its story in scenes, with pictures and an animation of the dust cloud |
| Nerd mode | Interested users and judges | Formulas, sliders for distance and engine thrust, simulation and damage map |
| Future planner | Everyone | Pick a moon base or historic site, set the lander size; the model shows the safest landing site with a short walk |

**MVP that will be finished in any case:** website with a short story, simple
dust simulation with a distance slider, one result chart.

**Bonus if there is time:** future planner with a map, elaborate animations,
illustrations for every scene.

## Math and physics model

The model simulates thousands of dust particles at random, checks itself
against the real Apollo 12 case and computes the minimum distance for future
landings from that.

**1. Trajectory of a particle.** The Moon has no air drag, so every grain flies
a parabola (g = 1.62 m/s²):

```txt
R = v² sin(2θ) / g        T = 2 v sin(θ) / g
```

Special cases: from about 1.68 km/s a particle goes into orbit, from about
2.38 km/s it leaves the Moon. These particles are handled separately or
computed with the Moon's curvature.

**2. Monte Carlo simulation.** Every particle gets random values:

- Grain size: from the size distribution of lunar regolith
- Speed v: depends on grain size, e.g. log-normally distributed
- Angle θ: narrowly around a few degrees (literature: 1–3 degrees)
- Direction φ: uniform over 0–360 degrees

Simulate N = 10⁵ to 10⁶ particles and count how many hit the area of the
target object.

**3. Statistics.**

- Expected hits per area as a function of distance d
- Confidence intervals over several runs; the error falls as 1/√N
- Hits as rare events, Poisson distribution:

```txt
P(at least one hit) = 1 − e^(−λ)
```

**4. Calibration.** Tune the parameters so that the Surveyor 3 case at 155 m is
roughly reproduced. Then a sensitivity analysis: how much does the result
change when v or θ vary?

**5. Optimization for the future.** We look for the smallest distance d at
which the damage probability stays below a limit, e.g. 1 %. Alternatively a
cost function of walking distance and damage risk, whose minimum we look for:

```txt
d* = min { d : P_damage(d) < 0.01 }
```

## Roles

One person takes math and physics, the other story and app; fact checking and
submission are done together.

### *Math & physics**

- Physics model: trajectories of dust particles in lunar gravity
- Stochastics: Monte Carlo simulation in Python
- Research: numbers from NASA sources (distance, angles, speeds)
- Matching the model against the real Apollo 12 case
- Computing the minimum distance for the future
- Delivering results as a JSON file
- Short explanations of the formulas for nerd mode

### **Story & app**

- Story: write scenes from Surveyor's point of view, suitable for kids
- Research: mission history of Surveyor 3 and Apollo 12
- App structure: story part, nerd mode, future planner
- Design: colors, character, illustrations
- Charts and sliders based on the JSON data
- Presentation or video for the submission

### **Together**

- Decide the data format and MVP scope
- Check each other's facts (accuracy counts in judging)
- Build the data into the app and test it
- Submit on the Space Apps site

## Interface

The simulation writes its results to a JSON file, and the app builds its charts
and sliders only on that file.

```txt
Simulation (Python)          results.json               App (story & app)
Math & physics       ──►     distance, hits, risk  ──►  Story · Nerd mode · Future planner
Monte Carlo, statistics
```

This way the model can be improved without changing anything in the app. Until
real results exist, the app works with placeholders like these (numbers made
up):

```json
{
  "distance_m": [50, 100, 155, 200, 500],
  "hits_per_cm2": [120, 40, 15, 8, 1],
  "damage_probability": [0.99, 0.9, 0.6, 0.4, 0.05]
}
```

## First steps and schedule

First we decide data format and MVP together, then both work in parallel and
merge the parts at the end.

- [ ] Together: read the challenge rules, judging criteria, submission format and deadline on the Space Apps site
- [ ] Together: go through the challenge's Resources tab
- [ ] Together: decide the data format (JSON) and MVP scope
- [ ] Together: create a GitHub repo
- [ ] Math & physics: source list with key numbers (155 m, 1–3 degrees, g = 1.62 m/s²)
- [ ] Math & physics: first simple Python prototype of the simulation
- [ ] Math & physics: roughly compare results with the Apollo 12 case
- [ ] Story & app: write a story outline with 5–7 scenes
- [ ] Story & app: first clickable app version with placeholder data
- [ ] Together: build real data into the app and test it
- [ ] Together: make the video or presentation and submit

**Rough plan:** day 1 prototype and story draft, day 2 connect everything, at
the end presentation and submission. The exact dates depend on the deadline,
which we still have to fill in.

## Sources

- [Forensic Ballistics: How Apollo 12 Helped Solve the Skydiver Meteorite Mystery – Planetary Society (Philip Metzger)](https://planetary.org/articles/0419-forensic-ballistics)
- [Further Analysis on the Mystery of the Surveyor III Dust Deposits – NASA NTRS](https://ntrs.nasa.gov/api/citations/20120000029/downloads/20120000029.pdf)
- [Cratering of Soil by Impinging Jets of Gas – arXiv](https://arxiv.org/pdf/2104.05195)
- [Simulating how Moon landings will kick up dust – Universe Today](https://www.universetoday.com/articles/simulating-how-moon-landings-will-kick-up-dust)
- [PELT, Lunar Ejecta Tool – Florida Space Institute](https://fsi.ucf.edu/?p=1940)
- [For All Moonkind, presentation 2022 – UNOOSA](https://www.unoosa.org/documents/pdf/copuos/stsc/2022/09_For_All_Moonkind_STSC_Presentation_2022.pdf)
- [Plume ejecta study, Acta Astronautica 2024 – University of Southampton](https://eprints.soton.ac.uk/502554/1/1-s2.0-S0094576524005204-main.pdf)
