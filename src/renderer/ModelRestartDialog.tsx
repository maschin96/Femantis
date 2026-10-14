import { useLayoutEffect, useRef } from 'react';

export function ModelRestartDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="box-dialog model-restart-dialog"
      aria-label="Modell neu erstellen"
      aria-describedby="model-restart-consequences"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2>Modell neu erstellen?</h2>
      <p id="model-restart-consequences">
        Die bisherigen Materialien, Zuordnungen, Randbedingungen und Lasten werden durch einen neuen
        Entwurf mit Standardmaterial ersetzt. Netz und gewählte Physik bleiben erhalten. Vorhandene
        Ergebnisse gehören weiterhin zum bisherigen Modellstand.
      </p>
      <div className="editor-bottom">
        <button autoFocus onClick={onCancel}>
          Abbrechen
        </button>
        <button className="primary" onClick={onConfirm}>
          Neu erstellen
        </button>
      </div>
    </dialog>
  );
}
