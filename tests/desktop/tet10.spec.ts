import { test, expect, _electron as electron } from '@playwright/test';
import { backendStartup, chromiumArgs } from './startup';

test('Tet10-Ergebnis wird quadratisch dargestellt und als solches gekennzeichnet', async () => {
  const app = await electron.launch({ args: ['.', ...chromiumArgs], cwd: process.cwd() });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await expect(page.getByTestId('cell-count')).toHaveText('288', backendStartup);
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1;
  });
  await page.getByRole('button', { name: 'Tetraeder · Tet10' }).click();
  await expect(page.locator('.viewport-caption')).toContainText('Tet10');
  await page.getByRole('button', { name: 'Modell erstellen', exact: true }).click();
  await page.getByRole('button', { name: 'Temperatur', exact: true }).click();
  await page.getByLabel('dirichlet 1 · Flächengruppe', { exact: true }).selectOption('ground');
  await page.getByLabel('Temperatur 1 · Wert [K]', { exact: true }).fill('300');
  await page.getByRole('button', { name: 'Berechnen', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Ergebnisfeld' })).toHaveValue('temperature_K');
  await expect(page.locator('.field-caption')).toContainText(
    'Knotenwerte · quadratische Triangle6-Interpolation',
  );
  await page.evaluate(() => window.desktop.setDirty(false));
  await app.close();
  expect(errors).toEqual([]);
});
