export type Stage = 'mesh' | 'model' | 'calculation' | 'results';
export type GuidanceAction = 'createModel' | 'calculation' | 'results';

export interface WorkflowState {
  hasMesh: boolean;
  hasModel: boolean;
  hasResult: boolean;
  /** A result exists but belongs to an earlier model state. */
  stale: boolean;
  stage: Stage;
}

export interface NextStep {
  title: string;
  text: string;
  action: GuidanceAction | null;
}

export const actionLabels: Record<GuidanceAction, string> = {
  createModel: 'Modell erstellen',
  calculation: 'Zur Berechnung',
  results: 'Ergebnisse ansehen',
};

/** The single recommended action for the current workflow state; never the current stage. */
export function nextStep(state: WorkflowState): NextStep {
  if (!state.hasMesh)
    return {
      title: 'Netz laden',
      text: 'Ein Gmsh- oder VTU-Netz öffnen, einen Quader erzeugen oder ein Beispiel laden.',
      action: null,
    };
  if (!state.hasModel)
    return {
      title: 'Modell anlegen',
      text: 'Physik wählen, Materialien den Volumengruppen zuordnen und Randbedingungen festlegen.',
      action: 'createModel',
    };
  if (state.hasResult && !state.stale)
    return state.stage === 'results'
      ? {
          title: 'Ergebnis auswerten',
          text: 'Feld und Komponente wählen, Flächen anklicken und Werte im Inspector ablesen.',
          action: null,
        }
      : {
          title: 'Ergebnis liegt vor',
          text: 'Das Ergebnis gehört zum aktuellen Modellstand.',
          action: 'results',
        };
  const title = state.hasResult ? 'Ergebnis veraltet' : 'Modell berechnen';
  return state.stage === 'calculation'
    ? {
        title,
        text: 'Die Berechnung prüft das Modell zuerst und meldet Eingabefehler mit Datenpfad.',
        action: null,
      }
    : {
        title,
        text: state.hasResult
          ? 'Das Modell wurde seit der letzten Berechnung geändert.'
          : 'Eingaben prüfen und die stationäre Lösung mit der FEM-Toolbox berechnen.',
        action: 'calculation',
      };
}

/** Which workflow steps are complete; a stale result does not complete the calculation. */
export function stepStates(state: WorkflowState): Record<Stage, boolean> {
  const current = state.hasResult && !state.stale;
  return {
    mesh: state.hasMesh,
    model: state.hasMesh && state.hasModel,
    calculation: current,
    results: current,
  };
}

/**
 * Which stage tabs of the ribbon can be opened. The model and calculation tabs need a
 * model, the results tab a result; every stage tab is locked while a job runs or an
 * unapplied JSON draft blocks conflicting operations.
 */
export function tabAvailable(state: WorkflowState, locked: boolean): Record<Stage, boolean> {
  return {
    mesh: !locked,
    model: !locked && state.hasModel,
    calculation: !locked && state.hasModel,
    results: !locked && state.hasResult,
  };
}
