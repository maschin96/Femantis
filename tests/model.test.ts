import { describe, expect, it } from 'vitest';
import { canonicalModel, newModel, parseModelDocument } from '../src/shared/model';
import { scalarValues, fieldLimits } from '../src/renderer/viewer/fields';
import type { MeshPacket, ResultField } from '../src/shared/types';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModelEditor } from '../src/renderer/ModelEditor';

const mesh = { groups: [{ name: 'a', kind: 'volume' }] } as MeshPacket;

describe('Strukturprüfung an den Editorgrenzen', () => {
  it.each(
    [null, undefined, 1, 'Last', [], [1, 2], [1, 2, 3, 4], [1, null, 3]].map((value) => ({
      value,
    })),
  )('weist ungültige Flächenlast $value mit Datenpfad ab', ({ value }) => {
    const model = newModel(mesh, 'elasticity');
    model.boundary = { traction: [{ set: 'Stirnflaeche', value: value as never }] };
    if (value === undefined) delete model.boundary.traction[0].value;
    expect(() => parseModelDocument(model)).toThrow('boundary.traction[0].value');
  });
  it.each(['materials', 'regions'] as const)('meldet fehlende aktive Tabelle %s', (table) => {
    const model = newModel(mesh, 'elasticity');
    delete model[table].u;
    expect(() => parseModelDocument(model)).toThrow(`${table}.u`);
  });
  it.each([
    ['body_force', null],
    ['body_force', [1, 2]],
    ['source', null],
    ['volume_charge', []],
  ])('meldet ungültige Volumenlast %s', (kind, value) => {
    const model = newModel(mesh, kind === 'body_force' ? 'elasticity' : 'heat');
    model.loads = { [kind as string]: { value: value as never } };
    expect(() => parseModelDocument(model)).toThrow(`loads.${kind}.value`);
  });
  it('erhält Vektor-Dirichlet, Tensoren, Knotenlisten und erweiterte Tabellen', () => {
    const model = newModel(mesh, 'elasticity');
    model.boundary = {
      dirichlet: [{ field: 'u', nodes: [0, 1], components: ['x', 'z'], value: [1, 2], unit: 'm' }],
    };
    model.materials.u.Werkstoff = {
      stiffness: Array.from({ length: 6 }, () => [1, 0, 0, 0, 0, 0]),
      unit: 'Pa',
    };
    model.solver = { method: 'direct' };
    expect(parseModelDocument(model)).toEqual(model);
    expect(() => renderEditor(model)).not.toThrow();
    model.boundary.dirichlet[0].value = [1, 2, 3, 4];
    expect(parseModelDocument(model)).toEqual(model);
  });
  it('hält einen fehlerhaften vorhandenen Entwurf im JSON-Editor korrigierbar', () => {
    const model = newModel(mesh, 'elasticity');
    model.boundary = { traction: [{ value: null }] };
    const html = renderEditor(model);
    expect(html).toContain('boundary.traction[0].value');
    expect(html).toContain('Vollständiger Model-Datensatz');
    expect(html).toContain('role="alert"');
  });
});

function renderEditor(document: ReturnType<typeof newModel>) {
  const noop = () => {};
  return renderToStaticMarkup(
    createElement(ModelEditor, {
      mesh,
      document,
      busy: false,
      onChange: noop,
      onPendingChange: noop,
    }),
  );
}

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
