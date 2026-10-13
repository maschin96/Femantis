import type { MeshPacket, ViewState } from '../../shared/types';

export function visibleTriangles(mesh: MeshPacket, view: ViewState): number[] {
  const hidden = new Set<number>();
  for (const key of view.hiddenGroups) {
    for (const triangle of selectedTriangles(mesh, key)) hidden.add(triangle);
  }
  return Array.from({ length: mesh.triangleCount }, (_, index) => index).filter(
    (index) => !hidden.has(index),
  );
}

export function selectedTriangles(mesh: MeshPacket, key: string | null): Set<number> {
  const group = mesh.groups.find((group) => group.key === key);
  if (!group) return new Set();
  const members = new Set(group.members);
  const indices = group.kind === 'volume' ? mesh.triangleOwners : mesh.triangleFacets;
  const result = new Set<number>();
  for (let index = 0; index < mesh.triangleCount; index++) {
    if (members.has(indices[index])) result.add(index);
  }
  return result;
}
