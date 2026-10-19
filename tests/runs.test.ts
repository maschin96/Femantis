import { describe, expect, it } from 'vitest';
import { formatBytes, runState, runStateLabel, runTitle } from '../src/renderer/runs';
import { canonicalModel } from '../src/shared/model';
import type { ModelDocument, RunSummary } from '../src/shared/types';

const model: ModelDocument = {
  schema_version: 1,
  units: 'SI',
  physics: 'heat',
  materials: { T: { Stahl: { conductivity: 45 } } },
  regions: { T: { Volumen: 'Stahl' } },
};
const summary = (patch: Partial<RunSummary> = {}): RunSummary => ({
  id: '0f8b6b1e-2a4c-4d1a-9c55-3f1d2c7b9a10',
  createdAt: '2026-10-19T08:00:00.000Z',
  physics: 'heat',
  inputHash: 'a'.repeat(64),
  modelKey: canonicalModel(model),
  provenanceVerified: true,
  stored: 'cache',
  ...patch,
});

describe('Laufhistorie in der Oberfläche', () => {
  it('unterscheidet aktuelle, ältere und nicht verifizierte Läufe', () => {
    expect(runState(summary(), model)).toBe('current');
    const edited = structuredClone(model);
    edited.materials.T.Stahl.conductivity = 50;
    expect(runState(summary(), edited)).toBe('stale');
    expect(runState(summary(), null)).toBe('stale');
    expect(runState(summary({ provenanceVerified: false }), model)).toBe('unverified');
    expect(runStateLabel.stale).toBe('Vorheriger Modellstand');
    expect(runStateLabel.current).toBe('Aktueller Modellstand');
    expect(runStateLabel.unverified).toBe('Zuordnung nicht verifiziert');
  });
  it('benennt Läufe über ihre stabile Kennung und formatiert Cachegrößen', () => {
    expect(runTitle(summary())).toBe('Lauf 0f8b6b1e');
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1,5 kB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
  });
});
