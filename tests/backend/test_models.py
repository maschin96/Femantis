import json
from pathlib import Path
import tempfile
import tomllib
import unittest

import numpy as np
from fem_toolbox.io import read_gmsh
from fem_toolbox.errors import ModelSchemaError
from backend.models import validate_model, solve_model, read_result, dump_toml, create_box


def case(physics):
    field = {"heat": "T", "elasticity": "u", "electrostatics": "phi"}[physics]
    material = {"heat": {"conductivity": 2.0, "unit": "W/(m K)"}, "elasticity": {"young": 100e9, "poisson": 0.0, "unit": "Pa"}, "electrostatics": {"permittivity": 1.0, "unit": "relative"}}[physics]
    left = {"field": field, "set": "Einspannung", "value": 300.0 if physics == "heat" else 0.0, "unit": {"T": "K", "u": "m", "phi": "V"}[field]}
    right = {"field": field, "set": "Stirnflaeche", "value": 350.0 if physics == "heat" else 10.0, "unit": left["unit"]}
    boundary = {"dirichlet": [left, right]} if physics != "elasticity" else {"dirichlet": [left], "traction": [{"set": "Stirnflaeche", "value": [1e6, 0, 0], "unit": "N/m^2"}]}
    return {"schema_version": 1, "units": "SI", "physics": physics, "materials": {field: {"Werkstoff": material}}, "regions": {field: {"Basis": "Werkstoff", "Spitze": "Werkstoff"}}, "boundary": boundary}


class ModelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mesh = read_gmsh("examples/cantilever.msh")

    def solve(self, physics):
        with tempfile.TemporaryDirectory() as folder:
            result = solve_model(self.mesh, case(physics), Path(folder))
            loaded = read_result(Path(folder))
            self.assertEqual(loaded["input_hash"], result["input_hash"])
            self.assertTrue((Path(folder) / "result.vtu").exists())
            self.assertTrue((Path(folder) / "result.json").exists())
            return loaded

    def values(self, result, name):
        field = next(field for field in result["fields"] if field["id"] == name)
        return result["arrays"][field["buffer"]]

    def test_linear_heat_field_and_balance(self):
        result = self.solve("heat")
        # Exact continuum solution with insulated sides, k=2 W/(m K).
        np.testing.assert_allclose(self.values(result, "temperature_K"), 300 + 50*self.mesh.points[:,0]/.12, atol=1e-9, rtol=0)
        self.assertLess(abs(result["metrics"]["heat"]["power_balance_W"]), 1e-9)

    def test_linear_electrostatic_field(self):
        result = self.solve("electrostatics")
        np.testing.assert_allclose(self.values(result, "potential_V"), 10*self.mesh.points[:,0]/.12, atol=1e-10, rtol=0)

    def test_axial_elasticity_with_zero_poisson_ratio(self):
        result = self.solve("elasticity")
        expected = np.zeros_like(self.mesh.points)
        expected[:,0] = 1e6/100e9*self.mesh.points[:,0]
        np.testing.assert_allclose(self.values(result, "displacement_m"), expected, atol=1e-14, rtol=0)

    def test_missing_reference_and_conflicting_boundary_rejected(self):
        doc = case("heat")
        doc["boundary"]["dirichlet"] = []
        with self.assertRaises(ModelSchemaError):
            validate_model(self.mesh, doc)
        doc = case("heat")
        doc["boundary"]["dirichlet"].append({"field": "T", "set": "Einspannung", "value": 301, "unit": "K"})
        with self.assertRaises(ModelSchemaError):
            validate_model(self.mesh, doc)

    def test_toml_roundtrip_preserves_regions_arrays_and_units(self):
        doc = case("elasticity")
        doc["mesh"] = {"path": "mesh.msh", "length_scale_to_m": .001}
        self.assertEqual(tomllib.loads(dump_toml(doc)), doc)

    def test_damaged_result_bundle_is_not_loaded(self):
        with tempfile.TemporaryDirectory() as folder:
            solve_model(self.mesh, case("heat"), Path(folder))
            (Path(folder) / "result.vtu").write_text("kaputt")
            with self.assertRaisesRegex(ValueError, "Prüfsumme"):
                read_result(Path(folder))

    def test_box_has_six_boundary_groups_and_correct_volume(self):
        from fem_toolbox.elements import Tet4Geometry
        mesh = create_box([.12,.03,.018],[4,2,2])
        self.assertEqual(mesh.n_cells, 96)
        self.assertEqual(set(mesh.facet_sets), {"x_min","x_max","y_min","y_max","z_min","z_max"})
        volume = sum(Tet4Geometry(mesh.points[cell]).volume for cell in mesh.cells)
        self.assertAlmostEqual(volume, .12*.03*.018, places=14)
        all_facets = np.concatenate(list(mesh.facet_sets.values()))
        self.assertEqual(len(np.unique(all_facets)), mesh.n_facets)


if __name__ == "__main__":
    unittest.main()
