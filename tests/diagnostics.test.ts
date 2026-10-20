import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { requestBackend } from '../src/main/backend';
import {
  DiagnosticError,
  decodeDiagnostic,
  describeDiagnostic,
  diagnosticFromBackend,
  focusPath,
  pathAncestors,
  type Diagnostic,
} from '../src/shared/diagnostics';
import { developmentBackend } from '../src/main/runtime';

const backend = developmentBackend(process.cwd());

const conflict: Diagnostic = {
  version: 1,
  category: 'boundary_conflict',
  kind: null,
  code: 'ModelSchemaError',
  path: 'boundary.dirichlet[2]',
  related: ['boundary.dirichlet[0]'],
  reason: 'value 400.0 conflicts with 300.0 from boundary.dirichlet[0]',
  detail: 'invalid model boundary.dirichlet[2]: …',
  cellId: null,
};

describe('Diagnosevertrag', () => {
  it('übersteht die Electron-IPC-Grenze als Meldungstext', () => {
    const message = `Error invoking remote method 'desktop:validate': Error: ${new DiagnosticError(conflict).message}`;
    expect(decodeDiagnostic(message)).toEqual(conflict);
  });

  it('übernimmt Adapterdiagnosen nur mit bekannter Version und Kategorie', () => {
    const raw = {
      diagnostic_version: 1,
      category: 'material',
      kind: 'missing',
      code: 'ModelSchemaError',
      path: 'regions.T',
      related: [],
      reason: 'material assignment …',
      detail: 'invalid model regions.T',
      cell_id: '1152921504606846977',
    };
    expect(diagnosticFromBackend(raw)).toMatchObject({
      category: 'material',
      path: 'regions.T',
      cellId: '1152921504606846977',
    });
    expect(diagnosticFromBackend({ ...raw, diagnostic_version: 2 })).toBeNull();
    expect(diagnosticFromBackend({ ...raw, category: 'erfunden' })).toBeNull();
    expect(diagnosticFromBackend({ ...raw, cell_id: 7 })).toBeNull();
  });

  it('behält Prozessfehler und Abbruch als verständlichen Fallback', () => {
    expect(
      decodeDiagnostic(
        "Error invoking remote method 'desktop:solve': Error: Berechnung abgebrochen.",
      ),
    ).toMatchObject({ category: 'cancelled', detail: 'Berechnung abgebrochen.', path: null });
    const timeout = decodeDiagnostic('Der Vorgang dauert zu lange.');
    expect(timeout).toMatchObject({ category: 'process', detail: 'Der Vorgang dauert zu lange.' });
    expect(describeDiagnostic(timeout).title).toBe('Der Vorgang dauert zu lange.');
    const broken = decodeDiagnostic('FEMANTIS_DIAGNOSTIC_V1 {kaputt');
    expect(broken.category).toBe('process');
  });

  it('formuliert konkrete deutsche Hinweise je Kategorie', () => {
    const anchor = { ...conflict, category: 'reference', kind: 'missing_anchor', related: [] };
    expect(describeDiagnostic({ ...anchor, path: 'boundary.T' } as Diagnostic).title).toContain(
      'Temperaturreferenz',
    );
    expect(describeDiagnostic({ ...anchor, path: 'boundary.u' } as Diagnostic).title).toContain(
      'Lagerung',
    );
    expect(describeDiagnostic({ ...anchor, path: 'boundary.phi' } as Diagnostic).title).toContain(
      'Potentialreferenz',
    );
    expect(describeDiagnostic(conflict).hint).toContain('boundary.dirichlet[0]');
    const material = describeDiagnostic({
      ...conflict,
      category: 'material',
      kind: 'unknown_material',
      path: 'regions.T',
      related: ['regions.T.Basis'],
    });
    expect(material.title).toContain('Material');
    expect(material.hint).toContain('Basis');
    expect(describeDiagnostic({ ...conflict, category: 'file' }).title).toContain('Datei');
  });

  it('zerlegt Toolbox-Pfade vom genauesten zum allgemeinsten Ziel', () => {
    expect(pathAncestors('boundary.dirichlet[2].set')).toEqual([
      'boundary.dirichlet[2].set',
      'boundary.dirichlet[2]',
      'boundary.dirichlet',
      'boundary',
    ]);
    expect(pathAncestors('materials.T.Werkstoff 2.conductivity')).toEqual([
      'materials.T.Werkstoff 2.conductivity',
      'materials.T.Werkstoff 2',
      'materials.T',
      'materials',
    ]);
  });

  it('wählt das genaueste vorhandene Formularziel', () => {
    const available = new Set([
      'regions.T',
      'regions.T.Basis',
      'boundary',
      'boundary.dirichlet[0]',
    ]);
    expect(focusPath(['regions.T', 'regions.T.Basis'], available)).toBe('regions.T.Basis');
    expect(focusPath(['boundary.T'], available)).toBe('boundary');
    expect(focusPath(['boundary.dirichlet[0].unit', 'boundary.dirichlet[0]'], available)).toBe(
      'boundary.dirichlet[0]',
    );
    expect(focusPath(['document'], available)).toBeNull();
  });
});

describe('Echte Diagnose über den Python-Prozess', () => {
  it('liefert Toolbox-Kategorie und Datenpfad als DiagnosticError', async () => {
    const document = JSON.parse(
      await readFile('tests/fixtures/heat-unknown-set.json', 'utf8'),
    ) as Record<string, unknown>;
    const failure = await requestBackend(backend, 'validateModel', {
      path: path.resolve('examples/cantilever.msh'),
      document,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DiagnosticError);
    expect((failure as DiagnosticError).diagnostic).toMatchObject({
      category: 'reference',
      kind: 'unknown_set',
      path: 'boundary.dirichlet[1].set',
    });
    expect(decodeDiagnostic((failure as Error).message).path).toBe('boundary.dirichlet[1].set');
  });
});
