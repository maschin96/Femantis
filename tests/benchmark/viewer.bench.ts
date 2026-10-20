/**
 * Viewer benchmark for #8: real Electron/WebGL window, real backend import, no screenshots.
 * Meshes: `npm run benchmark:meshes`. Run: `npm run benchmark:viewer` (FEMANTIS_BENCH_LABEL
 * names the output file, FEMANTIS_BENCH_CASES selects meshes, comma-separated).
 * Frame times come from requestAnimationFrame while each pointer move triggers one render;
 * the display refresh rate caps the result, and Playwright's input round trip is included,
 * so the reported FPS is a conservative lower bound.
 */
import { test, expect, _electron as electron, type Page } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { backendStartup } from '../desktop/startup';

const folder = path.resolve('.cache/viewer-benchmark');
const label = process.env.FEMANTIS_BENCH_LABEL || 'local';
const selected = (process.env.FEMANTIS_BENCH_CASES || 'block-100k,plate-100k')
  .split(',')
  .filter(Boolean);
const report: Record<string, unknown> = {};

const round = (value: number, digits = 1) => Number(value.toFixed(digits));
function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    samples: values.length,
    medianMs: round(at(0.5), 2),
    p95Ms: round(at(0.95), 2),
    maxMs: round(sorted.at(-1) ?? 0, 2),
    fps: round(1000 / at(0.5)),
  };
}
async function lastMeasure(page: Page, name: string) {
  return page.evaluate(
    (name) => performance.getEntriesByName(`femantis:${name}`).at(-1)?.duration ?? null,
    name,
  );
}
async function clearMeasures(page: Page) {
  await page.evaluate(() => performance.clearMeasures());
}
async function settle(page: Page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}
/** Drag across the canvas, one pointer move per animation frame. */
async function rotate(page: Page, steps = 90) {
  const box = (await page.locator('.viewport canvas').first().boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.evaluate(() => {
    const record = { stamps: [] as number[], active: true };
    (window as unknown as { __frames: typeof record }).__frames = record;
    const tick = (time: number) => {
      record.stamps.push(time);
      if (record.active) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= steps; step++) {
    await page.mouse.move(x + 4 * Math.sin(step / 9) * 30, y + 2 * Math.cos(step / 7) * 20);
    await settle(page);
  }
  await page.mouse.up();
  const stamps = await page.evaluate(() => {
    const record = (window as unknown as { __frames: { stamps: number[]; active: boolean } })
      .__frames;
    record.active = false;
    return record.stamps;
  });
  return stats(stamps.slice(1).map((stamp, index) => stamp - stamps[index]));
}
async function memory(page: Page, app: Awaited<ReturnType<typeof electron.launch>>) {
  const heap = await page.evaluate(() => {
    (globalThis as unknown as { gc?: () => void }).gc?.();
    return (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
      ?.usedJSHeapSize;
  });
  const metrics = await app.evaluate(({ app }) =>
    app.getAppMetrics().map((metric) => ({
      type: metric.type,
      workingSetMB: metric.memory.workingSetSize / 1024,
    })),
  );
  const sum = (type: string) =>
    round(metrics.filter((m) => m.type === type).reduce((total, m) => total + m.workingSetMB, 0));
  return {
    rendererHeapMB: heap ? round(heap / 1024 / 1024) : null,
    rendererWorkingSetMB: sum('Tab'),
    gpuProcessWorkingSetMB: sum('GPU'),
    mainWorkingSetMB: sum('Browser'),
  };
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(30 * 60_000);

test('Viewerleistung je Netzgröße', async () => {
  const meshes = JSON.parse(await readFile(path.join(folder, 'meshes.json'), 'utf8'));
  const app = await electron.launch({
    args: ['--js-flags=--expose-gc', '--enable-precise-memory-info', '.'],
    cwd: process.cwd(),
  });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let crashed: (() => void) | null = null;
  const crash = new Promise<void>((resolve) => (crashed = resolve));
  page.on('crash', () => crashed?.());
  await expect(page.getByTestId('cell-count')).toHaveText('288', backendStartup);
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1;
  });
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return info ? gl!.getParameter(info.UNMASKED_RENDERER_WEBGL) : null;
  });
  report.environment = {
    label,
    date: new Date().toISOString(),
    platform: `${os.type()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0]?.model,
    memoryGB: round(os.totalmem() / 1024 ** 3),
    gpu,
    electron: await app.evaluate(() => process.versions.electron),
    chrome: await app.evaluate(() => process.versions.chrome),
    viewport: page.viewportSize() ?? (await page.evaluate(() => [innerWidth, innerHeight])),
    devicePixelRatio: await page.evaluate(() => devicePixelRatio),
  };

  for (const name of selected) {
    const file = path.join(folder, `${name}.vtu`);
    const expectedCells = meshes[name].cells.toLocaleString('de-AT');
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, file);
    await clearMeasures(page);
    const previousErrors = await page.locator('.message.error').count();
    const started = Date.now();
    await page.getByRole('button', { name: 'Netz öffnen', exact: true }).click();
    // A load failure (e.g. a backend timeout) is a measured limit, not a harness error.
    const outcome = await Promise.race([
      expect(page.getByTestId('cell-count'))
        .toHaveText(expectedCells, { timeout: 20 * 60_000 })
        .then(() => null),
      expect(page.locator('.message.error'))
        .toHaveCount(previousErrors + 1, { timeout: 20 * 60_000 })
        .then(async () => (await page.locator('.message.error').first().textContent())!),
      crash.then(() => 'Renderer-Prozess abgestürzt'),
    ]);
    const loadSeconds = (Date.now() - started) / 1000;
    if (outcome !== null) {
      report[name] = {
        cells: meshes[name].cells,
        points: meshes[name].points,
        load: { failedAfterSeconds: round(loadSeconds, 2), message: outcome.trim() },
      };
      console.log(name, JSON.stringify(report[name]));
      if (page.isClosed()) break;
      continue;
    }
    await settle(page);
    const geometry = await page.evaluate(
      () => (performance.getEntriesByName('femantis:geometry').at(-1) as PerformanceMark).detail,
    );
    const result: Record<string, unknown> = {
      cells: meshes[name].cells,
      points: meshes[name].points,
      exteriorFaces: Number(
        (await page.getByTestId('face-count').textContent())!.replace(/\D/g, ''),
      ),
      geometry,
      load: {
        totalSeconds: round(loadSeconds, 2),
        createViewportMs: round((await lastMeasure(page, 'createViewport'))!, 1),
      },
      memoryAfterLoad: await memory(page, app),
    };
    result.rotationMesh = await rotate(page);
    await page.getByRole('button', { name: 'Bauteil', exact: true }).click();
    await settle(page);
    result.switchModeMs = round((await lastMeasure(page, 'setView'))!, 1);
    result.rotationPart = await rotate(page);

    const box = (await page.locator('.viewport canvas').first().boundingBox())!;
    const pickStart = Date.now();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('.inspector')).toContainText('Außenfläche ausgewählt');
    result.pick = {
      endToEndMs: Date.now() - pickStart,
      raycastMs: round((await lastMeasure(page, 'pick'))!, 2),
      highlightMs: round((await lastMeasure(page, 'setSelected'))!, 2),
    };
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Gruppe Vorderhaelfte auswählen', exact: true }).click();
    await settle(page);
    const groups: Record<string, number> = {
      selectVolumeGroupMs: round((await lastMeasure(page, 'setView'))!, 1),
    };
    await page.getByRole('button', { name: 'z_max ausblenden', exact: true }).click();
    await settle(page);
    groups.hideFacetGroupMs = round((await lastMeasure(page, 'setView'))!, 1);
    await page.getByRole('button', { name: 'z_max einblenden', exact: true }).click();
    await page.keyboard.press('Escape');
    await settle(page);
    result.groups = groups;

    if (name === 'block-100k' || name === 'plate-100k') {
      await page.getByRole('button', { name: 'Modell erstellen', exact: true }).click();
      for (const [index, set, value] of [
        [1, 'x_min', '300'],
        [2, 'x_max', '350'],
      ] as const) {
        await page.getByRole('button', { name: 'Temperatur', exact: true }).click();
        await page
          .getByLabel(`dirichlet ${index} · Flächengruppe`, { exact: true })
          .selectOption(set);
        await page.getByLabel(`Temperatur ${index} · Wert [K]`, { exact: true }).fill(value);
      }
      const solveStart = Date.now();
      await page.getByRole('button', { name: 'Berechnen', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Berechnung abbrechen' })).toBeVisible();
      const duringSolve = await rotate(page, 60);
      await expect(page.getByRole('combobox', { name: 'Ergebnisfeld' })).toHaveValue(
        'temperature_K',
        { timeout: 20 * 60_000 },
      );
      const solveSeconds = (Date.now() - solveStart) / 1000;
      await settle(page);
      const field: Record<string, number> = {
        showResultMs: round((await lastMeasure(page, 'setField'))!, 1),
      };
      await page.getByRole('combobox', { name: 'Ergebnisfeld' }).selectOption({ index: 1 }); // first cell field after temperature
      await settle(page);
      field.switchFieldMs = round((await lastMeasure(page, 'setField'))!, 1);
      await page.getByText('Farbskala festlegen').click();
      await page.getByLabel('Skalenmaximum', { exact: true }).fill('1e9');
      await settle(page);
      field.changeLimitsMs = round((await lastMeasure(page, 'setField'))!, 1);
      result.solve = {
        totalSeconds: round(solveSeconds, 2),
        rotationDuringSolve: duringSolve,
      };
      result.field = field;
      result.rotationResult = await rotate(page);
      result.memoryWithResult = await memory(page, app);
    }
    report[name] = result;
    console.log(name, JSON.stringify(result));
  }
  if (!page.isClosed()) await page.evaluate(() => window.desktop.setDirty(false));
  await app.close().catch(() => {});
  expect(errors).toEqual([]);
  await mkdir('Doc/evidence', { recursive: true });
  await writeFile(
    `Doc/evidence/viewer-benchmark-${label}.json`,
    JSON.stringify(report, null, 2) + '\n',
  );
});
