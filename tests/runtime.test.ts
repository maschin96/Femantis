import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { runtimeLayout } from '../src/main/runtime';

const checkout = path.resolve('/arbeit/Femantis');
const resources = path.resolve('/Programme/Femantis.app/Contents/Resources');
const userData = path.resolve('/Benutzer/test/Library/Application Support/Femantis');

describe('Laufzeitpfade', () => {
  it('verwendet im Entwicklungscheckout .venv, backend/, examples/ und .cache/runs', () => {
    const layout = runtimeLayout({
      packaged: false,
      appRoot: checkout,
      resourcesPath: resources,
      userData,
      platform: 'darwin',
      env: {},
    });
    expect(layout.backend).toMatchObject({
      python: path.join(checkout, '.venv/bin/python'),
      pythonArgs: [],
      adapter: path.join(checkout, 'backend/adapter.py'),
      cwd: checkout,
    });
    expect(layout.backend.missingRuntime).toContain('npm run setup:backend');
    expect(layout.examples).toBe(path.join(checkout, 'examples'));
    expect(layout.runCache).toBe(path.join(checkout, '.cache/runs'));
  });

  it('verwendet unter Windows die Scripts-Runtime des Checkouts', () => {
    const layout = runtimeLayout({
      packaged: false,
      appRoot: checkout,
      resourcesPath: resources,
      userData,
      platform: 'win32',
      env: {},
    });
    expect(layout.backend.python).toBe(path.join(checkout, '.venv/Scripts/python.exe'));
  });

  it('lädt im Paket Runtime, Adapter und Beispiele aus den App-Ressourcen', () => {
    const layout = runtimeLayout({
      packaged: true,
      appRoot: path.join(resources, 'app.asar'),
      resourcesPath: resources,
      userData,
      platform: 'darwin',
      env: {},
    });
    expect(layout.backend).toMatchObject({
      python: path.join(resources, 'python/bin/python3'),
      adapter: path.join(resources, 'backend/adapter.py'),
      cwd: path.join(resources, 'backend'),
    });
    // Isolate the bundled interpreter from PYTHON* variables and user site-packages
    // and never write bytecode into the signed, read-only bundle.
    expect(layout.backend.pythonArgs).toEqual(['-E', '-s', '-B']);
    expect(layout.backend.missingRuntime).not.toContain('npm');
    expect(layout.examples).toBe(path.join(resources, 'examples'));
  });

  it('legt den Laufcache im Paket außerhalb der App-Ressourcen ab', () => {
    const layout = runtimeLayout({
      packaged: true,
      appRoot: path.join(resources, 'app.asar'),
      resourcesPath: resources,
      userData,
      platform: 'darwin',
      env: {},
    });
    expect(layout.runCache).toBe(path.join(userData, 'runs'));
    expect(path.relative(resources, layout.runCache).startsWith('..')).toBe(true);
  });

  it('übernimmt FEMANTIS_PYTHON ohne Isolationsschalter und FEMANTIS_RUN_CACHE in beiden Layouts', () => {
    for (const packaged of [false, true]) {
      const layout = runtimeLayout({
        packaged,
        appRoot: checkout,
        resourcesPath: resources,
        userData,
        platform: 'darwin',
        env: { FEMANTIS_PYTHON: '/opt/python/bin/python3', FEMANTIS_RUN_CACHE: '/tmp/laeufe' },
      });
      expect(layout.backend.python).toBe('/opt/python/bin/python3');
      expect(layout.backend.pythonArgs).toEqual([]);
      expect(layout.runCache).toBe('/tmp/laeufe');
    }
  });

  it('lehnt einen relativen FEMANTIS_RUN_CACHE ab', () => {
    expect(() =>
      runtimeLayout({
        packaged: true,
        appRoot: checkout,
        resourcesPath: resources,
        userData,
        platform: 'darwin',
        env: { FEMANTIS_RUN_CACHE: 'relativ/runs' },
      }),
    ).toThrow('FEMANTIS_RUN_CACHE muss ein absoluter Pfad sein.');
  });
});
