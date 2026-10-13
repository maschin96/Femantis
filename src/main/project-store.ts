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
  let run: RunFiles | undefined;
  if (project.run) {
    const directory = await realpath(resolveMeshPath(root, project.run.path));
    resolveMeshPath(root, path.relative(root, directory));
    for (const file of ['result.json', 'result.vtu'])
      resolveMeshPath(
        directory,
        path.relative(directory, await realpath(path.join(directory, file))),
      );
    if (project.run.sourceKey !== sourceKey(source))
      throw new Error('Das Ergebnis gehört zu einem anderen Netz.');
    run = { ...project.run, directory };
  }
  return { name: project.name, source, view: project.view, model: project.model, run };
}

export async function saveProjectFile(
  filename: string,
  source: MeshSource,
  view: ViewState,
  model?: ModelDocument | null,
  run?: RunFiles,
): Promise<void> {
  const root = await realpath(path.dirname(filename));
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
  let savedRun;
  if (run) {
    if (run.sourceKey !== sourceKey(source))
      throw new Error('Das Ergebnis gehört zu einem anderen Netz.');
    const relative = `${folderName}/runs/${run.id}`;
    const destination = path.join(root, relative);
    await mkdir(destination, { recursive: true });
    resolveMeshPath(root, path.relative(root, await realpath(destination)));
    const runRoot = await realpath(run.directory);
    for (const file of await readdir(runRoot)) {
      if (
        !['result.json', 'result.vtu', 'case.json', 'case.toml', 'mesh.msh', 'mesh.vtu'].includes(
          file,
        )
      )
        continue;
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
    savedRun = { id: run.id, path: relative, modelKey: run.modelKey, sourceKey: run.sourceKey };
  }
  const document = parseProject({
    schemaVersion: model || run ? 2 : 1,
    name: path.basename(filename, '.femantis.json'),
    mesh: {
      path: `${folderName}/${meshName}`,
      sha256: digest,
      scale: source.scale,
      name: source.name,
    },
    view: viewSchema.parse(view),
    ...(model ? { model } : {}),
    ...(savedRun ? { run: savedRun } : {}),
  });
  const temporary = path.join(root, `.femantis-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(document, null, 2) + '\n', { flag: 'wx' });
    await rename(temporary, filename);
  } finally {
    await rm(temporary, { force: true });
  }
}
