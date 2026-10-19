import { z } from 'zod';

/**
 * Versioned diagnostic contract between the Python adapter, the main process
 * and the renderer (Issue #6). The adapter classifies Toolbox exceptions;
 * `process` and `cancelled` are created here for errors without a diagnostic.
 */
export const diagnosticCategories = [
  'material',
  'reference',
  'boundary_conflict',
  'schema',
  'mesh',
  'file',
  'input',
  'internal',
  'process',
  'cancelled',
] as const;

const diagnosticSchema = z.object({
  version: z.literal(1),
  category: z.enum(diagnosticCategories),
  kind: z.string().nullable(),
  code: z.string(),
  path: z.string().nullable(),
  related: z.array(z.string()),
  reason: z.string().nullable(),
  detail: z.string(),
  cellId: z.string().nullable(),
});
export type Diagnostic = z.infer<typeof diagnosticSchema>;

const backendSchema = z.object({
  diagnostic_version: z.literal(1),
  category: z.enum(diagnosticCategories),
  kind: z.string().nullable(),
  code: z.string(),
  path: z.string().nullable(),
  related: z.array(z.string()),
  reason: z.string().nullable(),
  detail: z.string(),
  cell_id: z.string().nullable(),
});

/** Converts the adapter's snake_case diagnostic; unknown versions yield null. */
export function diagnosticFromBackend(raw: unknown): Diagnostic | null {
  const parsed = backendSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { diagnostic_version: version, cell_id: cellId, ...rest } = parsed.data;
  return { version, cellId, ...rest };
}

// Electron forwards only the message of a rejected IPC call, so the structured
// diagnostic travels as a marked JSON suffix and is validated again on decode.
const marker = 'FEMANTIS_DIAGNOSTIC_V1 ';

export class DiagnosticError extends Error {
  constructor(readonly diagnostic: Diagnostic) {
    super(marker + JSON.stringify(diagnostic));
    this.name = 'DiagnosticError';
  }
}

export function decodeDiagnostic(message: string): Diagnostic {
  const text = message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '');
  const start = text.indexOf(marker);
  if (start >= 0) {
    try {
      const parsed = diagnosticSchema.safeParse(JSON.parse(text.slice(start + marker.length)));
      if (parsed.success) return parsed.data;
    } catch {
      // Falls through to the readable process fallback below.
    }
  }
  return {
    version: 1,
    category: text === 'Berechnung abgebrochen.' ? 'cancelled' : 'process',
    kind: null,
    code: 'Error',
    path: null,
    related: [],
    reason: null,
    detail: text,
    cellId: null,
  };
}

const anchorTitle: Record<string, string> = {
  T: 'Es fehlt eine Temperaturreferenz.',
  u: 'Die Lagerung reicht nicht aus.',
  phi: 'Es fehlt eine Potentialreferenz.',
};
const anchorHint: Record<string, string> = {
  T: 'Mindestens eine Temperatur- oder Konvektionsrandbedingung auf jedem zusammenhängenden Bauteil festlegen.',
  u: 'Verschiebungen so festlegen, dass alle Starrkörperbewegungen (3 Verschiebungen, 3 Drehungen) verhindert sind.',
  phi: 'Mindestens eine Potentialrandbedingung auf jedem zusammenhängenden Bauteil festlegen.',
};
const materialKind: Record<string, string> = {
  unknown_material: 'Die Volumengruppe verweist auf ein nicht definiertes Material.',
  unknown_region: 'Die zugeordnete Volumengruppe existiert im Netz nicht.',
  missing: 'Mindestens ein Element hat kein Material.',
  conflict: 'Überlappende Volumengruppen erhalten unterschiedliche Materialien.',
};

/** German title and correction hint; raw Toolbox text stays in `detail`. */
export function describeDiagnostic(diagnostic: Diagnostic): { title: string; hint: string } {
  const { category, kind, path, related } = diagnostic;
  const regions = related.map((item) => item.split('.').pop()).join(', ');
  switch (category) {
    case 'material':
      return {
        title: materialKind[kind ?? ''] ?? 'Die Materialangabe ist ungültig.',
        hint: regions
          ? `Materialzuordnung für ${regions} prüfen.`
          : diagnostic.cellId
            ? `Betroffene Element-ID: ${diagnostic.cellId}. Volumengruppen und Materialzuordnung prüfen.`
            : 'Werkstoffwerte und Materialzuordnung prüfen.',
      };
    case 'reference': {
      if (kind === 'unknown_set')
        return {
          title: 'Die Flächengruppe existiert im Netz nicht.',
          hint: 'Eine vorhandene Flächengruppe auswählen.',
        };
      const field = path?.split('.')[1] ?? '';
      return {
        title: anchorTitle[field] ?? 'Es fehlt eine Referenz- oder Lagerungsbedingung.',
        hint: anchorHint[field] ?? 'Randbedingungen ergänzen.',
      };
    }
    case 'boundary_conflict':
      return {
        title: 'Randbedingungen widersprechen sich an gemeinsamen Knoten.',
        hint: `Werte von ${[path, ...related].filter(Boolean).join(' und ')} angleichen oder Flächengruppen trennen.`,
      };
    case 'schema':
      return {
        title: 'Der Modelldatensatz enthält eine ungültige Angabe.',
        hint: 'Den markierten Eintrag korrigieren.',
      };
    case 'mesh':
      return { title: 'Das Netz ist ungültig.', hint: 'Netz im Vorprozessor prüfen.' };
    case 'file':
      return {
        title: 'Die Datei konnte nicht gelesen werden.',
        hint: 'Dateipfad, Format und Inhalt prüfen.',
      };
    case 'input':
    case 'process':
    case 'cancelled':
      return { title: diagnostic.detail, hint: '' };
    default:
      return {
        title: 'Unerwarteter Fehler in der Python-Anbindung.',
        hint: 'Details unten; bitte melden, falls reproduzierbar.',
      };
  }
}

/** `a.b[2].c` → [`a.b[2].c`, `a.b[2]`, `a.b`, `a`]; names may contain spaces. */
export function pathAncestors(path: string): string[] {
  const result = [path];
  let current = path;
  for (;;) {
    const cut = Math.max(current.lastIndexOf('.'), current.lastIndexOf('['));
    if (cut <= 0) return result;
    current = current.slice(0, cut);
    result.push(current);
  }
}

/** Picks the most specific available form target among all candidate paths. */
export function focusPath(paths: string[], available: Set<string>): string | null {
  let best: string | null = null;
  for (const candidate of paths)
    for (const ancestor of pathAncestors(candidate))
      if (available.has(ancestor)) {
        if (!best || ancestor.length > best.length) best = ancestor;
        break;
      }
  return best;
}
