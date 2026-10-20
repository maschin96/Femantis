#!/usr/bin/env node
// Starts scripts/setup_backend.py with a system Python 3.11–3.13 on every platform (#11).
// `python3` is missing (or a Store stub) on Windows, where the py launcher is reliable.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function setupInterpreters(platform = process.platform, environment = process.env) {
  if (environment.FEMANTIS_SETUP_PYTHON) return [[environment.FEMANTIS_SETUP_PYTHON]];
  return platform === 'win32' ? [['py', '-3'], ['python']] : [['python3'], ['python']];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const script = path.join(root, 'scripts', 'setup_backend.py');
  for (const [command, ...prefix] of setupInterpreters()) {
    const probe = spawnSync(command, [...prefix, '--version'], { encoding: 'utf8' });
    if (probe.error || probe.status !== 0) continue;
    const result = spawnSync(command, [...prefix, script, ...process.argv.slice(2)], {
      cwd: root,
      stdio: 'inherit',
    });
    process.exit(result.status ?? 1);
  }
  console.error(
    'Kein Python 3 gefunden. Python 3.11–3.13 installieren oder FEMANTIS_SETUP_PYTHON setzen.',
  );
  process.exit(1);
}
