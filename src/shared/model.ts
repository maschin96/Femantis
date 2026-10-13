import { z } from 'zod';
import type { MeshPacket, ModelDocument, Physics, JsonValue } from './types';

export const fieldOf: Record<Physics, string> = {
  heat: 'T',
  elasticity: 'u',
  electrostatics: 'phi',
};
export const physicsLabels: Record<Physics, string> = {
  heat: 'Wärmeleitung',
  elasticity: 'Elastizität',
  electrostatics: 'Elektrostatik',
};
const jsonTable = z.record(z.string(), z.json());
const modelSchema = z
  .object({
    schema_version: z.literal(1),
    units: z.literal('SI'),
    physics: z.enum(['heat', 'elasticity', 'electrostatics']),
    materials: z.record(z.string(), z.record(z.string(), jsonTable)),
    regions: z.record(z.string(), z.record(z.string(), z.string())),
    boundary: z.record(z.string(), z.array(jsonTable)).optional(),
    loads: z.record(z.string(), jsonTable).optional(),
  })
  .passthrough();
export function parseModelDocument(value: unknown): ModelDocument {
  if (!z.json().safeParse(value).success)
    throw new Error('Der Modellentwurf muss endliche, gültige JSON-Werte enthalten.');
  const parsed = modelSchema.safeParse(value);
  if (!parsed.success || JSON.stringify(value).length > 2 * 1024 * 1024)
    throw new Error(
      'Ungültiger Modellentwurf. Stationäres Modell-Schema 1 und endliche Werte werden benötigt.',
    );
  return parsed.data as ModelDocument;
}
export function canonicalModel(value: unknown): string {
  const sort = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(sort)
      : item && typeof item === 'object'
        ? Object.fromEntries(
            Object.entries(item)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, value]) => [key, sort(value)]),
          )
        : item;
  return JSON.stringify(sort(value));
}
export function newModel(mesh: MeshPacket, physics: Physics = 'heat'): ModelDocument {
  const field = fieldOf[physics];
  const material: Record<string, JsonValue> =
    physics === 'heat'
      ? { conductivity: 2, unit: 'W/(m K)' }
      : physics === 'elasticity'
        ? { young: 210, poisson: 0.3, unit: 'GPa' }
        : { permittivity: 1, unit: 'relative' };
  return {
    schema_version: 1,
    units: 'SI',
    physics,
    materials: { [field]: { Werkstoff: material } },
    regions: {
      [field]: Object.fromEntries(
        mesh.groups
          .filter((group) => group.kind === 'volume')
          .map((group) => [group.name, 'Werkstoff']),
      ),
    },
    boundary: { dirichlet: [] },
  };
}
