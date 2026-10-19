import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { backendStartup } from './startup';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
let app: ElectronApplication;
let page: Page;
let folder: string;
let cache: string;
const errors: string[] = [];
test.beforeAll(async () => {
  folder = await mkdtemp(path.join(tmpdir(), 'femantis-runs-desktop-'));
  // An isolated run cache keeps the counts independent of earlier local sessions.
  cache = path.join(folder, 'cache');
  app = await electron.launch({
    args: ['.'],
    cwd: process.cwd(),
    env: { ...process.env, FEMANTIS_RUN_CACHE: cache },
  });
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await expect(page.getByTestId('cell-count')).toHaveText('288', backendStartup);
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1;
  });
});
test.afterAll(async () => {
  if (app) {
    await page.evaluate(() => window.desktop.setDirty(false));
    await app.close();
  }
  await rm(folder, { recursive: true, force: true });
});
const history = () => page.getByRole('region', { name: 'Berechnungsläufe' });
const entries = () => history().locator('li[data-run-id]');
async function calculate() {
  await page.getByRole('button', { name: 'Berechnen', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Ergebnisfeld' })).toHaveValue('temperature_K');
}

test('zwei Läufe unterscheiden, auswählen, speichern, wieder öffnen und bereinigen', async () => {
  await page.getByRole('button', { name: 'Quader erstellen', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Quader erstellen' })
    .getByRole('button', { name: 'Quader erstellen', exact: true })
    .click();
  for (const [index, set, value] of [
    [1, 'x_min', '300'],
    [2, 'x_max', '350'],
  ] as const) {
    await page.getByRole('button', { name: 'Temperatur', exact: true }).click();
    await page.getByLabel(`dirichlet ${index} · Flächengruppe`, { exact: true }).selectOption(set);
    await page.getByLabel(`Temperatur ${index} · Wert [K]`, { exact: true }).fill(value);
  }
  await calculate();
  await expect(entries()).toHaveCount(1);
  const older = await entries().first().getAttribute('data-run-id');
  await page.getByRole('button', { name: /02 Modell/ }).click();
  await page.getByLabel('Temperatur 2 · Wert [K]', { exact: true }).fill('400');
  await calculate();
  await expect(page.locator('.colorbar-labels')).toContainText('400 K');

  await expect(entries()).toHaveCount(2);
  const first = history().locator(`li[data-run-id="${older}"]`);
  const newer = (await entries().evaluateAll((items) => items.map((i) => i.dataset.runId)))
    .filter((id) => id !== older)
    .at(0)!;
  const second = history().locator(`li[data-run-id="${newer}"]`);
  await expect(first).toContainText('Vorheriger Modellstand');
  await expect(second).toContainText('Aktueller Modellstand');
  await expect(second).toContainText('Ausgewählt');
  await expect(first).toContainText(/Eingabe [a-f0-9]{12}/);
  await expect(history()).toContainText('Lokaler Laufcache: 2 Läufe');

  await first.getByRole('button', { name: /anzeigen$/ }).click();
  await expect(first).toContainText('Ausgewählt');
  await expect(page.locator('.colorbar-labels')).toContainText('350 K');
  await expect(page.locator('.result-status')).toContainText('Vorheriger Modellstand');
  await expect(first.getByRole('button', { name: /entfernen$/ })).toBeDisabled();
  await history().scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/run-history.png' });

  // A run directory in the pre-#7 flat layout is unreferenced and may be removed.
  const legacy = path.join(cache, randomUUID());
  await mkdir(legacy);
  await writeFile(path.join(legacy, 'result.vtu'), 'alt');
  await page.getByRole('button', { name: 'Cache bereinigen', exact: true }).click();
  await expect(page.locator('.message-list')).toContainText('Laufcache bereinigt: 1 Lauf');
  await expect(history()).toContainText('Lokaler Laufcache: 2 Läufe');
  await expect(page.locator('.colorbar-labels')).toContainText('350 K');

  const filename = path.join(folder, 'laeufe.femantis.json');
  await app.evaluate(({ dialog }, filename) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename });
  }, filename);
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.locator('.project-title')).toContainText('Gespeichertes Projekt');
  const saved = JSON.parse(await readFile(filename, 'utf8'));
  expect(saved.run.id).toBe(older);
  expect(saved.runs.map((run: { id: string }) => run.id).sort()).toEqual([older, newer].sort());
  // Saved runs now live in the project folder; their cache copies are released.
  await expect(first).toContainText('Im Projekt');
  await expect(history()).toContainText('Lokaler Laufcache: 0 Läufe');

  await app.evaluate(({ dialog }, filename) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
  }, filename);
  await page.getByRole('button', { name: 'Projekt öffnen', exact: true }).click();
  await expect(page.locator('.colorbar-labels')).toContainText('350 K');
  await expect(entries()).toHaveCount(2);
  await expect(first).toContainText('Ausgewählt');
  await expect(first).toContainText('Im Projekt');
  await expect(first).toContainText('Vorheriger Modellstand');
  await expect(second).toContainText('Aktueller Modellstand');

  await second.getByRole('button', { name: /entfernen$/ }).click();
  await expect(entries()).toHaveCount(1);
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect.poll(async () => JSON.parse(await readFile(filename, 'utf8')).runs.length).toBe(1);
  const removed = saved.runs.find((run: { id: string }) => run.id === newer).path;
  expect((await lstat(path.join(folder, removed, 'result.vtu'))).isFile()).toBe(true);
  expect(await readdir(path.join(folder, 'laeufe.femantis.files', 'runs'))).toHaveLength(2);
  expect(errors).toEqual([]);
});
