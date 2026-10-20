import type { ResultField } from '../../shared/types';
export function scalarValues(field: ResultField, component: string): Float64Array {
  const width = field.components.length;
  const selected = field.components.indexOf(component);
  if (component !== 'magnitude' && selected < 0) throw new Error('Unbekannte Feldkomponente.');
  if (component === 'magnitude' && width !== 3)
    throw new Error('Betrag nur für Vektorfelder mit drei Komponenten.');
  const output = new Float64Array(field.rows);
  for (let row = 0; row < field.rows; row++) {
    output[row] =
      field.activeMask && !field.activeMask[row]
        ? NaN
        : component === 'magnitude'
          ? Math.hypot(...field.values.slice(row * width, row * width + width))
          : field.values[row * width + selected];
  }
  return output;
}
export function fieldLimits(values: Float64Array): [number, number] {
  let min = Infinity,
    max = -Infinity;
  for (const value of values)
    if (Number.isFinite(value)) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  if (!Number.isFinite(min)) throw new Error('Keine aktiven Feldwerte.');
  return min === max
    ? [min - Math.max(1, Math.abs(min)) * 1e-6, max + Math.max(1, Math.abs(max)) * 1e-6]
    : [min, max];
}

/** Affine display coordinates: normalize in Double before rounding for the GPU.
 * Keep extrapolated values so clipping happens after nodal interpolation.
 */
export function gpuFieldValues(values: Float64Array, limits: [number, number]): Float32Array {
  const [low, high] = limits;
  if (!Number.isFinite(low) || !Number.isFinite(high) || low >= high)
    throw new Error('Die Skala benötigt zwei endliche, aufsteigende Grenzen.');
  const width = high - low;
  const output = new Float32Array(values.length);
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    const difference = value - low;
    output[index] =
      Number.isFinite(width) && Number.isFinite(difference)
        ? difference / width
        : (value / 2 - low / 2) / (high / 2 - low / 2);
    if (!Number.isNaN(value) && !Number.isFinite(output[index]))
      throw new Error('Die Skala ist für diese Feldwerte zu eng. Bitte die Grenzen vergrößern.');
  }
  return output;
}
export const fieldLabels: Record<string, string> = {
  temperature_K: 'Temperatur',
  potential_V: 'Potential',
  displacement_m: 'Verschiebung',
  heat_flux_W_m2: 'Wärmestromdichte',
  stress_Pa: 'Spannung',
  strain_1: 'Dehnung',
  electric_field_V_m: 'Elektrisches Feld',
  electric_displacement_C_m2: 'Elektrische Verschiebung',
};
export function fieldLabel(id: string): string {
  return fieldLabels[id.replace(/_at_centroid$/, '')] || id;
}

/**
 * Caption for how a field is drawn. Tet10 nodal components are exact Triangle6 fields;
 * a magnitude interpolates nodal magnitudes and remains an approximation.
 */
export function interpolationLabel(
  cellType: 'tetra4' | 'tetra10',
  field: Pick<ResultField, 'association' | 'components'>,
  component: string,
): string {
  if (field.association === 'cell') return 'Elementwerte · ohne Glättung';
  if (cellType === 'tetra4') return 'Knotenwerte · lineare Darstellungsinterpolation';
  return component === 'magnitude'
    ? 'Knotenwerte · Betrag aus Knotenbeträgen quadratisch interpoliert (Näherung)'
    : 'Knotenwerte · quadratische Triangle6-Interpolation';
}
