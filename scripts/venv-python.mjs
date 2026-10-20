#!/usr/bin/env node
// Runs the project's Python environment on every platform (#11): `.venv/bin/python` on
// macOS/Linux, `.venv\Scripts\python.exe` on Windows, or FEMANTIS_PYTHON like the app.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function venvPython(projectRoot, platform = process.platform, environment = process.env) {
  if (environment.FEMANTIS_PYTHON) return environment.FEMANTIS_PYTHON;
  return platform === 'win32'
    ? path.join(projectRoot, '.venv', 'Scripts', 'python.exe')
    : path.join(projectRoot, '.venv', 'bin', 'python');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = spawnSync(venvPython(root), process.argv.slice(2), {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(
      `Python-Umgebung nicht startbar: ${result.error.message}. Bitte npm run setup:backend ausführen.`,
    );
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}
