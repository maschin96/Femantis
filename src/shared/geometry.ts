import { z } from 'zod';

/** Largest STEP file the desktop hands to the mesher. */
export const MAX_STEP_BYTES = 64 * 1024 * 1024;

const geometryImportSchema = z
  .object({
    /** Maximum element edge length in metres; null lets the backend derive it from the bounding box. */
    maxSizeM: z.number().finite().positive().nullable(),
  })
  .strict();

export function parseGeometryImport(value: unknown): { maxSizeM: number | null } {
  return geometryImportSchema.parse(value);
}
