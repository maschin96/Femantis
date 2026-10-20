import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  BackendStatus,
  MeshPacket,
  JobEvent,
  ModelDocument,
  ResultPacket,
} from '../shared/types';
import { sealRun, sourceKey, verifyRunFiles, type MeshSource } from './project-store';
import { canonicalModel } from '../shared/model';
import { DiagnosticError, diagnosticFromBackend } from '../shared/diagnostics';
import type { BackendRuntime } from './runtime';

const count = z
  .number()
  .int()
  .nonnegative()
  .max(2 ** 32 - 1);
const bufferSpec = z.object({
  file: z.string().regex(/^buffer-\d+\.bin$/),
  dtype: z.enum(['<f8', '<u4', '<i4']),
  count,
  bytes: count,
});
const manifestSchema = z.object({
  buffer_schema_version: z.literal(1),
  cell_type: z.enum(['tetra4', 'tetra10']),
  point_count: count,
  cell_count: count,
  facet_count: count,
  boundary_face_count: count,
  triangle_count: count,
  cell_ids: z.array(z.string()),
  facet_ids: z.array(z.string()),
  point_ids: z.array(z.string()),
  external_ids: z.object({ cells: z.boolean(), facets: z.boolean(), points: z.boolean() }),
  groups: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      kind: z.enum(['volume', 'facet']),
      members: z.string(),
    }),
  ),
  buffers: z.record(z.string(), bufferSpec),
});

export async function requestBackend(
  backend: BackendRuntime,
  action: string,
  data: Record<string, unknown> = {},
  options: { signal?: AbortSignal; onPhase?: (event: JobEvent) => void; timeout?: number } = {},
): Promise<unknown> {
  if (options.signal?.aborted) throw new Error('Berechnung abgebrochen.');
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const child = spawn(backend.python, [...backend.pythonArgs, backend.adapter], {
      cwd: backend.cwd,
      windowsHide: true,
      stdio: 'pipe',
    });
    let output = '';
    let pending = '';
    let received = 0;
    let diagnostics = '';
    let settled = false;
    const fail = (error: Error): void => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        child.kill();
        reject(error);
      }
    };
    const timeout = setTimeout(
      () =>
        fail(
          new Error('Der Vorgang dauert zu lange. Bitte Modellgröße und Python-Umgebung prüfen.'),
        ),
      options.timeout ?? 120_000,
    );
    const abort = () => fail(new Error('Berechnung abgebrochen.'));
    options.signal?.addEventListener('abort', abort, { once: true });
    child.on('error', () => fail(new Error(backend.missingRuntime)));
    child.stdin.on('error', () => fail(new Error('Die Python-Anbindung wurde unterbrochen.')));
    child.stdout.on('data', (chunk: Buffer) => {
      received += chunk.length;
      pending += chunk.toString();
      const lines = pending.split('\n');
      pending = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const item = JSON.parse(line);
          if (item.id === id && ['validating', 'solving', 'exporting'].includes(item.event))
            options.onPhase?.({ phase: item.event });
          else output += line;
        } catch {
          output += line;
        }
      }
      if (received > 64 * 1024 * 1024)
        fail(new Error('Die Netzmetadaten überschreiten die unterstützte Größe.'));
    });
    child.stderr.on('data', (chunk: Buffer) => {
      diagnostics = (diagnostics + chunk.toString()).slice(-4000);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
      if (settled) return;
      settled = true;
      try {
        if (code !== 0)
          throw new Error(
            `Python-Adapter konnte das Netz nicht verarbeiten: ${diagnostics || code}`,
          );
        const response = JSON.parse(output + pending);
        if (response.id !== id) throw new Error('Unpassende Antwort der Python-Anbindung.');
        if (response.error) {
          const diagnostic = diagnosticFromBackend(response.error.diagnostic);
          if (diagnostic) throw new DiagnosticError(diagnostic);
          throw new Error(`${response.error.category}: ${response.error.message}`);
        }
        resolve(response.result);
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(JSON.stringify({ id, protocolVersion: 1, action, ...data }) + '\n');
  });
}

export async function withMeshInput<T>(
  source: MeshSource,
  operation: (filename: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(path.join(tmpdir(), 'femantis-model-'));
  try {
    const filename = path.join(directory, `mesh${path.extname(source.name).toLowerCase()}`);
    await writeFile(filename, source.bytes);
    return await operation(filename);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const resultSchema = z.object({
  physics: z.enum(['heat', 'elasticity', 'electrostatics']),
  input_hash: z.string(),
  metrics: z.record(z.string(), z.record(z.string(), z.unknown())),
  limitations: z.array(z.string()),
  point_count: count,
  cell_count: count,
  fields: z.array(
    z.object({
      id: z.string(),
      unit: z.string(),
      association: z.enum(['point', 'cell']),
      components: z.array(z.string()).min(1).max(6),
      rows: count,
      buffer: z.string(),
      mask: z.string().optional(),
      at_centroid: z.boolean(),
    }),
  ),
  buffers: z.record(z.string(), bufferSpec),
});
async function resultPacket(
  directory: string,
  raw: unknown,
  runId: string,
  modelKey: string,
  provenanceVerified: boolean,
  provenanceSha256?: string,
): Promise<ResultPacket> {
  const manifest = resultSchema.parse(raw);
  const arrays: Record<string, Float64Array | Uint32Array> = {};
  for (const [key, spec] of Object.entries(manifest.buffers)) {
    const bytes = await readFile(path.join(directory, spec.file));
    const width = spec.dtype === '<f8' ? 8 : 4;
    if (spec.dtype === '<i4' || bytes.length !== spec.count * width || bytes.length !== spec.bytes)
      throw new Error('Beschädigter Ergebnispuffer.');
    const storage = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.length,
    ) as ArrayBuffer;
    arrays[key] = spec.dtype === '<f8' ? new Float64Array(storage) : new Uint32Array(storage);
  }
  const fields = manifest.fields.map((field) => {
    const values = arrays[field.buffer];
    const activeMask = field.mask ? arrays[field.mask] : undefined;
    if (
      !(values instanceof Float64Array) ||
      values.length !== field.rows * field.components.length ||
      field.rows !== (field.association === 'point' ? manifest.point_count : manifest.cell_count) ||
      values.some((value) => !Number.isFinite(value)) ||
      (field.mask && (!(activeMask instanceof Uint32Array) || activeMask.length !== field.rows))
    )
      throw new Error('Ungültiger Ergebnisfeldvertrag.');
    return {
      id: field.id,
      unit: field.unit,
      association: field.association,
      components: field.components,
      rows: field.rows,
      values,
      activeMask: activeMask as Uint32Array | undefined,
      atCentroid: field.at_centroid,
    };
  });
  return {
    runId,
    modelKey,
    inputHash: manifest.input_hash,
    physics: manifest.physics,
    provenanceVerified,
    ...(provenanceSha256 ? { provenanceSha256 } : {}),
    metrics: manifest.metrics,
    limitations: manifest.limitations,
    fields,
  };
}
export async function calculateModel(
  backend: BackendRuntime,
  source: MeshSource,
  document: ModelDocument,
  runId: string,
  directory: string,
  options: { signal?: AbortSignal; onPhase?: (event: JobEvent) => void } = {},
): Promise<ResultPacket> {
  const filename = path.join(directory, `mesh${path.extname(source.name).toLowerCase()}`);
  await writeFile(filename, source.bytes);
  await writeFile(path.join(directory, 'model.json'), JSON.stringify(document, null, 2) + '\n');
  const snapshot = {
    ...document,
    mesh: { path: path.basename(filename), length_scale_to_m: source.scale },
  };
  const raw = await requestBackend(
    backend,
    'solveModel',
    { path: filename, scale: source.scale, document: snapshot, outputDir: directory },
    { ...options, timeout: 600_000 },
  );
  if (options.signal?.aborted) throw new Error('Berechnung abgebrochen.');
  const modelKey = canonicalModel(document);
  const provenanceSha256 = await sealRun(
    { id: runId, directory, modelKey, sourceKey: sourceKey(source) },
    source,
    resultSchema.parse(raw).input_hash,
  );
  return resultPacket(directory, raw, runId, modelKey, true, provenanceSha256);
}
export async function loadCalculation(
  backend: BackendRuntime,
  directory: string,
  runId: string,
  modelKey: string,
  source: MeshSource,
  provenanceSha256?: string,
): Promise<ResultPacket> {
  const verified = await verifyRunFiles(
    { id: runId, directory, modelKey, sourceKey: sourceKey(source), provenanceSha256 },
    source,
  );
  const temporary = await mkdtemp(path.join(tmpdir(), 'femantis-fields-'));
  try {
    return await withMeshInput(source, async (filename) =>
      resultPacket(
        temporary,
        await requestBackend(backend, 'readResult', {
          directory,
          outputDir: temporary,
          path: filename,
          scale: source.scale,
          physics: JSON.parse(modelKey).physics,
        }),
        runId,
        modelKey,
        verified,
        provenanceSha256,
      ),
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function backendStatus(backend: BackendRuntime): Promise<BackendStatus> {
  try {
    const result = z
      .object({
        available: z.boolean(),
        pythonVersion: z.string().optional(),
        toolboxVersion: z.string().optional(),
        message: z.string().optional(),
      })
      .parse(await requestBackend(backend, 'capabilities'));
    if (result.available && result.toolboxVersion !== '1.4.0')
      return {
        ...result,
        available: false,
        message:
          'Dieser Desktopstand benötigt FEM-Toolbox 1.4.0. Bitte npm run setup:backend ausführen.',
      };
    return result;
  } catch (error) {
    return { available: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Import limit by mesh file size. The Toolbox boundary topology runs per cell in Python
 * (#8: about 10–13 s per MiB of Tet4 VTU on macOS/Apple Silicon); 30 s/MiB leaves at
 * least twice that, capped at one hour for the 256 MB file limit.
 */
export function importTimeout(bytes: number): number {
  return Math.min(120_000 + Math.ceil((bytes / (1024 * 1024)) * 30_000), 60 * 60_000);
}

export async function importMesh(
  backend: BackendRuntime,
  source: Buffer,
  name: string,
  scale: number,
): Promise<MeshPacket> {
  const directory = await mkdtemp(path.join(tmpdir(), 'femantis-mesh-'));
  try {
    const sourcePath = path.join(directory, `input${path.extname(name).toLowerCase()}`);
    await writeFile(sourcePath, source);
    const manifest = manifestSchema.parse(
      await requestBackend(
        backend,
        'importMesh',
        { path: sourcePath, scale, outputDir: directory },
        { timeout: importTimeout(source.length) },
      ),
    );
    const arrays: Record<string, Float64Array | Uint32Array | Int32Array> = {};
    for (const [name, spec] of Object.entries(manifest.buffers)) {
      const raw = await readFile(path.join(directory, spec.file));
      const width = spec.dtype === '<f8' ? 8 : 4;
      if (raw.length !== spec.bytes || raw.length !== spec.count * width)
        throw new Error('Beschädigter Netzpuffer.');
      const storage = raw.buffer.slice(
        raw.byteOffset,
        raw.byteOffset + raw.byteLength,
      ) as ArrayBuffer;
      arrays[name] =
        spec.dtype === '<f8'
          ? new Float64Array(storage)
          : spec.dtype === '<i4'
            ? new Int32Array(storage)
            : new Uint32Array(storage);
    }
    if (
      !(arrays.positions instanceof Float64Array) ||
      arrays.positions.length !== manifest.point_count * 3 ||
      !(arrays.triangles instanceof Uint32Array) ||
      arrays.triangles.length !== manifest.triangle_count * 3 ||
      !(arrays.triangleOwners instanceof Uint32Array) ||
      arrays.triangleOwners.length !== manifest.triangle_count ||
      !(arrays.triangleFacets instanceof Int32Array) ||
      arrays.triangleFacets.length !== manifest.triangle_count ||
      !(arrays.activeNodes instanceof Uint32Array) ||
      manifest.cell_ids.length !== manifest.cell_count ||
      manifest.facet_ids.length !== manifest.facet_count ||
      manifest.point_ids.length !== manifest.point_count
    )
      throw new Error('Unvollständiger Netzvertrag.');
    if (
      arrays.positions.some((value) => !Number.isFinite(value)) ||
      arrays.triangles.some((index) => index >= manifest.point_count) ||
      arrays.triangleOwners.some((index) => index >= manifest.cell_count) ||
      arrays.triangleFacets.some((index) => index < -1 || index >= manifest.facet_count) ||
      arrays.activeNodes.some((index) => index >= manifest.point_count)
    )
      throw new Error('Ungültige Netzindizes oder Koordinaten.');
    const groups = manifest.groups.map((group) => {
      const members = arrays[group.members];
      if (
        !(members instanceof Uint32Array) ||
        members.some(
          (index) =>
            index >= (group.kind === 'volume' ? manifest.cell_count : manifest.facet_count),
        )
      )
        throw new Error('Ungültige Gruppenzuordnung.');
      return { ...group, members };
    });
    return {
      bufferSchemaVersion: 1,
      name,
      cellType: manifest.cell_type,
      pointCount: manifest.point_count,
      cellCount: manifest.cell_count,
      facetCount: manifest.facet_count,
      boundaryFaceCount: manifest.boundary_face_count,
      triangleCount: manifest.triangle_count,
      positions: arrays.positions,
      triangles: arrays.triangles,
      triangleOwners: arrays.triangleOwners,
      triangleFacets: arrays.triangleFacets,
      activeNodes: arrays.activeNodes,
      cellIds: manifest.cell_ids,
      facetIds: manifest.facet_ids,
      pointIds: manifest.point_ids,
      externalIds: manifest.external_ids,
      groups,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
