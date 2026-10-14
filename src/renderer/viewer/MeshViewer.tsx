import { useEffect, useRef, useState } from 'react';
import { Box, Maximize, Rotate3D } from 'lucide-react';
import type { MeshPacket, ViewState, ResultField } from '../../shared/types';
import { Viewport } from './Viewport';

interface Props {
  mesh: MeshPacket | null;
  view: ViewState;
  selectedTriangle: number | null;
  onPick: (triangle: number | null) => void;
  onCamera: (camera: NonNullable<ViewState['camera']>) => void;
  field?: ResultField | null;
  component?: string;
  limits?: [number, number] | null;
  displacement?: Float64Array | null;
  deformationFactor?: number;
}

export function MeshViewer(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewport = useRef<Viewport | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setError(null);
    if (!host.current || !props.mesh) return;
    try {
      viewport.current = new Viewport(
        host.current,
        props.mesh,
        latest.current.view,
        (value) => latest.current.onPick(value),
        (value) => latest.current.onCamera(value),
      );
    } catch (error) {
      setError(
        `Die 3D-Ansicht konnte nicht starten: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return () => {
      viewport.current?.dispose();
      viewport.current = null;
    };
  }, [props.mesh]);
  useEffect(() => {
    viewport.current?.setView(latest.current.view);
  }, [
    props.mesh,
    props.view.mode,
    props.view.showNodes,
    props.view.showAxes,
    props.view.selectedGroup,
    props.view.hiddenGroups,
  ]);
  useEffect(() => {
    viewport.current?.setSelected(props.selectedTriangle);
  }, [props.selectedTriangle]);
  useEffect(() => {
    try {
      viewport.current?.setField(
        props.field || null,
        props.component || 'scalar',
        props.limits || null,
        props.displacement || null,
        props.deformationFactor || 0,
      );
      if (viewport.current) setError(null);
    } catch (error) {
      setError(
        `Die Felddarstellung konnte nicht aktualisiert werden: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, [
    props.mesh,
    props.field,
    props.component,
    props.limits,
    props.displacement,
    props.deformationFactor,
  ]);

  return (
    <div className="viewport-shell">
      <div ref={host} className="viewport" data-testid="viewport" />
      {!props.mesh && (
        <div className="empty-view">
          <div className="empty-icon">
            <Box size={48} />
          </div>
          <h2>Ihr Bauteil. In drei Dimensionen.</h2>
          <p>Öffnen Sie ein FEM-Netz oder entdecken Sie die Ansicht mit einem Beispiel.</p>
          <div className="empty-formats">
            GMSH .MSH <span /> VTK .VTU <span /> TET4 · TET10
          </div>
        </div>
      )}
      {error && (
        <div className="viewer-error" role="alert">
          {error}
        </div>
      )}
      {props.mesh && (
        <>
          <div className="viewport-caption">
            <span className="dot" />
            {props.mesh.name}
            <small>
              {props.mesh.cellType === 'tetra10'
                ? 'Tet10 · Anzeige in Teilflächen'
                : 'Tet4 · Originalnetz'}
            </small>
          </div>
          <div className="view-controls">
            <button
              title="Alles einpassen"
              aria-label="Alles einpassen"
              onClick={() => viewport.current?.fit()}
            >
              <Maximize size={17} />
            </button>
            <span />
            {(['front', 'top', 'side'] as const).map((preset, index) => (
              <button key={preset} onClick={() => viewport.current?.fit(preset)}>
                {['Vorn', 'Oben', 'Seite'][index]}
              </button>
            ))}
            <button
              title="Isometrische Ansicht"
              aria-label="Isometrische Ansicht"
              onClick={() => viewport.current?.fit('iso')}
            >
              <Rotate3D size={18} />
            </button>
          </div>
          <div className="viewport-help">
            Ziehen: drehen <span>·</span> Mausrad: zoomen <span>·</span> Rechts ziehen: verschieben
          </div>
        </>
      )}
    </div>
  );
}
