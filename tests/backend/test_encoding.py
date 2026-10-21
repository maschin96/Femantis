"""UTF-8 contracts that must not depend on the platform locale (#11).

Windows starts Python with a legacy code page (often cp1252) for stdin and for
`Path.read_text`/`write_text` without an explicit encoding. The cases below force a
non-UTF-8 locale so the same defect is visible on macOS and Linux.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import tomllib
import unittest

ROOT = Path(__file__).resolve().parents[2]
NAME = "Stähl"


# Candidate environments for a child Python whose preferred encoding is not UTF-8.
# Runners rarely install en_US.ISO8859-1; the C locale (ASCII once PEP 538 coercion
# and UTF-8 mode are off) exists on every POSIX system, and Windows uses its ANSI
# code page by default.
FOREIGN_LOCALES = (
    {"LC_ALL": "en_US.ISO8859-1", "LANG": "en_US.ISO8859-1"},
    {"LC_ALL": "C", "LANG": "C", "PYTHONCOERCECLOCALE": "0"},
    {},
)


def foreign_locale_environment():
    """Return the first environment whose child Python does not prefer UTF-8, or None."""
    probe = "import locale; print(locale.getpreferredencoding(False))"
    for overrides in FOREIGN_LOCALES:
        environment = {**os.environ, **overrides, "PYTHONUTF8": "0"}
        completed = subprocess.run(
            [sys.executable, "-c", probe], capture_output=True, env=environment, check=False,
        )
        encoding = completed.stdout.decode("ascii", "replace").strip().lower().replace("-", "")
        if completed.returncode == 0 and encoding and encoding != "utf8":
            return environment
    return None


def heat_document_text():
    text = (ROOT / "examples/heat.toml").read_text(encoding="utf-8")
    return text.replace('"Werkstoff"', f'"{NAME}"')


class EncodingTests(unittest.TestCase):
    def test_adapter_reads_utf8_requests_under_a_foreign_stdin_encoding(self):
        request = {"id": "utf8", "protocolVersion": 1, "action": "parseModel", "text": heat_document_text()}
        environment = {**os.environ, "PYTHONIOENCODING": "latin-1", "PYTHONUTF8": "0"}
        completed = subprocess.run(
            [sys.executable, str(ROOT / "backend/adapter.py")],
            input=(json.dumps(request, ensure_ascii=False) + "\n").encode("utf-8"),
            capture_output=True, env=environment, cwd=ROOT, check=False,
        )
        response = json.loads(completed.stdout.decode("utf-8").splitlines()[-1])
        self.assertIn(NAME, response["result"]["materials"]["T"])

    def test_run_snapshot_files_are_utf8_under_a_foreign_locale(self):
        environment = foreign_locale_environment()
        if environment is None:
            self.skipTest("Keine Locale ohne UTF-8 auf diesem System verfügbar.")
        document = tomllib.loads(heat_document_text())
        document.pop("mesh", None)
        with tempfile.TemporaryDirectory() as folder:
            script = textwrap.dedent(f"""
                import json, locale, sys
                sys.path.insert(0, {str(ROOT)!r})
                assert locale.getpreferredencoding(False).lower() not in ("utf-8", "utf8")
                from backend.adapter import read_mesh
                from backend.models import solve_model
                mesh = read_mesh({str(ROOT / "examples/cantilever.msh")!r}, 1.0)
                solve_model(mesh, json.loads(sys.argv[1]), {folder!r})
            """)
            completed = subprocess.run(
                [sys.executable, "-c", script, json.dumps(document)],
                capture_output=True, env=environment, cwd=ROOT, check=False,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr.decode("utf-8", "replace"))
            snapshot = (Path(folder) / "case.toml").read_bytes().decode("utf-8")
            self.assertIn(NAME, tomllib.loads(snapshot)["materials"]["T"])


if __name__ == "__main__":
    unittest.main()
