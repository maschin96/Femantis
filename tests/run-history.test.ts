import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { calculateModel, importMesh, loadCalculation } from '../src/main/backend';
import {
  describeRun,
  openProjectFile,
  saveProjectFile,
  sourceKey,
  type MeshSource,
  type RunFiles,
} from '../src/main/project-store';
import { RunCache } from '../src/main/run-cache';
import { canonicalModel, newModel } from '../src/shared/model';
import { defaultView, type ModelDocument } from '../src/shared/types';

let cacheFolder: string;
let cache: RunCache;
let source: MeshSource;
let model: ModelDocument;
let changed: ModelDocument;
let first: RunFiles;
let second: RunFiles;
const projects: string[] = [];

async function solve(document: ModelDocument, createdAt: string): Promise<RunFiles> {
  const id = randomUUID();
  const directory = await cache.createRunDirectory(id);
  const result = await calculateModel(process.cwd(), source, document, id, directory);
  return {
    id,
    directory,
    modelKey: result.modelKey,
    sourceKey: sourceKey(source),
    provenanceSha256: result.provenanceSha256,
    createdAt,
  };
}
beforeAll(async () => {
  cacheFolder = await mkdtemp(path.join(tmpdir(), 'femantis-history-cache-'));
  cache = await RunCache.open(path.join(cacheFolder, 'runs'));
  source = { name: 'cantilever.msh', scale: 1, bytes: await readFile('examples/cantilever.msh') };
  const mesh = await importMesh(process.cwd(), source.bytes, source.name, source.scale);
  model = newModel(mesh);
  model.boundary = {
    dirichlet: [
      { field: 'T', set: 'Einspannung', value: 300, unit: 'K' },
      { field: 'T', set: 'Stirnflaeche', value: 350, unit: 'K' },
    ],
  };
  changed = structuredClone(model);
  changed.boundary!.dirichlet[1].value = 400;
  first = await solve(model, '2026-10-19T08:00:00.000Z');
  second = await solve(changed, '2026-10-19T09:00:00.000Z');
});
afterEach(async () => {
  for (const folder of projects.splice(0)) await rm(folder, { recursive: true, force: true });
});
afterAll(async () => {
  await rm(cacheFolder, { recursive: true, force: true });
});
async function project() {
  const folder = await mkdtemp(path.join(tmpdir(), 'femantis-history-project-'));
  projects.push(folder);
  return path.join(folder, 'probe.femantis.json');
}
const maximum = async (run: RunFiles) =>
  Math.max(
    ...(
      await loadCalculation(
        process.cwd(),
        run.directory,
        run.id,
        run.modelKey,
        source,
        run.provenanceSha256,
      )
    ).fields.find((field) => field.id === 'temperature_K')!.values,
  );

describe('Mehrere Berechnungsläufe im portablen Projekt', () => {
  it('speichert zwei echte Läufe, behält die Auswahl und lädt beide getrennt', async () => {
    const filename = await project();
    await saveProjectFile(filename, source, defaultView(), changed, first, [first, second]);
    const document = JSON.parse(await readFile(filename, 'utf8'));
    expect(document.schemaVersion).toBe(2);
    expect(document.run.id).toBe(first.id); // readers without run history keep working
    expect(document.runs.map((run: { id: string }) => run.id)).toEqual([first.id, second.id]);
    expect(new Set(document.runs.map((run: { path: string }) => run.path)).size).toBe(2);

    const opened = await openProjectFile(filename);
    expect(opened.run!.id).toBe(first.id);
    expect(opened.runs.map((run) => run.id)).toEqual([first.id, second.id]);
    expect(opened.runs.map((run) => run.createdAt)).toEqual([first.createdAt, second.createdAt]);
    for (const run of opened.runs) expect(path.dirname(run.directory)).toMatch(/runs$/);
    expect(opened.runs[0].modelKey).toBe(canonicalModel(model));
    expect(opened.runs[1].modelKey).toBe(canonicalModel(changed));
    expect(await maximum(opened.runs[0])).toBeCloseTo(350, 8);
    expect(await maximum(opened.runs[1])).toBeCloseTo(400, 8);
  });

  it('beschreibt Eingaberevision und Nachweisstatus je Lauf', async () => {
    const one = await describeRun(first, source);
    const two = await describeRun(second, source);
    expect(one).toMatchObject({ physics: 'heat', verified: true });
    expect(one.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(two.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(one.inputHash).not.toBe(two.inputHash);
  });

  it('bleibt nach Bereinigung des lokalen Caches vollständig lesbar', async () => {
    const filename = await project();
    const isolated = await RunCache.open(path.join(cacheFolder, 'isolated'));
    const id = randomUUID();
    const directory = await isolated.createRunDirectory(id);
    const result = await calculateModel(process.cwd(), source, model, id, directory);
    const run = {
      id,
      directory,
      modelKey: result.modelKey,
      sourceKey: sourceKey(source),
      provenanceSha256: result.provenanceSha256,
    };
    await saveProjectFile(filename, source, defaultView(), model, run, [run]);
    expect((await isolated.prune([])).runs).toBe(1);
    const opened = await openProjectFile(filename);
    expect(opened.runs).toHaveLength(1);
    expect(await maximum(opened.runs[0])).toBeCloseTo(350, 8);
  });

  it('entfernt einen Lauf aus der Historie, ohne Projektdateien zu löschen', async () => {
    const filename = await project();
    await saveProjectFile(filename, source, defaultView(), changed, first, [first, second]);
    const before = JSON.parse(await readFile(filename, 'utf8'));
    const opened = await openProjectFile(filename);
    await saveProjectFile(filename, opened.source, defaultView(), changed, opened.runs[0], [
      opened.runs[0],
    ]);
    const after = JSON.parse(await readFile(filename, 'utf8'));
    expect(after.runs.map((run: { id: string }) => run.id)).toEqual([first.id]);
    const removed = path.join(path.dirname(filename), before.runs[1].path);
    expect((await lstat(path.join(removed, 'result.vtu'))).isFile()).toBe(true);
  });

  it('überschreibt kein abweichendes vorhandenes Ergebnisbündel gleicher Lauf-ID', async () => {
    const filename = await project();
    await saveProjectFile(filename, source, defaultView(), model, first, [first]);
    const document = JSON.parse(await readFile(filename, 'utf8'));
    const target = path.join(path.dirname(filename), document.runs[0].path, 'result.json');
    await writeFile(target, '{"fremd":true}');
    await expect(
      saveProjectFile(filename, source, defaultView(), model, first, [first, second]),
    ).rejects.toThrow(/verändert/);
    expect(await readFile(target, 'utf8')).toBe('{"fremd":true}');
  });

  it('lehnt beschädigte, doppelte oder fremde Laufeinträge ab', async () => {
    const filename = await project();
    await saveProjectFile(filename, source, defaultView(), changed, first, [first, second]);
    const original = await readFile(filename, 'utf8');
    const variants: [string, (document: any) => void, RegExp][] = [
      ['fremder Pfad', (d) => (d.runs[1].path = '../fremd'), /innerhalb/],
      ['absoluter Pfad', (d) => (d.runs[1].path = tmpdir()), /innerhalb/],
      ['doppelte ID', (d) => (d.runs[1].id = d.runs[0].id), /Desktopprojekt/],
      ['Auswahl fehlt', (d) => (d.run.id = randomUUID()), /Desktopprojekt/],
      ['Historie ohne Auswahl', (d) => delete d.run, /Desktopprojekt/],
    ];
    for (const [, mutate, error] of variants) {
      const document = JSON.parse(original);
      mutate(document);
      await writeFile(filename, JSON.stringify(document));
      await expect(openProjectFile(filename)).rejects.toThrow(error);
    }
    await writeFile(filename, original);
    const document = JSON.parse(original);
    await writeFile(
      path.join(path.dirname(filename), document.runs[1].path, 'run.json'),
      '{"forged":true}',
    );
    await expect(openProjectFile(filename)).rejects.toThrow('Laufnachweis');
  });

  it('liest ältere Projekte mit Einzellauf oder ohne Lauf als Historie', async () => {
    const filename = await project();
    await saveProjectFile(filename, source, defaultView(), model, first, [first]);
    const document = JSON.parse(await readFile(filename, 'utf8'));
    delete document.runs;
    delete document.run.createdAt;
    await writeFile(filename, JSON.stringify(document));
    const legacy = await openProjectFile(filename);
    expect(legacy.runs.map((run) => run.id)).toEqual([first.id]);
    expect(legacy.runs[0].createdAt).toBeUndefined();

    const viewer = await project();
    await saveProjectFile(viewer, source, defaultView());
    expect(JSON.parse(await readFile(viewer, 'utf8')).schemaVersion).toBe(1);
    expect((await openProjectFile(viewer)).runs).toEqual([]);
  });
});
