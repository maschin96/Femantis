import { describe, expect, it } from 'vitest';
import { fieldLimits, gpuFieldValues, interpolationLabel } from '../src/renderer/viewer/fields';

describe('Double-Feldwerte vor der GPU-Übertragung', () => {
  it.each([
    [300, 300.000001],
    [-300.000001, -300],
    [1e-9, 1e-9 + 1e-17],
    [1e8, 1e8 + 1],
  ])('erhält Unterschiede zwischen %j und %j', (low, high) => {
    const raw = new Float64Array([low, high]);
    expect(gpuFieldValues(raw, [low, high])).toEqual(new Float32Array([0, 1]));
    expect([...raw]).toEqual([low, high]);
  });
  it.each([300, -300, 0])('stellt das konstante Feld %j in der Skalenmitte dar', (value) => {
    const values = new Float64Array([value, value]);
    for (const gpuValue of gpuFieldValues(values, fieldLimits(values)))
      expect(gpuValue).toBeCloseTo(0.5, 6);
  });
  it('interpoliert extrapolierte Werte vor der Farbbegrenzung und erhält die Maske', () => {
    const raw = new Float64Array([299.999999, 300, 300.000001, 300.000002, NaN]);
    const gpu = gpuFieldValues(raw, [300, 300.000001]);
    expect([...gpu.slice(0, 4)]).toEqual([-1, 0, 1, 2]);
    expect(Number.isNaN(gpu[4])).toBe(true);
  });
  it('normalisiert auch endliche Grenzen mit überlaufender Differenz', () => {
    expect(gpuFieldValues(new Float64Array([-1e308, 0, 1e308]), [-1e308, 1e308])).toEqual(
      new Float32Array([0, 0.5, 1]),
    );
  });
  it.each([
    [1, 1],
    [2, 1],
    [NaN, 1],
    [0, Infinity],
  ])('weist ungültige Grenzen %j zurück', (low, high) => {
    expect(() => gpuFieldValues(new Float64Array([0]), [low, high])).toThrow('Skala');
  });
  it('meldet eine im GPU-Format nicht darstellbare Skala statt unendlicher Anzeigewerte', () => {
    expect(() => gpuFieldValues(new Float64Array([1e308]), [0, 1])).toThrow('Grenzen vergrößern');
  });
});

describe('Kennzeichnung der Feldinterpolation', () => {
  const point = { association: 'point', components: ['x', 'y', 'z'] } as never;
  const cell = { association: 'cell', components: ['scalar'] } as never;
  it('unterscheidet Tet4, Tet10-Komponenten, Tet10-Betrag und Zellwerte', () => {
    expect(interpolationLabel('tetra4', point, 'x')).toBe(
      'Knotenwerte · lineare Darstellungsinterpolation',
    );
    expect(interpolationLabel('tetra10', point, 'x')).toBe(
      'Knotenwerte · quadratische Triangle6-Interpolation',
    );
    expect(interpolationLabel('tetra10', point, 'magnitude')).toBe(
      'Knotenwerte · Betrag aus Knotenbeträgen quadratisch interpoliert (Näherung)',
    );
    expect(interpolationLabel('tetra10', cell, 'scalar')).toBe('Elementwerte · ohne Glättung');
  });
});
