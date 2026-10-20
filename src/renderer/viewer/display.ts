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
  /** Display rows per mesh triangle: 4 when a Tet10 face is refined for deformation, else 1. */
  rowsPerTriangle: number;
  /**
   * Tet10 nodal fields only: per vertex the face-local area coordinates and, constant over
   * each row, the GPU values of the face corners and midside nodes. The fragment shader
   * evaluates the Triangle6 shape functions with them (#9).
   */
  quadratic?: { lambda: Float32Array; corners: Float32Array; midsides: Float32Array };
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

/** Area coordinates of the six Triangle6 nodes: corners, then edges 01, 12, 20. */
const faceLambda = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [0.5, 0.5, 0],
  [0, 0.5, 0.5],
  [0.5, 0, 0.5],
];
/** Triangle6 shape functions at area coordinates λ. */
function shape(l: ArrayLike<number>): number[] {
  return [
    l[0] * (2 * l[0] - 1),
    l[1] * (2 * l[1] - 1),
    l[2] * (2 * l[2] - 1),
    4 * l[0] * l[1],
    4 * l[1] * l[2],
    4 * l[2] * l[0],
  ];
}

export function buildDisplay(input: DisplayInput): Display {
  const { mesh, view, origin, palette, field } = input;
  const triangles = mesh.triangles;
  const owners = mesh.triangleOwners;
  const faceNodes = mesh.triangleFaceNodes;
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
  const deformation = input.deformation;
  const factor = input.factor ?? 0;
  const quadratic = field?.association === 'point' && faceNodes ? field : null;
  // A quadratic displacement curves the flat Tet10 face; sample it at finer points.
  const refine = !!faceNodes && !!deformation && factor !== 0;
  const rowsPerTriangle = refine ? 4 : 1;

  const displayIndex = new Int32Array(mesh.triangleCount).fill(-1);
  const order = new Uint32Array(mesh.triangleCount);
  let count = 0;
  for (let t = 0; t < mesh.triangleCount; t++) {
    if (hidden[t]) continue;
    if (field) {
      const values = field.values;
      if (field.association === 'cell') {
        if (!Number.isFinite(values[owners[t]])) continue;
      } else if (faceNodes) {
        // The quadratic field of a face needs all six nodes; partial faces are not drawn.
        let active = true;
        for (let k = 0; k < 6; k++) active &&= Number.isFinite(values[faceNodes[t * 6 + k]]);
        if (!active) continue;
      } else if (
        !Number.isFinite(values[triangles[t * 3]]) ||
        !Number.isFinite(values[triangles[t * 3 + 1]]) ||
        !Number.isFinite(values[triangles[t * 3 + 2]])
      )
        continue;
    }
    displayIndex[t] = count * rowsPerTriangle;
    order[count++] = t;
  }
  const parents = order.slice(0, count);

  // Display positions per node: centred (and deformed) in Double, rounded once.
  const positions = new Float32Array(pointCount * 3);
  for (let node = 0; node < pointCount; node++)
    for (let axis = 0; axis < 3; axis++) {
      const index = node * 3 + axis;
      positions[index] =
        mesh.positions[index] - origin[axis] + (deformation?.[index] || 0) * factor;
    }
  /** Isoparametric Triangle6 position at λ; equals the node position at every node. */
  const facePosition = (t: number, lambda: number[], target: Float32Array, offset: number) => {
    const n = shape(lambda);
    for (let axis = 0; axis < 3; axis++) {
      let value = -origin[axis];
      for (let k = 0; k < 6; k++) {
        const index = faceNodes![t * 6 + k] * 3 + axis;
        value += n[k] * (mesh.positions[index] + (deformation?.[index] || 0) * factor);
      }
      target[offset + axis] = value;
    }
  };
  const localLambda = (t: number, node: number) => {
    for (let k = 0; k < 6; k++) if (faceNodes![t * 6 + k] === node) return faceLambda[k];
    throw new Error('Unvollständiger Tet10-Flächenvertrag.');
  };

  const rows = count * rowsPerTriangle;
  const rendered = new Uint32Array(rows);
  const coordinates = new Float32Array(rows * 9);
  const colors = new Float32Array(rows * 9);
  const femValues = new Float32Array(rows * 3);
  const lambdas = quadratic ? new Float32Array(rows * 9) : null;
  const corners = quadratic ? new Float32Array(rows * 9) : null;
  const midsides = quadratic ? new Float32Array(rows * 9) : null;
  const edges = new Float32Array(count * 18 * (refine ? 2 : 1));
  const nodes = new Float32Array(Math.min(count * 3, pointCount) * 3);
  const seenNode = new Uint8Array(pointCount);
  const seenEdge = new Set<number>();
  const highlight = rgb(selectedColor);
  let edgeOffset = 0;
  let nodeOffset = 0;
  let row = 0;
  for (let index = 0; index < count; index++) {
    const t = parents[index];
    const owner = owners[t];
    const color = selected?.[t] ? highlight : palette.subarray(owner * 3, owner * 3 + 3);
    const vertexNodes = [triangles[t * 3], triangles[t * 3 + 1], triangles[t * 3 + 2]];
    const vertexLambda = faceNodes ? vertexNodes.map((node) => localLambda(t, node)) : null;
    // Micro triangles in area coordinates of the display triangle (identity when unrefined).
    const micro = refine
      ? [
          [
            [1, 0, 0],
            [0.5, 0.5, 0],
            [0.5, 0, 0.5],
          ],
          [
            [0.5, 0.5, 0],
            [0, 1, 0],
            [0, 0.5, 0.5],
          ],
          [
            [0.5, 0, 0.5],
            [0, 0.5, 0.5],
            [0, 0, 1],
          ],
          [
            [0.5, 0.5, 0],
            [0, 0.5, 0.5],
            [0.5, 0, 0.5],
          ],
        ]
      : [
          [
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
          ],
        ];
    for (const weights of micro) {
      rendered[row] = t;
      for (let local = 0; local < 3; local++) {
        const target = row * 9 + local * 3;
        const w = weights[local];
        const vertex = w.indexOf(1);
        const lambda = vertexLambda
          ? [0, 1, 2].map((axis) =>
              w.reduce((sum, weight, v) => sum + weight * vertexLambda[v][axis], 0),
            )
          : null;
        if (vertex >= 0 && !refine) {
          const node = vertexNodes[vertex];
          coordinates.set(positions.subarray(node * 3, node * 3 + 3), target);
        } else facePosition(t, lambda!, coordinates, target);
        colors.set(color, target);
        if (quadratic) {
          const face = faceNodes!.subarray(t * 6, t * 6 + 6);
          lambdas!.set(lambda!, target);
          for (let k = 0; k < 3; k++) {
            corners![target + k] = quadratic.gpu[face[k]];
            midsides![target + k] = quadratic.gpu[face[k + 3]];
          }
          femValues[row * 3 + local] = shape(lambda!).reduce(
            (sum, n, k) => sum + n * quadratic.gpu[face[k]],
            0,
          );
        } else if (field)
          femValues[row * 3 + local] =
            field.gpu[field.association === 'cell' ? owner : vertexNodes[Math.max(vertex, 0)]];
      }
      row++;
    }
    for (let local = 0; local < 3; local++) {
      const node = vertexNodes[local];
      if (!seenNode[node]) {
        seenNode[node] = 1;
        nodes.set(positions.subarray(node * 3, node * 3 + 3), nodeOffset);
        nodeOffset += 3;
      }
      const next = vertexNodes[(local + 1) % 3];
      const key = node < next ? node * pointCount + next : next * pointCount + node;
      if (seenEdge.has(key)) continue;
      seenEdge.add(key);
      if (refine) {
        // Two segments through the exactly displaced edge midpoint.
        const a = vertexLambda![local];
        const b = vertexLambda![(local + 1) % 3];
        const middle = new Float32Array(3);
        facePosition(
          t,
          [0, 1, 2].map((axis) => (a[axis] + b[axis]) / 2),
          middle,
          0,
        );
        edges.set(positions.subarray(node * 3, node * 3 + 3), edgeOffset);
        edges.set(middle, edgeOffset + 3);
        edges.set(middle, edgeOffset + 6);
        edges.set(positions.subarray(next * 3, next * 3 + 3), edgeOffset + 9);
        edgeOffset += 12;
      } else {
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
    rowsPerTriangle,
    ...(quadratic
      ? { quadratic: { lambda: lambdas!, corners: corners!, midsides: midsides! } }
      : {}),
  };
}
