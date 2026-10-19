import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { backendStartup } from './startup';

let app: ElectronApplication;
let page: Page;
const errors: string[] = [];
test.beforeAll(async () => {
  app = await electron.launch({ args: ['.'], cwd: process.cwd() });
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
});

const guide = () => page.getByRole('region', { name: 'Nächster Schritt' });

test('the next-step card and workflow bar guide from mesh to model', async () => {
  await expect(page.getByRole('button', { name: /01 Netz.*erledigt/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /02 Modell.*erledigt/ })).toHaveCount(0);
  await guide().getByRole('button', { name: 'Modell erstellen', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Physik' })).toHaveValue('heat');
  await expect(page.getByRole('button', { name: /02 Modell.*erledigt/ })).toBeVisible();
  await guide().getByRole('button', { name: 'Zur Berechnung', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Modell berechnen' })).toBeVisible();
  await expect(guide().getByRole('button', { name: 'Zur Berechnung' })).toHaveCount(0);
  await expect(guide().getByRole('button', { name: 'Modell neu erstellen' })).toBeVisible();
});

test('the message console collapses and reopens for new errors', async () => {
  const toggle = page.getByRole('button', { name: 'Meldungen einklappen', exact: true });
  await toggle.click();
  await expect(page.getByRole('button', { name: 'Meldungen ausklappen' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(page.getByRole('log')).toBeHidden();
  await page.getByRole('button', { name: /02 Modell/ }).click();
  await page.getByRole('button', { name: 'Modell prüfen', exact: true }).click();
  await expect(page.getByRole('log')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Meldungen einklappen' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(page.locator('.message-list .message.error').first()).toBeVisible();
  expect(errors).toEqual([]);
});
