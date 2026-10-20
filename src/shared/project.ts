import path from 'node:path';
import { z } from 'zod';
import { parseModelDocument } from './model';

const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export const viewSchema = z.object({
  mode: z.enum(['part', 'mesh']),
  showNodes: z.boolean(),
  showAxes: z.boolean(),
  selectedGroup: z.string().max(500).nullable(),
  hiddenGroups: z.array(z.string().max(500)).max(10000),
  camera: z.object({ position: vector, target: vector }).nullable(),
});
const runEntry = z.object({
  id: z.string().uuid(),
  path: z.string(),
  modelKey: z.string().max(2 * 1024 * 1024),
  sourceKey: z.string(),
  provenanceSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  /** Informational solve time; not part of the run proof. */
  createdAt: z.iso.datetime().optional(),
});
const projectSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  name: z.string().min(1).max(250),
  mesh: z.object({
    path: z.string().min(1).max(4000),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    scale: z.number().finite().positive(),
    name: z.string().min(1).max(250).optional(),
  }),
  view: viewSchema,
  model: z
    .unknown()
    .transform((value) => parseModelDocument(value))
    .optional(),
  run: runEntry.optional(),
  /** Retained runs (#7). `run` stays the selected entry so older readers still open it. */
  runs: z.array(runEntry).max(100).optional(),
});
type ProjectDocument = z.infer<typeof projectSchema>;

/** Unique run IDs/paths; a non-empty history needs a selected run that it contains. */
function consistentRuns(project: ProjectDocument): boolean {
  if (!project.runs) return true;
  const ids = new Set(project.runs.map((run) => run.id));
  const paths = new Set(project.runs.map((run) => run.path));
  if (ids.size !== project.runs.length || paths.size !== project.runs.length) return false;
  if (!project.run) return project.runs.length === 0;
  const selected = project.runs.find((run) => run.id === project.run!.id);
  return !!selected && JSON.stringify(selected) === JSON.stringify(project.run);
}

export function parseProject(input: unknown): ProjectDocument {
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success || !consistentRuns(parsed.data))
    throw new Error(
      'Ungültiges Desktopprojekt: Schema, Netzmaßstab, Ansicht oder Laufliste prüfen.',
    );
  return parsed.data;
}

export function resolveMeshPath(root: string, relative: string): string {
  if (path.isAbsolute(relative) || path.win32.isAbsolute(relative) || relative.includes('\\')) {
    throw new Error('Die Netzdatei muss innerhalb des Projekts liegen.');
  }
  const absolute = path.resolve(root, relative);
  const remainder = path.relative(root, absolute);
  if (
    !remainder ||
    remainder.startsWith(`..${path.sep}`) ||
    remainder === '..' ||
    path.isAbsolute(remainder)
  ) {
    throw new Error('Die Netzdatei muss innerhalb des Projekts liegen.');
  }
  return absolute;
}

/**
 * `absolute` (a resolved native path, e.g. after realpath) must lie strictly inside
 * `root`. Unlike `resolveMeshPath`, which validates the portable `/` paths stored in a
 * project file, this accepts the platform's own separators (backslashes on Windows, #11).
 */
export function assertInside(
  root: string,
  absolute: string,
  paths: Pick<typeof path, 'relative' | 'isAbsolute' | 'sep'> = path,
): string {
  const remainder = paths.relative(root, absolute);
  if (
    !remainder ||
    remainder === '..' ||
    remainder.startsWith(`..${paths.sep}`) ||
    paths.isAbsolute(remainder)
  )
    throw new Error('Die Netzdatei muss innerhalb des Projekts liegen.');
  return absolute;
}
