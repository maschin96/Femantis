import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { defaultView, type MeshPacket } from '../src/shared/types';
import { buildDisplay, cellPalette } from '../src/renderer/viewer/display';

/**
 * Unit cube surface: 8 corner nodes, 12 triangles, two per face. Cells 0..5 own the
 * faces in order x-, x+, y-, y+, z-, z+; facet rows exist for x- only.
 */
const corners = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];
const faces = [
  [0, 3, 7, 4],
  [1, 2, 6, 5],
  [0, 1, 5, 4],
  [3, 2, 6, 7],
  [0, 1, 2, 3],
  [4, 5, 6, 7],
];
const cube = {
  pointCount: 8,
  cellCount: 6,
  triangleCount: 12,
  positions: new Float64Array(corners.flat().map((value) => value + 1e6)),
  triangles: new Uint32Array(faces.flatMap(([a, b, c, d]) => [a, b, c, a, c, d])),
  triangleOwners: new Uint32Array(faces.flatMap((_, cell) => [cell, cell])),
  triangleFacets: new Int32Array([0, 1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1]),
  groups: [
    { key: 'volume:all', name: 'all', kind: 'volume', members: Uint32Array.of(0, 1, 2, 3, 4, 5) },
    { key: 'volume:top', name: 'top', kind: 'volume', members: Uint32Array.of(5) },
    { key: 'facet:left', name: 'left', kind: 'facet', members: Uint32Array.of(0, 1) },
  ],
} as unknown as MeshPacket;
const origin: [number, number, number] = [1e6 + 0.5, 1e6 + 0.5, 1e6 + 0.5];
const input = (patch: Partial<Parameters<typeof buildDisplay>[0]> = {}) => ({
  mesh: cube,
  view: defaultView(),
  origin,
  palette: cellPalette(cube),
  ...patch,
});

describe('Anzeigegeometrie', () => {
  it('erzeugt geschlossene Außenhaut mit eindeutigen Kanten und Knoten', () => {
    const display = buildDisplay(input());
    expect(display.rendered).toEqual(Uint32Array.from({ length: 12 }, (_, i) => i));
    expect(display.coordinates.length).toBe(12 * 9);
    // Closed triangulated surface: E = 3F/2 (12 cube edges + 6 face diagonals).
    expect(display.edges.length / 6).toBe(18);
    expect(display.nodes.length / 3).toBe(8);
    const nodes = Array.from({ length: 8 }, (_, i) => [...display.nodes.slice(i * 3, i * 3 + 3)]);
    expect(nodes.map((node) => node.map(Math.abs))).toEqual(
      Array.from({ length: 8 }, () => [0.5, 0.5, 0.5]),
    );
  });

  it('zentriert in Double vor der Float32-Rundung', () => {
    const display = buildDisplay(input());
    const [a, b, c] = cube.triangles;
    expect([...display.coordinates.slice(0, 9)]).toEqual(
      [a, b, c].flatMap((node) => corners[node].map((value) => value - 0.5)),
    );
  });

  it('blendet Gruppen aus und bildet Anzeige- auf Originaldreiecke ab', () => {
    const hidden = buildDisplay(
      input({ view: { ...defaultView(), hiddenGroups: ['volume:top'] } }),
    );
    expect([...hidden.rendered]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(hidden.displayIndex[10]).toBe(-1);
    expect(hidden.displayIndex[9]).toBe(9);
    const facet = buildDisplay(input({ view: { ...defaultView(), hiddenGroups: ['facet:left'] } }));
    expect([...facet.rendered]).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(facet.displayIndex[2]).toBe(0);
  });

  it('färbt die ausgewählte Gruppe und sonst nach Volumengruppe', () => {
    const display = buildDisplay(
      input({ view: { ...defaultView(), selectedGroup: 'facet:left' } }),
    );
    const rgb = (triangle: number) => [...display.colors.slice(triangle * 9, triangle * 9 + 3)];
    // Three.js color management converts the sRGB hex to linear working space.
    const green = new THREE.Color().setHex(0x2ecc71).toArray();
    rgb(0).forEach((value, index) => expect(value).toBeCloseTo(green[index], 6));
    expect(rgb(2)).not.toEqual(rgb(0));
    // The first volume group wins for overlapping membership.
    expect(rgb(10)).toEqual(rgb(2));
  });

  it('überträgt Knoten- und Zellwerte und entfernt maskierte Flächen', () => {
    const nodal = new Float64Array([0, 1, 2, 3, 4, 5, 6, NaN]);
    const gpu = new Float32Array([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, NaN]);
    const display = buildDisplay(input({ field: { association: 'point', values: nodal, gpu } }));
    // Node 7 is inactive: x- (0,1), y+ (6,7) and z+ (10,11) lose triangles touching it.
    const touches7 = [...cube.triangles].reduce<number[]>(
      (list, node, index) => (node === 7 ? [...list, Math.floor(index / 3)] : list),
      [],
    );
    expect([...display.rendered]).toEqual(
      Array.from({ length: 12 }, (_, i) => i).filter((i) => !touches7.includes(i)),
    );
    const first = display.rendered[0];
    expect([...display.femValues.slice(0, 3)]).toEqual(
      [...cube.triangles.slice(first * 3, first * 3 + 3)].map((node) => gpu[node]),
    );
    const cells = new Float64Array([1, 2, 3, 4, 5, NaN]);
    const cellGpu = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, NaN]);
    const cellDisplay = buildDisplay(
      input({ field: { association: 'cell', values: cells, gpu: cellGpu } }),
    );
    expect(cellDisplay.rendered.length).toBe(10);
    expect([...cellDisplay.femValues.slice(0, 3)]).toEqual([0.1, 0.1, 0.1].map(Math.fround));
  });

  it('verschiebt nur die Anzeige um Faktor mal Verschiebung', () => {
    const deformation = new Float64Array(24).fill(0.25);
    const display = buildDisplay(input({ deformation, factor: 2 }));
    const plain = buildDisplay(input());
    display.coordinates.forEach((value, index) =>
      expect(value).toBeCloseTo(plain.coordinates[index] + 0.5, 6),
    );
    expect(cube.positions[0]).toBe(1e6);
  });
});

/**
 * One straight-edged Triangle6 face in the X/Z plane, split into the adapter's four
 * display triangles (n0,n3,n5), (n3,n1,n4), (n5,n4,n2), (n3,n4,n5).
 */
const faceXZ = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [0, -1],
  [0, 0],
  [-1, 0],
];
const tet10Face = {
  cellType: 'tetra10',
  pointCount: 6,
  cellCount: 1,
  triangleCount: 4,
  positions: new Float64Array(faceXZ.flatMap(([x, z]) => [x, 0, z])),
  triangles: new Uint32Array([0, 3, 5, 3, 1, 4, 5, 4, 2, 3, 4, 5]),
  triangleOwners: new Uint32Array([0, 0, 0, 0]),
  triangleFacets: new Int32Array([-1, -1, -1, -1]),
  triangleFaceNodes: new Uint32Array(Array.from({ length: 4 }, () => [0, 1, 2, 3, 4, 5]).flat()),
  groups: [],
} as unknown as MeshPacket;
const faceInput = (patch: Partial<Parameters<typeof buildDisplay>[0]> = {}) => ({
  mesh: tet10Face,
  view: defaultView(),
  origin: [0, 0, 0] as [number, number, number],
  palette: cellPalette(tet10Face),
  ...patch,
});
/** Independent Triangle6 shape functions in area coordinates (corners, then edges 01, 12, 20). */
const shape = ([a, b, c]: number[]) => [
  a * (2 * a - 1),
  b * (2 * b - 1),
  c * (2 * c - 1),
  4 * a * b,
  4 * b * c,
  4 * c * a,
];
/** Display position and field value at local weights w of a display row. */
function quadraticAt(display: ReturnType<typeof buildDisplay>, row: number, w: number[]) {
  const q = display.quadratic!;
  const lambda = [0, 1, 2].map((axis) =>
    w.reduce((sum, weight, vertex) => sum + weight * q.lambda[row * 9 + vertex * 3 + axis], 0),
  );
  const nodal = [
    ...q.corners.slice(row * 9, row * 9 + 3),
    ...q.midsides.slice(row * 9, row * 9 + 3),
  ];
  const value = shape(lambda).reduce((sum, n, k) => sum + n * nodal[k], 0);
  const point = [0, 2].map((axis) =>
    w.reduce(
      (sum, weight, vertex) => sum + weight * display.coordinates[row * 9 + vertex * 3 + axis],
      0,
    ),
  );
  return { value, point };
}
const weights = [
  [1 / 3, 1 / 3, 1 / 3],
  [0.6, 0.3, 0.1],
  [0.05, 0.15, 0.8],
];

describe('Quadratische Tet10-Felddarstellung', () => {
  const fields: [string, (x: number, z: number) => number][] = [
    ['linear', (x, z) => 2 + 3 * x - 0.5 * z],
    ['quadratisch', (x, z) => 1 + x - 2 * z + 0.7 * x * x - 1.3 * x * z + 0.4 * z * z],
  ];
  it.each(fields)('reproduziert ein %ses Referenzfeld exakt', (_, f) => {
    const values = new Float64Array(faceXZ.map(([x, z]) => f(x, z)));
    const display = buildDisplay(
      faceInput({ field: { association: 'point', values, gpu: new Float32Array(values) } }),
    );
    expect(display.rendered.length).toBe(4);
    for (let row = 0; row < 4; row++)
      for (const w of weights) {
        const { value, point } = quadraticAt(display, row, w);
        expect(value).toBeCloseTo(f(point[0], point[1]), 5);
      }
  });

  it('weicht von der bisherigen linearen Teilflächeninterpolation ab', () => {
    // Corners 0, midsides 1: exact value 4/3 at the face centroid, linear sub-triangle 1.
    const values = new Float64Array([0, 0, 0, 1, 1, 1]);
    const display = buildDisplay(
      faceInput({ field: { association: 'point', values, gpu: new Float32Array(values) } }),
    );
    const centre = display.rendered.indexOf(3);
    const linear = [0, 1, 2].reduce((sum, v) => sum + display.femValues[centre * 3 + v] / 3, 0);
    expect(linear).toBeCloseTo(1, 6);
    expect(quadraticAt(display, centre, [1 / 3, 1 / 3, 1 / 3]).value).toBeCloseTo(4 / 3, 6);
  });

  it('entfernt die ganze Fläche bei einem inaktiven Knoten', () => {
    const values = new Float64Array([1, 2, 3, NaN, 5, 6]);
    const display = buildDisplay(
      faceInput({ field: { association: 'point', values, gpu: new Float32Array(values) } }),
    );
    // Sub-triangles (n5,n4,n2) do not touch n3, yet the face's quadratic field needs all six.
    expect(display.rendered.length).toBe(0);
  });

  it('lässt Zellwerte und Tet4 ohne quadratische Attribute', () => {
    const cell = buildDisplay(
      faceInput({
        field: { association: 'cell', values: new Float64Array([4]), gpu: new Float32Array([0.5]) },
      }),
    );
    expect(cell.quadratic).toBeUndefined();
    expect([...cell.femValues]).toEqual(Array(12).fill(0.5));
    const values = new Float64Array(8).fill(1);
    expect(
      buildDisplay(
        input({ field: { association: 'point', values, gpu: new Float32Array(values) } }),
      ).quadratic,
    ).toBeUndefined();
  });

  it('verfeinert die Verformungsanzeige und trifft die quadratische Verschiebung exakt', () => {
    // u_y(x, z) = 0.1 x z + 0.2 z² (out of plane); nodal values sampled from it.
    const uy = (x: number, z: number) => 0.1 * x * z + 0.2 * z * z;
    const deformation = new Float64Array(faceXZ.flatMap(([x, z]) => [0, uy(x, z), 0]));
    const display = buildDisplay(faceInput({ deformation, factor: 3 }));
    expect(display.rendered.length).toBe(16);
    expect(display.rowsPerTriangle).toBe(4);
    expect([...display.displayIndex]).toEqual([0, 4, 8, 12]);
    expect([...new Set(display.rendered)]).toEqual([0, 1, 2, 3]);
    for (let vertex = 0; vertex < display.coordinates.length / 3; vertex++) {
      const [x, y, z] = display.coordinates.slice(vertex * 3, vertex * 3 + 3);
      expect(y).toBeCloseTo(3 * uy(x, z), 6);
    }
    // Without deformation the flat face keeps its four display triangles.
    expect(buildDisplay(faceInput()).rendered.length).toBe(4);
  });
});
