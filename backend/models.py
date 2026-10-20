"""Stationary Model adapter; all numerics and raw exports stay in the Toolbox."""
import hashlib
import json
import math
from pathlib import Path


def validate_model(mesh, document):
    from fem_toolbox.model import Model
    if document.get("physics") not in ("heat", "elasticity", "electrostatics") or document.get("schema_version") != 1:
        raise ValueError("Dieser Editor unterstützt stationäre Wärme, Elastizität und Elektrostatik mit Modell-Schema 1.")
    return Model(mesh=mesh, document=document)


def solve_model(mesh, document, folder, progress=None):
    from fem_toolbox.io import export_result_bundle
    progress = progress or (lambda phase: None)
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    progress("validating")
    model = validate_model(mesh, document)
    (folder / "case.json").write_text(json.dumps(model.to_document(), indent=2, allow_nan=False) + "\n")
    (folder / "case.toml").write_text(dump_toml(model.to_document()))
    progress("solving")
    result = model.solve()
    progress("exporting")
    export_result_bundle(folder / "result", mesh, result)
    return read_result(folder, expected_mesh=mesh, expected_physics=model.physics)


def read_result(folder, *, expected_mesh=None, expected_physics=None):
    import meshio
    import numpy as np
    from fem_toolbox.io import read_vtu
    folder = Path(folder)
    manifest = json.loads((folder / "result.json").read_text())
    if manifest["bundle_schema_version"] not in (1, 2) or manifest["solver_status"] != "converged":
        raise ValueError("Nicht unterstütztes oder unvollständiges Ergebnisbündel.")
    if manifest["files"]["fields"] != "result.vtu":
        raise ValueError("Unzulässiger Ergebnisdateipfad.")
    if hashlib.sha256((folder / "result.vtu").read_bytes()).hexdigest() != manifest["files"]["fields_sha256"]:
        raise ValueError("Die Prüfsumme der Ergebnisdatei stimmt nicht.")
    if expected_physics is not None and manifest["physics"] != expected_physics:
        raise ValueError("Das Ergebnis gehört zu einer anderen Physik.")
    result_mesh = read_vtu(folder / "result.vtu")
    if (manifest["mesh"]["points"] != result_mesh.n_points
            or manifest["mesh"].get(f"{result_mesh.cell_type}_cells") != result_mesh.n_cells):
        raise ValueError("Netzzeilenzahlen im Ergebnismanifest stimmen nicht.")
    if expected_mesh is not None:
        if (result_mesh.cell_type != expected_mesh.cell_type
                or not np.array_equal(result_mesh.points, expected_mesh.points)
                or not np.array_equal(result_mesh.cells, expected_mesh.cells)
                or not np.array_equal(result_mesh.facets, expected_mesh.facets)):
            raise ValueError("Das Ergebnisnetz stimmt in Geometrie oder Topologie nicht mit dem Eingabenetz überein.")
        for name in ("volume_sets", "facet_sets"):
            actual, expected = getattr(result_mesh, name), getattr(expected_mesh, name)
            if actual.keys() != expected.keys() or any(not np.array_equal(actual[key], expected[key]) for key in expected):
                raise ValueError("Die Netzgruppen des Ergebnisses stimmen nicht mit der Eingabe überein.")
        for name in ("point_ids", "cell_ids", "facet_ids"):
            expected = getattr(expected_mesh, name)
            if expected is not None and not np.array_equal(getattr(result_mesh, name), expected):
                raise ValueError("Die Original-IDs des Ergebnisnetzes stimmen nicht mit der Eingabe überein.")
    mesh = meshio.read(folder / "result.vtu")
    arrays, fields = {}, []
    for family, definitions in manifest["fields"].items():
        if family not in ("point", "tetra4", "tetra10"):
            continue
        for name, definition in definitions.items():
            values = mesh.point_data[name] if family == "point" else mesh.cell_data_dict[name]["tetra" if family == "tetra4" else "tetra10"]
            values = np.asarray(values, dtype="<f8")
            rows = result_mesh.n_points if family == "point" else result_mesh.n_cells
            width = len(definition["components"])
            if (family != "point" and family != result_mesh.cell_type
                    or values.shape not in ((rows,), (rows, width))
                    or values.ndim == 1 and width != 1):
                raise ValueError("Zeilenzahl oder Komponenten des Ergebnisfelds stimmen nicht mit dem Netz überein.")
            if not np.isfinite(values).all():
                raise ValueError("Ein Ergebnisfeld enthält nichtendliche Rohwerte.")
            key = f"field{len(fields)}"
            arrays[key] = values
            field = {"id": name, "unit": definition["unit"], "association": "point" if family == "point" else "cell", "components": definition["components"], "rows": len(values), "buffer": key, "at_centroid": name.endswith("_at_centroid")}
            if family == "point":
                mask = np.zeros(len(values), dtype="<u4")
                active = definition["active_node_ids"]
                if (not isinstance(active, list)
                        or any(type(index) is not int or index < 0 or index >= rows for index in active)
                        or len(set(active)) != len(active)
                        or not np.array_equal(np.sort(active), np.unique(result_mesh.cells))):
                    raise ValueError("Aktive Knoten des Ergebnisfelds stimmen nicht mit dem Netz überein.")
                mask[active] = 1
                arrays[f"{key}Mask"] = mask
                field["mask"] = f"{key}Mask"
            fields.append(field)
    primary = {"heat": "temperature_K", "elasticity": "displacement_m", "electrostatics": "potential_V"}.get(manifest["physics"])
    if primary is None or not any(field["id"] == primary for field in fields):
        raise ValueError("Das primäre Ergebnisfeld passt nicht zur Physik.")
    return {"physics": manifest["physics"], "toolbox_version": manifest["toolbox_version"], "input_hash": manifest["provenance"]["input_sha256"], "metrics": manifest["metrics"], "limitations": manifest["limitations"], "fields": fields, "arrays": arrays, "point_count": result_mesh.n_points, "cell_count": result_mesh.n_cells}


def dump_toml(document):
    """Serialize JSON-safe stationary Model tables without changing their values."""
    def key(value):
        return json.dumps(value, ensure_ascii=False)
    def scalar(value):
        if isinstance(value, bool): return "true" if value else "false"
        if isinstance(value, str): return json.dumps(value, ensure_ascii=False)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            if not math.isfinite(value): raise ValueError("Modellwerte müssen endlich sein.")
            return repr(value)
        if isinstance(value, list): return "[" + ", ".join(scalar(item) for item in value) + "]"
        raise ValueError("Nicht unterstützter TOML-Wert.")
    lines = []
    def table(values, path, array=False):
        if path:
            section = ".".join(key(item) for item in path)
            lines.extend(["", f"[[{section}]]" if array else f"[{section}]"])
        for name, value in values.items():
            if not isinstance(value, dict) and not (isinstance(value, list) and value and isinstance(value[0], dict)):
                lines.append(f"{key(name)} = {scalar(value)}")
        for name, value in values.items():
            if isinstance(value, dict): table(value, path + [name])
            elif isinstance(value, list) and value and isinstance(value[0], dict):
                for item in value: table(item, path + [name], True)
    table(document, [])
    return "\n".join(lines) + "\n"


def create_box(lengths, divisions):
    """Structured Tet4 box in metres with six named exterior boundary groups."""
    if len(lengths) != 3 or len(divisions) != 3 or any(not math.isfinite(v) or v <= 0 for v in lengths) or any(type(v) is not int or v < 1 or v > 40 for v in divisions) or math.prod(divisions)*6 > 30000:
        raise ValueError("Positive Abmessungen, 1–40 Teilungen je Achse und höchstens 30.000 Elemente wählen.")
    return structured_box(lengths, divisions)


def structured_box(lengths, divisions):
    """Unbounded structured Tet4 box; callers validate sizes (UI limit in create_box)."""
    import numpy as np
    from fem_toolbox.mesh import Mesh, inspect_boundary_topology
    nx, ny, nz = divisions
    points = np.array([[x*lengths[0]/nx, y*lengths[1]/ny, z*lengths[2]/nz] for z in range(nz+1) for y in range(ny+1) for x in range(nx+1)])
    def node(x,y,z): return x+(nx+1)*(y+(ny+1)*z)
    cells = []
    for z in range(nz):
        for y in range(ny):
            for x in range(nx):
                a,b,c,d = node(x,y,z),node(x+1,y,z),node(x+1,y+1,z),node(x,y+1,z)
                e,f,g,h = node(x,y,z+1),node(x+1,y,z+1),node(x+1,y+1,z+1),node(x,y+1,z+1)
                cells.extend([[a,b,c,g],[a,c,d,g],[a,d,h,g],[a,h,e,g],[a,e,f,g],[a,f,b,g]])
    cells = np.asarray(cells)
    mesh = Mesh(points=points, tetra4=cells, volume_sets={"Bauteil": np.arange(len(cells))})
    triangles = np.asarray([face.nodes for face in inspect_boundary_topology(mesh).exterior_faces])
    centers = points[triangles].mean(axis=1)
    groups = {}
    for axis, name in enumerate("xyz"):
        groups[f"{name}_min"] = np.flatnonzero(np.isclose(centers[:,axis], 0, rtol=0, atol=lengths[axis]*1e-10))
        groups[f"{name}_max"] = np.flatnonzero(np.isclose(centers[:,axis], lengths[axis], rtol=0, atol=lengths[axis]*1e-10))
    return Mesh(points=points, tetra4=cells, triangle3=triangles, volume_sets=mesh.volume_sets, facet_sets=groups)
