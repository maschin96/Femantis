import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { backendStatus, importMesh } from '../src/main/backend';

describe('Echter Python-Prozess', () => {
  it('meldet die installierte Toolbox und überträgt Tet10 samt überlappenden Gruppen', async () => {
    expect(await backendStatus(process.cwd())).toMatchObject({
      available: true,
      toolboxVersion: '1.4.0',
    });
    const mesh = await importMesh(
      process.cwd(),
      await readFile('examples/tet10-groups.msh'),
      'tet10.msh',
      1,
    );
    expect(mesh.triangleCount).toBe(16);
    expect(mesh.positions).toBeInstanceOf(Float64Array);
    expect(mesh.groups.find((g) => g.name === 'ground')?.members).toEqual(
      mesh.groups.find((g) => g.name === 'electrode')?.members,
    );
  });
  it('zeigt bei fehlender Umgebung einen Installationshinweis', async () => {
    expect(await backendStatus(path.join(process.cwd(), 'nicht-vorhanden'))).toMatchObject({
      available: false,
    });
  });
});
