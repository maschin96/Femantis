import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Eye,
  EyeOff,
  FileBox,
  FolderOpen,
  Grid2X2,
  Layers,
  LoaderCircle,
  MousePointer2,
  RefreshCw,
  Save,
  Settings2,
  Triangle,
  X,
  Plus,
  Play,
  CheckCircle2,
} from 'lucide-react';
import type {
  BackendStatus,
  MeshPacket,
  OpenedProject,
  ViewState,
  ModelDocument,
  ResultPacket,
} from '../shared/types';
import { defaultView } from '../shared/types';
import { MeshViewer } from './viewer/MeshViewer';
import { newModel, canonicalModel, physicsLabels } from '../shared/model';
import { ModelEditor } from './ModelEditor';
import { BoxCreator } from './BoxCreator';
import { ModelRestartDialog } from './ModelRestartDialog';
import { ResultsPanel } from './ResultsPanel';
import { decodeDiagnostic, describeDiagnostic, type Diagnostic } from '../shared/diagnostics';
import { scalarValues, fieldLimits } from './viewer/fields';

const number = (value: number) => value.toLocaleString('de-AT');
const length = (value: number) =>
  `${(value * 1000).toLocaleString('de-AT', { maximumFractionDigits: 3 })} mm`;
type Notice = { time: string; kind: 'info' | 'error'; message: string; diagnostic?: Diagnostic };

function Logo() {
  return (
    <div className="brand">
      <svg viewBox="0 0 38 38" aria-hidden="true">
        <path
          d="M5 29 15 7l7 13L33 9l-6 24-9-10-6 10Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d="m15 7 3 16 15-14M5 29l13-6 9 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
        />
      </svg>
      <div>
        FEM<span>antis</span>
        <small>DESKTOP WORKSPACE</small>
      </div>
    </div>
  );
}

export function App() {
  const [backend, setBackend] = useState<BackendStatus>({ available: false });
  const [mesh, setMesh] = useState<MeshPacket | null>(null);
  const [projectName, setProjectName] = useState('Neues Projekt');
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [view, setView] = useState<ViewState>(defaultView);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>('Python-Anbindung prüfen');
  const [selectedTriangle, setSelectedTriangle] = useState<number | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [scale, setScale] = useState(1);
  const [logTab, setLogTab] = useState<'all' | 'errors'>('all');

  const [model, setModel] = useState<ModelDocument | null>(null);
  const [result, setResult] = useState<ResultPacket | null>(null);
  const [stage, setStage] = useState<'mesh' | 'model' | 'calculation' | 'results'>('mesh');
  const [focusRequest, setFocusRequest] = useState<{ paths: string[]; nonce: number } | null>(null);
  const [boxDialog, setBoxDialog] = useState(false);
  const [restartDialog, setRestartDialog] = useState(false);
  const [phase, setPhase] = useState('');
  const [fieldId, setFieldId] = useState('');
  const [component, setComponent] = useState('scalar');
  const [customLimits, setCustomLimits] = useState<[number, number] | null>(null);
  const [factor, setFactor] = useState(0);
  const [pendingJSON, setPendingJSON] = useState(false);
  function acceptResult(next: ResultPacket) {
    setResult(next);
    const primary =
      next.physics === 'heat'
        ? 'temperature_K'
        : next.physics === 'elasticity'
          ? 'displacement_m'
          : 'potential_V';
    const field = next.fields.find((field) => field.id === primary) || next.fields[0];
    setFieldId(field.id);
    setComponent(field.components.length === 3 ? 'magnitude' : field.components[0]);
    setCustomLimits(null);
    setFactor(0);
  }
  function editModel(document: ModelDocument) {
    setModel(document);
    setDirty(true);
  }
  function createModel() {
    if (mesh && !busy && !pendingJSON) {
      if (model) {
        setRestartDialog(true);
        return;
      }
      editModel(newModel(mesh));
      setStage('model');
    }
  }
  async function calculate() {
    if (!model) return;
    const snapshot = structuredClone(model);
    setStage('calculation');
    await run('Berechnung starten', async () => {
      setPhase('validating');
      try {
        const solved = await window.desktop.solveModel(snapshot);
        acceptResult(solved);
        setDirty(true);
        setStage('results');
        notice('Berechnung abgeschlossen. Rohfelder und Bilanzen sind verfügbar.');
      } finally {
        setPhase('');
      }
    });
  }
  useEffect(
    () =>
      window.desktop.onJob((event) => {
        setPhase(event.phase);
        setBusy(
          {
            validating: 'Modell prüfen',
            solving: 'Modell berechnen',
            exporting: 'Ergebnisse exportieren',
          }[event.phase],
        );
      }),
    [],
  );

  function notice(message: string, kind: Notice['kind'] = 'info', diagnostic?: Diagnostic) {
    setNotices((previous) =>
      [
        {
          time: new Date().toLocaleTimeString('de-AT', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }),
          kind,
          message,
          diagnostic,
        },
        ...previous,
      ].slice(0, 30),
    );
  }
  function accept(project: OpenedProject | null) {
    if (!project) return;
    setMesh(project.mesh);
    setProjectName(project.name);
    setProjectPath(project.path);
    setView(project.view);
    setSelectedTriangle(null);
    setDirty(project.path === null);
    setModel(project.model || null);
    setResult(null);
    setFieldId('');
    setCustomLimits(null);
    setFactor(0);
    if (project.result) {
      acceptResult(project.result);
      setStage('results');
    } else setStage(project.model ? 'model' : 'mesh');
    notice(
      `${project.mesh.name} geöffnet: ${number(project.mesh.cellCount)} Elemente, ${number(project.mesh.boundaryFaceCount)} Außenflächen.`,
    );
  }
  async function run(label: string, action: () => Promise<void>) {
    if (pendingJSON) {
      notice('Textänderungen zuerst übernehmen oder verwerfen.', 'error');
      return;
    }
    setBusy(label);
    try {
      await action();
    } catch (error) {
      const diagnostic = decodeDiagnostic(error instanceof Error ? error.message : String(error));
      const { title, hint } = describeDiagnostic(diagnostic);
      notice(hint ? `${title} ${hint}` : title, 'error', diagnostic.path ? diagnostic : undefined);
    } finally {
      setBusy(null);
    }
  }
  function changeView(update: Partial<ViewState>) {
    setView((previous) => ({ ...previous, ...update }));
    setDirty(true);
  }
  useEffect(() => {
    void window.desktop.setDirty(dirty).catch(() => {});
  }, [dirty]);
  useEffect(() => {
    void run('Beispielnetz laden', async () => {
      const status = await window.desktop.backendStatus();
      setBackend(status);
      if (status.available) accept(await window.desktop.loadExample('tet4'));
      else notice(status.message || 'Die Python-Anbindung ist nicht verfügbar.', 'error');
    });
  }, []);
  async function save() {
    await run('Projekt speichern', async () => {
      const saved = await window.desktop.saveWorkspace(view, model, result?.runId || null);
      if (saved) {
        setProjectPath(saved.path);
        setProjectName(saved.name);
        setDirty(false);
        notice('Projekt und Netzdatei gespeichert.');
      }
    });
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (mesh && !busy) void save();
      }
      if (event.key === 'Escape') {
        setSelectedTriangle(null);
        if (view.selectedGroup) changeView({ selectedGroup: null });
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [view, mesh, busy, model, result, pendingJSON]);

  const resultField =
    result?.fields.find((field) => field.id === fieldId) || result?.fields[0] || null;
  const resultValues = useMemo(
    () => (resultField ? scalarValues(resultField, component) : null),
    [resultField, component],
  );
  const limits = useMemo(
    () => (resultValues ? customLimits || fieldLimits(resultValues) : ([0, 1] as [number, number])),
    [resultValues, customLimits],
  );
  const stale = !!result && (!model || result.modelKey !== canonicalModel(model));
  const displacement =
    result?.fields.find((field) => field.id === 'displacement_m')?.values || null;
  const selectedGroup = mesh?.groups.find((group) => group.key === view.selectedGroup);
  const owner = mesh && selectedTriangle !== null ? mesh.triangleOwners[selectedTriangle] : null;
  const facet = mesh && selectedTriangle !== null ? mesh.triangleFacets[selectedTriangle] : null;
  const selectedGroups =
    mesh && owner !== null
      ? mesh.groups.filter((group) =>
          group.members.includes(group.kind === 'volume' ? owner : (facet ?? -1)),
        )
      : [];
  const selectedNodes =
    mesh && selectedTriangle !== null
      ? Array.from(mesh.triangles.slice(selectedTriangle * 3, selectedTriangle * 3 + 3))
      : [];
  const dimensions = useMemo(
    () =>
      mesh
        ? [0, 1, 2].map((axis) => {
            let min = Infinity;
            let max = -Infinity;
            for (let index = axis; index < mesh.positions.length; index += 3) {
              min = Math.min(min, mesh.positions[index]);
              max = Math.max(max, mesh.positions[index]);
            }
            return max - min;
          })
        : [],
    [mesh],
  );
  const visibleNotices = notices.filter((item) => logTab === 'all' || item.kind === 'error');

  return (
    <div className="app">
      <header className="topbar">
        <Logo />
        <div className="topbar-divider" />
        <div className="project-title">
          <span>
            {projectName}
            {dirty && <b title="Ungespeichert"> •</b>}
          </span>
          <small>{projectPath ? 'Gespeichertes Projekt' : 'Lokaler Arbeitsbereich'}</small>
        </div>
        <div className="header-actions">
          <button
            disabled={!!busy || pendingJSON}
            onClick={() =>
              void run('Projekt öffnen', async () => accept(await window.desktop.openProject()))
            }
          >
            <FolderOpen size={16} />
            Projekt öffnen
          </button>
          <button
            className="primary"
            disabled={!mesh || !!busy || pendingJSON}
            onClick={() => void save()}
          >
            <Save size={16} />
            Speichern
          </button>
        </div>
      </header>
      <div className="workflow">
        {(['mesh', 'model', 'calculation', 'results'] as const).map((tab, index) => (
          <button
            key={tab}
            className={`step ${stage === tab ? 'active' : ''}`}
            disabled={
              !!busy ||
              pendingJSON ||
              (tab === 'model' && !model) ||
              (tab === 'calculation' && !model) ||
              (tab === 'results' && !result)
            }
            onClick={() => setStage(tab)}
          >
            <span>0{index + 1}</span>
            {['Netz & Bauteil', 'Modell', 'Berechnung', 'Ergebnisse'][index]}
          </button>
        ))}
        <div className="workflow-note">
          FEM-Arbeitsbereich <span>V0.2</span>
        </div>
      </div>
      <main className="workspace">
        <aside className="sidebar">
          <div className="panel-heading">
            <span>PROJEKT</span>
            <Layers size={15} />
          </div>
          <div className="project-root">
            <ChevronDown size={14} />
            <FileBox size={18} />
            <span>{projectName}</span>
          </div>
          <div className="sidebar-section">
            <div className="section-label">GEOMETRIE & NETZ</div>
            <button
              className="tree-row mesh-row"
              onClick={() => {
                setSelectedTriangle(null);
                changeView({ selectedGroup: null });
              }}
              disabled={!mesh}
            >
              <Box size={17} />
              <span>{mesh?.name || 'Kein Netz geladen'}</span>
              {mesh && (
                <span className="tree-tag">{mesh.cellType === 'tetra4' ? 'T4' : 'T10'}</span>
              )}
            </button>
            {(['volume', 'facet'] as const).map((kind) => (
              <div className="group-block" key={kind}>
                <div className="group-heading">
                  <ChevronDown size={12} />
                  {kind === 'volume' ? 'Volumengruppen' : 'Flächengruppen'}
                  <span>{mesh?.groups.filter((group) => group.kind === kind).length || 0}</span>
                </div>
                {mesh?.groups
                  .filter((group) => group.kind === kind)
                  .map((group) => (
                    <div
                      className={`group-row ${view.selectedGroup === group.key ? 'selected' : ''} ${view.hiddenGroups.includes(group.key) ? 'muted' : ''}`}
                      key={group.key}
                    >
                      <button
                        className="group-select"
                        aria-label={`Gruppe ${group.name} auswählen`}
                        onClick={() => {
                          setSelectedTriangle(null);
                          changeView({ selectedGroup: group.key });
                        }}
                      >
                        {kind === 'volume' ? <Box size={14} /> : <Triangle size={14} />}
                        <span>{group.name}</span>
                        <small>{number(group.members.length)}</small>
                      </button>
                      <button
                        className="visibility"
                        aria-label={`${group.name} ${view.hiddenGroups.includes(group.key) ? 'einblenden' : 'ausblenden'}`}
                        title="Sichtbarkeit ändern"
                        onClick={() =>
                          changeView({
                            hiddenGroups: view.hiddenGroups.includes(group.key)
                              ? view.hiddenGroups.filter((key) => key !== group.key)
                              : [...view.hiddenGroups, group.key],
                          })
                        }
                      >
                        {view.hiddenGroups.includes(group.key) ? (
                          <EyeOff size={14} />
                        ) : (
                          <Eye size={14} />
                        )}
                      </button>
                    </div>
                  ))}
              </div>
            ))}
          </div>
          <div className="model-sidebar-actions">
            <button disabled={!mesh || !!busy || pendingJSON} onClick={createModel}>
              <Plus size={14} />
              {model ? 'Modell neu erstellen' : 'Modell erstellen'}
            </button>
            <button
              disabled={!!busy || pendingJSON || !backend.available}
              onClick={() => setBoxDialog(true)}
            >
              <Box size={14} />
              Quader erstellen
            </button>
            {model && (
              <button disabled={!!busy || pendingJSON} onClick={() => setStage('model')}>
                {physicsLabels[model.physics]} · bearbeiten
              </button>
            )}
            {result && (
              <button disabled={!!busy || pendingJSON} onClick={() => setStage('results')}>
                <CheckCircle2 size={14} />
                {stale ? 'Vorheriges Ergebnis' : 'Ergebnisse ansehen'}
              </button>
            )}
          </div>
          <div className="import-card">
            <ArrowDownToLine size={20} />
            <h3>Ein eigenes Netz öffnen</h3>
            <p>Gmsh oder VTU, mit Gruppen und Elementzuordnung.</p>
            <label className="unit-label">
              Gmsh-Längeneinheit
              <select
                aria-label="Gmsh-Längeneinheit"
                value={scale}
                disabled={!!busy || pendingJSON}
                onChange={(event) => setScale(Number(event.target.value))}
              >
                <option value={1}>Meter (m)</option>
                <option value={0.001}>Millimeter (mm)</option>
              </select>
            </label>
            <button
              className="primary"
              disabled={!!busy || pendingJSON || !backend.available}
              onClick={() =>
                void run('Netz importieren', async () =>
                  accept(await window.desktop.openMesh(scale)),
                )
              }
            >
              <FolderOpen size={15} />
              Netz öffnen
            </button>
            <small>VTU-Koordinaten werden in m gelesen.</small>
          </div>
          <div className="examples">
            <span className="section-label">BEISPIELNETZE</span>
            <button
              disabled={!!busy || pendingJSON || !backend.available}
              onClick={() =>
                void run('Tet4-Beispiel laden', async () =>
                  accept(await window.desktop.loadExample('tet4')),
                )
              }
            >
              <Box size={14} />
              Kragträger · Tet4
              <ChevronRight size={13} />
            </button>
            <button
              disabled={!!busy || pendingJSON || !backend.available}
              onClick={() =>
                void run('Tet10-Beispiel laden', async () =>
                  accept(await window.desktop.loadExample('tet10')),
                )
              }
            >
              <Grid2X2 size={14} />
              Tetraeder · Tet10
              <ChevronRight size={13} />
            </button>
          </div>
        </aside>
        <section className="viewer-panel">
          <div className="viewer-toolbar">
            <div className="view-tabs">
              <button
                className={view.mode === 'part' ? 'active' : ''}
                disabled={!!busy || pendingJSON}
                onClick={() => {
                  changeView({ mode: 'part' });
                  if (stage === 'model' || stage === 'calculation') setStage('mesh');
                }}
              >
                <Box size={16} />
                Bauteil
              </button>
              <button
                className={view.mode === 'mesh' ? 'active' : ''}
                disabled={!!busy || pendingJSON}
                onClick={() => {
                  changeView({ mode: 'mesh' });
                  if (stage === 'model' || stage === 'calculation') setStage('mesh');
                }}
              >
                <Grid2X2 size={16} />
                Netz
              </button>
            </div>
            <div className="view-options">
              <button
                className={view.showNodes ? 'on' : ''}
                aria-pressed={view.showNodes}
                disabled={!mesh}
                onClick={() => changeView({ showNodes: !view.showNodes })}
              >
                <CircleDot size={15} />
                Knoten
              </button>
              <button
                className={view.showAxes ? 'on' : ''}
                aria-pressed={view.showAxes}
                disabled={!mesh}
                onClick={() => changeView({ showAxes: !view.showAxes })}
              >
                Achsen
              </button>
            </div>
          </div>
          {stage === 'model' && mesh && model ? (
            <ModelEditor
              mesh={mesh}
              document={model}
              busy={!!busy}
              onChange={editModel}
              focusRequest={focusRequest}
              onFocusHandled={() => setFocusRequest(null)}
              onPendingChange={(value) => {
                setPendingJSON(value);
                if (value) setDirty(true);
              }}
              onValidate={() =>
                void run('Modell prüfen', async () => {
                  await window.desktop.validateModel(model);
                  notice(
                    'Modellprüfung bestanden. Materialien und Randbedingungen sind konsistent.',
                  );
                })
              }
              onCalculate={() => void calculate()}
              onOpen={() =>
                void run('TOML-Modell öffnen', async () => accept(await window.desktop.openModel()))
              }
              onExport={() =>
                void run('TOML-Modell exportieren', async () => {
                  const file = await window.desktop.exportModel(model);
                  if (file) notice('TOML-Modell und zugehöriges Netz exportiert.');
                })
              }
            />
          ) : stage === 'calculation' && model ? (
            <div className="calculation-panel">
              <span>FEM-TOOLBOX · STATIONÄR</span>
              <h2>Modell berechnen</h2>
              <p>
                {physicsLabels[model.physics]} · {number(mesh?.cellCount || 0)} Elemente
              </p>
              <div className="calculation-phases">
                {(['validating', 'solving', 'exporting'] as const).map((p, i) => (
                  <div className={phase === p ? 'current' : ''} key={p}>
                    <span>{i + 1}</span>
                    {
                      [
                        'Modell und Randbedingungen prüfen',
                        'System aufstellen und lösen',
                        'Rohfelder und Bilanzen exportieren',
                      ][i]
                    }
                    {phase === p && <LoaderCircle className="spin" size={16} />}
                  </div>
                ))}
              </div>
              {busy ? (
                <button
                  className="cancel-calculation"
                  onClick={() => void window.desktop.cancelJob()}
                >
                  Berechnung abbrechen
                </button>
              ) : (
                <button className="primary" onClick={() => void calculate()}>
                  <Play size={15} />
                  Berechnen
                </button>
              )}
              <p className="editor-hint">
                Die Oberfläche bleibt während der Berechnung bedienbar. Ein erfolgreicher Solverlauf
                ist kein experimenteller Validierungsnachweis.
              </p>
            </div>
          ) : (
            <MeshViewer
              mesh={mesh}
              view={view}
              selectedTriangle={selectedTriangle}
              onPick={(value) => {
                setSelectedTriangle(value);
                if (value !== null && view.selectedGroup) changeView({ selectedGroup: null });
              }}
              onCamera={(camera) => changeView({ camera })}
              field={stage === 'results' ? resultField : null}
              component={component}
              limits={limits}
              displacement={stage === 'results' ? displacement : null}
              deformationFactor={stage === 'results' ? factor : 0}
            />
          )}
          {busy && stage !== 'calculation' && (
            <div className="busy-overlay" role="status">
              <LoaderCircle className="spin" size={23} />
              <span>{busy}…</span>
            </div>
          )}
        </section>
        <aside className="inspector">
          {stage === 'results' && result && resultField && (
            <ResultsPanel
              result={result}
              field={resultField}
              component={component}
              limits={limits}
              customLimits={customLimits}
              factor={factor}
              stale={stale}
              onField={(id) => {
                const field = result.fields.find((f) => f.id === id)!;
                setFieldId(id);
                setComponent(field.components.length === 3 ? 'magnitude' : field.components[0]);
                setCustomLimits(null);
              }}
              onComponent={(c) => {
                setComponent(c);
                setCustomLimits(null);
              }}
              onLimits={setCustomLimits}
              onFactor={setFactor}
              values={resultValues!}
              selectedNodes={selectedNodes}
              selectedCell={owner}
            />
          )}

          <div className="panel-heading">
            <span>EIGENSCHAFTEN</span>
            <Settings2 size={15} />
          </div>
          <div className="inspector-section">
            <div className="section-title">
              <MousePointer2 size={15} />
              <h3>Auswahl</h3>
              {(selectedTriangle !== null || selectedGroup) && (
                <button
                  title="Auswahl aufheben"
                  aria-label="Auswahl aufheben"
                  onClick={() => {
                    setSelectedTriangle(null);
                    changeView({ selectedGroup: null });
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </div>
            {selectedGroup ? (
              <>
                <div className="selection-name">{selectedGroup.name}</div>
                <div className="badge">
                  {selectedGroup.kind === 'volume' ? 'Volumengruppe' : 'Flächengruppe'}
                </div>
                <dl>
                  <dt>Mitglieder</dt>
                  <dd>{number(selectedGroup.members.length)}</dd>
                  <dt>Sichtbarkeit</dt>
                  <dd>
                    {view.hiddenGroups.includes(selectedGroup.key) ? 'Ausgeblendet' : 'Sichtbar'}
                  </dd>
                </dl>
              </>
            ) : owner !== null && mesh ? (
              <>
                <div className="selection-name">
                  {mesh.externalIds.cells ? 'Element' : 'Elementindex'} {mesh.cellIds[owner]}
                </div>
                <div className="badge">Außenfläche ausgewählt</div>
                <dl>
                  <dt>Elementindex</dt>
                  <dd>{owner}</dd>
                  <dt>{mesh.externalIds.facets ? 'Flächen-ID' : 'Flächenindex'}</dt>
                  <dd>{facet !== null && facet >= 0 ? mesh.facetIds[facet] : 'Abgeleitet'}</dd>
                </dl>
                {selectedGroups.map((group) => (
                  <div key={group.key} className="selection-chip">
                    {group.name}
                  </div>
                ))}
                <div className="coordinate-list">
                  <span>
                    Flächenknoten · {mesh.externalIds.points ? 'Original-IDs' : 'interne Indizes'}
                  </span>
                  {selectedNodes.map((node) => (
                    <div key={node}>
                      <b>{mesh.pointIds[node]}</b>
                      <small>
                        {[0, 1, 2]
                          .map((axis) => length(mesh.positions[node * 3 + axis]))
                          .join(' / ')}
                      </small>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="selection-empty">
                Wählen Sie eine Gruppe im Projektbaum oder eine Fläche in der 3D-Ansicht.
              </div>
            )}
          </div>
          <div className="inspector-section">
            <div className="section-title">
              <Grid2X2 size={15} />
              <h3>Netzinformation</h3>
            </div>
            <dl>
              <dt>Elementtyp</dt>
              <dd>{mesh ? (mesh.cellType === 'tetra4' ? 'Tet4' : 'Tet10') : '—'}</dd>
              <dt>Knoten</dt>
              <dd data-testid="point-count">{mesh ? number(mesh.pointCount) : '—'}</dd>
              <dt>Volumenelemente</dt>
              <dd data-testid="cell-count">{mesh ? number(mesh.cellCount) : '—'}</dd>
              <dt>Außenflächen</dt>
              <dd data-testid="face-count">{mesh ? number(mesh.boundaryFaceCount) : '—'}</dd>
              <dt>Randflächen im Netz</dt>
              <dd>{mesh ? number(mesh.facetCount) : '—'}</dd>
            </dl>
            {mesh?.cellType === 'tetra10' && (
              <div className="inspector-note">
                Geradkantige Tet10. Jede Triangle6-Fläche wird mit vier Teilflächen dargestellt.
              </div>
            )}
          </div>
          <div className="inspector-section">
            <div className="section-title">
              <Box size={15} />
              <h3>Abmessungen</h3>
            </div>
            <dl>
              {['X', 'Y', 'Z'].map((axis, index) => (
                <div className="dl-row" key={axis}>
                  <dt>{axis}</dt>
                  <dd>{mesh ? length(dimensions[index]) : '—'}</dd>
                </div>
              ))}
            </dl>
            <div className="inspector-note">
              Bauteilansicht aus der Außenfläche des FEM-Netzes. Originalkoordinaten in m.
            </div>
          </div>
          <div className="next-step">
            <span>MODELL UND BERECHNUNG</span>
            <h4>Vom Netz zum Ergebnis</h4>
            <p>
              Über „Modell erstellen“ Materialien und Randbedingungen festlegen. Die Modellprüfung
              kontrolliert die Eingaben vor der Berechnung.
            </p>
          </div>
        </aside>
      </main>
      <section className="messages">
        <div className="message-tabs">
          <button className={logTab === 'all' ? 'active' : ''} onClick={() => setLogTab('all')}>
            Meldungen <span>{notices.length}</span>
          </button>
          <button
            className={logTab === 'errors' ? 'active' : ''}
            onClick={() => setLogTab('errors')}
          >
            Fehler <span>{notices.filter((item) => item.kind === 'error').length}</span>
          </button>
          <button
            className="check-backend"
            disabled={!!busy || pendingJSON}
            onClick={() =>
              void run('Anbindung prüfen', async () => {
                const status = await window.desktop.backendStatus();
                setBackend(status);
                notice(
                  status.available
                    ? `FEM-Toolbox ${status.toolboxVersion} ist verfügbar.`
                    : status.message || 'Anbindung nicht verfügbar.',
                  status.available ? 'info' : 'error',
                );
              })
            }
          >
            <RefreshCw size={13} />
            Anbindung prüfen
          </button>
        </div>
        <div className="message-list" role="log">
          {visibleNotices.length ? (
            visibleNotices.map((item, index) => (
              <div key={`${item.time}-${index}`} className={`message ${item.kind}`}>
                <span>{item.time}</span>
                {item.kind === 'info' ? <Check size={13} /> : <X size={13} />}
                <div className="message-body">
                  <p>{item.message}</p>
                  {item.diagnostic && (
                    <DiagnosticDetails
                      diagnostic={item.diagnostic}
                      canShow={!!model && !!mesh}
                      onShow={(paths) => {
                        setStage('model');
                        setFocusRequest({ paths, nonce: Date.now() });
                      }}
                    />
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="no-messages">
              {logTab === 'errors' ? 'Keine Fehler gemeldet.' : 'Bereit.'}
            </div>
          )}
        </div>
      </section>
      <footer className="statusbar">
        <span>
          <i className={backend.available ? 'status-dot ready' : 'status-dot'} />
          {busy || (backend.available ? 'Bereit' : 'Anbindung fehlt')}
        </span>
        <span>
          {mesh
            ? `${number(mesh.cellCount)} Elemente · ${number(mesh.pointCount)} Knoten`
            : 'Kein Netz'}
        </span>
        <div />
        <span>
          {backend.available ? `FEM-Toolbox ${backend.toolboxVersion}` : 'FEM-Toolbox offline'}
        </span>
        <span>SI · Anzeige mm</span>
      </footer>
      {boxDialog && (
        <BoxCreator
          busy={!!busy}
          onClose={() => setBoxDialog(false)}
          onCreate={(spec) =>
            void run('Quader erstellen', async () => {
              const project = await window.desktop.createBox(spec);
              if (project) {
                accept(project);
                setBoxDialog(false);
                setModel(newModel(project.mesh));
                setStage('model');
                setDirty(true);
              }
            })
          }
        />
      )}
      {restartDialog && (
        <ModelRestartDialog
          onCancel={() => setRestartDialog(false)}
          onConfirm={() => {
            if (mesh && model && !busy && !pendingJSON) {
              editModel(newModel(mesh, model.physics));
              setStage('model');
              notice(
                'Neuer Modellentwurf erstellt. Bisherige Materialien und Randbedingungen wurden zurückgesetzt.',
              );
            }
            setRestartDialog(false);
          }}
        />
      )}
    </div>
  );
}

function DiagnosticDetails({
  diagnostic,
  canShow,
  onShow,
}: {
  diagnostic: Diagnostic;
  canShow: boolean;
  onShow: (paths: string[]) => void;
}) {
  const paths = [diagnostic.path!, ...diagnostic.related];
  return (
    <div className="diagnostic">
      <span>
        Datenpfad <code>{diagnostic.path}</code>
        {diagnostic.related.length > 0 && (
          <>
            {' '}
            · bezogen auf{' '}
            {diagnostic.related.map((item) => (
              <code key={item}>{item}</code>
            ))}
          </>
        )}
      </span>
      {canShow && <button onClick={() => onShow(paths)}>Eingabe anzeigen</button>}
      <details>
        <summary>Toolbox-Meldung ({diagnostic.code})</summary>
        <code>{diagnostic.detail}</code>
      </details>
    </div>
  );
}
