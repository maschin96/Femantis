"""STEP geometry meshing with Gmsh/OpenCASCADE; the result is an ordinary .msh file.

The numerical model still reads the mesh through the public Toolbox reader, so
this module only produces input: a Tet4 volume mesh in metres whose boundary
triangles are grouped per CAD face.
"""
from contextlib import contextmanager
import math
import os
from pathlib import Path
import sys

STEP_SUFFIXES = (".step", ".stp")
DEFAULT_MAX_CELLS = 100_000
# Mean Tet4 volume for edge length h is roughly h^3 / (6 sqrt 2); used only to
# reject hopeless sizes before the mesher runs.
_REGULAR_TET = 1 / (6 * math.sqrt(2))


class GeometryError(ValueError):
    """A geometry file or meshing setting cannot be used."""


@contextmanager
def _native_stdout_to_stderr():
    """Gmsh and OpenCASCADE write to the C-level stdout, which is the JSON protocol."""
    sys.stdout.flush()
    saved = os.dup(1)
    try:
        os.dup2(2, 1)
        yield
    finally:
        os.dup2(saved, 1)
        os.close(saved)


def mesh_step(path, output_dir, *, max_size_m=None, max_cells=DEFAULT_MAX_CELLS):
    """Mesh one STEP solid into ``<output_dir>/geometry.msh`` (Gmsh 4.1, Tet4).

    The STEP length unit is honoured and converted to metres. The volume forms
    the group ``Bauteil``; each CAD boundary face ``n`` (Gmsh surface tag, i.e.
    STEP face order) forms the group ``Flaeche_<n>``. ``max_size_m`` is the
    maximum element edge length in metres (default: bounding-box diagonal / 10).
    Returns a JSON-safe summary with the mesh path and counts.
    """
    path = Path(path)
    if path.suffix.lower() not in STEP_SUFFIXES:
        raise GeometryError("Unterstützte Geometrieformate: .step und .stp (STEP).")
    if max_size_m is not None and (not isinstance(max_size_m, (int, float)) or not math.isfinite(max_size_m) or max_size_m <= 0):
        raise GeometryError("Die Elementgröße muss eine positive endliche Zahl in Metern sein.")
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    target = output_dir / "geometry.msh"
    import gmsh
    with _native_stdout_to_stderr():
        gmsh.initialize()
        try:
            return _mesh(gmsh, path, target, max_size_m, max_cells)
        finally:
            gmsh.finalize()


def _mesh(gmsh, path, target, max_size_m, max_cells):
    gmsh.option.setNumber("General.Terminal", 0)
    gmsh.option.setString("Geometry.OCCTargetUnit", "M")
    try:
        gmsh.model.occ.importShapes(str(path))
        gmsh.model.occ.synchronize()
    except Exception as error:
        raise GeometryError(f"Die STEP-Datei konnte nicht gelesen werden: {error}") from error
    volumes = [tag for _, tag in gmsh.model.getEntities(3)]
    if not volumes:
        raise GeometryError("Die STEP-Datei enthält keinen Volumenkörper (nur Flächen oder Kurven).")
    if len(volumes) > 1:
        raise GeometryError("Die STEP-Datei enthält mehrere Volumenkörper. Dieser Schnitt meshed genau einen.")
    x0, y0, z0, x1, y1, z1 = gmsh.model.getBoundingBox(-1, -1)
    size = max_size_m if max_size_m is not None else math.dist((x0, y0, z0), (x1, y1, z1)) / 10
    if not size > 0:
        raise GeometryError("Die Geometrie hat keine Ausdehnung.")
    estimate = gmsh.model.occ.getMass(3, volumes[0]) / (size**3 * _REGULAR_TET)
    if estimate > 5 * max_cells:
        raise GeometryError(
            f"Mit dieser Elementgröße entstünden etwa {estimate:,.0f} Elemente (Grenze {max_cells:,}). Größeres Maß wählen.".replace(",", ".")
        )
    faces = [tag for _, tag in gmsh.model.getBoundary([(3, volumes[0])], combined=True, oriented=False)]
    for tag in faces:
        gmsh.model.addPhysicalGroup(2, [tag], name=f"Flaeche_{tag}")
    gmsh.model.addPhysicalGroup(3, volumes, name="Bauteil")
    # OCC points carry the size; Mesh.MeshSizeMax alone leaves the default (bounding-box based) in place.
    gmsh.model.mesh.setSize(gmsh.model.getEntities(0), size)
    gmsh.option.setNumber("Mesh.MeshSizeMax", size)
    gmsh.option.setNumber("Mesh.MeshSizeMin", 0)
    gmsh.option.setNumber("Mesh.ElementOrder", 1)
    try:
        gmsh.model.mesh.generate(3)
    except Exception as error:
        raise GeometryError(f"Das Volumennetz konnte nicht erzeugt werden: {error}") from error
    cells = sum(len(tags) for tags in gmsh.model.mesh.getElements(3)[1])
    if cells == 0:
        raise GeometryError("Das Volumennetz ist leer. Elementgröße oder Geometrie prüfen.")
    if cells > max_cells:
        raise GeometryError(f"Das Netz hat {cells} Elemente (Grenze {max_cells}). Größere Elemente wählen.")
    gmsh.option.setNumber("Mesh.MshFileVersion", 4.1)
    gmsh.option.setNumber("Mesh.SaveAll", 0)
    gmsh.write(str(target))
    return {
        "mesh": str(target),
        "cells": cells,
        "points": len(gmsh.model.mesh.getNodes()[0]),
        "faces": len(faces),
        "volumes": len(volumes),
        "max_size_m": size,
        "gmsh_version": gmsh.__version__,
    }
