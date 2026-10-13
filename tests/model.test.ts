import { describe, expect, it } from 'vitest';
import { canonicalModel, newModel, parseModelDocument } from '../src/shared/model';
import { scalarValues, fieldLimits } from '../src/renderer/viewer/fields';
import type { MeshPacket, ResultField } from '../src/shared/types';

describe('Modellentwurf und Feldzuordnung', () => {
  it('erhält Tensorwerte, Einheiten und überlappende Regionsnamen', () => {
    const model = newModel({
      groups: [
        { name: 'a', kind: 'volume' },
        { name: 'b', kind: 'volume' },
      ],
    } as MeshPacket);
    model.materials.T.Werkstoff.conductivity = [
      [2, 0, 0],
      [0, 3, 0],
      [0, 0, 4],
    ];
    expect(parseModelDocument(JSON.parse(JSON.stringify(model)))).toEqual(model);
    expect(model.regions.T).toEqual({ a: 'Werkstoff', b: 'Werkstoff' });
  });
  it('vergleicht Modellrevisionen unabhängig von Tabellenreihenfolge', () => {
    expect(canonicalModel({ a: 1, b: { c: 2 } })).toBe(canonicalModel({ b: { c: 2 }, a: 1 }));
    expect(canonicalModel({ a: 2 })).not.toBe(canonicalModel({ a: 1 }));
  });
  it('wertet Komponenten und Vektorbetrag aus und maskiert Padding', () => {
    const field = {
      components: ['x', 'y', 'z'],
      rows: 2,
      values: new Float64Array([3, 4, 0, 0, 0, 0]),
      activeMask: new Uint32Array([1, 0]),
    } as ResultField;
    expect(scalarValues(field, 'magnitude')[0]).toBe(5);
    expect(scalarValues(field, 'x')[0]).toBe(3);
    expect(Number.isNaN(scalarValues(field, 'x')[1])).toBe(true);
    expect(() => scalarValues(field, 'xx')).toThrow();
    expect(fieldLimits(new Float64Array([NaN, 2, 8]))).toEqual([2, 8]);
  });
});
