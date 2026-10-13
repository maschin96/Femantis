import { useState } from 'react';
import type { BoxDefinition } from '../shared/types';
import { NumericInput } from './ModelEditor';
export function BoxCreator({
  busy,
  onCreate,
  onClose,
}: {
  busy: boolean;
  onCreate: (box: BoxDefinition) => void;
  onClose: () => void;
}) {
  const [lengths, setLengths] = useState<[number, number, number]>([120, 30, 18]);
  const [divisions, setDivisions] = useState<[number, number, number]>([8, 3, 2]);
  return (
    <div className="modal-backdrop">
      <div className="box-dialog" role="dialog" aria-label="Quader erstellen">
        <h2>Quader und FEM-Netz erstellen</h2>
        <p>Tet4-Netz mit Volumengruppe und sechs benannten Außenflächen.</p>
        <h3>Abmessungen</h3>
        <div className="input-grid three">
          {['X', 'Y', 'Z'].map((axis, i) => (
            <NumericInput
              key={axis}
              label={`${axis} [mm]`}
              value={lengths[i]}
              onChange={(value) => {
                const next = [...lengths] as typeof lengths;
                next[i] = value;
                setLengths(next);
              }}
              disabled={busy}
            />
          ))}
        </div>
        <h3>Teilungen je Achse</h3>
        <div className="input-grid three">
          {['X', 'Y', 'Z'].map((axis, i) => (
            <NumericInput
              key={axis}
              label={`${axis} Teilungen`}
              value={divisions[i]}
              onChange={(value) => {
                const next = [...divisions] as typeof divisions;
                next[i] = value;
                setDivisions(next);
              }}
              disabled={busy}
            />
          ))}
        </div>
        <div className="editor-bottom">
          <button disabled={busy} onClick={onClose}>
            Abbrechen
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              onCreate({ lengths: lengths.map((v) => v / 1000) as typeof lengths, divisions })
            }
          >
            Quader erstellen
          </button>
        </div>
      </div>
    </div>
  );
}
