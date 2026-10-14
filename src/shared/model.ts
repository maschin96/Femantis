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
  .passthrough()
  .superRefine((doc, ctx) => {
    // Only the shapes needed by the forms; physical validation stays in the Toolbox.
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    const field = fieldOf[doc.physics];
    for (const table of ['materials', 'regions'] as const) {
      if (!Object.hasOwn(doc[table], field))
        issue([table, field], 'Die aktive Tabelle fehlt. Im vollständigen Datensatz ergänzen.');
    }
    const scalar = z.number().finite();
    const vector = z.tuple([scalar, scalar, scalar]);
    const check = (schema: z.ZodType, value: unknown, path: (string | number)[], hint: string) => {
      if (!schema.safeParse(value).success) issue(path, hint);
    };
    for (const [kind, entries] of Object.entries(doc.boundary || {})) {
      entries.forEach((entry, index) => {
        const path = ['boundary', kind, index];
        if (kind === 'traction')
          check(vector, entry.value, [...path, 'value'], 'Drei Zahlen für x, y und z angeben.');
        if (kind === 'flux' || kind === 'surface_charge')
          check(scalar, entry.value, [...path, 'value'], 'Einen Zahlenwert angeben.');
        if (kind === 'convection') {
          for (const key of ['coefficient', 'ambient_temperature'])
            check(scalar, entry[key], [...path, key], 'Einen Zahlenwert angeben.');
        }
        if (kind === 'dirichlet') {
          if (entry.components !== undefined)
            check(
              z.array(z.string()),
              entry.components,
              [...path, 'components'],
              'Eine Liste von Komponenten angeben.',
            );
          // Per-node vectors also depend on mesh sets: the Toolbox checks their length.
          check(
            z.union([scalar, z.array(scalar).min(1)]),
            entry.value,
            [...path, 'value'],
            'Eine Zahl oder eine nichtleere Liste von Zahlen angeben.',
          );
        }
      });
    }
    for (const [kind, entry] of Object.entries(doc.loads || {})) {
      if (kind === 'body_force')
        check(vector, entry.value, ['loads', kind, 'value'], 'Drei Zahlen für x, y und z angeben.');
      if (kind === 'source' || kind === 'volume_charge')
        check(scalar, entry.value, ['loads', kind, 'value'], 'Einen Zahlenwert angeben.');
    }
  });

function diagnostic(error: z.ZodError): Error {
  const issue = error.issues[0];
  const path = issue.path.reduce<string>(
    (text, part) =>
      typeof part === 'number' ? `${text}[${part}]` : `${text}${text ? '.' : ''}${String(part)}`,
    '',
  );
  const hint = issue.code === 'custom' ? issue.message : 'Datentyp und Tabellenstruktur prüfen.';
  return new Error(`Ungültiger Modellentwurf · ${path || 'Model'}: ${hint}`);
}

export function parseModelDocument(value: unknown): ModelDocument {
  const json = z.json().safeParse(value);
  if (!json.success) throw diagnostic(json.error);
  const parsed = modelSchema.safeParse(value);
  if (!parsed.success) throw diagnostic(parsed.error);
  if (JSON.stringify(value).length > 2 * 1024 * 1024)
    throw new Error('Der Modellentwurf darf höchstens 2 MiB groß sein.');
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
