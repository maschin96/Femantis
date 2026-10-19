import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  writeFile,
  rm,
  copyFile,
  readdir,
} from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { parseProject, resolveMeshPath, viewSchema } from '../shared/project';
import type { ViewState, ModelDocument } from '../shared/types';
import { canonicalModel, parseModelDocument } from '../shared/model';
import { z } from 'zod';

export interface MeshSource {
  name: string;
  bytes: Buffer;
  scale: number;
}
const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');
export const sourceKey = (source: MeshSource): string => sha256(source.bytes) + ':' + source.scale;
export interface RunFiles {
  id: string;
  directory: string;
  modelKey: string;
  sourceKey: string;
  provenanceSha256?: string;
  /** ISO time of the successful solve, when known. */
  createdAt?: string;
}

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const runProofSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  modelKey: z.string().max(2 * 1024 * 1024),
  sourceKey: z.string(),
  inputHash: digestSchema,
  files: z.record(z.string(), digestSchema),
});
const runFileNames = (source: MeshSource): string[] => [
  'model.json',
  'case.json',
  'case.toml',
  `mesh${path.extname(source.name).toLowerCase()}`,
  'result.json',
  'result.vtu',
];
async function runBytes(directory: string, name: string): Promise<Buffer> {
  const root = await realpath(directory);
  const filename = path.join(root, name);
  try {
    resolveMeshPath(root, path.relative(root, await realpath(filename)));
    return await readFile(filename);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new Error(`Die Laufdatei ${name} fehlt. Bitte neu berechnen.`, { cause: error });
    throw error;
  }
}

/** Bind immutable run artifacts to the successful solve, before publication. */
export async function sealRun(
  run: RunFiles,
  source: MeshSource,
  inputHash: string,
): Promise<string> {
  const files: Record<string, string> = {};
  for (const name of runFileNames(source))
    files[name] = sha256(await runBytes(run.directory, name));
  const proof = runProofSchema.parse({
    schemaVersion: 1,
    id: run.id,
    modelKey: run.modelKey,
    sourceKey: run.sourceKey,
    inputHash,
    files,
  });
  const bytes = Buffer.from(JSON.stringify(proof, null, 2) + '\n', 'utf8');
  await writeFile(path.join(run.directory, 'run.json'), bytes, { flag: 'wx' });
  const digest = sha256(bytes);
  await verifyRunFiles({ ...run, provenanceSha256: digest }, source);
  return digest;
}

/** Legacy runs remain explicitly unverified; opening/saving cannot promote them. */
export async function verifyRunFiles(run: RunFiles, source: MeshSource): Promise<boolean> {
  if (run.sourceKey !== sourceKey(source))
    throw new Error('Das Ergebnis gehört zu einem anderen Netz.');
  let proof: z.infer<typeof runProofSchema> | undefined;
  if (run.provenanceSha256) {
    const bytes = await runBytes(run.directory, 'run.json');
    if (sha256(bytes) !== run.provenanceSha256)
      throw new Error('Der Laufnachweis wurde verändert oder ist beschädigt. Bitte neu berechnen.');
    try {
      proof = runProofSchema.parse(JSON.parse(bytes.toString('utf8')));
    } catch (error) {
      throw new Error('Der Laufnachweis ist ungültig. Bitte neu berechnen.', { cause: error });
    }
    if (proof.id !== run.id || proof.modelKey !== run.modelKey || proof.sourceKey !== run.sourceKey)
      throw new Error(
        'Der Laufnachweis stimmt nicht mit der gespeicherten Modell-/Netzrevision überein.',
      );
    const names = runFileNames(source);
    if (
      Object.keys(proof.files).length !== names.length ||
      names.some((name) => !Object.hasOwn(proof!.files, name))
    )
      throw new Error('Der Laufnachweis enthält nicht alle erforderlichen Artefakte.');
    for (const name of names)
      if (sha256(await runBytes(run.directory, name)) !== proof.files[name])
        throw new Error(
          `Eingabe- oder Ergebnisdatei ${name} wurde verändert oder ausgetauscht. Bitte neu berechnen.`,
        );
  }
  const document = parseModelDocument(JSON.parse(run.modelKey));
  const meshName = `mesh${path.extname(source.name).toLowerCase()}`;
  if (sha256(await runBytes(run.directory, meshName)) !== sha256(source.bytes))
    throw new Error('Das gerechnete Eingabenetz stimmt nicht mit dem Projektnetz überein.');
  const expected = { ...document, mesh: { path: meshName, length_scale_to_m: source.scale } };
  const snapshot = parseModelDocument(
    JSON.parse((await runBytes(run.directory, 'case.json')).toString('utf8')),
  );
  if (canonicalModel(snapshot) !== canonicalModel(expected))
    throw new Error('Der Eingabesnapshot stimmt nicht mit der gerechneten Modellrevision überein.');
  if (
    proof &&
    canonicalModel(JSON.parse((await runBytes(run.directory, 'model.json')).toString('utf8'))) !==
      run.modelKey
  )
    throw new Error('Der Laufnachweis enthält einen abweichenden Modellentwurf.');
  const manifest = JSON.parse((await runBytes(run.directory, 'result.json')).toString('utf8'));
  if (
    manifest.physics !== document.physics ||
    (proof && manifest.provenance?.input_sha256 !== proof.inputHash)
  )
    throw new Error('Das Ergebnisbündel gehört nicht zur gerechneten Physik oder Eingaberevision.');
  return !!proof;
}

/** Verified provenance state and input revision of one run, without loading its fields. */
export async function describeRun(
  run: RunFiles,
  source: MeshSource,
): Promise<{ verified: boolean; inputHash: string | null; physics: string }> {
  const verified = await verifyRunFiles(run, source);
  const manifest = JSON.parse((await runBytes(run.directory, 'result.json')).toString('utf8'));
  const inputHash = manifest.provenance?.input_sha256;
  return {
    verified,
    inputHash: digestSchema.safeParse(inputHash).success ? inputHash : null,
    physics: JSON.parse(run.modelKey).physics,
  };
}

export async function readMeshSource(filename: string, scale: number): Promise<MeshSource> {
  if (!['.msh', '.vtu'].includes(path.extname(filename).toLowerCase()))
    throw new Error('Bitte ein Gmsh- oder VTU-Netz wählen.');
  const info = await stat(filename);
  if (info.size > 256 * 1024 * 1024)
    throw new Error('Netzdateien über 256 MB sind in diesem Prototyp noch nicht unterstützt.');
  return { name: path.basename(filename), bytes: await readFile(filename), scale };
}

export async function openProjectFile(filename: string): Promise<{
  name: string;
  source: MeshSource;
  view: ViewState;
  model?: ModelDocument;
  run?: RunFiles;
  runs: RunFiles[];
}> {
  if ((await stat(filename)).size > 8 * 1024 * 1024)
    throw new Error('Die Projektdatei ist zu groß.');
  const project = parseProject(JSON.parse(await readFile(filename, 'utf8')));
  const root = await realpath(path.dirname(filename));
  const sourcePath = resolveMeshPath(root, project.mesh.path);
  const actualPath = await realpath(sourcePath);
  resolveMeshPath(root, path.relative(root, actualPath));
  const source = await readMeshSource(actualPath, project.mesh.scale);
  if (
    project.mesh.name &&
    path.extname(project.mesh.name).toLowerCase() === path.extname(source.name).toLowerCase()
  )
    source.name = path.basename(project.mesh.name);
  if (sha256(source.bytes) !== project.mesh.sha256)
    throw new Error(
      'Die Netzdatei wurde verändert oder ist beschädigt. Bitte das Netz neu importieren.',
    );
  const runs: RunFiles[] = [];
  for (const entry of project.runs ?? (project.run ? [project.run] : [])) {
    const directory = await realpath(resolveMeshPath(root, entry.path));
    resolveMeshPath(root, path.relative(root, directory));
    for (const file of ['result.json', 'result.vtu'])
      resolveMeshPath(
        directory,
        path.relative(directory, await realpath(path.join(directory, file))),
      );
    if (entry.sourceKey !== sourceKey(source))
      throw new Error('Das Ergebnis gehört zu einem anderen Netz.');
    const run: RunFiles = {
      id: entry.id,
      directory,
      modelKey: entry.modelKey,
      sourceKey: entry.sourceKey,
      ...(entry.provenanceSha256 ? { provenanceSha256: entry.provenanceSha256 } : {}),
      ...(entry.createdAt ? { createdAt: entry.createdAt } : {}),
    };
    await verifyRunFiles(run, source);
    runs.push(run);
  }
  const run = project.run ? runs.find((entry) => entry.id === project.run!.id) : undefined;
  return { name: project.name, source, view: project.view, model: project.model, run, runs };
}

const runArtifacts = [
  'result.json',
  'result.vtu',
  'case.json',
  'case.toml',
  'mesh.msh',
  'mesh.vtu',
  'model.json',
  'run.json',
];

/** Copy one run into the project without replacing a differing existing bundle. */
async function copyRun(
  root: string,
  folderName: string,
  run: RunFiles,
  source: MeshSource,
): Promise<NonNullable<ReturnType<typeof parseProject>['run']>> {
  if (run.sourceKey !== sourceKey(source))
    throw new Error('Das Ergebnis gehört zu einem anderen Netz.');
  const relative = `${folderName}/runs/${run.id}`;
  const destination = path.join(root, relative);
  await mkdir(destination, { recursive: true });
  resolveMeshPath(root, path.relative(root, await realpath(destination)));
  const runRoot = await realpath(run.directory);
  for (const file of await readdir(runRoot)) {
    if (!runArtifacts.includes(file)) continue;
    const original = path.join(runRoot, file);
    const actual = await realpath(original);
    resolveMeshPath(runRoot, path.relative(runRoot, actual));
    const target = path.join(destination, file);
    if (path.resolve(original) !== path.resolve(target)) {
      try {
        await copyFile(original, target, constants.COPYFILE_EXCL);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        resolveMeshPath(destination, path.relative(destination, await realpath(target)));
        if (sha256(await readFile(target)) !== sha256(await readFile(original)))
          throw new Error(
            'Eine gespeicherte Ergebnisdatei wurde verändert. Bitte ein anderes Speicherziel wählen.',
          );
      }
    }
  }
  await verifyRunFiles({ ...run, directory: destination }, source);
  return {
    id: run.id,
    path: relative,
    modelKey: run.modelKey,
    sourceKey: run.sourceKey,
    ...(run.provenanceSha256 ? { provenanceSha256: run.provenanceSha256 } : {}),
    ...(run.createdAt ? { createdAt: run.createdAt } : {}),
  };
}

/**
 * Save the project with `run` as selected run and `retained` as the run history
 * (defaults to the selected run alone). Every run is copied into `<name>.files/runs`;
 * runs dropped from the history keep their files there. Returns the history with
 * directories pointing at the project copies.
 */
export async function saveProjectFile(
  filename: string,
  source: MeshSource,
  view: ViewState,
  model?: ModelDocument | null,
  run?: RunFiles,
  retained?: readonly RunFiles[],
): Promise<RunFiles[]> {
  const root = await realpath(path.dirname(filename));
  const history = [...(retained ?? (run ? [run] : []))];
  if (run && !history.some((entry) => entry.id === run.id)) history.unshift(run);
  if (history.length && !run) throw new Error('Bitte einen Berechnungslauf auswählen.');
  if (new Set(history.map((entry) => entry.id)).size !== history.length)
    throw new Error('Die Laufhistorie enthält einen Lauf mehrfach.');
  for (const entry of history) await verifyRunFiles(entry, source);
  const digest = sha256(source.bytes);
  const folderName = `${path.basename(filename, '.json')}.files`;
  const folder = path.join(root, folderName);
  await mkdir(folder, { recursive: true });
  resolveMeshPath(root, path.relative(root, await realpath(folder)));
  const meshName = `mesh-${digest}${path.extname(source.name).toLowerCase()}`;
  const meshPath = path.join(folder, meshName);
  try {
    await writeFile(meshPath, source.bytes, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (sha256(await readFile(meshPath)) !== digest)
      throw new Error(
        'Eine vorhandene Projektnetzdatei ist beschädigt. Bitte ein anderes Speicherziel wählen.',
      );
  }
  const savedRuns: Awaited<ReturnType<typeof copyRun>>[] = [];
  for (const entry of history) savedRuns.push(await copyRun(root, folderName, entry, source));
  const savedRun = run ? savedRuns.find((entry) => entry.id === run.id) : undefined;
  const document = parseProject({
    schemaVersion: model || savedRun ? 2 : 1,
    name: path.basename(filename, '.femantis.json'),
    mesh: {
      path: `${folderName}/${meshName}`,
      sha256: digest,
      scale: source.scale,
      name: source.name,
    },
    view: viewSchema.parse(view),
    ...(model ? { model } : {}),
    ...(savedRun ? { run: savedRun, runs: savedRuns } : {}),
  });
  const temporary = path.join(root, `.femantis-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(document, null, 2) + '\n', { flag: 'wx' });
    await rename(temporary, filename);
  } finally {
    await rm(temporary, { force: true });
  }
  return history.map((entry, index) => ({
    ...entry,
    directory: path.join(root, savedRuns[index].path),
  }));
}
