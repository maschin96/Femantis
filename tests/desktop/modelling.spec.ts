import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { backendStartup, chromiumArgs } from './startup';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
let app: ElectronApplication;
let page: Page;
let folder: string;
const errors: string[] = [];
test.beforeAll(async () => {
  folder = await mkdtemp(path.join(tmpdir(), 'femantis-modelling-desktop-'));
  app = await electron.launch({ args: ['.', ...chromiumArgs], cwd: process.cwd() });
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
async function showModel() {
  await page.getByRole('button', { name: /02 Modell/ }).click();
}
async function addTemperature(index: number, set: string, value: string) {
  await page.getByRole('button', { name: 'Temperatur', exact: true }).click();
  await page.getByLabel(`dirichlet ${index} · Flächengruppe`, { exact: true }).selectOption(set);
  await page.getByLabel(`Temperatur ${index} · Wert [K]`, { exact: true }).fill(value);
}
async function calculate(primary: string) {
  await page.getByRole('button', { name: 'Berechnen', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Ergebnisfeld' })).toHaveValue(primary);
  await expect(page.locator('.result-status')).toContainText('Aktueller Modellstand');
  await expect(page.locator('.viewport canvas')).toBeVisible();
  expect(errors).toEqual([]);
}

test('Quader und Wärmemodell erstellen, prüfen und mit Feldansicht berechnen', async () => {
  await page.getByRole('button', { name: 'Quader erstellen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Quader erstellen' });
  await dialog.getByLabel('X Teilungen', { exact: true }).fill('4');
  await dialog.getByRole('button', { name: 'Quader erstellen', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Physik' })).toHaveValue('heat');
  await addTemperature(1, 'x_min', '300');
  await addTemperature(2, 'x_max', '350');
  await page.getByRole('button', { name: 'Modell prüfen', exact: true }).click();
  await expect(page.locator('.message-list')).toContainText('Modellprüfung bestanden');
  await page.locator('.model-editor').evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({ path: 'test-results/model-editor.png' });
  await calculate('temperature_K');
  await expect(page.locator('.colorbar-labels')).toContainText('300 K');
  await expect(page.locator('.colorbar-labels')).toContainText('350 K');
  await page.screenshot({ path: 'test-results/heat-result.png' });
});
test('Modelländerung kennzeichnet ältere Ergebnisse; Entwurf und Lauf bleiben gespeichert', async () => {
  await showModel();
  await page.getByLabel('Werkstoff · Leitfähigkeit [W/(m K)]', { exact: true }).fill('5');
  await page.getByRole('button', { name: /04 Ergebnisse/ }).click();
  await expect(page.locator('.result-status')).toContainText('Vorheriger Modellstand');
  const filename = path.join(folder, 'waerme.femantis.json');
  await app.evaluate(({ dialog }, filename) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename });
  }, filename);
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.locator('.project-title')).toContainText('Gespeichertes Projekt');
  const document = JSON.parse(await readFile(filename, 'utf8'));
  expect(document.schemaVersion).toBe(2);
  expect(document.model.materials.T.Werkstoff.conductivity).toBe(5);
  expect(document.run.id).toBeTruthy();
  expect(document.run.provenanceSha256).toMatch(/^[a-f0-9]{64}$/);
  await app.evaluate(({ dialog }, filename) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
  }, filename);
  await page.getByRole('button', { name: 'Projekt öffnen', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Ergebnisfeld' })).toHaveValue('temperature_K');
  await expect(page.locator('.result-status')).toContainText('Vorheriger Modellstand');
  await showModel();
  await calculate('temperature_K');
});
test('beschädigten Lauf vor der Anzeige abweisen', async () => {
  const filename = path.join(folder, 'waerme.femantis.json');
  const document = JSON.parse(await readFile(filename, 'utf8'));
  const manifest = path.join(folder, document.run.path, 'result.json');
  const result = JSON.parse(await readFile(manifest, 'utf8'));
  result.physics = 'elasticity';
  await writeFile(manifest, JSON.stringify(result));
  await app.evaluate(({ dialog }, filename) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
  }, filename);
  await page.getByRole('button', { name: 'Projekt öffnen', exact: true }).click();
  await expect(page.locator('.message-list')).toContainText('result.json wurde verändert');
  await expect(page.getByRole('combobox', { name: 'Ergebnisfeld' })).toHaveValue('temperature_K');
  await expect(page.locator('.result-status')).toContainText('Aktueller Modellstand');
});
test('Elektrostatik aus dem gleichen Netz bearbeiten und berechnen', async () => {
  await showModel();
  await page.getByRole('combobox', { name: 'Physik' }).selectOption('electrostatics');
  for (const [index, set, value] of [
    [1, 'x_min', '0'],
    [2, 'x_max', '10'],
  ] as const) {
    await page.getByRole('button', { name: 'Potential', exact: true }).click();
    await page.getByLabel(`dirichlet ${index} · Flächengruppe`, { exact: true }).selectOption(set);
    await page.getByLabel(`Potential ${index} · Wert [V]`, { exact: true }).fill(value);
  }
  await calculate('potential_V');
  await expect(page.locator('.colorbar-labels')).toContainText('10 V');
});
test('Elastizität mit Lagerung und Flächenlast berechnen; TOML exportieren und wieder öffnen', async () => {
  await showModel();
  await page.getByRole('combobox', { name: 'Physik' }).selectOption('elasticity');
  await page.getByLabel('Werkstoff · E-Modul [GPa]', { exact: true }).fill('100');
  await page.getByLabel('Werkstoff · Poissonzahl', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Verschiebung / Lagerung', exact: true }).click();
  await page.getByLabel('dirichlet 1 · Flächengruppe', { exact: true }).selectOption('x_min');
  await page.getByRole('button', { name: 'Flächenlast', exact: true }).click();
  await page.getByLabel('traction 1 · Flächengruppe', { exact: true }).selectOption('x_max');
  await page.getByLabel('Flächenlast 1 · x [N/m²]', { exact: true }).fill('1000000');
  await calculate('displacement_m');
  await page.getByLabel('Verformungsfaktor', { exact: true }).fill('100');
  await expect(page.locator('.field-caption')).toContainText('Geometrie x + 100');
  await page.screenshot({ path: 'test-results/elasticity-result.png' });
  await showModel();
  const filename = path.join(folder, 'zug.toml');
  await app.evaluate(({ dialog }, filename) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename });
  }, filename);
  await page.getByRole('button', { name: 'TOML exportieren', exact: true }).click();
  await expect(page.locator('.message-list')).toContainText(
    'TOML-Modell und zugehöriges Netz exportiert',
  );
  await app.evaluate(({ dialog }, filename) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
  }, filename);
  await page.getByRole('button', { name: 'TOML öffnen', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Physik' })).toHaveValue('elasticity');
  await expect(page.getByLabel('Werkstoff · E-Modul [GPa]', { exact: true })).toHaveValue('100');
  await calculate('displacement_m');
  expect(errors).toEqual([]);
});

test('vollständiger Datensatz blockiert versehentliches Speichern unapplizierter Textänderungen', async () => {
  await showModel();
  await page
    .getByRole('button', { name: 'Vollständigen Model-Datensatz bearbeiten', exact: true })
    .click();
  const input = page.getByLabel('Vollständiger Model-Datensatz', { exact: true });
  const document = JSON.parse(await input.inputValue());
  await input.fill('{"unvollstaendig":');
  await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: /03 Berechnung/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  document.materials.u.Werkstoff.poisson = 0.1;
  await input.fill(JSON.stringify(document, null, 2));
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Werkstoff · Poissonzahl', { exact: true })).toHaveValue('0.1');
  expect(errors).toEqual([]);
});

test('Modellneustart schützt Material und Randbedingungen bis zur Bestätigung', async () => {
  await calculate('displacement_m');
  await page.getByRole('button', { name: /Modell (neu )?erstellen/, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Modell neu erstellen' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Materialien');
  await expect(dialog).toContainText('Randbedingungen');
  await expect(dialog.getByRole('button', { name: 'Abbrechen', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Neu erstellen', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Abbrechen', exact: true })).toBeFocused();
  await page.screenshot({ path: 'test-results/model-restart.png' });
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Modell neu erstellen', exact: true }),
  ).toBeFocused();
  await showModel();
  await expect(page.getByLabel('Werkstoff · E-Modul [GPa]', { exact: true })).toHaveValue('100');
  await expect(page.getByLabel('Werkstoff · Poissonzahl', { exact: true })).toHaveValue('0.1');
  await expect(page.getByLabel('Flächenlast 1 · x [N/m²]', { exact: true })).toHaveValue('1000000');
  await page.getByRole('button', { name: /04 Ergebnisse/ }).click();
  await expect(page.locator('.result-status')).toContainText('Aktueller Modellstand');
  await page.getByRole('button', { name: /Modell (neu )?erstellen/, exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: /Modell (neu )?erstellen/, exact: true }).click();
  await dialog.getByRole('button', { name: 'Neu erstellen', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('Physik', { exact: true })).toHaveValue('elasticity');
  await expect(page.getByLabel('Werkstoff · E-Modul [GPa]', { exact: true })).toHaveValue('210');
  await expect(page.getByLabel('Flächenlast 1 · x [N/m²]', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /04 Ergebnisse/ }).click();
  await expect(page.locator('.result-status')).toContainText('Vorheriger Modellstand');
  await showModel();
  await page
    .getByRole('button', { name: 'Vollständigen Model-Datensatz bearbeiten', exact: true })
    .click();
  const input = page.getByLabel('Vollständiger Model-Datensatz', { exact: true });
  await input.fill('{"unvollstaendig":');
  await expect(
    page.getByRole('button', { name: /Modell (neu )?erstellen/, exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Textentwurf verwerfen', exact: true }).click();
  expect(errors).toEqual([]);
});
