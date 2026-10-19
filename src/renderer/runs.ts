import { canonicalModel } from '../shared/model';
import type { ModelDocument, RunSummary } from '../shared/types';

export type RunState = 'current' | 'stale' | 'unverified';
export const runStateLabel: Record<RunState, string> = {
  current: 'Aktueller Modellstand',
  stale: 'Vorheriger Modellstand',
  unverified: 'Zuordnung nicht verifiziert',
};

/** Same precedence as the result status: missing proof outranks the model comparison. */
export function runState(run: RunSummary, model: ModelDocument | null): RunState {
  if (!run.provenanceVerified) return 'unverified';
  return model && run.modelKey === canonicalModel(model) ? 'current' : 'stale';
}

/** The UUID prefix stays stable across saving, reopening and removal of other runs. */
export const runTitle = (run: RunSummary): string => `Lauf ${run.id.slice(0, 8)}`;

export function runTime(run: RunSummary): string {
  if (!run.createdAt) return 'Zeitpunkt unbekannt';
  return new Date(run.createdAt).toLocaleString('de-AT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'kB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString('de-AT', { maximumFractionDigits: 1 })} ${units[unit]}`;
}
