import { useState } from 'react';
import type { GeometryImportDefinition } from '../shared/types';
import { NumericInput } from './ModelEditor';

export function GeometryImporter({
  busy,
  onImport,
  onClose,
}: {
  busy: boolean;
  onImport: (spec: GeometryImportDefinition) => void;
  onClose: () => void;
}) {
  const [automatic, setAutomatic] = useState(true);
  const [sizeMm, setSizeMm] = useState(5);
  const valid = automatic || (Number.isFinite(sizeMm) && sizeMm > 0);
  return (
    <div className="modal-backdrop">
      <div className="box-dialog" role="dialog" aria-label="STEP-Geometrie importieren">
        <h2>STEP-Geometrie importieren und vernetzen</h2>
        <p>
          Ein Volumenkörper wird mit Gmsh zu einem Tet4-Netz. Die STEP-Längeneinheit wird in Meter
          umgerechnet; jede CAD-Fläche wird zur Gruppe „Flaeche_n“, der Körper zur Gruppe „Bauteil“.
        </p>
        <h3>Elementgröße</h3>
        <label className="check-row">
          <input
            type="checkbox"
            checked={automatic}
            disabled={busy}
            onChange={(event) => setAutomatic(event.target.checked)}
          />
          Automatisch (ein Zehntel der Bauteildiagonale)
        </label>
        {!automatic && (
          <div className="input-grid three">
            <NumericInput
              label="Größte Elementkante [mm]"
              value={sizeMm}
              onChange={setSizeMm}
              disabled={busy}
            />
          </div>
        )}
        <div className="editor-bottom">
          <button disabled={busy} onClick={onClose}>
            Abbrechen
          </button>
          <button
            className="primary"
            disabled={busy || !valid}
            onClick={() => onImport({ maxSizeM: automatic ? null : sizeMm / 1000 })}
          >
            STEP-Datei wählen…
          </button>
        </div>
      </div>
    </div>
  );
}
