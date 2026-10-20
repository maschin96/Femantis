import type { MeshPacket, ViewState } from '../../shared/types';

/**
 * 1 for every mesh triangle belonging to the group (volume: owner cell; facet: surface
 * row), or null for an unknown key. Membership uses flags instead of hash sets.
 */
export function groupTriangleMask(mesh: MeshPacket, key: string | null): Uint8Array | null {
  const group = mesh.groups.find((group) => group.key === key);
  if (!group) return null;
  let size = 0;
  for (const member of group.members) if (member >= size) size = member + 1;
  const members = new Uint8Array(size);
  for (const member of group.members) members[member] = 1;
  const indices = group.kind === 'volume' ? mesh.triangleOwners : mesh.triangleFacets;
  const mask = new Uint8Array(mesh.triangleCount);
  for (let index = 0; index < mesh.triangleCount; index++) {
    const owner = indices[index];
    if (owner >= 0 && owner < size && members[owner]) mask[index] = 1;
  }
  return mask;
}

export function visibleTriangles(mesh: MeshPacket, view: ViewState): number[] {
  const hidden = new Uint8Array(mesh.triangleCount);
  for (const key of view.hiddenGroups) {
    const mask = groupTriangleMask(mesh, key);
    if (mask) for (let index = 0; index < mask.length; index++) hidden[index] |= mask[index];
  }
  const visible: number[] = [];
  for (let index = 0; index < mesh.triangleCount; index++) if (!hidden[index]) visible.push(index);
  return visible;
}

export function selectedTriangles(mesh: MeshPacket, key: string | null): Set<number> {
  const mask = groupTriangleMask(mesh, key);
  const result = new Set<number>();
  if (mask) for (let index = 0; index < mask.length; index++) if (mask[index]) result.add(index);
  return result;
}
