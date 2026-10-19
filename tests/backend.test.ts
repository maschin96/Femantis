import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { backendStatus, importMesh, importTimeout } from '../src/main/backend';

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
