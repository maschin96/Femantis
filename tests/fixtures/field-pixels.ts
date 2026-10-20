import { Viewport } from '../../src/renderer/viewer/Viewport';
import { defaultView, type MeshPacket, type ResultField } from '../../src/shared/types';

// Two triangles in the X/Z plane; a known camera makes pixel sampling independent
// of the viewer's picking and coordinate helpers.
const mesh: MeshPacket = {
  bufferSchemaVersion: 1,
  name: 'Pixelreferenz',
  cellType: 'tetra4',
  pointCount: 4,
  cellCount: 2,
  facetCount: 2,
  boundaryFaceCount: 2,
  triangleCount: 2,
  positions: new Float64Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1]),
  triangles: new Uint32Array([0, 1, 2, 0, 2, 3]),
  triangleOwners: new Uint32Array([0, 1]),
  triangleFacets: new Int32Array([0, 1]),
  activeNodes: new Uint32Array([0, 1, 2, 3]),
  cellIds: ['0', '1'],
  facetIds: ['0', '1'],
  pointIds: ['0', '1', '2', '3'],
  externalIds: { cells: false, facets: false, points: false },
  groups: [],
};
const host = document.createElement('div');
host.style.cssText = 'width:640px;height:640px';
document.body.style.margin = '0';
document.body.append(host);
const viewport = new Viewport(
  host,
  mesh,
  {
    ...defaultView(),
    mode: 'part',
    showAxes: false,
    camera: { position: [0, -4, 0], target: [0, 0, 0] },
  },
  () => {},
  () => {},
);

Object.assign(window, {
  sampleField(spec: {
    values: number[];
    association?: 'point' | 'cell';
    limits?: [number, number];
    mask?: number[];
    samples: [number, number][];
  }) {
    const field: ResultField = {
      id: 'reference',
      unit: 'K',
      components: ['scalar'],
      atCentroid: false,
      association: spec.association || 'point',
      rows: spec.association === 'cell' ? 2 : 4,
      values: new Float64Array(spec.values),
      activeMask: spec.mask ? new Uint32Array(spec.mask) : undefined,
    };
    viewport.setField(field, 'scalar', spec.limits || null, null, 0);
    const canvas = host.querySelector('canvas')!;
    const gl = canvas.getContext('webgl2')!;
    const halfWidth = 4 * Math.tan((19 * Math.PI) / 180);
    const pixels = spec.samples.map(([x, z]) => {
      const pixel = new Uint8Array(4);
      gl.readPixels(
        Math.floor(((1 + x / halfWidth) * canvas.width) / 2),
        Math.floor(((1 + z / halfWidth) * canvas.height) / 2),
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixel,
      );
      return [...pixel];
    });
    return { pixels, raw: [...field.values], error: gl.getError() };
  },
});

// One straight-edged Triangle6 face (#9): corners (-1,-1), (1,-1), (-1,1) in X/Z, split
// into the adapter's four display triangles; created lazily above the first viewport.
let quadratic: { host: HTMLElement; viewport: Viewport } | null = null;
const face: MeshPacket = {
  ...mesh,
  name: 'Triangle6-Referenz',
  cellType: 'tetra10',
  pointCount: 6,
  cellCount: 1,
  facetCount: 0,
  boundaryFaceCount: 1,
  triangleCount: 4,
  positions: new Float64Array([-1, 0, -1, 1, 0, -1, -1, 0, 1, 0, 0, -1, 0, 0, 0, -1, 0, 0]),
  triangles: new Uint32Array([0, 3, 5, 3, 1, 4, 5, 4, 2, 3, 4, 5]),
  triangleOwners: new Uint32Array([0, 0, 0, 0]),
  triangleFacets: new Int32Array([-1, -1, -1, -1]),
  triangleFaceNodes: new Uint32Array([
    0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5,
  ]),
  activeNodes: new Uint32Array([0, 1, 2, 3, 4, 5]),
  cellIds: ['0'],
  facetIds: [],
  pointIds: ['0', '1', '2', '3', '4', '5'],
};
Object.assign(window, {
  sampleQuadratic(spec: {
    values: number[];
    limits: [number, number];
    samples: [number, number][];
  }) {
    if (!quadratic) {
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:0;top:0;width:640px;height:640px';
      document.body.append(host);
      quadratic = {
        host,
        viewport: new Viewport(
          host,
          face,
          {
            ...defaultView(),
            mode: 'part',
            showAxes: false,
            camera: { position: [0, -4, 0], target: [0, 0, 0] },
          },
          () => {},
          () => {},
        ),
      };
    }
    const field: ResultField = {
      id: 'reference',
      unit: 'K',
      components: ['scalar'],
      atCentroid: false,
      association: 'point',
      rows: 6,
      values: new Float64Array(spec.values),
    };
    quadratic.viewport.setField(field, 'scalar', spec.limits, null, 0);
    const canvas = quadratic.host.querySelector('canvas')!;
    const gl = canvas.getContext('webgl2')!;
    const halfWidth = 4 * Math.tan((19 * Math.PI) / 180);
    const pixels = spec.samples.map(([x, z]) => {
      const pixel = new Uint8Array(4);
      gl.readPixels(
        Math.floor(((1 + x / halfWidth) * canvas.width) / 2),
        Math.floor(((1 + z / halfWidth) * canvas.height) / 2),
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixel,
      );
      return [...pixel];
    });
    return { pixels, error: gl.getError() };
  },
});
