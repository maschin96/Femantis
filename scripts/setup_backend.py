"""Install the frozen public Toolbox snapshot; no GitHub login is required."""
from pathlib import Path
import subprocess
import sys
import venv

COMMIT = "baae07f088a87ce6e256af3c5855a3b110d0f17a"
ROOT = Path(__file__).resolve().parents[1]
# The full commit SHA in the URL pins the exact source tree. pip downloads it
# with its bundled CA certificates, which python.org builds on macOS lack.
ARCHIVE = f"https://codeload.github.com/maschin96/FEM-Toolbox/tar.gz/{COMMIT}"


def main():
    if not (3, 11) <= sys.version_info[:2] < (3, 14):
        raise SystemExit("Python 3.11–3.13 wird benötigt.")
    environment = ROOT / ".venv"
    if not environment.exists():
        venv.create(environment, with_pip=True)
    python = environment / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
    arguments = [str(python), "-m", "pip", "install", f"fem-toolbox @ {ARCHIVE}"]
    if sys.version_info[:2] == (3, 13):
        arguments.extend(["--constraint", str(ROOT / "backend/constraints.txt")])
    if subprocess.run(arguments).returncode != 0:
        raise SystemExit(f"FEM-Toolbox konnte nicht installiert werden. Quelle: {ARCHIVE}")
    print("FEM-Toolbox 1.4.0 ist installiert. Start: npm run dev")


if __name__ == "__main__":
    main()
