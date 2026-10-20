import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openProjectFile, saveProjectFile } from '../src/main/project-store';
import { defaultView } from '../src/shared/types';
const temporary: string[] = [];
async function folder() {
  const value = await mkdtemp(path.join(tmpdir(), 'femantis-store-test-'));
  temporary.push(value);
  return value;
}
afterEach(async () => {
  for (const directory of temporary.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe('Portable Projektspeicherung', () => {
  it('speichert eine echte Netzdatei und prüft deren Hash beim Öffnen', async () => {
    const root = await folder();
    const target = path.join(root, 'probe.femantis.json');
    const bytes = await readFile('examples/cantilever.msh');
    const view = {
      ...defaultView(),
      selectedGroup: 'volume:Basis',
      hiddenGroups: ['facet:Mantel'],
    };
    await saveProjectFile(target, { name: 'cantilever.msh', bytes, scale: 0.001 }, view);
    const result = await openProjectFile(target);
    expect(result.source.bytes).toEqual(bytes);
    expect(result.source.scale).toBe(0.001);
    expect(result.view).toEqual(view);
    const document = JSON.parse(await readFile(target, 'utf8'));
    await writeFile(path.join(root, document.mesh.path), 'kaputt');
    await expect(openProjectFile(target)).rejects.toThrow('beschädigt');
  });
  it('verhindert Schreiben durch einen Netzordner-Symlink außerhalb des Projekts', async () => {
    const root = await folder();
    const outside = await folder();
    await symlink(
      outside,
      path.join(root, 'probe.femantis.files'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(
      saveProjectFile(
        path.join(root, 'probe.femantis.json'),
        { name: 'probe.msh', bytes: Buffer.from('test'), scale: 1 },
        defaultView(),
      ),
    ).rejects.toThrow('innerhalb');
  });
});
