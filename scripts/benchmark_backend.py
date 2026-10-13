"""Measure import-independent topology+binary transfer; no FPS assertion."""
import json
from pathlib import Path
import platform
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.adapter import mesh_payload, write_artifact
from scripts.generate_example import build_mesh
import fem_toolbox

def main():
    cases = []
    for dimensions in [(8, 3, 2), (20, 10, 5)]:
        mesh = build_mesh(*dimensions)
        start = time.perf_counter()
        payload = mesh_payload(mesh)
        topology_time = time.perf_counter() - start
        with tempfile.TemporaryDirectory() as temporary:
            start = time.perf_counter()
            manifest = write_artifact(payload, Path(temporary))
            binary_time = time.perf_counter() - start
            size = sum(b["bytes"] for b in manifest["buffers"].values())
        cases.append({"cells": mesh.n_cells, "points": mesh.n_points, "surface_triangles": payload["triangle_count"], "topology_seconds": round(topology_time, 4), "binary_write_seconds": round(binary_time, 4), "buffer_bytes": size})
    report = {"platform": platform.platform(), "python": platform.python_version(), "toolbox": fem_toolbox.__version__, "scope": "Python topology and binary buffers; not viewer FPS", "cases": cases}
    folder = Path(__file__).resolve().parents[1] / "Doc/evidence"
    folder.mkdir(exist_ok=True)
    (folder / "backend-baseline.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))

if __name__ == "__main__":
    main()
