import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { venvPython } from '../scripts/venv-python.mjs';

describe('Plattformneutraler Aufruf der Projekt-Python-Umgebung', () => {
  it('wählt den venv-Interpreter je Betriebssystem', () => {
    expect(venvPython('/projekt', 'darwin', {})).toBe(
      path.join('/projekt', '.venv', 'bin', 'python'),
    );
    expect(venvPython('/projekt', 'linux', {})).toBe(
      path.join('/projekt', '.venv', 'bin', 'python'),
    );
    expect(venvPython('/projekt', 'win32', {})).toBe(
      path.join('/projekt', '.venv', 'Scripts', 'python.exe'),
    );
  });
  it('respektiert FEMANTIS_PYTHON wie die Desktop-App', () => {
    expect(venvPython('/projekt', 'win32', { FEMANTIS_PYTHON: '/opt/py/bin/python3' })).toBe(
      '/opt/py/bin/python3',
    );
  });
  it('startet die eingerichtete Umgebung und reicht Argumente samt Exitcode durch', () => {
    const output = execFileSync(
      process.execPath,
      ['scripts/venv-python.mjs', '-c', 'import sys, fem_toolbox; print(fem_toolbox.__version__)'],
      { encoding: 'utf8' },
    );
    expect(output.trim()).toBe('1.4.0');
    expect(() =>
      execFileSync(process.execPath, ['scripts/venv-python.mjs', '-c', 'raise SystemExit(3)'], {
        stdio: 'pipe',
      }),
    ).toThrow(expect.objectContaining({ status: 3 }));
  });
});
