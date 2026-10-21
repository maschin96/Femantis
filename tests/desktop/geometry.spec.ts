import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { backendStartup, chromiumArgs } from './startup';
import path from 'node:path';

let app: ElectronApplication;
const errors: string[] = [];

test.afterAll(async () => {
  if (app) await app.close();
});

test('STEP-Quader importieren, vernetzen und mit CAD-Flächengruppen berechnen', async () => {
  app = await electron.launch({ args: ['.', ...chromiumArgs], cwd: process.cwd() });
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await expect(page.getByTestId('cell-count')).toHaveText('288', backendStartup);
  const step = path.resolve('tests/fixtures/box-10x20x30mm.step');
  await app.evaluate(({ dialog }, filename) => {
    dialog.showMessageBoxSync = () => 1;
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
  }, step);
  await page.getByRole('button', { name: 'STEP-Geometrie', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'STEP-Geometrie importieren' });
  await dialog.getByLabel(/Automatisch/).uncheck();
  await dialog.getByLabel('Größte Elementkante [mm]', { exact: true }).fill('10');
  await dialog.getByRole('button', { name: 'STEP-Datei wählen…' }).click();
  await expect(page.getByRole('combobox', { name: 'Physik' })).toHaveValue('heat', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('cell-count')).not.toHaveText('288');
  await page.getByRole('button', { name: 'Temperatur', exact: true }).click();
  await page.getByLabel('dirichlet 1 · Flächengruppe', { exact: true }).selectOption('Flaeche_1');
  await page.getByLabel('Temperatur 1 · Wert [K]', { exact: true }).fill('300');
  await page.getByRole('button', { name: 'Temperatur', exact: true }).click();
  await page.getByLabel('dirichlet 2 · Flächengruppe', { exact: true }).selectOption('Flaeche_2');
  await page.getByLabel('Temperatur 2 · Wert [K]', { exact: true }).fill('350');
  await page.getByRole('button', { name: 'Berechnen', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Ergebnisfeld' })).toHaveValue('temperature_K');
  await expect(page.locator('.colorbar-labels')).toContainText('300 K');
  await expect(page.locator('.colorbar-labels')).toContainText('350 K');
  expect(errors).toEqual([]);
  await page.evaluate(() => window.desktop.setDirty(false));
});
