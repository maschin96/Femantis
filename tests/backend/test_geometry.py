import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import numpy as np
from fem_toolbox.io import read_gmsh
from fem_toolbox.mesh import inspect_boundary_topology

from backend.models import validate_model
from backend.geometry import GeometryError, mesh_step


def write_box_step(path, lengths=(10.0, 20.0, 30.0)):
    """Independent fixture: a STEP box in millimetres written by Gmsh/OpenCASCADE.

    A separate process keeps Gmsh's global state (units, options) out of the
    tests of the code under test.
    """
    script = (
        "import gmsh, sys; gmsh.initialize(); gmsh.option.setNumber('General.Terminal', 0); "
        f"gmsh.model.occ.addBox(0, 0, 0, *{tuple(lengths)!r}); gmsh.model.occ.synchronize(); "
        "gmsh.write(sys.argv[1]); gmsh.finalize()"
    )
    subprocess.run([sys.executable, "-c", script, str(path)], capture_output=True, check=True)


class StepMeshingTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.step = self.root / "box.step"
        write_box_step(self.step)

    def test_box_is_meshed_in_metres_with_one_group_per_cad_face(self):
        result = mesh_step(self.step, self.root / "out", max_size_m=0.01)
        mesh = read_gmsh(result["mesh"])
        self.assertEqual(mesh.cell_type, "tetra4")
        # 10 x 20 x 30 mm: the STEP unit (mm) becomes metres.
        self.assertTrue(np.allclose(mesh.points.min(axis=0), 0, atol=1e-9))
        self.assertTrue(np.allclose(mesh.points.max(axis=0), [0.01, 0.02, 0.03], atol=1e-9))
        volume = sum(abs(np.linalg.det(mesh.points[c[1:]] - mesh.points[c[0]])) / 6 for c in mesh.cells)
        self.assertAlmostEqual(volume, 6e-6, delta=6e-6 * 1e-9)
        self.assertEqual(sorted(mesh.facet_sets), [f"Flaeche_{i}" for i in range(1, 7)])
        self.assertEqual(list(mesh.volume_sets), ["Bauteil"])
        self.assertEqual(result["faces"], 6)
        self.assertEqual(result["volumes"], 1)
        # Each CAD face group covers exactly the exterior triangles; none is shared.
        exterior = len(inspect_boundary_topology(mesh).exterior_faces)
        self.assertEqual(sum(len(v) for v in mesh.facet_sets.values()), exterior)

    def test_face_groups_follow_the_cad_faces_and_feed_a_model(self):
        mesh = read_gmsh(mesh_step(self.step, self.root / "out", max_size_m=0.01)["mesh"])
        # OpenCASCADE box faces in STEP order: x=0, x=dx, y=0, y=dy, z=0, z=dz.
        expected = {1: (0, 0.0), 2: (0, 0.01), 3: (1, 0.0), 4: (1, 0.02), 5: (2, 0.0), 6: (2, 0.03)}
        for face, (axis, coordinate) in expected.items():
            triangles = mesh.facets[mesh.facet_sets[f"Flaeche_{face}"]]
            self.assertTrue(np.allclose(mesh.points[triangles][:, :, axis], coordinate, atol=1e-9), face)
        document = {"schema_version": 1, "units": "SI", "physics": "heat",
                    "materials": {"T": {"Stahl": {"conductivity": 2.0, "unit": "W/(m K)"}}},
                    "regions": {"T": {"Bauteil": "Stahl"}},
                    "boundary": {"dirichlet": [{"field": "T", "set": "Flaeche_1", "value": 300.0, "unit": "K"},
                                               {"field": "T", "set": "Flaeche_2", "value": 350.0, "unit": "K"}]}}
        model = validate_model(mesh, document)
        heat = model.solve().field_result
        temperature = np.asarray(heat.temperature)
        self.assertEqual(temperature.shape, (mesh.n_points,))
        # Steady 1-D conduction between the two faces is linear in x (exact for Tet4).
        self.assertTrue(np.allclose(temperature, 300 + 50 * mesh.points[:, 0] / 0.01, atol=1e-6))

    def test_smaller_size_gives_more_cells(self):
        coarse = mesh_step(self.step, self.root / "a", max_size_m=0.02)
        fine = mesh_step(self.step, self.root / "b", max_size_m=0.005)
        self.assertGreater(fine["cells"], coarse["cells"])

    def test_default_size_is_derived_from_the_bounding_box(self):
        result = mesh_step(self.step, self.root / "out")
        self.assertGreater(result["cells"], 0)
        self.assertGreater(result["max_size_m"], 0)

    def test_cell_limit_is_enforced(self):
        with self.assertRaisesRegex(GeometryError, "Elemente"):
            mesh_step(self.step, self.root / "out", max_size_m=0.0005, max_cells=1000)

    def test_invalid_inputs_have_actionable_errors(self):
        broken = self.root / "broken.step"
        broken.write_text("not a step file", encoding="utf-8")
        with self.assertRaisesRegex(GeometryError, "STEP"):
            mesh_step(broken, self.root / "out")
        with self.assertRaisesRegex(GeometryError, "STEP|\\.step|\\.stp"):
            mesh_step(self.root / "model.iges", self.root / "out")
        for size in (0, -1, float("nan"), float("inf")):
            with self.assertRaisesRegex(GeometryError, "Elementgröße"):
                mesh_step(self.step, self.root / "out", max_size_m=size)

    def test_gmsh_output_never_reaches_protocol_stdout(self):
        script = (
            "import sys; sys.path.insert(0, 'backend'); "
            "from geometry import mesh_step; import sys as s; "
            f"mesh_step({str(self.step)!r}, {str(self.root / 'o')!r}, max_size_m=0.01)"
        )
        done = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True)
        self.assertEqual(done.returncode, 0, done.stderr[-600:])
        self.assertEqual(done.stdout, "")

    def test_adapter_protocol_returns_one_json_line_and_reports_errors(self):
        def request(**values):
            line = json.dumps({"protocolVersion": 1, "id": "1", "action": "meshGeometry", **values})
            done = subprocess.run([sys.executable, "backend/adapter.py"], input=line + "\n", capture_output=True, text=True)
            self.assertEqual(len(done.stdout.splitlines()), 1, done.stdout[:300])
            return json.loads(done.stdout)
        ok = request(path=str(self.step), outputDir=str(self.root / "out"), maxSize=0.01)
        self.assertEqual(ok["result"]["faces"], 6)
        self.assertTrue(Path(ok["result"]["mesh"]).is_file())
        bad = request(path=str(self.step), outputDir=str(self.root / "o2"), maxSize=-1)
        self.assertEqual(bad["error"]["diagnostic"]["category"], "input")
        self.assertIn("Elementgröße", bad["error"]["message"])


if __name__ == "__main__":
    unittest.main()
