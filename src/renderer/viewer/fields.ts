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
