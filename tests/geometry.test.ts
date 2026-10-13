import { describe, expect, it } from 'vitest';
import { defaultView, type MeshPacket } from '../src/shared/types';
import { visibleTriangles, selectedTriangles } from '../src/renderer/viewer/geometry';

const mesh = {
  triangleCount: 4,
  triangleOwners: new Uint32Array([0, 0, 1, 1]),
  triangleFacets: new Int32Array([0, -1, 1, -1]),
  groups: [
    { key: 'volume:all', name: 'all', kind: 'volume', members: new Uint32Array([0, 1]) },
    { key: 'volume:upper', name: 'upper', kind: 'volume', members: new Uint32Array([0]) },
    { key: 'facet:base', name: 'base', kind: 'facet', members: new Uint32Array([1]) },
  ],
} as MeshPacket;

describe('Fachliche Darstellungsfilter', () => {
  it('zeigt abgeleitete Außenflächen auch ohne Randdreieck', () => {
    expect(visibleTriangles(mesh, defaultView())).toEqual([0, 1, 2, 3]);
  });
  it('blendet Volumengruppen aus, auch bei überlappenden Mitgliedschaften', () => {
    expect(visibleTriangles(mesh, { ...defaultView(), hiddenGroups: ['volume:upper'] })).toEqual([
      2, 3,
    ]);
  });
  it('entfernt bei Flächengruppen nur zugehörige Randflächen', () => {
    expect(visibleTriangles(mesh, { ...defaultView(), hiddenGroups: ['facet:base'] })).toEqual([
      0, 1, 3,
    ]);
  });
  it('ordnet eine Flächenauswahl nicht versehentlich einem Elementindex zu', () => {
    expect([...selectedTriangles(mesh, 'facet:base')]).toEqual([2]);
    expect([...selectedTriangles(mesh, 'volume:upper')]).toEqual([0, 1]);
  });
});
