import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { assertInside, parseProject, resolveMeshPath } from '../src/shared/project';
import { defaultView } from '../src/shared/types';

const document = {
  schemaVersion: 1,
  name: 'Wärmeprobe',
  mesh: { path: 'probe.files/netz.msh', sha256: 'a'.repeat(64), scale: 0.001 },
  view: defaultView(),
};

describe('Desktopprojektvertrag', () => {
  it('erhält Netzmaßstab und Ansicht beim Roundtrip', () => {
    const input = {
      ...document,
      view: {
        ...defaultView(),
        selectedGroup: 'volume:solid',
        camera: { position: [1, 2, 3], target: [0, 0, 0] },
      },
    };
    expect(parseProject(JSON.parse(JSON.stringify(input)))).toEqual(input);
  });
  it('lehnt unbekannte Versionen und ungültige Zahlen ab', () => {
    expect(() => parseProject({ ...document, schemaVersion: 99 })).toThrow();
    expect(() => parseProject({ ...document, mesh: { ...document.mesh, scale: 0 } })).toThrow();
    expect(() =>
      parseProject({
        ...document,
        view: { ...defaultView(), camera: { position: [NaN, 0, 0], target: [0, 0, 0] } },
      }),
    ).toThrow();
  });
  it('begrenzt Netzpfade auf das Projektverzeichnis', () => {
    expect(resolveMeshPath('/tmp/projekt', 'probe.files/netz.msh')).toBe(
      path.resolve('/tmp/projekt', 'probe.files/netz.msh'),
    );
    for (const relative of [
      '../fremd.msh',
      '/etc/passwd',
      'C:\\Windows\\file',
      '..\\outside.msh',
    ]) {
      expect(() => resolveMeshPath('/tmp/projekt', relative)).toThrow();
    }
  });
  it('prüft aufgelöste native Pfade auch mit Windows-Trennzeichen (#11)', () => {
    const win = path.win32;
    expect(assertInside('C:\\p', 'C:\\p\\probe.files\\netz.msh', win)).toBe(
      'C:\\p\\probe.files\\netz.msh',
    );
    for (const outside of ['C:\\p', 'C:\\andere\\netz.msh', 'D:\\p\\netz.msh', 'C:\\p\\..\\q'])
      expect(() => assertInside('C:\\p', outside, win)).toThrow('innerhalb');
    expect(assertInside('/tmp/p', '/tmp/p/a/b.msh', path.posix)).toBe('/tmp/p/a/b.msh');
    expect(() => assertInside('/tmp/p', '/tmp/pq/b.msh', path.posix)).toThrow('innerhalb');
  });
});
