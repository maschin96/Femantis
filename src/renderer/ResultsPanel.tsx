import type { ResultPacket, ResultField } from '../shared/types';
import { fieldLabel } from './viewer/fields';
import { NumericInput } from './ModelEditor';
const display = (v: number) => v.toLocaleString('de-AT', { maximumSignificantDigits: 7 });
interface Props {
  result: ResultPacket;
  field: ResultField;
  component: string;
  limits: [number, number];
  customLimits: [number, number] | null;
  factor: number;
  stale: boolean;
  onField: (id: string) => void;
  onComponent: (component: string) => void;
  onLimits: (range: [number, number] | null) => void;
  onFactor: (factor: number) => void;
  values: Float64Array;
  selectedNodes: number[];
  selectedCell: number | null;
}
export function ResultsPanel(props: Props) {
  return (
    <section className="results-panel">
      <div className="result-status">
        <b>Berechnung abgeschlossen</b>
        <span className={props.stale ? 'stale-badge' : 'badge'}>
          {props.stale ? 'Vorheriger Modellstand' : 'Aktueller Modellstand'}
        </span>
      </div>
      <div className="result-controls">
        <label className="editor-input">
          Ergebnisfeld
          <select
            aria-label="Ergebnisfeld"
            value={props.field.id}
            onChange={(e) => props.onField(e.target.value)}
          >
            {props.result.fields.map((field) => (
              <option key={field.id} value={field.id}>
                {fieldLabel(field.id)} [{field.unit}]
              </option>
            ))}
          </select>
        </label>
        <label className="editor-input">
          Komponente
          <select
            aria-label="Ergebniskomponente"
            value={props.component}
            onChange={(e) => props.onComponent(e.target.value)}
          >
            {props.field.components.map((c) => (
              <option key={c} value={c}>
                {c === 'scalar' ? 'Skalar' : c}
              </option>
            ))}
            {props.field.components.length === 3 && <option value="magnitude">Betrag</option>}
          </select>
        </label>
        {props.result.fields.some((field) => field.id === 'displacement_m') && (
          <NumericInput
            label="Verformungsfaktor"
            value={props.factor}
            onChange={(v) => {
              if (v >= 0 && v <= 1e6) props.onFactor(v);
            }}
          />
        )}
      </div>
      <div className="field-caption">
        {props.field.association === 'point'
          ? 'Knotenwerte · lineare Darstellungsinterpolation'
          : 'Elementwerte · ohne Glättung'}
        {props.field.atCentroid ? ' · Schwerpunktwerte' : ''}
        {props.factor > 0 ? ` · Geometrie x + ${props.factor} · u` : ''}
      </div>
      <div className="colorbar" />
      <div className="colorbar-labels">
        <span>
          {display(props.limits[0])} {props.field.unit}
        </span>
        <span>
          {display(props.limits[1])} {props.field.unit}
        </span>
      </div>
      {(props.field.association === 'point'
        ? props.selectedNodes.length > 0
        : props.selectedCell !== null) && (
        <div className="selected-values">
          <h4>Werte der Auswahl</h4>
          <dl>
            {(props.field.association === 'point'
              ? props.selectedNodes
              : [props.selectedCell!]
            ).map((index) => (
              <div className="dl-row" key={index}>
                <dt>
                  {props.field.association === 'point' ? 'Knotenindex' : 'Elementindex'} {index}
                </dt>
                <dd>
                  {Number.isFinite(props.values[index])
                    ? display(props.values[index]) + ' ' + props.field.unit
                    : 'Inaktiv'}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <details>
        <summary>Farbskala festlegen</summary>
        <div className="input-grid">
          <NumericInput
            label="Skalenminimum"
            value={props.limits[0]}
            onChange={(v) => {
              if (v < props.limits[1]) props.onLimits([v, props.limits[1]]);
            }}
          />
          <NumericInput
            label="Skalenmaximum"
            value={props.limits[1]}
            onChange={(v) => {
              if (v > props.limits[0]) props.onLimits([props.limits[0], v]);
            }}
          />
        </div>
        <button onClick={() => props.onLimits(null)}>Automatische Skala</button>
        {props.customLimits && <p>Werte außerhalb der Skala werden farblich begrenzt.</p>}
      </details>
      <details className="metric-details">
        <summary>Bilanzen und Kennwerte</summary>
        {Object.entries(props.result.metrics).map(([physics, metrics]) => (
          <div key={physics}>
            <h4>{physics}</h4>
            <dl>
              {Object.entries(metrics)
                .filter(([, v]) => typeof v === 'number')
                .map(([key, v]) => (
                  <div className="dl-row" key={key}>
                    <dt>{key}</dt>
                    <dd>{display(v as number)}</dd>
                  </div>
                ))}
            </dl>
          </div>
        ))}
        <p>
          Eingabehash: <code>{props.result.inputHash}</code>
        </p>
      </details>
    </section>
  );
}
