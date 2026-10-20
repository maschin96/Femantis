"""UTF-8 contracts that must not depend on the platform locale (#11).

Windows starts Python with a legacy code page (often cp1252) for stdin and for
`Path.read_text`/`write_text` without an explicit encoding. The cases below force a
non-UTF-8 locale so the same defect is visible on macOS and Linux.
"""
import json
import locale
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
        foreign = "en_US.ISO8859-1"
        try:
            previous = locale.setlocale(locale.LC_CTYPE)
            locale.setlocale(locale.LC_CTYPE, foreign)
            locale.setlocale(locale.LC_CTYPE, previous)
        except locale.Error:
            self.skipTest(f"Locale {foreign} ist auf diesem System nicht installiert.")
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
            environment = {**os.environ, "LC_ALL": foreign, "LANG": foreign, "PYTHONUTF8": "0"}
            completed = subprocess.run(
                [sys.executable, "-c", script, json.dumps(document)],
                capture_output=True, env=environment, cwd=ROOT, check=False,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr.decode("utf-8", "replace"))
            snapshot = (Path(folder) / "case.toml").read_bytes().decode("utf-8")
            self.assertIn(NAME, tomllib.loads(snapshot)["materials"]["T"])


if __name__ == "__main__":
    unittest.main()
