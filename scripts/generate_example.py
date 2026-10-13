"""Deterministic viewer geometry in SI; no loads or solver results."""
from pathlib import Path
import numpy as np
import meshio
from fem_toolbox.mesh import Mesh, inspect_boundary_topology

ROOT = Path(__file__).resolve().parents[1]


def build_mesh(nx=8, ny=3, nz=2):
    points = np.array([[x * .12 / nx, y * .03 / ny, z * .018 / nz] for z in range(nz + 1) for y in range(ny + 1) for x in range(nx + 1)])
    def node(x, y, z):
        return x + (nx + 1) * (y + (ny + 1) * z)
    cells = []
    for z in range(nz):
        for y in range(ny):
            for x in range(nx):
                a, b, c, d = node(x,y,z), node(x+1,y,z), node(x+1,y+1,z), node(x,y+1,z)
                e, f, g, h = node(x,y,z+1), node(x+1,y,z+1), node(x+1,y+1,z+1), node(x,y+1,z+1)
                cells.extend([[a,b,c,g], [a,c,d,g], [a,d,h,g], [a,h,e,g], [a,e,f,g], [a,f,b,g]])
    cells = np.asarray(cells, dtype=np.int64)
    # Orient tetrahedra positively for the Toolbox's independent geometry checks.
    corners = points[cells]
    negative = np.linalg.det(np.stack([corners[:,1]-corners[:,0], corners[:,2]-corners[:,0], corners[:,3]-corners[:,0]], axis=2)) < 0
    cells[negative, :2] = cells[negative, :2][:, ::-1]
    return Mesh(points=points, tetra4=cells)


def main():
    mesh = build_mesh()
    faces = inspect_boundary_topology(mesh).exterior_faces
    triangles = np.asarray([face.nodes for face in faces])
    centers = mesh.points[triangles].mean(axis=1)
    facet_tags = np.where(np.isclose(centers[:,0], 0), 11, np.where(np.isclose(centers[:,0], .12), 12, 13))
    volume_tags = np.where(mesh.points[mesh.cells].mean(axis=1)[:,0] < .06, 21, 22)
    meshio.write(ROOT / "examples/cantilever.msh", meshio.Mesh(mesh.points, [("tetra", mesh.cells), ("triangle", triangles)], cell_data={"gmsh:physical": [volume_tags, facet_tags], "gmsh:geometrical": [volume_tags, facet_tags]}, field_data={"Basis": np.array([21, 3]), "Spitze": np.array([22, 3]), "Einspannung": np.array([11, 2]), "Stirnflaeche": np.array([12, 2]), "Mantel": np.array([13, 2])}), file_format="gmsh22", binary=False)
    print(f"{mesh.n_points} Knoten, {mesh.n_cells} Tet4, {len(faces)} Außenflächen")


if __name__ == "__main__":
    main()
