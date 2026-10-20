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
