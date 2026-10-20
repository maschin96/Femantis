import * as THREE from 'three';
import type { MeshPacket, ViewState } from '../../shared/types';
import { groupTriangleMask } from './geometry';

/** Field values per node or cell; NaN marks inactive entries whose faces are not drawn. */
export interface DisplayField {
  association: 'point' | 'cell';
  values: Float64Array;
  gpu: Float32Array;
}
export interface DisplayInput {
  mesh: MeshPacket;
  view: ViewState;
  /** Display origin in model coordinates; subtracted in Double before Float32 rounding. */
  origin: [number, number, number];
  palette: Float32Array;
  field?: DisplayField | null;
  deformation?: Float64Array | null;
  factor?: number;
}
/** Non-indexed GPU buffers plus the mapping between display and mesh triangles. */
export interface Display {
  rendered: Uint32Array;
  /** Display row of each mesh triangle, -1 when hidden or masked. */
  displayIndex: Int32Array;
  coordinates: Float32Array;
  colors: Float32Array;
  femValues: Float32Array;
  edges: Float32Array;
  nodes: Float32Array;
}

const selectedColor = 0x2ecc71;
const defaultColor = 0x6798a2;
const groupColors = [0x548b95, 0x8abeb2, 0x729bbd, 0xb7c4a1];
const rgb = (hex: number) => new THREE.Color().setHex(hex).toArray();

/** Working-space RGB per cell: colour of the first volume group containing the cell. */
export function cellPalette(mesh: MeshPacket): Float32Array {
  const palette = new Float32Array(mesh.cellCount * 3);
  const fallback = rgb(defaultColor);
  for (let cell = 0; cell < mesh.cellCount; cell++) palette.set(fallback, cell * 3);
  const assigned = new Uint8Array(mesh.cellCount);
  mesh.groups
    .filter((group) => group.kind === 'volume')
    .forEach((group, index) => {
      const color = rgb(groupColors[index % groupColors.length]);
      for (const cell of group.members)
        if (cell < mesh.cellCount && !assigned[cell]) {
          assigned[cell] = 1;
          palette.set(color, cell * 3);
        }
    });
  return palette;
}

export function buildDisplay(input: DisplayInput): Display {
  const { mesh, view, origin, palette, field } = input;
  const triangles = mesh.triangles;
  const owners = mesh.triangleOwners;
  const pointCount = mesh.positions.length / 3;
  // Numeric edge keys a·n+b are exact while n² < 2^53; the 256 MB import limit keeps
  // real meshes far below 94 million nodes, but never risk silent collisions.
  if (pointCount > 94_000_000) throw new Error('Zu viele Knoten für die Kantendarstellung.');
  const hidden = new Uint8Array(mesh.triangleCount);
  for (const key of view.hiddenGroups) {
    const mask = groupTriangleMask(mesh, key);
    if (mask) for (let t = 0; t < mask.length; t++) hidden[t] |= mask[t];
  }
  const selected = groupTriangleMask(mesh, view.selectedGroup);

  const displayIndex = new Int32Array(mesh.triangleCount).fill(-1);
  const order = new Uint32Array(mesh.triangleCount);
  let count = 0;
  for (let t = 0; t < mesh.triangleCount; t++) {
    if (hidden[t]) continue;
    if (field) {
      const values = field.values;
      if (field.association === 'cell') {
        if (!Number.isFinite(values[owners[t]])) continue;
      } else if (
        !Number.isFinite(values[triangles[t * 3]]) ||
        !Number.isFinite(values[triangles[t * 3 + 1]]) ||
        !Number.isFinite(values[triangles[t * 3 + 2]])
      )
        continue;
    }
    displayIndex[t] = count;
    order[count++] = t;
  }
  const rendered = order.slice(0, count);

  // Display positions per node: centred (and deformed) in Double, rounded once.
  const positions = new Float32Array(pointCount * 3);
  const deformation = input.deformation;
  const factor = input.factor ?? 0;
  for (let node = 0; node < pointCount; node++)
    for (let axis = 0; axis < 3; axis++) {
      const index = node * 3 + axis;
      positions[index] =
        mesh.positions[index] - origin[axis] + (deformation?.[index] || 0) * factor;
    }

  const coordinates = new Float32Array(count * 9);
  const colors = new Float32Array(count * 9);
  const femValues = new Float32Array(count * 3);
  const edges = new Float32Array(count * 18);
  const nodes = new Float32Array(Math.min(count * 3, pointCount) * 3);
  const seenNode = new Uint8Array(pointCount);
  const seenEdge = new Set<number>();
  const highlight = rgb(selectedColor);
  let edgeOffset = 0;
  let nodeOffset = 0;
  for (let row = 0; row < count; row++) {
    const t = rendered[row];
    const owner = owners[t];
    for (let local = 0; local < 3; local++) {
      const node = triangles[t * 3 + local];
      const target = row * 9 + local * 3;
      coordinates.set(positions.subarray(node * 3, node * 3 + 3), target);
      if (selected?.[t]) colors.set(highlight, target);
      else colors.set(palette.subarray(owner * 3, owner * 3 + 3), target);
      if (field)
        femValues[row * 3 + local] = field.gpu[field.association === 'cell' ? owner : node];
      if (!seenNode[node]) {
        seenNode[node] = 1;
        nodes.set(positions.subarray(node * 3, node * 3 + 3), nodeOffset);
        nodeOffset += 3;
      }
      const next = triangles[t * 3 + ((local + 1) % 3)];
      const key = node < next ? node * pointCount + next : next * pointCount + node;
      if (!seenEdge.has(key)) {
        seenEdge.add(key);
        edges.set(positions.subarray(node * 3, node * 3 + 3), edgeOffset);
        edges.set(positions.subarray(next * 3, next * 3 + 3), edgeOffset + 3);
        edgeOffset += 6;
      }
    }
  }
  return {
    rendered,
    displayIndex,
    coordinates,
    colors,
    femValues,
    edges: edges.slice(0, edgeOffset),
    nodes: nodes.slice(0, nodeOffset),
  };
}
