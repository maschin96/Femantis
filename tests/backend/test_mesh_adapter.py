"""Independent acceptance cases for the desktop mesh boundary contract."""
import json
from pathlib import Path
import tempfile
import unittest
import subprocess
import sys

import numpy as np
from fem_toolbox.mesh import Mesh
from fem_toolbox.errors import DegenerateElementError

from backend.adapter import mesh_payload, write_artifact


class MeshAdapterTests(unittest.TestCase):
    def two_tetrahedra(self):
        return Mesh(
            points=[[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]],
            tetra4=[[0, 1, 2, 3], [0, 2, 1, 4]],
            tetra4_ids=[2**60 + 1, 2**60 + 2],
            volume_sets={"all": [0, 1], "upper": [0]},
        )

    def test_shared_face_removed_and_original_owners_retained(self):
        data = mesh_payload(self.two_tetrahedra())
        self.assertEqual(data["triangle_count"], 6)
        self.assertEqual(data["boundary_face_count"], 6)
        self.assertEqual(data["cell_ids"], [str(2**60 + 1), str(2**60 + 2)])
        self.assertTrue(data["external_ids"]["cells"])
        self.assertFalse(data["external_ids"]["points"])
        owners = data["arrays"]["triangleOwners"]
        self.assertEqual(np.bincount(owners).tolist(), [3, 3])
        self.assertTrue(np.all(data["arrays"]["triangleFacets"] == -1))
        triangles = data["arrays"]["triangles"].reshape(-1, 3)
        self.assertNotIn({0, 1, 2}, [set(t) for t in triangles])

    def test_group_membership_is_not_flattened(self):
        data = mesh_payload(self.two_tetrahedra())
        self.assertEqual([(g["name"], g["kind"]) for g in data["groups"]], [("all", "volume"), ("upper", "volume")])
        self.assertEqual(data["arrays"][data["groups"][0]["members"]].tolist(), [0, 1])

    def test_tet10_subdivision_preserves_owner_and_facet_group(self):
        points = np.array([[0,0,0], [1,0,0], [0,1,0], [0,0,1], [.5,0,0], [.5,.5,0], [0,.5,0], [0,0,.5], [.5,0,.5], [0,.5,.5]])
        mesh = Mesh(points=points, tetra10=[list(range(10))], triangle6=[[0,2,1,6,5,4]], tetra10_ids=[99], triangle6_ids=[77], facet_sets={"base": [0]})
        data = mesh_payload(mesh)
        self.assertEqual(data["boundary_face_count"], 4)
        self.assertEqual(data["triangle_count"], 16)
        self.assertEqual(np.count_nonzero(data["arrays"]["triangleFacets"] == 0), 4)
        self.assertEqual(set(data["arrays"]["triangles"]), set(range(10)))
        self.assertEqual(data["facet_ids"], ["77"])

    def test_tet10_display_triangles_name_their_triangle6_face(self):
        """Each display triangle lists the six nodes of its face: corners, then edge 01/12/20."""
        points = np.array([[0,0,0], [1,0,0], [0,1,0], [0,0,1], [.5,0,0], [.5,.5,0], [0,.5,0], [0,0,.5], [.5,0,.5], [0,.5,.5]])
        mesh = Mesh(points=points, tetra10=[list(range(10))])
        data = mesh_payload(mesh)
        faces = data["arrays"]["triangleFaceNodes"].reshape(-1, 6)
        triangles = data["arrays"]["triangles"].reshape(-1, 3)
        self.assertEqual(faces.shape, (16, 6))
        self.assertEqual(faces.dtype.str, "<u4")
        for face, triangle in zip(faces, triangles):
            self.assertTrue(set(triangle) <= set(face))
            corners = points[face[:3]]
            # Straight-edged Tet10: midside nodes lie at the edge midpoints.
            for midside, (a, b) in zip(face[3:], ((0, 1), (1, 2), (2, 0))):
                np.testing.assert_allclose(points[midside], (corners[a] + corners[b]) / 2)
        # Four consecutive display triangles share one face; four faces in total.
        self.assertEqual(len({tuple(face) for face in faces}), 4)
        for start in range(0, 16, 4):
            self.assertTrue((faces[start:start + 4] == faces[start]).all())

    def test_tet4_payload_has_no_triangle6_buffer(self):
        self.assertNotIn("triangleFaceNodes", mesh_payload(self.two_tetrahedra())["arrays"])

    def test_binary_artifact_roundtrip_retains_double_coordinates(self):
        data = mesh_payload(self.two_tetrahedra())
        with tempfile.TemporaryDirectory() as folder:
            manifest = write_artifact(data, Path(folder))
            self.assertNotIn("arrays", manifest)
            self.assertEqual(manifest["buffer_schema_version"], 1)
            for name, spec in manifest["buffers"].items():
                raw = (Path(folder) / spec["file"]).read_bytes()
                array = np.frombuffer(raw, dtype=spec["dtype"])
                np.testing.assert_array_equal(array, data["arrays"][name].reshape(-1))
            json.dumps(manifest, allow_nan=False)

    def test_empty_volume_rejected(self):
        with self.assertRaisesRegex(ValueError, "Volumen"):
            mesh_payload(Mesh(points=[[0, 0, 0]]))

    def test_import_notice_does_not_corrupt_stdio_protocol(self):
        with tempfile.TemporaryDirectory() as folder:
            request = {"id": "probe", "protocolVersion": 1, "action": "importMesh", "path": str(Path("examples/tet10-groups.msh").resolve()), "outputDir": folder}
            result = subprocess.run([sys.executable, "backend/adapter.py"], input=json.dumps(request) + "\n", capture_output=True, text=True, check=True)
            response = json.loads(result.stdout)
            self.assertEqual(response["id"], "probe")
            self.assertEqual(response["result"]["triangle_count"], 16)

    def test_incompatible_protocol_returns_structured_error(self):
        result = subprocess.run([sys.executable, "backend/adapter.py"], input='{"id":"wrong","protocolVersion":99,"action":"capabilities"}\n', capture_output=True, text=True, check=True)
        response = json.loads(result.stdout)
        self.assertEqual(response["id"], "wrong")
        self.assertEqual(response["error"]["category"], "ValueError")

    def test_invalid_volume_geometry_is_rejected_before_rendering(self):
        mesh = Mesh(points=[[0,0,0], [1,0,0], [0,1,0], [1,1,0]], tetra4=[[0,1,2,3]])
        with self.assertRaises(DegenerateElementError):
            mesh_payload(mesh)


if __name__ == "__main__":
    unittest.main()
