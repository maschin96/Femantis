import { History, Trash2 } from 'lucide-react';
import { physicsLabels } from '../shared/model';
import type { ModelDocument, RunHistory as RunHistoryState } from '../shared/types';
import { formatBytes, runState, runStateLabel, runTime, runTitle } from './runs';

interface Props {
  history: RunHistoryState;
  model: ModelDocument | null;
  disabled: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onClean: () => void;
}

/** Retained runs of the workspace with input revision, stale state and storage place. */
export function RunHistory({ history, model, disabled, onSelect, onRemove, onClean }: Props) {
  const { cache } = history;
  return (
    <section className="run-history" aria-label="Berechnungsläufe">
      <div className="section-title">
        <History size={14} />
        <h3>Berechnungsläufe</h3>
      </div>
      <ol>
        {history.runs.map((run) => {
          const state = runState(run, model);
          const selected = run.id === history.selectedRunId;
          const title = runTitle(run);
          return (
            <li key={run.id} data-run-id={run.id} className={selected ? 'selected' : undefined}>
              <button
                className="run-select"
                aria-label={`${title} anzeigen`}
                aria-pressed={selected}
                disabled={disabled || selected}
                onClick={() => onSelect(run.id)}
              >
                <b>{title}</b>
                <span>
                  {runTime(run)} · {physicsLabels[run.physics]}
                </span>
                <span>
                  {run.inputHash ? `Eingabe ${run.inputHash.slice(0, 12)}` : 'Eingabehash fehlt'}
                </span>
                <span className="run-badges">
                  <span className={state === 'current' ? 'badge' : 'stale-badge'}>
                    {runStateLabel[state]}
                  </span>
                  <span className="badge">
                    {run.stored === 'project' ? 'Im Projekt' : 'Nur lokal'}
                  </span>
                  {selected && <span className="badge">Ausgewählt</span>}
                </span>
              </button>
              <button
                className="run-remove"
                aria-label={`${title} aus Historie entfernen`}
                title={
                  selected
                    ? 'Der angezeigte Lauf kann nicht entfernt werden.'
                    : run.stored === 'project'
                      ? 'Aus der Historie entfernen; die Projektdateien bleiben erhalten.'
                      : 'Ungespeicherten Lauf löschen'
                }
                disabled={disabled || selected}
                onClick={() => onRemove(run.id)}
              >
                <Trash2 size={13} />
              </button>
            </li>
          );
        })}
      </ol>
      <div className="run-cache">
        <span>
          Lokaler Laufcache: {cache.runs} {cache.runs === 1 ? 'Lauf' : 'Läufe'} ·{' '}
          {formatBytes(cache.bytes)}
        </span>
        <button className="glass-button" disabled={disabled} onClick={onClean}>
          Cache bereinigen
        </button>
      </div>
      <p className="run-note">
        Speichern übernimmt alle aufgeführten Läufe in den Projektordner. Ungespeicherte Läufe enden
        mit der Sitzung; die Bereinigung entfernt nur nicht referenzierte Cacheläufe.
      </p>
    </section>
  );
}
