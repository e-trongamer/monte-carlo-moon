"""Model configuration: every input, grouped by what it describes.

Conventions
  * SI units throughout, except grain sizes in micrometres (as the
    literature reports them). Every field name ends in its unit.
  * All groups are frozen: a configuration cannot change after it is built.
    Make variants with `cfg.with_(**{"engine.thrust_n": 44_000})`.
  * Fields marked `post=True` only affect post-processing, so changing them
    does not invalidate cached simulation runs.
  * Sources and assumptions live in each class docstring and in MODEL.md.
    Comments here say what a value is, not how we got to it (CHANGELOG.md).
"""
from __future__ import annotations

import difflib
import hashlib
import json
from dataclasses import dataclass, field, fields, is_dataclass, replace
from enum import Enum, StrEnum
from pathlib import Path
from typing import Any


RESULTS_DIR = Path(__file__).resolve().parents[2] / "results"


class ErosionLaws(StrEnum):
    SCALING = "scaling"         # shear power law, Lane & Metzger 2015
    ROBERTS = "roberts"         # Roberts per-grain entrainment
    ENERGY_FLUX = "energy_flux" # Metzger 2024

class VelocityModels(StrEnum):
    INTEGRATED = "integrated"
    FIG5 = "fig5"

def _member(enum_cls, value):
    try:
        return enum_cls(value)
    except ValueError:
        choices = ", ".join(x.value for x in enum_cls)
        raise ValueError(f"{value!r} is not a {enum_cls.__name__} member; "
                         f"choose from {choices}") from None


def post(default):
    """A field that only post-processing reads (excluded from the run hash)."""
    return field(default=default, metadata={"post": True})


# Environment and vehicle
@dataclass(frozen=True)
class Moon:
    gravity_m_s2: float = 1.625
    radius_m: float = 1.7374e6
    escape_speed_m_s: float = 2380.0


@dataclass(frozen=True)
class Sutherland:
    """Exhaust viscosity mu(T) by Sutherland's law. N2 constants, used as a
    stand-in for the LM exhaust mixture."""
    mu_ref_pa_s: float = 1.663e-5
    t_ref_k: float = 273.15
    s_k: float = 107.0


@dataclass(frozen=True)
class Engine:
    """Single-nozzle engine and its plume, defaults for the Apollo LM descent
    engine near touchdown (hover thrust ~ landed weight 7.2 t x lunar g).

    The LM's exit Mach number, exit temperature, gamma and molar mass are not
    published; chamber_temp_k, gamma and gas_constant are assumptions.
    """
    thrust_n: float = 11_600.0
    exhaust_speed_m_s: float = 3050.0
    chamber_temp_k: float = 2900.0
    gamma: float = 1.24
    gas_constant_j_kg_k: float = 400.0  # ~20.8 g/mol exhaust mixture
    plume_cos_exponent: float = 4.0     # momentum flux ~ cos^n(theta)
    wall_temp_k: float = 300.0          # regolith surface
    recovery_factor: float = 0.85       # ~ Pr^0.5
    viscosity: Sutherland = Sutherland()


@dataclass(frozen=True)
class Descent:
    """Nozzle height over time. Default: Apollo 12, 34 m to 2 m at 0.5 m/s
    (Lane & Metzger 2015)."""
    start_height_m: float = 34.0
    cutoff_height_m: float = 2.0
    height_step_m: float = 0.5
    rate_m_s: float = 0.5


# Regolith and erosion
@dataclass(frozen=True)
class Regolith:
    """Lognormal (by mass) size distribution, truncated to [d_min, d_max].
    Threshold shear stress follows Shao & Lu (2000), a terrestrial aeolian
    law; it is used only by the shear-based erosion laws."""
    grain_density_kg_m3: float = 3100.0
    bulk_density_kg_m3: float = 1500.0
    d50_mass_um: float = 70.0
    geometric_sd: float = 3.0
    d_min_um: float = 1.0
    d_max_um: float = 500.0
    n_size_bins: int = 40
    threshold_coefficient: float = 0.0123 # Shao & Lu A_N
    cohesion_n_m: float = 3.0e-4          # Shao & Lu gamma


@dataclass(frozen=True)
class ShearScalingLaw:
    """mdot = coefficient * tau^exponent [kg m^-2 s^-1] (Lane & Metzger 2015,
    calibrated to the superseded 2.6 t Apollo estimate)."""
    coefficient: float = 0.0222
    exponent: float = 2.52


@dataclass(frozen=True)
class CalibrationVehicle:
    """The vehicle eps is calibrated on. Must stay Apollo: 18 t is an Apollo
    number, and recalibrating per lander would force every lander to 18 t."""
    thrust_n: float = 11_600.0
    descent: Descent = Descent()


@dataclass(frozen=True)
class EnergyFluxLaw:
    """Metzger (2024): mdot = rho_b eps (E - E_th) / (rho_b g <D> + alpha),
    E = rho_g v_g^2 v_thermal / 12.

    The published eps was fitted to Metzger's own CFD field, not to this
    point-source plume, so by default eps is rescaled until the calibration
    vehicle erodes `calibrate_to_mass_t` (midpoint of Metzger's 11-26 t).
    """
    epsilon: float = 0.0029
    threshold_w_m2: float = 0.123
    mean_over_d84: float = 1.5
    cohesion_energy_j_m3: float = 0.289
    calibrate: bool = True
    calibrate_to_mass_t: float = 18.0
    calibration_vehicle: CalibrationVehicle = CalibrationVehicle()


@dataclass(frozen=True)
class Erosion:
    laws: tuple[ErosionLaws, ...] = tuple(ErosionLaws)
    shear_scaling: ShearScalingLaw = ShearScalingLaw()
    energy_flux: EnergyFluxLaw = EnergyFluxLaw()
    
    def __post_init__(self):
        object.__setattr__(self, "laws", tuple(_member(ErosionLaws, x) for x in self.laws))


@dataclass(frozen=True)
class SourceGrid:
    """Radial rings over which erosion is evaluated (log-spaced)."""
    r_min_m: float = 0.05
    r_max_m: float = 120.0
    n_rings: int = 140


# Particle launch
@dataclass(frozen=True)
class Fig5Fit:
    """Lane & Metzger (2015) Fig. 5, digitized (133 points, 1.2% median error):
        u(h, D) = K(h) / sqrt(D_um),  K(h) = K0 (1 + (h/h_k)^(n s))^(-1/s)
    No lift where log10(D_um) + c1 log10(h) > c0. Apollo LM only."""
    k0: float = 2054.0 # m/s * um^0.5
    knee_height_m: float = 3.32
    slope: float = 0.913
    sharpness: float = 36.0
    no_lift_c0: float = 7.082
    no_lift_c1: float = 3.579


@dataclass(frozen=True)
class Velocity:
    """How fast grains leave the surface.

    integrated  drag integration along the wall jet over a path of
                accel_path_m from each grain's launch point
    fig5        the same launch-radius profile, rescaled so its maximum
                matches Fig. 5 (capped at exhaust speed)

    Scaling to other landers is an ASSUMPTION: at fixed chamber conditions the
    nozzle diameter goes as thrust^0.5; the Fig. 5 knee and the acceleration
    path are taken proportional to it, and K0 to its square root.
    """
    model: VelocityModels = VelocityModels.INTEGRATED
    accel_path_m: float = 10.0
    accel_path_thrust_exp: float = 0.5
    step_rel: float = 0.02 # integration step / radius
    fig5: Fig5Fit = Fig5Fit()
    fig5_reference_thrust_n: float = 11_600.0
    fig5_k0_thrust_exp: float = 0.25
    fig5_knee_thrust_exp: float = 0.5

    def __post_init__(self):
        object.__setattr__(self, "model", _member(VelocityModels, self.model))


@dataclass(frozen=True)
class Ejection:
    """Ejection angles. Each hypothesis is a separate model branch: the five
    measured Apollo mission angles plus their mean (Immer/Metzger). The
    within-sheet spread is unconstrained by any measurement."""
    angles_deg: tuple[float, ...] = (1.4, 2.0, 2.4, 2.6, 3.3, 8.1)
    nominal_angle_deg: float = 3.3
    spread_sd_deg: float = 0.5


# Where we look, what we compare with, how we sample
@dataclass(frozen=True)
class Mitigation:
    """Geometry only. 0 disables. Not modelled: pad-edge erosion, ejecta from
    the berm, berm erosion."""
    pad_radius_m: float = 0.0
    berm_radius_m: float = 0.0
    berm_height_m: float = 0.0


@dataclass(frozen=True)
class Targets:
    """Axisymmetric target bands (height above the landing plane x distance)."""
    heights_m: tuple[float, ...] = (-6.0, -3.0, 0.0, 1.5, 3.0, 5.0, 8.0)
    distances_m: tuple[float, ...] = (25, 50, 75, 100, 125, 155, 160, 180, 200, 250,
                                      300, 400, 500, 750, 1000, 1500, 2000, 3000,
                                      5000, 10000)
    height_bin_m: float = 0.25
    hardware_height_m: float = post(1.5)


@dataclass(frozen=True)
class SurveyorAnchor:
    """Surveyor III, the one in-situ measurement. It sat ~3 m below the plain
    inside its crater. SP-284 gives 155 m; Metzger's ~3 divots/cm^2 is tied
    to 180 m. The pit density cancels out of every 'x Surveyor' threshold."""
    distance_m: float = post(155.0)
    height_m: float = post(-3.0)
    pit_density_per_cm2: float = post(103.0)


@dataclass(frozen=True)
class Damage:
    """Sheldon & Kanhere divot volume. divot_coefficient is a placeholder,
    so absolute depths are order-of-magnitude only."""
    target_hardness_pa: float = 1.05e9        # Al alloy, ~107 HV
    divot_coefficient: float = 1.0


@dataclass(frozen=True)
class MonteCarlo:
    particles_per_branch: int = 10_000_000
    seed: int = 20261107


# ---------------------------------------------------------------------------
# The whole configuration
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Config:
    moon: Moon = Moon()
    engine: Engine = Engine()
    descent: Descent = Descent()
    regolith: Regolith = Regolith()
    erosion: Erosion = Erosion()
    source: SourceGrid = SourceGrid()
    velocity: Velocity = Velocity()
    ejection: Ejection = Ejection()
    mitigation: Mitigation = Mitigation()
    targets: Targets = Targets()
    surveyor: SurveyorAnchor = SurveyorAnchor()
    damage: Damage = Damage()
    monte_carlo: MonteCarlo = MonteCarlo()

    def __post_init__(self):
        _validate(self)

    # -- variants ------------------------------------------------------------
    def with_(self, **changes: Any) -> "Config":
        """Copy with some fields changed, addressed by dotted path:
        cfg.with_(**{"engine.thrust_n": 44_000, "velocity.model": "fig5"})"""
        out = self
        for path, value in changes.items():
            out = _replace_path(out, path.split("."), value, path)
        return out

    def to_dict(self, *, skip_post: bool = False) -> dict[str, Any]:
        """Return a plain, JSON-ready representation of this configuration."""
        return _as_plain(self, skip_post)

    # -- identity --------------------------------------------------------------
    def run_hash(self) -> str:
        """Hash of everything the simulation reads. Post-only fields are left
        out, so changing them reuses cached runs."""
        blob = json.dumps(_simulation_view(self), sort_keys=True)
        return hashlib.sha256(blob.encode()).hexdigest()[:16]


def _validate(c: Config) -> None:
    problems = []

    def need(ok, msg):
        if not ok:
            problems.append(msg)

    need(c.engine.thrust_n > 0, "engine.thrust_n must be > 0")
    need(c.engine.gamma > 1, "engine.gamma must be > 1")
    need(c.descent.start_height_m > c.descent.cutoff_height_m > 0,
         "descent: need start_height_m > cutoff_height_m > 0")
    need(c.descent.height_step_m > 0 and c.descent.rate_m_s > 0,
         "descent: height_step_m and rate_m_s must be > 0")
    need(0 < c.regolith.d_min_um < c.regolith.d50_mass_um < c.regolith.d_max_um,
         "regolith: need d_min_um < d50_mass_um < d_max_um")
    need(c.regolith.geometric_sd > 1, "regolith.geometric_sd must be > 1")
    need(c.regolith.n_size_bins >= 2, "regolith.n_size_bins must be >= 2")
    unknown = set(c.erosion.laws) - set(ErosionLaws)
    need(not unknown and c.erosion.laws, f"erosion.laws: unknown {sorted(unknown)}; "
                                         f"choose from {ErosionLaws}")
    need(0 < c.source.r_min_m < c.source.r_max_m, "source: need 0 < r_min_m < r_max_m")
    need(c.velocity.model in VelocityModels,
         f"velocity.model must be one of {VelocityModels}")
    need(c.velocity.accel_path_m > 0, "velocity.accel_path_m must be > 0")
    need(len(c.ejection.angles_deg) > 0 and all(0 < a < 90 for a in c.ejection.angles_deg),
         "ejection.angles_deg must be non-empty and within (0, 90)")
    m = c.mitigation
    need(m.pad_radius_m >= 0 and m.berm_height_m >= 0, "mitigation values must be >= 0")
    need(m.berm_height_m == 0 or m.berm_radius_m > 0,
         "mitigation: a berm with height needs berm_radius_m > 0")
    need(m.pad_radius_m < c.source.r_max_m, "mitigation.pad_radius_m covers the whole source grid")
    d = c.targets.distances_m
    need(all(a < b for a, b in zip(d, d[1:])), "targets.distances_m must be strictly increasing")
    need(c.targets.height_bin_m > 0, "targets.height_bin_m must be > 0")
    need(c.monte_carlo.particles_per_branch > 0, "monte_carlo.particles_per_branch must be > 0")
    if problems:
        raise ValueError("invalid configuration:\n  - " + "\n  - ".join(problems))


# Helpers
def _replace_path(obj, parts, value, full):
    names = [f.name for f in fields(obj)]
    if parts[0] not in names:
        raise KeyError(_unknown(full, _all_paths(Config())))
    if len(parts) == 1:
        current = getattr(obj, parts[0])
        if isinstance(current, tuple) and isinstance(value, list):
            value = tuple(value)
        return replace(obj, **{parts[0]: value})
    return replace(obj, **{parts[0]: _replace_path(getattr(obj, parts[0]), parts[1:], value, full)})

def _all_paths(obj, prefix=""):
    out = []
    for f in fields(obj):
        v = getattr(obj, f.name)
        out += _all_paths(v, f"{prefix}{f.name}.") if is_dataclass(v) else [prefix + f.name]
    return out


def _unknown(key, known):
    hint = difflib.get_close_matches(key, list(known), n=3)
    return f"unknown setting {key!r}" + (f"; did you mean {hint}?" if hint else "")


def _as_plain(obj, skip_post):
    """Dataclasses -> dicts, tuples -> lists, enumes -> values."""
    if is_dataclass(obj):
        return {f.name: _as_plain(getattr(obj, f.name), skip_post)
                for f in fields(obj) if not (skip_post and f.metadata.get("post"))}
    if isinstance(obj, tuple):
        return [_as_plain(x, skip_post) for x in obj]
    if isinstance(obj, Enum):
        return obj.value
    return obj

def _simulation_view(obj):
    out = {}
    for f in fields(obj):
        if f.metadata.get("post"):
            continue
        v = getattr(obj, f.name)
        out[f.name] = _simulation_view(v) if is_dataclass(v) else (list(v) if isinstance(v, tuple) else v)
    return out

# TODO: add all the dataclasses to __all__ for docs, but not the helpers
__all__ = [
    "Config",
    "post",
    "Erosion",
    "ErosionLaws", 
    "Damage",
    "VelocityModels",
]