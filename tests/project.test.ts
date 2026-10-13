import { describe, expect, it } from 'vitest';
import { parseProject, resolveMeshPath } from '../src/shared/project';
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
      '/tmp/projekt/probe.files/netz.msh',
    );
    for (const path of ['../fremd.msh', '/etc/passwd', 'C:\\Windows\\file', '..\\outside.msh']) {
      expect(() => resolveMeshPath('/tmp/projekt', path)).toThrow();
    }
  });
});
