"""One-request stdio adapter. Numerical topology is owned by FEM-Toolbox."""
from contextlib import redirect_stdout
import json
from pathlib import Path
import platform
import sys
import tomllib


def mesh_payload(mesh):
    import numpy as np
    from fem_toolbox.mesh import inspect_boundary_topology

    if not mesh.n_cells:
        raise ValueError("Das Netz enthält keine unterstützten Volumenelemente.")
    if mesh.n_points >= 2**32 or mesh.n_cells >= 2**32:
        raise ValueError("Das Netz überschreitet die 32-Bit-Indizes des Viewers.")
    topology = inspect_boundary_topology(mesh)
    if any(len(owners) > 2 for owners in topology.facet_incidence.values()):
        raise ValueError("Das Netz enthält eine nichtmannigfaltige Volumenfläche.")
    triangles, owners, facets = [], [], []
    for face in topology.exterior_faces:
        nodes = face.nodes
        parts = [nodes] if len(nodes) == 3 else [
            (nodes[0], nodes[3], nodes[5]),
            (nodes[3], nodes[1], nodes[4]),
            (nodes[5], nodes[4], nodes[2]),
            (nodes[3], nodes[4], nodes[5]),
        ]
        for triangle in parts:
            triangles.extend(triangle)
            owners.append(face.cell_index)
            facets.append(-1 if face.triangle_index is None else face.triangle_index)
    arrays = {
        "positions": np.asarray(mesh.points, dtype="<f8"),
        "triangles": np.asarray(triangles, dtype="<u4"),
        "triangleOwners": np.asarray(owners, dtype="<u4"),
        "triangleFacets": np.asarray(facets, dtype="<i4"),
        "activeNodes": np.asarray(np.unique(mesh.cells), dtype="<u4"),
    }
    groups = []
    for kind, selections in (("volume", mesh.volume_sets), ("facet", mesh.facet_sets)):
        for name, indices in sorted(selections.items()):
            key = f"group{len(groups)}"
            arrays[key] = np.asarray(indices, dtype="<u4")
            groups.append({"key": f"{kind}:{name}", "name": name, "kind": kind, "members": key})
    def identifiers(values, count):
        return [str(int(i)) for i in (range(count) if values is None else values)]
    return {
        "buffer_schema_version": 1,
        "cell_type": mesh.cell_type,
        "point_count": mesh.n_points,
        "cell_count": mesh.n_cells,
        "facet_count": mesh.n_facets,
        "boundary_face_count": len(topology.exterior_faces),
        "triangle_count": len(owners),
        "cell_ids": identifiers(mesh.cell_ids, mesh.n_cells),
        "facet_ids": identifiers(mesh.facet_ids, mesh.n_facets),
        "point_ids": identifiers(mesh.point_ids, mesh.n_points),
        "external_ids": {"cells": mesh.cell_ids is not None, "facets": mesh.facet_ids is not None, "points": mesh.point_ids is not None},
        "groups": groups,
        "arrays": arrays,
    }


def write_artifact(payload, folder):
    """Write little-endian arrays; metadata contains no local filesystem paths."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    buffers = {}
    for index, (name, array) in enumerate(payload["arrays"].items()):
        filename = f"buffer-{index}.bin"
        raw = array.tobytes(order="C")
        (folder / filename).write_bytes(raw)
        buffers[name] = {"file": filename, "dtype": array.dtype.str, "count": array.size, "bytes": len(raw)}
    return {**{key: value for key, value in payload.items() if key != "arrays"}, "buffers": buffers}


def read_mesh(path, scale=1):
    from fem_toolbox.io import read_gmsh, read_vtu
    path = Path(path)
    if path.suffix.lower() == ".msh":
        return read_gmsh(path, length_scale_to_m=scale)
    if path.suffix.lower() == ".vtu":
        if scale != 1:
            raise ValueError("VTU-Netze verwenden Meter. Bitte den Importmaßstab auf m setzen.")
        return read_vtu(path)
    raise ValueError("Unterstützte Netzformate: .msh und .vtu.")


def handle_request(request):
    if request.get("protocolVersion") != 1:
        raise ValueError("Unbekannte Adapter-Protokollversion.")
    action = request.get("action")
    if action == "capabilities":
        try:
            import fem_toolbox
            return {"available": True, "pythonVersion": platform.python_version(), "toolboxVersion": fem_toolbox.__version__, "protocolVersion": 1}
        except ImportError:
            return {"available": False, "pythonVersion": platform.python_version(), "message": "FEM-Toolbox fehlt. Bitte npm run setup:backend ausführen."}
    from models import validate_model, solve_model, read_result, dump_toml, create_box
    if action == "parseModel":
        document = tomllib.loads(request["text"])
        json.dumps(document, allow_nan=False)
        return document
    if action == "dumpModel":
        return {"text": dump_toml(request["document"])}
    if action == "createBox":
        from fem_toolbox.io import write_vtu
        mesh = create_box(request["lengths"], request["divisions"])
        write_vtu(Path(request["outputDir"]) / "box.vtu", mesh)
        return {"created": True}
    if action == "readResult":
        return write_artifact(read_result(Path(request["directory"])), Path(request["outputDir"]))
    if action not in ("importMesh", "validateModel", "solveModel"):
        raise ValueError("Unbekannte Adapteraktion.")
    mesh = read_mesh(request["path"], float(request.get("scale", 1)))
    if action == "importMesh":
        return write_artifact(mesh_payload(mesh), Path(request["outputDir"]))
    if action == "validateModel":
        model = validate_model(mesh, request["document"])
        return {"valid": True, "physics": model.physics, "document": model.to_document()}
    def progress(phase):
        sys.__stdout__.write(json.dumps({"id": request["id"], "event": phase}) + "\n")
        sys.__stdout__.flush()
    return write_artifact(solve_model(mesh, request["document"], Path(request["outputDir"]), progress), Path(request["outputDir"]))


def main():
    request = {}
    try:
        request = json.loads(sys.stdin.readline())
        if not isinstance(request, dict):
            raise ValueError("Eine JSON-Anfrage wird benötigt.")
        # meshio prints import notices; stdout is exclusively the JSON protocol.
        with redirect_stdout(sys.stderr):
            result = handle_request(request)
        response = {"id": request.get("id"), "result": result}
    except Exception as error:
        response = {"id": request.get("id") if isinstance(request, dict) else None, "error": {"category": type(error).__name__, "message": str(error), "field": str(getattr(error, "field", ""))}}
    print(json.dumps(response, allow_nan=False))


if __name__ == "__main__":
    main()
