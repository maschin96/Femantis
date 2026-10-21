"""Install the frozen public Toolbox snapshot; no GitHub login is required."""
from importlib import metadata
from pathlib import Path
import re
import subprocess
import sys
import venv

COMMIT = "baae07f088a87ce6e256af3c5855a3b110d0f17a"
ROOT = Path(__file__).resolve().parents[1]
# The full commit SHA in the URL pins the exact source tree. pip downloads it
# with its bundled CA certificates, which python.org builds on macOS lack.
# Optional STEP meshing (#13). Gmsh is GPL-2.0-or-later; it is installed for development
# only and is not part of backend/constraints.txt or the packaged runtime.
GMSH_REQUIREMENT = "gmsh==4.15.2"
ARCHIVE = f"https://codeload.github.com/maschin96/FEM-Toolbox/tar.gz/{COMMIT}"


def _normalized(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def constraint_mismatches(constraints, version_of):
    """Differences between `name==version` pins and installed versions (PEP 503 names)."""
    mismatches = []
    for line in constraints.splitlines():
        requirement = line.split("#", 1)[0].strip()
        if not requirement:
            continue
        name, separator, expected = requirement.partition("==")
        if not separator or not expected.strip():
            raise ValueError(f"Constraint ohne exakte Version: {requirement}")
        name, expected = _normalized(name.strip()), expected.strip()
        installed = version_of(name)
        if installed is None:
            mismatches.append(f"{name}: nicht installiert, erwartet {expected}")
        elif installed != expected:
            mismatches.append(f"{name}: installiert {installed}, erwartet {expected}")
    return mismatches


def check_constraints():
    """Run inside .venv: fail when the environment deviates from backend/constraints.txt."""
    def version_of(name):
        try:
            return metadata.version(name)
        except metadata.PackageNotFoundError:
            return None

    mismatches = constraint_mismatches((ROOT / "backend/constraints.txt").read_text(encoding="utf-8"), version_of)
    if mismatches:
        raise SystemExit("Abweichung von backend/constraints.txt:\n" + "\n".join(mismatches))
    print("Alle Versionen aus backend/constraints.txt sind installiert.")


def main():
    if sys.argv[1:] == ["--check-constraints"]:
        check_constraints()
        return
    if not (3, 11) <= sys.version_info[:2] < (3, 14):
        raise SystemExit("Python 3.11–3.13 wird benötigt.")
    environment = ROOT / ".venv"
    if not environment.exists():
        venv.create(environment, with_pip=True)
    python = environment / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
    arguments = [str(python), "-m", "pip", "install", f"fem-toolbox @ {ARCHIVE}", GMSH_REQUIREMENT]
    if sys.version_info[:2] == (3, 13):
        arguments.extend(["--constraint", str(ROOT / "backend/constraints.txt")])
    if subprocess.run(arguments).returncode != 0:
        raise SystemExit(f"FEM-Toolbox konnte nicht installiert werden. Quelle: {ARCHIVE}")
    print("FEM-Toolbox 1.4.0 ist installiert. Start: npm run dev")


if __name__ == "__main__":
    main()
