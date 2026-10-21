import { describe, expect, it } from 'vitest';
import { nextStep, stepStates, tabAvailable, type WorkflowState } from '../src/renderer/guidance';

const base: WorkflowState = {
  hasMesh: true,
  hasModel: false,
  hasResult: false,
  stale: false,
  stage: 'mesh',
};

describe('workflow guidance', () => {
  it('asks for a mesh before anything else', () => {
    const step = nextStep({ ...base, hasMesh: false });
    expect(step.action).toBeNull();
    expect(step.title).toBe('Netz laden');
  });

  it('offers model creation once a mesh is loaded', () => {
    expect(nextStep(base).action).toBe('createModel');
  });

  it('leads from a model without result to the calculation', () => {
    expect(nextStep({ ...base, hasModel: true, stage: 'model' }).action).toBe('calculation');
  });

  it('does not offer the current stage as its own next step', () => {
    expect(nextStep({ ...base, hasModel: true, stage: 'calculation' }).action).toBeNull();
    expect(
      nextStep({ ...base, hasModel: true, hasResult: true, stage: 'results' }).action,
    ).toBeNull();
  });

  it('treats a stale result as requiring a new calculation', () => {
    const step = nextStep({
      ...base,
      hasModel: true,
      hasResult: true,
      stale: true,
      stage: 'model',
    });
    expect(step.action).toBe('calculation');
    expect(step.title).toBe('Ergebnis veraltet');
  });

  it('points to a current result from other stages', () => {
    expect(nextStep({ ...base, hasModel: true, hasResult: true, stage: 'model' }).action).toBe(
      'results',
    );
  });

  it('marks completed workflow steps', () => {
    expect(stepStates({ ...base, hasMesh: false })).toEqual({
      mesh: false,
      model: false,
      calculation: false,
      results: false,
    });
    expect(stepStates({ ...base, hasModel: true })).toEqual({
      mesh: true,
      model: true,
      calculation: false,
      results: false,
    });
    expect(stepStates({ ...base, hasModel: true, hasResult: true })).toEqual({
      mesh: true,
      model: true,
      calculation: true,
      results: true,
    });
    expect(stepStates({ ...base, hasModel: true, hasResult: true, stale: true }).calculation).toBe(
      false,
    );
  });
});

describe('ribbon tab availability', () => {
  it('opens a stage tab only once its input exists', () => {
    expect(tabAvailable({ ...base, hasMesh: false }, false)).toEqual({
      mesh: true,
      model: false,
      calculation: false,
      results: false,
    });
    expect(tabAvailable({ ...base, hasModel: true, hasResult: true }, false)).toEqual({
      mesh: true,
      model: true,
      calculation: true,
      results: true,
    });
  });

  it('locks every stage tab while a job runs or a JSON draft is unapplied', () => {
    expect(Object.values(tabAvailable({ ...base, hasModel: true, hasResult: true }, true))).toEqual(
      [false, false, false, false],
    );
  });
});
