export interface MeshGroup {
  key: string;
  name: string;
  kind: 'volume' | 'facet';
  members: Uint32Array;
}

export interface MeshPacket {
  bufferSchemaVersion: 1;
  name: string;
  cellType: 'tetra4' | 'tetra10';
  pointCount: number;
  cellCount: number;
  facetCount: number;
  boundaryFaceCount: number;
  triangleCount: number;
  positions: Float64Array;
  triangles: Uint32Array;
  triangleOwners: Uint32Array;
  triangleFacets: Int32Array;
  activeNodes: Uint32Array;
  /** Tet10 only: the six Triangle6 face nodes (corners, edges 01/12/20) per display triangle. */
  triangleFaceNodes?: Uint32Array;
  cellIds: string[];
  facetIds: string[];
  pointIds: string[];
  externalIds: { cells: boolean; facets: boolean; points: boolean };
  groups: MeshGroup[];
}

export interface ViewState {
  mode: 'part' | 'mesh';
  showNodes: boolean;
  showAxes: boolean;
  selectedGroup: string | null;
  hiddenGroups: string[];
  camera: { position: [number, number, number]; target: [number, number, number] } | null;
}

export interface BackendStatus {
  available: boolean;
  pythonVersion?: string;
  toolboxVersion?: string;
  message?: string;
}

export interface OpenedProject {
  name: string;
  path: string | null;
  mesh: MeshPacket;
  view: ViewState;
  model?: ModelDocument | null;
  result?: ResultPacket | null;
}

export type Physics = 'heat' | 'elasticity' | 'electrostatics';
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export interface ModelDocument {
  schema_version: 1;
  units: 'SI';
  physics: Physics;
  materials: Record<string, Record<string, Record<string, JsonValue>>>;
  regions: Record<string, Record<string, string>>;
  boundary?: Record<string, Record<string, JsonValue>[]>;
  loads?: Record<string, Record<string, JsonValue>>;
  mesh?: { path: string; length_scale_to_m: number; length_unit?: string };
  [key: string]: unknown;
}
export interface ResultField {
  id: string;
  unit: string;
  association: 'point' | 'cell';
  components: string[];
  rows: number;
  values: Float64Array;
  activeMask?: Uint32Array;
  atCentroid: boolean;
}
export interface ResultPacket {
  runId: string;
  modelKey: string;
  inputHash: string;
  physics: Physics;
  fields: ResultField[];
  provenanceVerified: boolean;
  provenanceSha256?: string;
  metrics: Record<string, Record<string, unknown>>;
  limitations: string[];
}
/** One retained calculation run as listed in the run history (#7). */
export interface RunSummary {
  id: string;
  /** ISO solve time; null for runs saved before #7. */
  createdAt: string | null;
  physics: Physics;
  /** Toolbox input hash of the solved snapshot (input revision). */
  inputHash: string | null;
  modelKey: string;
  provenanceVerified: boolean;
  /** Where the run's files currently live: the saved project or the local cache. */
  stored: 'project' | 'cache';
}
export interface CacheUsage {
  bytes: number;
  runs: number;
}
export interface RunHistory {
  runs: RunSummary[];
  selectedRunId: string | null;
  cache: CacheUsage;
}
export interface JobEvent {
  phase: 'validating' | 'solving' | 'exporting';
}
export interface BoxDefinition {
  lengths: [number, number, number];
  divisions: [number, number, number];
}

export interface DesktopAPI {
  backendStatus(): Promise<BackendStatus>;
  openMesh(scale: number): Promise<OpenedProject | null>;
  openProject(): Promise<OpenedProject | null>;
  loadExample(kind: 'tet4' | 'tet10'): Promise<OpenedProject | null>;
  saveProject(view: ViewState): Promise<{ path: string; name: string } | null>;
  setDirty(dirty: boolean): Promise<void>;
  createBox(specification: BoxDefinition): Promise<OpenedProject | null>;
  openModel(): Promise<OpenedProject | null>;
  exportModel(document: ModelDocument): Promise<string | null>;
  validateModel(document: ModelDocument): Promise<{ valid: true }>;
  solveModel(document: ModelDocument): Promise<ResultPacket>;
  cancelJob(): Promise<void>;
  onJob(callback: (event: JobEvent) => void): () => void;
  saveWorkspace(
    view: ViewState,
    model: ModelDocument | null,
    runId: string | null,
  ): Promise<{ path: string; name: string } | null>;
  listRuns(): Promise<RunHistory>;
  selectRun(id: string): Promise<ResultPacket>;
  removeRun(id: string): Promise<RunHistory>;
  cleanRunCache(): Promise<{ removed: CacheUsage; history: RunHistory }>;
}

export const defaultView = (): ViewState => ({
  mode: 'mesh',
  showNodes: false,
  showAxes: true,
  selectedGroup: null,
  hiddenGroups: [],
  camera: null,
});
