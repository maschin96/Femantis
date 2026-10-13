"""Install the frozen private Toolbox snapshot using an authenticated gh session."""
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import venv

COMMIT = "baae07f088a87ce6e256af3c5855a3b110d0f17a"
ROOT = Path(__file__).resolve().parents[1]


def main():
    if not (3, 11) <= sys.version_info[:2] < (3, 14):
        raise SystemExit("Python 3.11–3.13 wird benötigt.")
    environment = ROOT / ".venv"
    if not environment.exists():
        venv.create(environment, with_pip=True)
    python = environment / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
    with tempfile.TemporaryDirectory(prefix="femantis-toolbox-") as temporary:
        folder = Path(temporary)
        archive = folder / "toolbox.tar.gz"
        with archive.open("wb") as stream:
            subprocess.run(["gh", "api", f"repos/maschin96/FEM-Toolbox/tarball/{COMMIT}"], stdout=stream, check=True)
        with tarfile.open(archive) as tar:
            tar.extractall(folder, filter="data")
        source = next(folder.glob("maschin96-FEM-Toolbox-*"))
        arguments = [str(python), "-m", "pip", "install", str(source)]
        if sys.version_info[:2] == (3, 13):
            arguments.extend(["--constraint", str(ROOT / "backend/constraints.txt")])
        subprocess.run(arguments, check=True)
    print("FEM-Toolbox 1.4.0 ist installiert. Start: npm run dev")


if __name__ == "__main__":
    main()
