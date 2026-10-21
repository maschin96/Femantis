import type { ResultPacket, ResultField } from '../shared/types';
import { Ruler } from 'lucide-react';
import { fieldLabel, interpolationLabel } from './viewer/fields';
import { NumericInput } from './ModelEditor';
import { RibbonButton, RibbonGroup, RibbonStack } from './Ribbon';
const display = (v: number) => v.toLocaleString('de-AT', { maximumSignificantDigits: 7 });
interface Props {
  result: ResultPacket;
  cellType: 'tetra4' | 'tetra10';
  field: ResultField;
  component: string;
  limits: [number, number];
  customLimits: [number, number] | null;
  factor: number;
  stale: boolean;
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
          {!props.result.provenanceVerified
            ? 'Zuordnung nicht verifiziert'
            : props.stale
              ? 'Vorheriger Modellstand'
              : 'Aktueller Modellstand'}
        </span>
        {!props.result.provenanceVerified && (
          <p className="editor-warning">
            Dieser ältere Lauf hat keinen gespeicherten Laufnachweis. Bitte neu berechnen, um seine
            Zuordnung zum Modell zu bestätigen.
          </p>
        )}
      </div>
      <div className="field-caption">
        {interpolationLabel(props.cellType, props.field, props.component)}
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
      {props.customLimits && (
        <p className="field-caption">Werte außerhalb der Skala werden farblich begrenzt.</p>
      )}
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

interface ControlProps {
  result: ResultPacket;
  field: ResultField;
  component: string;
  limits: [number, number];
  customLimits: [number, number] | null;
  factor: number;
  onField: (id: string) => void;
  onComponent: (component: string) => void;
  onLimits: (range: [number, number] | null) => void;
  onFactor: (factor: number) => void;
}

/** Ribbon commands of the results tab: field, component, colour scale, deformation. */
export function ResultControls(props: ControlProps) {
  const hasDisplacement = props.result.fields.some((field) => field.id === 'displacement_m');
  return (
    <>
      <RibbonGroup label="Feld">
        <RibbonStack>
          <label className="rb-field">
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
          <label className="rb-field">
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
        </RibbonStack>
      </RibbonGroup>
      <RibbonGroup label="Farbskala">
        <RibbonStack>
          <RibbonButton
            icon={<Ruler size={14} />}
            label="Automatische Skala"
            pressed={!props.customLimits}
            onClick={() => props.onLimits(null)}
          />
          <NumericInput
            className="rb-field"
            label="Skalenminimum"
            value={props.limits[0]}
            onChange={(v) => {
              if (v < props.limits[1]) props.onLimits([v, props.limits[1]]);
            }}
          />
          <NumericInput
            className="rb-field"
            label="Skalenmaximum"
            value={props.limits[1]}
            onChange={(v) => {
              if (v > props.limits[0]) props.onLimits([props.limits[0], v]);
            }}
          />
        </RibbonStack>
      </RibbonGroup>
      {hasDisplacement && (
        <RibbonGroup label="Verformung">
          <RibbonStack>
            <NumericInput
              className="rb-field"
              label="Verformungsfaktor"
              value={props.factor}
              onChange={(v) => {
                if (v >= 0 && v <= 1e6) props.onFactor(v);
              }}
            />
          </RibbonStack>
        </RibbonGroup>
      )}
    </>
  );
}
