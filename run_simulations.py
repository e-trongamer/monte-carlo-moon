"""Run the simulation studies, reports, and app build in pipeline order.

    python run_simulations.py --quick  # reduced-resolution run
    python run_simulations.py          # full-resolution run; may take hours
"""
from __future__ import annotations

import argparse
import importlib.util
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
# Keep engine/psi off PYTHONPATH to avoid loading config.py as two modules.
IMPORT_PATHS = (
    ROOT,
    ROOT / "engine" / "studies",
    ROOT / "tools",
)
STEPS = (
    ("Escalation study", Path("engine") / "studies" / "escalation.py"),
    ("Pit spectrum", Path("tools") / "pit_spectrum.py"),
    ("Pit calibration", Path("tools") / "pit_calibration.py"),
    ("Mitigation study", Path("engine") / "studies" / "mitigation.py"),
    ("Export app data", Path("tools") / "export_app_data.py"),
)


def child_environment() -> dict[str, str]:
    env = os.environ.copy()
    existing = env.get("PYTHONPATH", "").split(os.pathsep)
    paths = [str(path) for path in IMPORT_PATHS]
    env["PYTHONPATH"] = os.pathsep.join(dict.fromkeys(paths + [p for p in existing if p]))
    return env


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--quick", action="store_true",
                        help="use reduced resolution for all studies")
    args = parser.parse_args()

    if importlib.util.find_spec("numba") is None:
        python = f'"{sys.executable}"'
        requirements = f'"{ROOT / "requirements-accelerated.txt"}"'
        print("[performance] Numba is not installed; simulations will use the "
              "slower NumPy fallback.", flush=True)
        print(f"[performance] Enable acceleration with: {python} -m pip install -r "
              f"{requirements}", flush=True)

    env = child_environment()
    mode = ["--quick"] if args.quick else []
    for label, script in STEPS:
        command = [sys.executable, str(ROOT / script), *mode]
        print(f"\n== {label} ==", flush=True)
        subprocess.run(command, cwd=ROOT, env=env, check=True)

    print("\n== Build app ==", flush=True)
    subprocess.run([sys.executable, str(ROOT / "app" / "build.py")],
                   cwd=ROOT, env=env, check=True)

    print("\nAll studies and app build completed.", flush=True)


if __name__ == "__main__":
    main()
