"""Deterministic Tet4 meshes for the viewer benchmark (#8); written to .cache, not tracked.

Two shapes bracket the surface share: a compact block (few exterior triangles per
cell) and a thin plate (one layer, about 0.7 exterior triangles per cell). Each box
carries the six exterior groups of the box creator plus an overlapping volume group
"Vorderhaelfte" (cell centroids with x < L/2) for group switching.
"""
import json
from pathlib import Path
import sys
import time

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.models import structured_box  # noqa: E402
from fem_toolbox.io import write_vtu  # noqa: E402
from fem_toolbox.mesh import Mesh  # noqa: E402

CASES = {
    "block-100k": ((0.4, 0.2, 0.2), (40, 21, 20)),
    "plate-100k": ((0.5, 0.5, 0.005), (130, 130, 1)),
    "block-1m": ((0.4, 0.2, 0.2), (88, 44, 43)),
    "plate-1m": ((0.5, 0.5, 0.005), (410, 410, 1)),
}


def build(lengths, divisions):
    box = structured_box(lengths, divisions)
    centroids = box.points[box.cells].mean(axis=1)
    front = np.flatnonzero(centroids[:, 0] < lengths[0] / 2)
    return Mesh(points=box.points, tetra4=box.cells, triangle3=box.facets,
                volume_sets={**box.volume_sets, "Vorderhaelfte": front},
                facet_sets=box.facet_sets)


def main(names):
    folder = ROOT / ".cache/viewer-benchmark"
    folder.mkdir(parents=True, exist_ok=True)
    summary = folder / "meshes.json"
    report = json.loads(summary.read_text(encoding="utf-8")) if summary.exists() else {}
    for name in names or CASES:
        lengths, divisions = CASES[name]
        start = time.perf_counter()
        mesh = build(lengths, divisions)
        write_vtu(folder / f"{name}.vtu", mesh)
        report[name] = {"cells": int(mesh.n_cells), "points": int(mesh.n_points),
                        "lengths_m": lengths, "divisions": divisions,
                        "seconds": round(time.perf_counter() - start, 2)}
        print(name, report[name], flush=True)
    summary.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv[1:])
