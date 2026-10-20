import { describe, expect, it } from 'vitest';
import { readFile, mkdtemp, mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { importMesh, calculateModel, loadCalculation } from '../src/main/backend';
import { newModel } from '../src/shared/model';
import { saveProjectFile, openProjectFile, sourceKey } from '../src/main/project-store';
import { defaultView } from '../src/shared/types';
import { developmentBackend } from '../src/main/runtime';

const backend = developmentBackend(process.cwd());

describe('Berechnung, Wiederöffnung und Abbruch', () => {
  it('berechnet ein lineares Temperaturfeld und speichert Entwurf und Ergebnis portabel', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'femantis-calculation-test-'));
    try {
      const source = {
        name: 'cantilever.msh',
        bytes: await readFile('examples/cantilever.msh'),
        scale: 1,
      };
      const mesh = await importMesh(backend, source.bytes, source.name, 1);
      const model = newModel(mesh);
      model.boundary = {
        dirichlet: [
          { field: 'T', set: 'Einspannung', value: 300, unit: 'K' },
          { field: 'T', set: 'Stirnflaeche', value: 350, unit: 'K' },
        ],
      };
      const runId = randomUUID();
      const runDir = path.join(directory, 'run');
      await mkdir(runDir);
      const phases: string[] = [];
      const result = await calculateModel(backend, source, model, runId, runDir, {
        onPhase: (e) => phases.push(e.phase),
      });
      expect(phases).toEqual(['validating', 'solving', 'exporting']);
      const field = result.fields.find((f) => f.id === 'temperature_K')!;
      for (let row = 0; row < mesh.pointCount; row++)
        expect(field.values[row]).toBeCloseTo(300 + (50 * mesh.positions[row * 3]) / 0.12, 8);
      const filename = path.join(directory, 'probe.femantis.json');
      await saveProjectFile(filename, source, defaultView(), model, {
        id: runId,
        directory: runDir,
        modelKey: result.modelKey,
        sourceKey: sourceKey(source),
        provenanceSha256: result.provenanceSha256,
      });
      const opened = await openProjectFile(filename);
      expect(opened.model).toEqual(model);
      expect(opened.run?.id).toBe(runId);
      const loaded = await loadCalculation(
        backend,
        opened.run!.directory,
        runId,
        opened.run!.modelKey,
        opened.source,
        opened.run!.provenanceSha256,
      );
      expect(loaded.fields.find((f) => f.id === 'temperature_K')!.values).toEqual(field.values);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('beendet den echten Python-Prozess bei Abbruch statt ein Ergebnis zu veröffentlichen', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'femantis-cancel-test-'));
    try {
      const source = {
        name: 'cantilever.msh',
        bytes: await readFile('examples/cantilever.msh'),
        scale: 1,
      };
      const mesh = await importMesh(backend, source.bytes, source.name, 1);
      const model = newModel(mesh);
      model.boundary = { dirichlet: [{ field: 'T', set: 'Einspannung', value: 300, unit: 'K' }] };
      const controller = new AbortController();
      await expect(
        calculateModel(backend, source, model, randomUUID(), directory, {
          signal: controller.signal,
          onPhase: () => controller.abort(),
        }),
      ).rejects.toThrow('abgebrochen');
      await expect(stat(path.join(directory, 'result.json'))).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
