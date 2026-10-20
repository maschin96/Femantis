import path from 'node:path';

/** How the main process starts the Python adapter. */
export interface BackendRuntime {
  python: string;
  pythonArgs: string[];
  adapter: string;
  cwd: string;
  /** Actionable message when the interpreter cannot be started. */
  missingRuntime: string;
}

export interface RuntimeLayout {
  backend: BackendRuntime;
  examples: string;
  runCache: string;
}

export interface RuntimeOptions {
  /** `app.isPackaged`: true for the distributed app bundle. */
  packaged: boolean;
  /** Development checkout root (unused for packaged apps). */
  appRoot: string;
  /** `process.resourcesPath`: read-only resources of the app bundle. */
  resourcesPath: string;
  /** `app.getPath('userData')`: writable per-user application data. */
  userData: string;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
}

/**
 * Resolve backend, examples and run cache. A development checkout uses `.venv`,
 * `backend/`, `examples/` and `.cache/runs` below the repository; a packaged app
 * reads the bundled CPython, adapter and examples from its resources and keeps
 * writable data in the user data directory, outside the signed bundle.
 */
export function runtimeLayout(options: RuntimeOptions): RuntimeLayout {
  const { packaged, appRoot, resourcesPath, userData, platform, env } = options;
  const configuredCache = env.FEMANTIS_RUN_CACHE;
  if (configuredCache && !path.isAbsolute(configuredCache))
    throw new Error('FEMANTIS_RUN_CACHE muss ein absoluter Pfad sein.');
  const configuredPython = env.FEMANTIS_PYTHON;
  if (!packaged)
    return {
      backend: {
        python:
          configuredPython ||
          path.join(appRoot, '.venv', platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
        pythonArgs: [],
        adapter: path.join(appRoot, 'backend/adapter.py'),
        cwd: appRoot,
        missingRuntime:
          'Python-Umgebung nicht verfügbar. Bitte npm run setup:backend ausführen oder FEMANTIS_PYTHON setzen.',
      },
      examples: path.join(appRoot, 'examples'),
      runCache: configuredCache || path.join(appRoot, '.cache/runs'),
    };
  const backend = path.join(resourcesPath, 'backend');
  return {
    backend: {
      python:
        configuredPython ||
        path.join(resourcesPath, 'python', platform === 'win32' ? 'python.exe' : 'bin/python3'),
      // -E/-s: no PYTHON* variables or user site-packages leak into the bundled
      // runtime; -B: no bytecode writes into the read-only, signed bundle; -X utf8
      // replaces PYTHONUTF8, which -E ignores (#11).
      pythonArgs: configuredPython ? [] : ['-E', '-s', '-B', '-X', 'utf8'],
      adapter: path.join(backend, 'adapter.py'),
      cwd: backend,
      missingRuntime:
        'Die mitgelieferte Python-Laufzeit konnte nicht gestartet werden. Bitte Femantis neu installieren.',
    },
    examples: path.join(resourcesPath, 'examples'),
    runCache: configuredCache || path.join(userData, 'runs'),
  };
}

/** Backend of a development checkout, e.g. for tests and scripts. */
export function developmentBackend(
  appRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): BackendRuntime {
  return runtimeLayout({
    packaged: false,
    appRoot,
    resourcesPath: appRoot,
    userData: appRoot,
    platform: process.platform,
    env: { FEMANTIS_PYTHON: env.FEMANTIS_PYTHON },
  }).backend;
}
