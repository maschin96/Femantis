import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, Check, Play, FileDown, FolderOpen } from 'lucide-react';
import type { MeshPacket, ModelDocument, Physics, JsonValue } from '../shared/types';
import { fieldOf, newModel, parseModelDocument, physicsLabels } from '../shared/model';
import { focusPath } from '../shared/diagnostics';

interface Props {
  mesh: MeshPacket;
  document: ModelDocument;
  busy: boolean;
  onChange: (doc: ModelDocument) => void;
  onValidate: () => void;
  onCalculate: () => void;
  onOpen: () => void;
  onExport: () => void;
  onPendingChange: (value: boolean) => void;
  focusRequest?: { paths: string[]; nonce: number } | null;
  onFocusHandled?: () => void;
}
export function NumericInput({
  label,
  value,
  onChange,
  disabled = false,
  path,
}: {
  label: string;
  value: unknown;
  onChange: (value: number) => void;
  disabled?: boolean;
  path?: string;
}) {
  const [text, setText] = useState(String(value ?? ''));
  useEffect(() => setText(typeof value === 'number' ? String(value) : ''), [value]);
  return (
    <label className="editor-input">
      {label}
      <input
        aria-label={label}
        data-model-path={path}
        type="number"
        step="any"
        value={text}
        disabled={disabled || typeof value !== 'number'}
        onChange={(event) => {
          setText(event.target.value);
          const n = Number(event.target.value);
          if (event.target.value !== '' && Number.isFinite(n)) onChange(n);
        }}
        onBlur={() => setText(typeof value === 'number' ? String(value) : '')}
      />
    </label>
  );
}

export function ModelEditor(props: Props) {
  const { document: doc, mesh } = props;
  let structureError = '';
  try {
    parseModelDocument(doc);
  } catch (error) {
    structureError = error instanceof Error ? error.message : String(error);
  }
  const field = fieldOf[doc.physics];
  const catalog = structureError ? {} : doc.materials[field];
  const [advanced, setAdvanced] = useState(false);
  const [text, setText] = useState(JSON.stringify(doc, null, 2));
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    props.onPendingChange(pending);
  }, [pending]);
  useEffect(() => () => props.onPendingChange(false), []);
  useEffect(() => {
    setText(JSON.stringify(doc, null, 2));
    setError('');
    setPending(false);
    root.current
      ?.querySelectorAll('[data-diagnostic-target]')
      .forEach((element) => element.removeAttribute('data-diagnostic-target'));
  }, [doc]);
  // Diagnostic navigation: data-model-path mirrors the Toolbox data paths, so the
  // most specific rendered ancestor receives focus; otherwise the full dataset.
  const root = useRef<HTMLDivElement>(null);
  const dataset = useRef<HTMLTextAreaElement>(null);
  const [datasetFocus, setDatasetFocus] = useState(0);
  const highlight = (element: HTMLElement) => {
    root.current
      ?.querySelectorAll('[data-diagnostic-target]')
      .forEach((item) => item.removeAttribute('data-diagnostic-target'));
    element.setAttribute('data-diagnostic-target', '');
    element.scrollIntoView({ block: 'center' });
    element.focus({ preventScroll: true });
  };
  useEffect(() => {
    const request = props.focusRequest;
    if (!request || !root.current) return;
    props.onFocusHandled?.();
    const targets = new Map(
      Array.from(root.current.querySelectorAll<HTMLElement>('[data-model-path]')).map((element) => [
        element.dataset.modelPath!,
        element,
      ]),
    );
    const target = focusPath(request.paths, new Set(targets.keys()));
    if (target) highlight(targets.get(target)!);
    else {
      setAdvanced(true);
      setDatasetFocus((value) => value + 1);
    }
  }, [props.focusRequest]);
  useEffect(() => {
    if (datasetFocus && dataset.current) highlight(dataset.current);
  }, [datasetFocus]);
  const update = (edit: (next: ModelDocument) => void) => {
    const next = structuredClone(doc);
    edit(next);
    props.onChange(next);
  };
  const matChange = (name: string, key: string, value: JsonValue) =>
    update((next) => {
      next.materials[field][name][key] = value;
    });
  const boundaryKinds =
    doc.physics === 'heat'
      ? ['dirichlet', 'flux', 'convection']
      : doc.physics === 'elasticity'
        ? ['dirichlet', 'traction']
        : ['dirichlet', 'surface_charge'];
  const facetNames = mesh.groups
    .filter((group) => group.kind === 'facet')
    .map((group) => group.name);
  const conditionName: Record<string, string> = {
    dirichlet:
      doc.physics === 'heat'
        ? 'Temperatur'
        : doc.physics === 'elasticity'
          ? 'Verschiebung / Lagerung'
          : 'Potential',
    flux: 'Wärmestrom nach außen',
    convection: 'Konvektion',
    traction: 'Flächenlast',
    surface_charge: 'Flächenladung',
  };
  const changeCondition = (kind: string, index: number, key: string, value: JsonValue) =>
    update((next) => {
      next.boundary![kind][index][key] = value;
    });
  function addCondition(kind: string) {
    const base: Record<string, JsonValue> = { set: facetNames[0] || '' };
    if (kind === 'dirichlet')
      Object.assign(base, {
        field,
        value: doc.physics === 'heat' ? 300 : 0,
        unit: doc.physics === 'heat' ? 'K' : doc.physics === 'elasticity' ? 'm' : 'V',
        ...(doc.physics === 'elasticity' ? { components: ['x', 'y', 'z'] } : {}),
      });
    if (kind === 'flux') Object.assign(base, { value: 0, unit: 'W/m^2' });
    if (kind === 'convection')
      Object.assign(base, {
        coefficient: 10,
        unit: 'W/(m^2 K)',
        ambient_temperature: 300,
        ambient_unit: 'K',
      });
    if (kind === 'traction') Object.assign(base, { value: [0, 0, 0], unit: 'N/m^2' });
    if (kind === 'surface_charge') Object.assign(base, { value: 0, unit: 'C/m^2' });
    update((next) => {
      next.boundary ||= {};
      next.boundary[kind] ||= [];
      next.boundary[kind].push(base);
    });
  }
  const loadName =
    doc.physics === 'heat'
      ? 'source'
      : doc.physics === 'elasticity'
        ? 'body_force'
        : 'volume_charge';
  const loadUnit =
    doc.physics === 'heat' ? 'W/m^3' : doc.physics === 'elasticity' ? 'N/m^3' : 'C/m^3';
  const loadValue = doc.loads?.[loadName]?.value ?? (doc.physics === 'elasticity' ? [0, 0, 0] : 0);
  return (
    <div className="model-editor" ref={root}>
      <div className="editor-title">
        <div>
          <span>MODELL · STATIONÄR</span>
          <h2>Vom Netz zum Rechenmodell</h2>
          <p>Materialien zuordnen, Randbedingungen festlegen und das Modell prüfen.</p>
        </div>
        <div className="editor-tools">
          <button disabled={props.busy || pending} onClick={props.onOpen}>
            <FolderOpen size={14} />
            TOML öffnen
          </button>
          <button disabled={props.busy || pending} onClick={props.onExport}>
            <FileDown size={14} />
            TOML exportieren
          </button>
        </div>
      </div>
      {structureError && (
        <p className="editor-warning" role="alert">
          {structureError}
        </p>
      )}
      {!structureError && (
        <fieldset disabled={props.busy || pending}>
          <section className="editor-card">
            <h3>Physikalisches Modell</h3>
            <label className="editor-input">
              Physik
              <select
                aria-label="Physik"
                data-model-path="physics"
                value={doc.physics}
                onChange={(event) => props.onChange(newModel(mesh, event.target.value as Physics))}
              >
                {Object.entries(physicsLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <p className="editor-hint">
              Ein Physikwechsel legt einen neuen Entwurf mit Standardmaterial und ohne
              Randbedingungen an. Berechnung: linear, stationär, SI.
            </p>
          </section>
          <section className="editor-card" data-model-path="materials" tabIndex={-1}>
            <div className="editor-card-title">
              <h3>Materialien</h3>
              <button
                onClick={() =>
                  update((next) => {
                    let n = 2;
                    while (next.materials[field][`Werkstoff_${n}`]) n++;
                    next.materials[field][`Werkstoff_${n}`] = structuredClone(
                      Object.values(catalog)[0] ||
                        newModel(mesh, doc.physics).materials[field].Werkstoff,
                    );
                  })
                }
              >
                <Plus size={13} />
                Material hinzufügen
              </button>
            </div>
            {Object.entries(catalog).map(([name, material]) => (
              <div
                className="material-row"
                key={name}
                data-model-path={`materials.${field}.${name}`}
                tabIndex={-1}
              >
                <div className="material-name">
                  <b>{name}</b>
                  <button
                    aria-label={`Material ${name} entfernen`}
                    disabled={Object.keys(catalog).length < 2}
                    onClick={() =>
                      update((next) => {
                        delete next.materials[field][name];
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="input-grid">
                  {doc.physics === 'heat' && (
                    <NumericInput
                      label={`${name} · Leitfähigkeit [W/(m K)]`}
                      value={material.conductivity}
                      path={`materials.${field}.${name}.conductivity`}
                      onChange={(v) => matChange(name, 'conductivity', v)}
                    />
                  )}
                  {doc.physics === 'elasticity' && (
                    <>
                      <NumericInput
                        label={`${name} · E-Modul [GPa]`}
                        path={`materials.${field}.${name}.young`}
                        value={
                          typeof material.young === 'number'
                            ? material.young / (material.unit === 'Pa' ? 1e9 : 1)
                            : material.young
                        }
                        onChange={(v) =>
                          matChange(name, 'young', v * (material.unit === 'Pa' ? 1e9 : 1))
                        }
                      />
                      <NumericInput
                        label={`${name} · Poissonzahl`}
                        value={material.poisson}
                        path={`materials.${field}.${name}.poisson`}
                        onChange={(v) => matChange(name, 'poisson', v)}
                      />
                    </>
                  )}
                  {doc.physics === 'electrostatics' && (
                    <NumericInput
                      label={`${name} · Permittivität [${material.unit === 'relative' ? 'relativ' : 'F/m'}]`}
                      value={material.permittivity}
                      path={`materials.${field}.${name}.permittivity`}
                      onChange={(v) => matChange(name, 'permittivity', v)}
                    />
                  )}
                </div>
                {(typeof material.conductivity === 'object' ||
                  material.stiffness ||
                  typeof material.permittivity === 'object') && (
                  <p className="editor-hint">
                    Tensorwerte bleiben erhalten. Sie können im vollständigen Model-Datensatz
                    bearbeitet werden.
                  </p>
                )}
              </div>
            ))}
            <div data-model-path={`regions.${field}`} tabIndex={-1}>
              <h4>Materialzuordnung zu Volumengruppen</h4>
              {mesh.groups
                .filter((group) => group.kind === 'volume')
                .map((group) => (
                  <label className="region-assignment" key={group.key}>
                    <span>{group.name}</span>
                    <select
                      aria-label={`Material für ${group.name}`}
                      data-model-path={`regions.${field}.${group.name}`}
                      value={doc.regions[field]?.[group.name] || ''}
                      onChange={(event) =>
                        update((next) => {
                          next.regions[field][group.name] = event.target.value;
                        })
                      }
                    >
                      <option value="">Nicht zugeordnet</option>
                      {Object.keys(catalog).map((name) => (
                        <option key={name}>{name}</option>
                      ))}
                    </select>
                  </label>
                ))}
            </div>
            {!mesh.groups.some((group) => group.kind === 'volume') && (
              <p className="editor-warning">
                Dieses Netz benötigt benannte Volumengruppen für die Materialzuordnung. Alternativ
                einen Quader erstellen.
              </p>
            )}
          </section>
          <section className="editor-card" data-model-path="boundary" tabIndex={-1}>
            <h3>Randbedingungen</h3>
            <div className="add-boundary">
              {boundaryKinds.map((kind) => (
                <button key={kind} disabled={!facetNames.length} onClick={() => addCondition(kind)}>
                  <Plus size={13} />
                  {conditionName[kind]}
                </button>
              ))}
            </div>
            {boundaryKinds.flatMap((kind) =>
              (doc.boundary?.[kind] || []).map((entry, index) => (
                <div
                  className="boundary-row"
                  key={`${kind}-${index}`}
                  data-model-path={`boundary.${kind}[${index}]`}
                  tabIndex={-1}
                >
                  <div className="material-name">
                    <b>
                      {conditionName[kind]} {index + 1}
                    </b>
                    <button
                      aria-label={`${conditionName[kind]} ${index + 1} entfernen`}
                      onClick={() =>
                        update((next) => {
                          next.boundary![kind].splice(index, 1);
                        })
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  {entry.set !== undefined && (
                    <label className="editor-input">
                      Flächengruppe
                      <select
                        aria-label={`${kind} ${index + 1} · Flächengruppe`}
                        data-model-path={`boundary.${kind}[${index}].set`}
                        value={String(entry.set)}
                        onChange={(event) =>
                          changeCondition(kind, index, 'set', event.target.value)
                        }
                      >
                        {facetNames.map((name) => (
                          <option key={name}>{name}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {entry.nodes && (
                    <p className="editor-hint">
                      Knotenliste: {JSON.stringify(entry.nodes)} · im vollständigen Datensatz
                      bearbeiten.
                    </p>
                  )}
                  {kind === 'traction' ? (
                    <div className="input-grid three">
                      {['x', 'y', 'z'].map((axis, i) => (
                        <NumericInput
                          key={axis}
                          label={`Flächenlast ${index + 1} · ${axis} [N/m²]`}
                          value={(entry.value as number[])[i]}
                          onChange={(v) => {
                            const vector = [...(entry.value as number[])];
                            vector[i] = v;
                            changeCondition(kind, index, 'value', vector);
                          }}
                        />
                      ))}
                    </div>
                  ) : kind === 'convection' ? (
                    <div className="input-grid">
                      <NumericInput
                        label={`Konvektion ${index + 1} · h [W/(m² K)]`}
                        value={entry.coefficient}
                        path={`boundary.${kind}[${index}].coefficient`}
                        onChange={(v) => changeCondition(kind, index, 'coefficient', v)}
                      />
                      <NumericInput
                        label={`Konvektion ${index + 1} · Umgebung [K]`}
                        value={entry.ambient_temperature}
                        path={`boundary.${kind}[${index}].ambient_temperature`}
                        onChange={(v) => changeCondition(kind, index, 'ambient_temperature', v)}
                      />
                    </div>
                  ) : (
                    <NumericInput
                      label={`${conditionName[kind]} ${index + 1} · Wert [${entry.unit}]`}
                      value={entry.value}
                      path={`boundary.${kind}[${index}].value`}
                      onChange={(v) => changeCondition(kind, index, 'value', v)}
                    />
                  )}
                  {kind === 'dirichlet' && doc.physics === 'elasticity' && (
                    <div className="components">
                      {['x', 'y', 'z'].map((axis) => (
                        <label key={axis}>
                          <input
                            type="checkbox"
                            checked={((entry.components || ['x', 'y', 'z']) as string[]).includes(
                              axis,
                            )}
                            onChange={(event) => {
                              const list = (entry.components || ['x', 'y', 'z']) as string[];
                              changeCondition(
                                kind,
                                index,
                                'components',
                                event.target.checked
                                  ? [...list, axis]
                                  : list.filter((item) => item !== axis),
                              );
                            }}
                          />
                          {axis} festlegen
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )),
            )}
            {!Object.values(doc.boundary || {}).some((list) => list.length) && (
              <p className="editor-hint">
                Noch keine Randbedingungen. Mindestens eine Referenz bzw. eine ausreichende Lagerung
                festlegen.
              </p>
            )}
          </section>
          <section className="editor-card" data-model-path="loads" tabIndex={-1}>
            <h3>Volumenlasten / Quellen</h3>
            {doc.physics === 'elasticity' ? (
              <div className="input-grid three">
                {['x', 'y', 'z'].map((axis, i) => (
                  <NumericInput
                    key={axis}
                    label={`Volumenkraft ${axis} [N/m³]`}
                    value={(loadValue as number[])[i]}
                    onChange={(v) =>
                      update((next) => {
                        const vector = [...(loadValue as number[])];
                        vector[i] = v;
                        next.loads ||= {};
                        next.loads[loadName] = { value: vector, unit: loadUnit };
                      })
                    }
                  />
                ))}
              </div>
            ) : (
              <NumericInput
                label={`${doc.physics === 'heat' ? 'Wärmequelle' : 'Volumenladung'} [${loadUnit}]`}
                value={loadValue}
                path={`loads.${loadName}.value`}
                onChange={(v) =>
                  update((next) => {
                    next.loads ||= {};
                    next.loads[loadName] = { value: v, unit: loadUnit };
                  })
                }
              />
            )}
          </section>
        </fieldset>
      )}
      <section className="editor-card">
        <button className="advanced-toggle" onClick={() => setAdvanced(!advanced)}>
          Vollständigen Model-Datensatz {advanced ? 'ausblenden' : 'bearbeiten'}
        </button>
        {(advanced || structureError) && (
          <>
            <p className="editor-hint">
              Dies sind die unveränderten Tabellen der Toolbox-Model-API als JSON. Tensoren,
              explizite Knotenlisten und weitere unterstützte Eingaben bleiben erhalten.
              Textänderungen erst mit „Übernehmen“ anwenden.
            </p>
            <textarea
              aria-label="Vollständiger Model-Datensatz"
              ref={dataset}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setPending(true);
              }}
              disabled={props.busy}
              spellCheck={false}
            />
            <button
              onClick={() => {
                try {
                  props.onChange(parseModelDocument(JSON.parse(text)));
                  setError('');
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              Übernehmen
            </button>
            {pending && (
              <button
                onClick={() => {
                  setText(JSON.stringify(doc, null, 2));
                  setError('');
                  setPending(false);
                }}
              >
                Textentwurf verwerfen
              </button>
            )}
            {error && (
              <p className="editor-warning" role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </section>
      <div className="editor-bottom">
        <button disabled={props.busy || pending || !!structureError} onClick={props.onValidate}>
          <Check size={16} />
          Modell prüfen
        </button>
        <button
          className="primary"
          disabled={props.busy || pending || !!structureError}
          onClick={props.onCalculate}
        >
          <Play size={15} />
          Berechnen
        </button>
      </div>
    </div>
  );
}
