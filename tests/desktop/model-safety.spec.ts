import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { backendStartup, chromiumArgs } from './startup';
import { mkdtemp, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

let app: ElectronApplication;
let page: Page;
let folder: string;
const errors: string[] = [];
test.beforeAll(async () => {
  folder = await mkdtemp(path.join(tmpdir(), 'femantis-model-safety-'));
  app = await electron.launch({ args: ['.', ...chromiumArgs], cwd: process.cwd() });
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.getByTestId('cell-count')).toHaveText('288', backendStartup);
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1;
  });
  await page.getByRole('button', { name: 'Modell erstellen', exact: true }).click();
  await page.getByLabel('Physik', { exact: true }).selectOption('elasticity');
  await page.getByLabel('Werkstoff · E-Modul [GPa]', { exact: true }).fill('123');
});
test.afterAll(async () => {
  if (app) {
    await page.evaluate(() => window.desktop.setDirty(false));
    await app.close();
  }
  await rm(folder, { recursive: true, force: true });
});

test('JSON-Ablehnung erhält den Entwurf und meldet korrigierbare Datenpfade', async () => {
  await page
    .getByRole('button', { name: 'Vollständigen Model-Datensatz bearbeiten', exact: true })
    .click();
  const input = page.getByLabel('Vollständiger Model-Datensatz', { exact: true });
  const original = JSON.parse(await input.inputValue());
  for (const value of [null, [], [1, 2], [1, 2, 3, 4]]) {
    const invalid = structuredClone(original);
    invalid.boundary.traction = [{ set: 'Stirnflaeche', value, unit: 'N/m^2' }];
    await input.fill(JSON.stringify(invalid));
    await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('boundary.traction[0].value');
    await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled();
  }
  const missing = structuredClone(original);
  delete missing.materials.u;
  await input.fill(JSON.stringify(missing));
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('materials.u');
  await page.getByRole('button', { name: 'Textentwurf verwerfen', exact: true }).click();
  await expect(input).toHaveValue(JSON.stringify(original, null, 2));
  await expect(page.getByLabel('Werkstoff · E-Modul [GPa]', { exact: true })).toHaveValue('123');
  original.boundary.dirichlet = [
    { field: 'u', nodes: [0, 1], components: ['x', 'z'], value: [1, 2, 3, 4], unit: 'm' },
  ];
  await input.fill(JSON.stringify(original));
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toBeEnabled();
  expect(JSON.parse(await input.inputValue())).toEqual(original);
  expect(errors).toEqual([]);
});

test('Projektöffnung weist ungültiges Modell vor Änderung des Arbeitsstands ab', async () => {
  const filename = path.join(folder, 'valid.femantis.json');
  await app.evaluate(({ dialog }, filename) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename });
  }, filename);
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.locator('.project-title')).toContainText('Gespeichertes Projekt');
  const saved = JSON.parse(await readFile(filename, 'utf8'));
  saved.model.loads = { body_force: { value: null, unit: 'N/m^3' } };
  const bad = path.join(folder, 'bad.femantis.json');
  await writeFile(bad, JSON.stringify(saved));
  await app.evaluate(({ dialog }, bad) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [bad] });
  }, bad);
  await page.getByRole('button', { name: 'Projekt öffnen', exact: true }).click();
  await expect(page.locator('.message-list')).toContainText('loads.body_force.value');
  await expect(page.getByLabel('Werkstoff · E-Modul [GPa]', { exact: true })).toHaveValue('123');
  // A subsequent save must still target the previously opened workspace.
  await page.getByLabel('Werkstoff · E-Modul [GPa]', { exact: true }).fill('124');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect
    .poll(
      async () => JSON.parse(await readFile(filename, 'utf8')).model.materials.u.Werkstoff.young,
    )
    .toBe(124);
  expect(JSON.parse(await readFile(bad, 'utf8')).model.loads.body_force.value).toBeNull();
  expect(errors).toEqual([]);
});

test('TOML-Import meldet fehlende aktive Tabellen und erhält das bisherige Modell', async () => {
  const filename = path.join(folder, 'invalid.toml');
  await copyFile('examples/cantilever.msh', path.join(folder, 'mesh.msh'));
  await writeFile(
    filename,
    `schema_version = 1\nunits = "SI"\nphysics = "elasticity"\n[mesh]\npath = "mesh.msh"\n[materials]\n[regions.u]\nBasis = "Werkstoff"\n`,
  );
  await app.evaluate(({ dialog }, filename) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
  }, filename);
  await page.getByRole('button', { name: 'TOML öffnen', exact: true }).click();
  await expect(page.locator('.message-list')).toContainText('materials.u');
  await expect(page.getByLabel('Werkstoff · E-Modul [GPa]', { exact: true })).toHaveValue('124');
  expect(errors).toEqual([]);
});
