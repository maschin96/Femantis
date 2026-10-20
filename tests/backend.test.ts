import { describe, expect, it } from 'vitest';
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { backendStatus, importMesh, importTimeout, requestBackend } from '../src/main/backend';
import { developmentBackend } from '../src/main/runtime';

const backend = developmentBackend(process.cwd());

describe('Echter Python-Prozess', () => {
  it('meldet die installierte Toolbox und überträgt Tet10 samt überlappenden Gruppen', async () => {
    expect(await backendStatus(backend)).toMatchObject({
      available: true,
      toolboxVersion: '1.4.0',
    });
    const mesh = await importMesh(
      backend,
      await readFile('examples/tet10-groups.msh'),
      'tet10.msh',
      1,
    );
    expect(mesh.triangleCount).toBe(16);
    expect(mesh.triangleFaceNodes).toBeInstanceOf(Uint32Array);
    expect(mesh.triangleFaceNodes!.length).toBe(16 * 6);
    const cube = await importMesh(backend, await readFile('examples/cantilever.msh'), 'c.msh', 1);
    expect(cube.triangleFaceNodes).toBeUndefined();
    expect(mesh.positions).toBeInstanceOf(Float64Array);
    expect(mesh.groups.find((g) => g.name === 'ground')?.members).toEqual(
      mesh.groups.find((g) => g.name === 'electrode')?.members,
    );
  });
  it('zeigt bei fehlender Umgebung einen Installationshinweis', async () => {
    expect(
      await backendStatus(developmentBackend(path.join(process.cwd(), 'nicht-vorhanden'), {})),
    ).toMatchObject({
      available: false,
      message: expect.stringContaining('npm run setup:backend'),
    });
  });
  it('nennt bei fehlender Paket-Runtime die Neuinstallation statt Entwicklerbefehlen', async () => {
    const status = await backendStatus({
      ...backend,
      python: path.join(process.cwd(), 'nicht-vorhanden', 'python3'),
      missingRuntime: 'Bitte Femantis neu installieren.',
    });
    expect(status).toMatchObject({ available: false, message: 'Bitte Femantis neu installieren.' });
  });
  it('rechnet mit den Isolationsschaltern des Pakets, ohne Bytecode neben den Adapter zu schreiben', async () => {
    const resources = await mkdtemp(path.join(tmpdir(), 'femantis-resources-'));
    try {
      for (const name of ['adapter.py', 'models.py'])
        await cp(path.join('backend', name), path.join(resources, name));
      const packaged = {
        ...backend,
        pythonArgs: ['-E', '-s', '-B', '-X', 'utf8'],
        adapter: path.join(resources, 'adapter.py'),
        cwd: resources,
      };
      expect(await backendStatus(packaged)).toMatchObject({ available: true });
      const parsed = await requestBackend(packaged, 'parseModel', {
        text: await readFile('examples/heat.toml', 'utf8'),
      });
      expect(parsed).toMatchObject({ physics: 'heat' });
      expect(await readdir(resources)).toEqual(['adapter.py', 'models.py']);
    } finally {
      await rm(resources, { recursive: true, force: true });
    }
  });
});

describe('Importzeitlimit', () => {
  // Measured on macOS/Apple Silicon (#8): the Toolbox boundary topology needs about
  // 110 s for the 8.4 MB block-1m VTU and 128 s for the 13.7 MB plate-1m VTU.
  const MiB = 1024 * 1024;
  it('behält 120 s für kleine Netze', () => {
    expect(importTimeout(0)).toBe(120_000);
    expect(importTimeout(50_000)).toBeGreaterThanOrEqual(120_000);
  });
  it('lässt gemessenen 1M-Importen mindestens doppelte Reserve', () => {
    expect(importTimeout(8.4 * MiB)).toBeGreaterThanOrEqual(2 * 110_000);
    expect(importTimeout(13.7 * MiB)).toBeGreaterThanOrEqual(2 * 128_000);
  });
  it('wächst monoton und bleibt begrenzt', () => {
    expect(importTimeout(20 * MiB)).toBeGreaterThan(importTimeout(10 * MiB));
    expect(importTimeout(256 * MiB)).toBe(60 * 60_000);
  });
});
