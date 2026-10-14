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
  run: z
    .object({
      id: z.string().uuid(),
      path: z.string(),
      modelKey: z.string().max(2 * 1024 * 1024),
      sourceKey: z.string(),
      provenanceSha256: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
    })
    .optional(),
});

export function parseProject(input: unknown): z.infer<typeof projectSchema> {
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success)
    throw new Error('Ungültiges Desktopprojekt: Schema, Netzmaßstab oder Ansicht prüfen.');
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
