import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { build } from 'vite';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let app: ElectronApplication;
let page: Page;
let directory: string;
const errors: string[] = [];
test.beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'femantis-field-pixels-'));
  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      outDir: directory,
      emptyOutDir: false,
      lib: {
        entry: path.resolve('tests/fixtures/field-pixels.ts'),
        formats: ['iife'],
        name: 'FieldPixels',
        fileName: () => 'probe.js',
      },
    },
  });
  const filename = path.join(directory, 'probe.html');
  await writeFile(
    filename,
    '<!doctype html><meta charset="utf-8"><script defer src="probe.js"></script>',
  );
  const entry = path.join(directory, 'main.cjs');
  await writeFile(
    entry,
    `const { app, BrowserWindow } = require('electron');
    app.whenReady().then(() => {
      const window = new BrowserWindow({ width: 700, height: 750,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
      window.loadFile(${JSON.stringify(filename)});
    });
    app.on('window-all-closed', () => app.quit());`,
  );
  app = await electron.launch({ args: [entry], cwd: process.cwd() });
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.waitForFunction(() => 'sampleField' in window);
});
test.afterAll(async () => {
  if (app) {
    await app.close();
  }
  await rm(directory, { recursive: true, force: true });
});

type Spec = {
  values: number[];
  association?: 'point' | 'cell';
  limits?: [number, number];
  mask?: number[];
  samples: [number, number][];
};
async function sample(spec: Spec) {
  return page.evaluate(
    (spec) =>
      (
        window as unknown as {
          sampleField: (spec: Spec) => { pixels: number[][]; raw: number[]; error: number };
        }
      ).sampleField(spec),
    spec,
  );
}
function color(actual: number[], expected: number[]) {
  // Three 8-bit levels cover pixel-center interpolation and final sRGB quantization.
  for (let channel = 0; channel < 3; channel++)
    expect(Math.abs(actual[channel] - expected[channel])).toBeLessThanOrEqual(3);
  expect(actual[3]).toBe(255);
}
test('kleine Unterschiede auf großem Grundwert erhalten ihre unabhängigen Viridis-Farben', async () => {
  const values = [300, 300.000001, 300.000001, 300];
  const result = await sample({
    values,
    samples: [
      [-0.5, 0],
      [0.5, 0],
    ],
  });
  color(result.pixels[0], [59, 82, 139]);
  color(result.pixels[1], [94, 201, 98]);
  expect(result.raw).toEqual(values);
  expect(result.error).toBe(0);
});
test('konstante positive, negative und Nullfelder verwenden die mittlere Farbe', async () => {
  for (const value of [300, -300, 0]) {
    const result = await sample({ values: [value, value, value, value], samples: [[0, 0.25]] });
    color(result.pixels[0], [33, 145, 140]);
    expect(result.error).toBe(0);
  }
});
test('enge benutzerdefinierte Skala begrenzt erst nach der Interpolation', async () => {
  const result = await sample({
    values: [299.999999, 300.000002, 300.000002, 299.999999],
    limits: [300, 300.000001],
    samples: [
      [-0.5, 0],
      [0.5, 0],
    ],
  });
  color(result.pixels[0], [68, 1, 84]);
  color(result.pixels[1], [253, 231, 37]);
});
test('Tet10-Knotenfelder folgen den quadratischen Triangle6-Formfunktionen', async () => {
  // Corners 0, midsides 1: f = 4(λ0λ1 + λ1λ2 + λ2λ0). Scale [0, 4/3]:
  // centroid t = 1 (linear sub-triangles: 0.75); λ = (1/6, 1/6, 2/3) t = 0.75 (linear: 0.5).
  const result = await page.evaluate(() =>
    (
      window as unknown as {
        sampleQuadratic: (spec: {
          values: number[];
          limits: [number, number];
          samples: [number, number][];
        }) => { pixels: number[][]; error: number };
      }
    ).sampleQuadratic({
      values: [0, 0, 0, 1, 1, 1],
      limits: [0, 4 / 3],
      samples: [
        [-1 / 3, -1 / 3],
        [-2 / 3, 1 / 3],
      ],
    }),
  );
  color(result.pixels[0], [253, 231, 37]);
  color(result.pixels[1], [94, 201, 98]);
  expect(result.error).toBe(0);
});
test('maskierte Knoten entfernen die betroffene Fläche; Zellwerte bleiben ungeglättet', async () => {
  const masked = await sample({
    values: [300, 300.000001, 300.000001, 300],
    mask: [1, 0, 1, 1],
    samples: [
      [0.5, -0.5],
      [-0.5, 0.5],
    ],
  });
  color(masked.pixels[0], [244, 247, 248]);
  color(masked.pixels[1], [59, 82, 139]);
  const cells = await sample({
    values: [300, 300.000001],
    association: 'cell',
    samples: [
      [0.5, -0.5],
      [-0.5, 0.5],
    ],
  });
  color(cells.pixels[0], [68, 1, 84]);
  color(cells.pixels[1], [253, 231, 37]);
  expect(errors).toEqual([]);
});
