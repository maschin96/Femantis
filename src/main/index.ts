import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
  backendStatus,
  importMesh,
  requestBackend,
  withMeshInput,
  calculateModel,
  loadCalculation,
} from './backend';
import {
  describeRun,
  openProjectFile,
  readMeshSource,
  saveProjectFile,
  sourceKey,
  type MeshSource,
  type RunFiles,
} from './project-store';
import { RunCache } from './run-cache';
import { runtimeLayout, type RuntimeLayout } from './runtime';
import {
  defaultView,
  type Physics,
  type RunHistory,
  type RunSummary,
  type ViewState,
} from '../shared/types';
import { assertInside, viewSchema, resolveMeshPath } from '../shared/project';
import { parseModelDocument } from '../shared/model';
import { MAX_STEP_BYTES, parseGeometryImport } from '../shared/geometry';
import { mkdtemp, readFile, writeFile, rm, realpath, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
let layoutCache: RuntimeLayout | null = null;
/** Paths of the checkout or the packaged app; resolved after `app` is ready. */
function layout(): RuntimeLayout {
  layoutCache ??= runtimeLayout({
    packaged: app.isPackaged,
    appRoot: root,
    resourcesPath: process.resourcesPath,
    userData: app.getPath('userData'),
    platform: process.platform,
    env: process.env,
  });
  return layoutCache;
}
const rendererFile = path.resolve(here, '../renderer/index.html');
let window: BrowserWindow;
let source: MeshSource | null = null;
let projectPath: string | null = null;
let dirty = false;
let operationPending = false;
let activeJob: AbortController | null = null;

/**
 * Run history of the open workspace, oldest first. Unsaved runs live in this
 * instance's cache session; after saving, entries point at the project copies.
 */
interface RunEntry extends RunFiles {
  stored: RunSummary['stored'];
  summary: Omit<RunSummary, 'stored'>;
}
let runs: RunEntry[] = [];
let selectedRunId: string | null = null;
let cacheReady: Promise<RunCache> | null = null;
function runCache(): Promise<RunCache> {
  if (!cacheReady) {
    cacheReady = RunCache.open(layout().runCache).then(async (cache) => {
      // Sessions of crashed or closed instances are unreachable; legacy runs stay
      // until the user cleans the cache explicitly.
      await cache.prune([], { legacy: false });
      return cache;
    });
  }
  return cacheReady;
}
async function runEntry(
  run: RunFiles,
  current: MeshSource,
  stored: RunSummary['stored'],
): Promise<RunEntry> {
  const described = await describeRun(run, current);
  return {
    ...run,
    stored,
    summary: {
      id: run.id,
      createdAt: run.createdAt ?? null,
      physics: described.physics as Physics,
      inputHash: described.inputHash,
      modelKey: run.modelKey,
      provenanceVerified: described.verified,
    },
  };
}
async function history(): Promise<RunHistory> {
  return {
    runs: runs.map((entry) => ({ ...entry.summary, stored: entry.stored })),
    selectedRunId,
    cache: await (await runCache()).usage(),
  };
}
/** Replace the workspace's runs; unsaved runs of the previous workspace are deleted. */
async function replaceRuns(next: RunEntry[], selected: string | null): Promise<void> {
  const previous = runs;
  runs = next;
  selectedRunId = selected;
  const cache = await runCache();
  for (const entry of previous)
    if (entry.stored === 'cache' && !next.some((run) => run.directory === entry.directory))
      await cache.discard(entry.directory);
}
function findRun(value: unknown): RunEntry {
  const id = z.string().uuid().parse(value);
  const entry = runs.find((run) => run.id === id);
  if (!entry) throw new Error('Dieser Berechnungslauf ist nicht verfügbar.');
  return entry;
}

function allowDiscard(): boolean {
  if (!dirty) return true;
  return (
    dialog.showMessageBoxSync(window, {
      type: 'question',
      title: 'Ungespeicherte Änderungen',
      message: 'Änderungen verwerfen?',
      detail: 'Mit „Abbrechen“ können Sie zur Ansicht zurückkehren und das Projekt speichern.',
      buttons: ['Abbrechen', 'Verwerfen'],
      defaultId: 0,
      cancelId: 0,
    }) === 1
  );
}

async function loaded(
  next: MeshSource,
  name: string,
  filename: string | null,
  view: ViewState,
  nextRuns?: { runs: RunEntry[]; selected: string | null },
) {
  const status = await backendStatus(layout().backend);
  if (!status.available) throw new Error(status.message || 'FEM-Toolbox nicht verfügbar.');
  const mesh = await importMesh(layout().backend, next.bytes, next.name, next.scale);
  await replaceRuns(nextRuns?.runs ?? [], nextRuns?.selected ?? null);
  source = next;
  projectPath = filename;
  dirty = filename === null;
  return { name, path: filename, mesh, view };
}

function register(channel: string, handler: (...args: unknown[]) => Promise<unknown>): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    if (
      event.sender !== window.webContents ||
      !event.senderFrame ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error('Ungültiger Desktopaufruf.');
    const exclusive = ![
      'desktop:dirty',
      'desktop:status',
      'desktop:cancel',
      'desktop:runs',
    ].includes(channel);
    if (operationPending && exclusive) throw new Error('Bitte den laufenden Vorgang abwarten.');
    if (exclusive) operationPending = true;
    try {
      return await handler(...args);
    } finally {
      if (exclusive) operationPending = false;
    }
  });
}

function setupAPI(): void {
  register('desktop:status', () => backendStatus(layout().backend));
  register('desktop:dirty', async (value) => {
    dirty = z.boolean().parse(value);
  });
  register('desktop:example', async (kind) => {
    const value = z.enum(['tet4', 'tet10']).parse(kind);
    if (!allowDiscard()) return null;
    return loaded(
      await readMeshSource(
        path.join(layout().examples, value === 'tet4' ? 'cantilever.msh' : 'tet10-groups.msh'),
        1,
      ),
      value === 'tet4' ? 'Kragträger · Tet4' : 'Tetraeder · Tet10',
      null,
      defaultView(),
    );
  });
  register('desktop:mesh', async (value) => {
    const scale = z.number().finite().positive().parse(value);
    if (!allowDiscard()) return null;
    const result = await dialog.showOpenDialog(window, {
      title: 'FEM-Netz öffnen',
      filters: [{ name: 'FEM-Netze', extensions: ['msh', 'vtu'] }],
      properties: ['openFile'],
    });
    if (result.canceled) return null;
    const file = result.filePaths[0];
    return loaded(await readMeshSource(file, scale), path.basename(file), null, defaultView());
  });
  register('desktop:open', async () => {
    if (!allowDiscard()) return null;
    const result = await dialog.showOpenDialog(window, {
      title: 'Femantis-Projekt öffnen',
      filters: [{ name: 'Femantis-Projekt', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (result.canceled) return null;
    const file = result.filePaths[0];
    const project = await openProjectFile(file);
    const calculation = project.run
      ? await loadCalculation(
          layout().backend,
          project.run.directory,
          project.run.id,
          project.run.modelKey,
          project.source,
          project.run.provenanceSha256,
        )
      : null;
    const entries = [];
    for (const run of project.runs) entries.push(await runEntry(run, project.source, 'project'));
    const opened = await loaded(project.source, project.name, file, project.view, {
      runs: entries,
      selected: project.run?.id ?? null,
    });
    return { ...opened, model: project.model || null, result: calculation };
  });
  const save = async (value: unknown, modelValue?: unknown, runValue?: unknown) => {
    const view = viewSchema.parse(value);
    if (!source) throw new Error('Bitte zuerst ein Netz öffnen.');
    let target = projectPath;
    if (!target) {
      const result = await dialog.showSaveDialog(window, {
        title: 'Femantis-Projekt speichern',
        defaultPath: `${path.parse(source.name).name}.femantis.json`,
        filters: [{ name: 'Femantis-Projekt', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) return null;
      target = result.filePath.endsWith('.json')
        ? result.filePath
        : `${result.filePath}.femantis.json`;
    }
    const model = modelValue == null ? null : parseModelDocument(modelValue);
    const run = runValue == null ? undefined : findRun(runValue);
    const saved = await saveProjectFile(target, source, view, model, run, run ? runs : []);
    // The project copies are now authoritative; their cache originals are released.
    if (run)
      await replaceRuns(
        runs.map((entry, index) => ({
          ...entry,
          directory: saved[index].directory,
          stored: 'project',
        })),
        run.id,
      );
    projectPath = target;
    dirty = false;
    return { path: target, name: path.basename(target, '.femantis.json') };
  };
  register('desktop:save', save);
  register('desktop:saveWorkspace', save);
  register('desktop:cancel', async () => {
    activeJob?.abort();
  });
  register('desktop:validate', async (value) => {
    if (!source) throw new Error('Bitte zuerst ein Netz öffnen.');
    const document = parseModelDocument(value);
    return withMeshInput(source, (filename) =>
      requestBackend(layout().backend, 'validateModel', {
        path: filename,
        scale: source!.scale,
        document,
      }),
    );
  });
  register('desktop:solve', async (value) => {
    if (!source) throw new Error('Bitte zuerst ein Netz öffnen.');
    const document = parseModelDocument(value);
    const id = randomUUID();
    const cache = await runCache();
    const directory = await cache.createRunDirectory(id);
    const controller = new AbortController();
    activeJob = controller;
    try {
      const result = await calculateModel(layout().backend, source, document, id, directory, {
        signal: controller.signal,
        onPhase: (event) => window.webContents.send('desktop:job', event),
      });
      const entry = await runEntry(
        {
          id,
          directory,
          modelKey: result.modelKey,
          sourceKey: sourceKey(source),
          provenanceSha256: result.provenanceSha256,
          createdAt: new Date().toISOString(),
        },
        source,
        'cache',
      );
      runs = [...runs, entry];
      selectedRunId = id;
      dirty = true;
      return result;
    } catch (error) {
      await cache.discard(directory);
      throw error;
    } finally {
      activeJob = null;
    }
  });
  register('desktop:runs', () => history());
  register('desktop:selectRun', async (value) => {
    if (!source) throw new Error('Bitte zuerst ein Netz öffnen.');
    const entry = findRun(value);
    const result = await loadCalculation(
      layout().backend,
      entry.directory,
      entry.id,
      entry.modelKey,
      source,
      entry.provenanceSha256,
    );
    selectedRunId = entry.id;
    return result;
  });
  register('desktop:removeRun', async (value) => {
    const entry = findRun(value);
    if (entry.id === selectedRunId)
      throw new Error(
        'Der angezeigte Lauf kann nicht entfernt werden. Bitte zuerst einen anderen wählen.',
      );
    // Project copies stay on disk; only the history entry is dropped.
    await replaceRuns(
      runs.filter((run) => run !== entry),
      selectedRunId,
    );
    return history();
  });
  register('desktop:cleanRunCache', async () => {
    const cache = await runCache();
    const removed = await cache.prune(
      runs.filter((run) => run.stored === 'cache').map((run) => run.directory),
    );
    return { removed, history: await history() };
  });
  register('desktop:box', async (value) => {
    const number = z.number().finite().positive();
    const integer = z.number().int().min(1).max(40);
    const spec = z
      .object({
        lengths: z.tuple([number, number, number]),
        divisions: z.tuple([integer, integer, integer]),
      })
      .parse(value);
    if (!allowDiscard()) return null;
    const directory = await mkdtemp(path.join(tmpdir(), 'femantis-box-'));
    try {
      await requestBackend(layout().backend, 'createBox', { ...spec, outputDir: directory });
      return await loaded(
        await readMeshSource(path.join(directory, 'box.vtu'), 1),
        'Quader · Tet4',
        null,
        defaultView(),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  register('desktop:geometry', async (value) => {
    const spec = parseGeometryImport(value);
    const status = await backendStatus(layout().backend);
    if (!status.geometry)
      throw new Error(
        'STEP-Import benötigt Gmsh in der Python-Umgebung. Bitte npm run setup:backend ausführen; die gepackte App enthält Gmsh noch nicht.',
      );
    if (!allowDiscard()) return null;
    const selection = await dialog.showOpenDialog(window, {
      title: 'STEP-Geometrie importieren',
      filters: [{ name: 'STEP-Geometrie', extensions: ['step', 'stp'] }],
      properties: ['openFile'],
    });
    if (selection.canceled) return null;
    const file = selection.filePaths[0];
    if ((await stat(file)).size > MAX_STEP_BYTES)
      throw new Error('STEP-Dateien über 64 MB werden in diesem Schnitt nicht unterstützt.');
    const directory = await mkdtemp(path.join(tmpdir(), 'femantis-step-'));
    try {
      await requestBackend(
        layout().backend,
        'meshGeometry',
        { path: file, outputDir: directory, maxSize: spec.maxSizeM },
        { timeout: 600_000 },
      );
      const meshed = await readMeshSource(path.join(directory, 'geometry.msh'), 1);
      const stem = path.basename(file, path.extname(file));
      return await loaded(
        { ...meshed, name: `${stem}.msh` },
        `${stem} · Tet4 (STEP)`,
        null,
        defaultView(),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  register('desktop:openModel', async () => {
    if (!allowDiscard()) return null;
    const selection = await dialog.showOpenDialog(window, {
      title: 'TOML-Modell öffnen',
      filters: [{ name: 'FEM-Modell', extensions: ['toml'] }],
      properties: ['openFile'],
    });
    if (selection.canceled) return null;
    const filename = selection.filePaths[0];
    if ((await stat(filename)).size > 2 * 1024 * 1024)
      throw new Error('Die Modelldatei ist zu groß.');
    const document = parseModelDocument(
      await requestBackend(layout().backend, 'parseModel', {
        text: await readFile(filename, 'utf8'),
      }),
    );
    if (!document.mesh?.path) throw new Error('Das TOML-Modell benötigt einen relativen Netzpfad.');
    const folder = await realpath(path.dirname(filename));
    const meshFile = await realpath(resolveMeshPath(folder, document.mesh.path));
    assertInside(folder, meshFile);
    const scale = z
      .number()
      .finite()
      .positive()
      .parse(document.mesh.length_scale_to_m ?? 1);
    const next = await readMeshSource(meshFile, scale);
    const opened = await loaded(next, path.parse(filename).name, null, defaultView());
    return { ...opened, model: document };
  });
  register('desktop:exportModel', async (value) => {
    if (!source) throw new Error('Bitte zuerst ein Netz öffnen.');
    const document = parseModelDocument(value);
    const selection = await dialog.showSaveDialog(window, {
      title: 'TOML-Modell exportieren',
      defaultPath: 'case.toml',
      filters: [{ name: 'FEM-Modell', extensions: ['toml'] }],
    });
    if (selection.canceled || !selection.filePath) return null;
    const filename = selection.filePath.endsWith('.toml')
      ? selection.filePath
      : selection.filePath + '.toml';
    const meshName =
      path.basename(filename, '.toml') +
      '-' +
      randomUUID().slice(0, 8) +
      path.extname(source.name).toLowerCase();
    const snapshot = { ...document, mesh: { path: meshName, length_scale_to_m: source.scale } };
    const result = z
      .object({ text: z.string() })
      .parse(await requestBackend(layout().backend, 'dumpModel', { document: snapshot }));
    await writeFile(path.join(path.dirname(filename), meshName), source.bytes, { flag: 'wx' });
    const temporary = filename + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temporary, result.text, { flag: 'wx' });
      const { rename } = await import('node:fs/promises');
      await rename(temporary, filename);
    } finally {
      await rm(temporary, { force: true });
    }
    return filename;
  });
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1100,
    minHeight: 720,
    title: 'Femantis Desktop',
    backgroundColor: '#E8EFF2',
    // The ribbon's title row doubles as the macOS title bar (drag region in styles.css);
    // the window controls sit centred in that row.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 26, y: 24 } }
      : {}),
    show: false,
    webPreferences: {
      preload: path.resolve(here, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const expected = process.env.ELECTRON_RENDERER_URL || pathToFileURL(rendererFile).href;
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== expected) event.preventDefault();
  });
  window.on('close', (event) => {
    if (operationPending || !allowDiscard()) event.preventDefault();
  });
  window.on('closed', () => {
    source = null;
    projectPath = null;
    dirty = false;
  });
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(expected);
  else void window.loadFile(rendererFile);
}

app.whenReady().then(() => {
  app.setName('Femantis');
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin'
        ? [
            {
              label: 'Femantis',
              submenu: [
                { role: 'about' as const },
                { type: 'separator' as const },
                { role: 'quit' as const },
              ],
            },
          ]
        : []),
      {
        label: 'Bearbeiten',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      { label: 'Ansicht', submenu: [{ role: 'togglefullscreen' }, { role: 'toggleDevTools' }] },
    ]),
  );
  createWindow();
  setupAPI();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
let cacheClosed = false;
app.on('will-quit', (event) => {
  if (!cacheReady || cacheClosed) return;
  event.preventDefault();
  cacheClosed = true;
  // Unsaved runs end with the session; a crash leaves them for the next startup.
  void cacheReady
    .then((cache) => cache.close())
    .catch(() => {})
    .finally(() => app.quit());
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
