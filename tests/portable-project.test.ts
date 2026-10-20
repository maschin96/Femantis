import { describe, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { importMesh, loadCalculation } from '../src/main/backend';
import { openProjectFile } from '../src/main/project-store';
import { developmentBackend } from '../src/main/runtime';

const backend = developmentBackend(process.cwd());

/**
 * tests/fixtures/portable-project was saved on macOS/Apple Silicon on 20.10.2026 with a real
 * heat run (T = 300 K at x = 0, 350 K at x = 0.12 m). Opening it on Windows and Linux in CI
 * proves the project format, run proof and UTF-8 names travel between platforms (#11).
 */
describe('Projektweitergabe zwischen Plattformen', () => {
  it('öffnet das auf macOS gespeicherte Projekt mit verifiziertem Lauf und analytischem Feld', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'femantis-portable-'));
    try {
      await cp('tests/fixtures/portable-project', folder, { recursive: true });
      const document = JSON.parse(
        await readFile(path.join(folder, 'portabel.femantis.json'), 'utf8'),
      );
      expect(document.mesh.path).toMatch(/^portabel\.femantis\.files\/mesh-[a-f0-9]{64}\.msh$/);
      expect(document.run.path).not.toContain('\\');
      const project = await openProjectFile(path.join(folder, 'portabel.femantis.json'));
      expect(Object.keys(project.model!.materials.T)).toEqual(['Wärmeleiter-Ü']);
      expect(project.runs).toHaveLength(1);
      const run = project.runs[0];
      const result = await loadCalculation(
        backend,
        run.directory,
        run.id,
        run.modelKey,
        project.source,
        run.provenanceSha256,
      );
      expect(result.provenanceVerified).toBe(true);
      const mesh = await importMesh(backend, project.source.bytes, project.source.name, 1);
      const temperature = result.fields.find((field) => field.id === 'temperature_K')!;
      for (let node = 0; node < mesh.pointCount; node++)
        expect(temperature.values[node]).toBeCloseTo(
          300 + (50 * mesh.positions[node * 3]) / 0.12,
          8,
        );
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
