import { describe, expect, it } from 'vitest';
import { parseGeometryImport } from '../src/shared/geometry';

describe('STEP import specification', () => {
  it('accepts automatic and explicit element sizes in metres', () => {
    expect(parseGeometryImport({ maxSizeM: null })).toEqual({ maxSizeM: null });
    expect(parseGeometryImport({ maxSizeM: 0.005 })).toEqual({ maxSizeM: 0.005 });
  });
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, '5', undefined])(
    'rejects the size %s',
    (maxSizeM) => {
      expect(() => parseGeometryImport({ maxSizeM })).toThrow();
    },
  );
  it('rejects unknown fields', () => {
    expect(() => parseGeometryImport({ maxSizeM: 0.01, path: '/etc/passwd' })).toThrow();
  });
});
