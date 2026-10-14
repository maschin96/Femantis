import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { calculateModel, importMesh, loadCalculation } from '../src/main/backend';
import {
  openProjectFile,
  saveProjectFile,
  sourceKey,
  type MeshSource,
  type RunFiles,
} from '../src/main/project-store';
import { canonicalModel, newModel } from '../src/shared/model';
import { defaultView, type ModelDocument, type ResultPacket } from '../src/shared/types';

let root: string;
let source: MeshSource;
let model: ModelDocument;
let run: RunFiles;
let other: string;
const projects: string[] = [];
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'femantis-provenance-runs-'));
  source = { name: 'cantilever.msh', scale: 1, bytes: await readFile('examples/cantilever.msh') };
  const mesh = await importMesh(process.cwd(), source.bytes, source.name, source.scale);
  model = newModel(mesh);
  model.boundary = {
    dirichlet: [
      { field: 'T', set: 'Einspannung', value: 300, unit: 'K' },
      { field: 'T', set: 'Stirnflaeche', value: 350, unit: 'K' },
    ],
  };
  const first = path.join(root, 'first');
  other = path.join(root, 'other');
  await mkdir(first);
  await mkdir(other);
  const id = randomUUID();
  const result = await calculateModel(process.cwd(), source, model, id, first);
  run = {
    id,
    directory: first,
    modelKey: result.modelKey,
    sourceKey: sourceKey(source),
    provenanceSha256: (result as ResultPacket & { provenanceSha256: string }).provenanceSha256,
  } as RunFiles;
  const next = structuredClone(model);
  next.boundary!.dirichlet[1].value = 400;
  await calculateModel(process.cwd(), source, next, randomUUID(), other);
});
afterEach(async () => {
  for (const folder of projects.splice(0)) await rm(folder, { recursive: true, force: true });
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});
async function project(draft = model) {
  const folder = await mkdtemp(path.join(tmpdir(), 'femantis-provenance-project-'));
  projects.push(folder);
  const filename = path.join(folder, 'probe.femantis.json');
  await saveProjectFile(filename, source, defaultView(), draft, run);
  const document = JSON.parse(await readFile(filename, 'utf8'));
  return { filename, document, directory: path.join(folder, document.run.path) };
}

describe('Bindung an den tatsächlich gerechneten Eingabesnapshot', () => {
  it('erkennt den Austausch eines vollständig gültigen fremden Ergebnisbündels', async () => {
    const saved = await project();
    for (const file of ['result.json', 'result.vtu'])
      await copyFile(path.join(other, file), path.join(saved.directory, file));
    await expect(openProjectFile(saved.filename)).rejects.toThrow(/Ergebnis|Laufnachweis/);
  });
  it.each(['case.json', 'result.json'])('erkennt Änderungen an %s', async (file) => {
    const saved = await project();
    const target = path.join(saved.directory, file);
    const value = JSON.parse(await readFile(target, 'utf8'));
    if (file === 'case.json') value.boundary.dirichlet[1].value = 400;
    else value.physics = 'elasticity';
    await writeFile(target, JSON.stringify(value));
    await expect(openProjectFile(saved.filename)).rejects.toThrow(/Eingabe|Ergebnis|Laufnachweis/);
  });
  it('erkennt Änderungen am Laufnachweis selbst', async () => {
    const saved = await project();
    await writeFile(path.join(saved.directory, 'run.json'), '{"forged":true}');
    await expect(openProjectFile(saved.filename)).rejects.toThrow('Laufnachweis');
  });
  it('meldet fehlende Laufdateien verständlich', async () => {
    const saved = await project();
    await rm(path.join(saved.directory, 'run.json'));
    await expect(openProjectFile(saved.filename)).rejects.toThrow('Die Laufdatei run.json fehlt');
  });
  it('kann einen Lauf nicht durch Änderung des Desktop-modelKey umetikettieren', async () => {
    const saved = await project();
    const changed = structuredClone(model);
    changed.boundary!.dirichlet[1].value = 400;
    saved.document.run.modelKey = canonicalModel(changed);
    await writeFile(saved.filename, JSON.stringify(saved.document));
    await expect(openProjectFile(saved.filename)).rejects.toThrow('Laufnachweis');
  });
  it('erhält einen legitimen alten Lauf neben einem neueren Entwurf portabel', async () => {
    const draft = structuredClone(model);
    draft.materials.T.Werkstoff.conductivity = 3;
    const saved = await project(draft);
    const opened = await openProjectFile(saved.filename);
    expect(opened.model).toEqual(draft);
    expect(opened.run!.modelKey).toBe(canonicalModel(model));
    const loaded = await loadCalculation(
      process.cwd(),
      opened.run!.directory,
      run.id,
      opened.run!.modelKey,
      opened.source,
      (opened.run as RunFiles & { provenanceSha256: string }).provenanceSha256,
    );
    expect(loaded.modelKey).not.toBe(canonicalModel(draft));
    expect((loaded as ResultPacket & { provenanceVerified: boolean }).provenanceVerified).toBe(
      true,
    );
    expect(
      Math.max(...loaded.fields.find((field) => field.id === 'temperature_K')!.values),
    ).toBeCloseTo(350, 8);
  });
  it('markiert alte Schema-2-Läufe ohne Vertrauensanker ausdrücklich als ungeprüft', async () => {
    const saved = await project();
    delete saved.document.run.provenanceSha256;
    await writeFile(saved.filename, JSON.stringify(saved.document));
    await rm(path.join(saved.directory, 'run.json'));
    await rm(path.join(saved.directory, 'model.json'));
    const opened = await openProjectFile(saved.filename);
    const loaded = await loadCalculation(
      process.cwd(),
      opened.run!.directory,
      run.id,
      opened.run!.modelKey,
      opened.source,
    );
    expect((loaded as ResultPacket & { provenanceVerified: boolean }).provenanceVerified).toBe(
      false,
    );
  });
});
