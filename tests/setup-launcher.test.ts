import { describe, expect, it } from 'vitest';
import { setupInterpreters } from '../scripts/setup-backend.mjs';

describe('Interpreterwahl für npm run setup:backend', () => {
  it('nutzt unter Windows den py-Launcher vor python, sonst python3', () => {
    expect(setupInterpreters('win32', {})).toEqual([['py', '-3'], ['python']]);
    expect(setupInterpreters('linux', {})).toEqual([['python3'], ['python']]);
    expect(setupInterpreters('darwin', {})).toEqual([['python3'], ['python']]);
  });
  it('bevorzugt einen ausdrücklich gesetzten Interpreter', () => {
    expect(
      setupInterpreters('win32', { FEMANTIS_SETUP_PYTHON: 'C:\\Python313\\python.exe' }),
    ).toEqual([['C:\\Python313\\python.exe']]);
  });
});
