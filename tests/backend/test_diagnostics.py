"""Acceptance cases for the versioned diagnostic contract (Issue #6).

Every case raises a real FEM-Toolbox 1.4.0 error from an invalid model instead
of constructing exceptions by hand, so a changed Toolbox contract fails here.
"""
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from fem_toolbox.io import read_gmsh

from backend.adapter import diagnostic, read_mesh
from backend.models import validate_model
from tests.backend.test_models import case


class DiagnosticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mesh = read_gmsh("examples/cantilever.msh")

    def diagnose(self, edit, physics="heat"):
        document = copy.deepcopy(case(physics))
        edit(document)
        with self.assertRaises(Exception) as caught:
            validate_model(self.mesh, document)
        result = diagnostic(caught.exception)
        json.dumps(result, allow_nan=False)
        self.assertEqual(result["diagnostic_version"], 1)
        return result

    def test_material_value_keeps_toolbox_path(self):
        result = self.diagnose(lambda d: d["materials"]["T"]["Werkstoff"].pop("conductivity"))
        self.assertEqual(result["category"], "material")
        self.assertEqual(result["code"], "ModelSchemaError")
        self.assertEqual(result["path"], "materials.T.Werkstoff.conductivity")
        self.assertEqual(result["reason"], "required key missing")

    def test_material_assignment_keeps_kind_regions_and_external_cell_id(self):
        result = self.diagnose(lambda d: d["regions"]["T"].update(Basis="Unbekannt"))
        self.assertEqual((result["category"], result["kind"]), ("material", "unknown_material"))
        self.assertEqual(result["path"], "regions.T")
        self.assertEqual(result["related"], ["regions.T.Basis"])
        uncovered = self.diagnose(lambda d: d["regions"]["T"].pop("Spitze"))
        self.assertEqual(uncovered["kind"], "missing")
        self.assertEqual(uncovered["related"], [])
        # Toolbox documents this as the external volume-cell ID; it travels as a string.
        self.assertIsInstance(uncovered["cell_id"], str)

    def test_unknown_facet_set_is_a_reference_error(self):
        result = self.diagnose(lambda d: d["boundary"]["dirichlet"][1].update(set="Fehlt"))
        self.assertEqual((result["category"], result["kind"]), ("reference", "unknown_set"))
        self.assertEqual(result["path"], "boundary.dirichlet[1].set")

    def test_missing_reference_or_support_is_distinguished(self):
        for physics, path in (("heat", "boundary.T"), ("elasticity", "boundary.u"), ("electrostatics", "boundary.phi")):
            with self.subTest(physics=physics):
                result = self.diagnose(lambda d: d["boundary"].update(dirichlet=[]), physics)
                self.assertEqual((result["category"], result["kind"]), ("reference", "missing_anchor"))
                self.assertEqual(result["path"], path)
                self.assertLessEqual(len(result["detail"]), 500)
                self.assertLessEqual(len(result["reason"]), 500)

    def test_conflicting_boundary_conditions_name_both_entries(self):
        def conflict(document):
            first = document["boundary"]["dirichlet"][0]
            document["boundary"]["dirichlet"].append(dict(first, value=400.0))
        result = self.diagnose(conflict)
        self.assertEqual(result["category"], "boundary_conflict")
        self.assertEqual(result["path"], "boundary.dirichlet[2]")
        self.assertEqual(result["related"], ["boundary.dirichlet[0]"])

    def test_other_schema_errors_stay_readable(self):
        result = self.diagnose(lambda d: d["boundary"]["dirichlet"][0].update(unit="degF"))
        self.assertEqual(result["category"], "schema")
        self.assertEqual(result["path"], "boundary.dirichlet[0].unit")
        self.assertIn("degF", result["detail"])

    def test_file_errors_are_their_own_category(self):
        for action in (lambda: read_mesh("netz.stl"), lambda: read_mesh("fehlt.msh")):
            with self.assertRaises(Exception) as caught:
                action()
            self.assertEqual(diagnostic(caught.exception)["category"], "file")

    def test_unclassified_errors_fall_back_to_internal(self):
        result = diagnostic(RuntimeError("unerwartet"))
        self.assertEqual(result["category"], "internal")
        self.assertIsNone(result["path"])
        self.assertEqual(result["detail"], "unerwartet")


class DiagnosticProtocolTests(unittest.TestCase):
    def request(self, payload):
        result = subprocess.run([sys.executable, "backend/adapter.py"], input=json.dumps(payload) + "\n", capture_output=True, text=True, check=True)
        lines = result.stdout.splitlines()
        self.assertEqual(len(lines), 1, "stdout must carry exactly one protocol line")
        return json.loads(lines[0])

    def test_validation_error_travels_structured_over_clean_stdout(self):
        document = case("heat")
        document["boundary"]["dirichlet"][1]["set"] = "Fehlt"
        response = self.request({"id": "diag", "protocolVersion": 1, "action": "validateModel", "path": str(Path("examples/cantilever.msh").resolve()), "document": document})
        self.assertEqual(response["id"], "diag")
        self.assertEqual(response["error"]["category"], "ModelSchemaError")
        self.assertEqual(response["error"]["diagnostic"]["category"], "reference")
        self.assertEqual(response["error"]["diagnostic"]["path"], "boundary.dirichlet[1].set")

    def test_invalid_toml_is_a_file_error(self):
        response = self.request({"id": "toml", "protocolVersion": 1, "action": "parseModel", "text": "physics = "})
        self.assertEqual(response["error"]["diagnostic"]["category"], "file")

    def test_missing_mesh_file_is_a_file_error(self):
        with tempfile.TemporaryDirectory() as folder:
            response = self.request({"id": "mesh", "protocolVersion": 1, "action": "importMesh", "path": str(Path(folder) / "fehlt.msh"), "outputDir": folder})
        self.assertEqual(response["error"]["diagnostic"]["category"], "file")


if __name__ == "__main__":
    unittest.main()
