import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleDot,
  Eye,
  EyeOff,
  FileBox,
  FolderOpen,
  Grid2X2,
  Layers,
  LoaderCircle,
  MousePointer2,
  Move3D,
  RefreshCw,
  RotateCcw,
  Ruler,
  Save,
  Sparkles,
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
import { actionLabels, nextStep, stepStates, type GuidanceAction, type Stage } from './guidance';

const number = (value: number) => value.toLocaleString('de-AT');
const length = (value: number) =>
  `${(value * 1000).toLocaleString('de-AT', { maximumFractionDigits: 3 })} mm`;
type Notice = { time: string; kind: 'info' | 'error'; message: string; diagnostic?: Diagnostic };
const stages: [Stage, string][] = [
  ['mesh', 'Netz & Bauteil'],
  ['model', 'Modell'],
  ['calculation', 'Berechnung'],
  ['results', 'Ergebnisse'],
];

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
  const [stage, setStage] = useState<Stage>('mesh');
  const [consoleOpen, setConsoleOpen] = useState(true);
  const [collapsed, setCollapsed] = useState<('volume' | 'facet')[]>([]);
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
    // Errors must stay visible even when the console was collapsed.
    if (kind === 'error') setConsoleOpen(true);
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

  const workflow = {
    hasMesh: !!mesh,
    hasModel: !!model,
    hasResult: !!result,
    stale,
    stage,
  };
  const guidance = nextStep(workflow);
  const completed = stepStates(workflow);
  const locked = !!busy || pendingJSON;
  const errorCount = notices.filter((item) => item.kind === 'error').length;
  const groupCount = (kind: 'volume' | 'facet') =>
    mesh?.groups.filter((group) => group.kind === kind).length || 0;
  function runGuidance(action: GuidanceAction) {
    if (action === 'createModel') createModel();
    else setStage(action);
  }

  return (
    <div className="app">
      <header className="topbar glass">
        <Logo />
        <div className="project-title">
          <span>
            {projectName}
            {dirty && (
              <b
                className="dirty-dot"
                title="Ungespeicherte Änderungen"
                aria-label="Ungespeichert"
              />
            )}
          </span>
          <small>{projectPath ? 'Gespeichertes Projekt' : 'Lokaler Arbeitsbereich'}</small>
        </div>
        <nav className="workflow" aria-label="Arbeitsablauf">
          {stages.map(([tab, label], index) => (
            <button
              key={tab}
              className={`step ${stage === tab ? 'active' : ''} ${completed[tab] ? 'done' : ''}`}
              aria-current={stage === tab ? 'step' : undefined}
              disabled={
                locked ||
                (tab === 'model' && !model) ||
                (tab === 'calculation' && !model) ||
                (tab === 'results' && !result)
              }
              onClick={() => setStage(tab)}
            >
              <span className="step-index">0{index + 1}</span>
              <span className="step-label">{label}</span>
              {completed[tab] && <span className="sr-only"> · erledigt</span>}
            </button>
          ))}
        </nav>
        <div className="header-actions">
          <button
            className="glass-button"
            disabled={locked}
            title="Projekt öffnen"
            onClick={() =>
              void run('Projekt öffnen', async () => accept(await window.desktop.openProject()))
            }
          >
            <FolderOpen size={15} />
            Projekt öffnen
          </button>
          <button
            className="primary"
            disabled={!mesh || locked}
            title="Speichern (⌘S)"
            onClick={() => void save()}
          >
            <Save size={15} />
            Speichern
          </button>
        </div>
      </header>
      <main className="workspace">
        <aside className="sidebar glass" aria-label="Projekt">
          <div className="panel-heading">
            <span>Projekt</span>
            <Layers size={14} />
          </div>
          <div className="project-root">
            <FileBox size={17} />
            <span>{projectName}</span>
          </div>
          <div className="sidebar-section">
            <button
              className="tree-row mesh-row"
              onClick={() => {
                setSelectedTriangle(null);
                changeView({ selectedGroup: null });
              }}
              disabled={!mesh}
            >
              <Box size={16} />
              <span>{mesh?.name || 'Kein Netz geladen'}</span>
              {mesh && (
                <span className="tree-tag">{mesh.cellType === 'tetra4' ? 'Tet4' : 'Tet10'}</span>
              )}
            </button>
            {(['volume', 'facet'] as const).map((kind) => (
              <div className="group-block" key={kind}>
                <button
                  className="group-heading"
                  aria-expanded={!collapsed.includes(kind)}
                  onClick={() =>
                    setCollapsed((previous) =>
                      previous.includes(kind)
                        ? previous.filter((item) => item !== kind)
                        : [...previous, kind],
                    )
                  }
                >
                  {collapsed.includes(kind) ? (
                    <ChevronRight size={13} />
                  ) : (
                    <ChevronDown size={13} />
                  )}
                  {kind === 'volume' ? 'Volumengruppen' : 'Flächengruppen'}
                  <span>{groupCount(kind)}</span>
                </button>
                {!collapsed.includes(kind) &&
                  mesh?.groups
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
                          {kind === 'volume' ? <Box size={13} /> : <Triangle size={13} />}
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
                {!collapsed.includes(kind) && mesh && groupCount(kind) === 0 && (
                  <div className="group-empty">Keine benannten Gruppen</div>
                )}
              </div>
            ))}
          </div>
          <div className="source-card">
            <div className="section-label">Netz laden</div>
            <div className="import-row">
              <label className="unit-label">
                <span>Gmsh-Einheit</span>
                <select
                  aria-label="Gmsh-Längeneinheit"
                  value={scale}
                  disabled={locked}
                  onChange={(event) => setScale(Number(event.target.value))}
                >
                  <option value={1}>m</option>
                  <option value={0.001}>mm</option>
                </select>
              </label>
              <button
                className="primary"
                disabled={locked || !backend.available}
                title="Gmsh (.msh) oder VTU (.vtu) öffnen"
                onClick={() =>
                  void run('Netz importieren', async () =>
                    accept(await window.desktop.openMesh(scale)),
                  )
                }
              >
                <ArrowDownToLine size={15} />
                Netz öffnen
              </button>
            </div>
            <small>Gmsh .msh oder VTU .vtu · VTU-Koordinaten in m.</small>
            <button
              className="source-action"
              disabled={locked || !backend.available}
              onClick={() => setBoxDialog(true)}
            >
              <Box size={15} />
              Quader erstellen
              <ChevronRight size={13} />
            </button>
            <div className="section-label examples-label">Beispiele</div>
            <button
              className="source-action"
              disabled={locked || !backend.available}
              onClick={() =>
                void run('Tet4-Beispiel laden', async () =>
                  accept(await window.desktop.loadExample('tet4')),
                )
              }
            >
              <Box size={15} />
              Kragträger · Tet4
              <ChevronRight size={13} />
            </button>
            <button
              className="source-action"
              disabled={locked || !backend.available}
              onClick={() =>
                void run('Tet10-Beispiel laden', async () =>
                  accept(await window.desktop.loadExample('tet10')),
                )
              }
            >
              <Grid2X2 size={15} />
              Tetraeder · Tet10
              <ChevronRight size={13} />
            </button>
          </div>
        </aside>
        <section className="viewer-panel glass">
          <div className="viewer-toolbar">
            <div className="segmented" role="group" aria-label="Darstellung">
              <button
                className={view.mode === 'part' ? 'active' : ''}
                disabled={locked}
                onClick={() => {
                  changeView({ mode: 'part' });
                  if (stage === 'model' || stage === 'calculation') setStage('mesh');
                }}
              >
                <Box size={15} />
                Bauteil
              </button>
              <button
                className={view.mode === 'mesh' ? 'active' : ''}
                disabled={locked}
                onClick={() => {
                  changeView({ mode: 'mesh' });
                  if (stage === 'model' || stage === 'calculation') setStage('mesh');
                }}
              >
                <Grid2X2 size={15} />
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
                <CircleDot size={14} />
                Knoten
              </button>
              <button
                className={view.showAxes ? 'on' : ''}
                aria-pressed={view.showAxes}
                disabled={!mesh}
                onClick={() => changeView({ showAxes: !view.showAxes })}
              >
                <Move3D size={14} />
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
              <div className="calculation-card">
                <span className="eyebrow">FEM-Toolbox · stationär</span>
                <h2>Modell berechnen</h2>
                <p>
                  {physicsLabels[model.physics]} · {number(mesh?.cellCount || 0)} Elemente
                </p>
                <ol className="calculation-phases">
                  {(['validating', 'solving', 'exporting'] as const).map((p, i) => (
                    <li className={phase === p ? 'current' : ''} key={p}>
                      <span>{i + 1}</span>
                      {
                        [
                          'Modell und Randbedingungen prüfen',
                          'System aufstellen und lösen',
                          'Rohfelder und Bilanzen exportieren',
                        ][i]
                      }
                      {phase === p && <LoaderCircle className="spin" size={16} />}
                    </li>
                  ))}
                </ol>
                {busy ? (
                  <button
                    className="cancel-calculation"
                    onClick={() => void window.desktop.cancelJob()}
                  >
                    <X size={15} />
                    Berechnung abbrechen
                  </button>
                ) : (
                  <button className="primary large" onClick={() => void calculate()}>
                    <Play size={15} />
                    Berechnen
                  </button>
                )}
                <p className="editor-hint">
                  Die Oberfläche bleibt während der Berechnung bedienbar. Ein erfolgreicher
                  Solverlauf ist kein experimenteller Validierungsnachweis.
                </p>
              </div>
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
              <div>
                <LoaderCircle className="spin" size={20} />
                <span>{busy}…</span>
              </div>
            </div>
          )}
        </section>
        <aside className="inspector glass" aria-label="Eigenschaften">
          <section className="next-step" aria-label="Nächster Schritt">
            <span className="eyebrow">
              <Sparkles size={12} />
              Nächster Schritt
            </span>
            <h4>{guidance.title}</h4>
            <p>{guidance.text}</p>
            {(guidance.action || model) && (
              <div className="next-step-actions">
                {guidance.action && (
                  <button
                    className="primary"
                    disabled={locked}
                    onClick={() => runGuidance(guidance.action!)}
                  >
                    {guidance.action === 'createModel' ? (
                      <Plus size={15} />
                    ) : guidance.action === 'calculation' ? (
                      <Play size={14} />
                    ) : (
                      <CheckCircle2 size={15} />
                    )}
                    {actionLabels[guidance.action]}
                  </button>
                )}
                {model && (
                  <button className="glass-button" disabled={!mesh || locked} onClick={createModel}>
                    <RotateCcw size={14} />
                    Modell neu erstellen
                  </button>
                )}
              </div>
            )}
          </section>
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

          <div className="inspector-section">
            <div className="section-title">
              <MousePointer2 size={14} />
              <h3>Auswahl</h3>
              {(selectedTriangle !== null || selectedGroup) && (
                <button
                  title="Auswahl aufheben (Esc)"
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
                Gruppe im Projektbaum oder Fläche in der 3D-Ansicht wählen.
              </div>
            )}
          </div>
          <div className="inspector-section">
            <div className="section-title">
              <Grid2X2 size={14} />
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
              <Ruler size={14} />
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
        </aside>
      </main>
      <section className={`dock glass ${consoleOpen ? 'open' : ''}`} aria-label="Meldungen">
        <div className="dock-bar">
          <span className="dock-status">
            <i className={backend.available ? 'status-dot ready' : 'status-dot'} />
            {busy || (backend.available ? 'Bereit' : 'Anbindung fehlt')}
          </span>
          <div className="segmented small" role="group" aria-label="Meldungsfilter">
            <button className={logTab === 'all' ? 'active' : ''} onClick={() => setLogTab('all')}>
              Meldungen <span>{notices.length}</span>
            </button>
            <button
              className={`${logTab === 'errors' ? 'active' : ''} ${errorCount ? 'has-errors' : ''}`}
              onClick={() => {
                setLogTab('errors');
                setConsoleOpen(true);
              }}
            >
              Fehler <span>{errorCount}</span>
            </button>
          </div>
          {!consoleOpen && notices[0] && (
            <span className={`dock-latest ${notices[0].kind}`}>{notices[0].message}</span>
          )}
          <span className="dock-meta">
            {mesh
              ? `${number(mesh.cellCount)} Elemente · ${number(mesh.pointCount)} Knoten`
              : 'Kein Netz'}
            <span>·</span>
            {backend.available ? `FEM-Toolbox ${backend.toolboxVersion}` : 'FEM-Toolbox offline'}
            <span>·</span>
            SI · Anzeige mm
          </span>
          <button
            className="check-backend"
            disabled={locked}
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
          <button
            className="dock-toggle"
            aria-expanded={consoleOpen}
            aria-controls="message-log"
            aria-label={consoleOpen ? 'Meldungen einklappen' : 'Meldungen ausklappen'}
            title={consoleOpen ? 'Meldungen einklappen' : 'Meldungen ausklappen'}
            onClick={() => setConsoleOpen(!consoleOpen)}
          >
            {consoleOpen ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
          </button>
        </div>
        <div className="message-list" id="message-log" role="log" hidden={!consoleOpen}>
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
