import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

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
  await expect(page.getByTestId('cell-count')).toHaveText('288');
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1;
  });
  await page.getByRole('button', { name: 'Quader erstellen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Quader erstellen' });
  await dialog.getByRole('button', { name: 'Quader erstellen', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Physik' })).toHaveValue('heat');
});
test.afterAll(async () => {
  if (app) {
    await page.evaluate(() => window.desktop.setDirty(false));
    await app.close();
  }
});

const latestError = () => page.locator('.message-list .message.error').first();
async function validate() {
  const count = await page.locator('.message-list .message.error').count();
  await page.getByRole('button', { name: 'Modell prüfen', exact: true }).click();
  await expect(page.locator('.message-list .message.error')).toHaveCount(count + 1);
}
async function addTemperature(index: number, set: string, value: string) {
  await page.getByRole('button', { name: 'Temperatur', exact: true }).click();
  await page.getByLabel(`dirichlet ${index} · Flächengruppe`, { exact: true }).selectOption(set);
  await page.getByLabel(`Temperatur ${index} · Wert [K]`, { exact: true }).fill(value);
}

test('fehlende Temperaturreferenz führt zum Randbedingungsbereich', async () => {
  await validate();
  await expect(latestError()).toContainText('Es fehlt eine Temperaturreferenz.');
  await expect(latestError()).toContainText('boundary.T');
  await latestError().getByRole('button', { name: 'Eingabe anzeigen', exact: true }).click();
  await expect(page.locator('[data-model-path="boundary"]')).toBeFocused();
});

test('kollidierende Randbedingungen nennen beide Einträge und führen zum zweiten', async () => {
  await addTemperature(1, 'x_min', '300');
  await addTemperature(2, 'x_min', '350');
  await validate();
  await expect(latestError()).toContainText('widersprechen sich');
  await expect(latestError()).toContainText('boundary.dirichlet[1]');
  await expect(latestError()).toContainText('boundary.dirichlet[0]');
  await latestError().getByRole('button', { name: 'Eingabe anzeigen', exact: true }).click();
  await expect(page.locator('[data-model-path="boundary.dirichlet[1]"]')).toBeFocused();
  await page.getByLabel('dirichlet 2 · Flächengruppe', { exact: true }).selectOption('x_max');
});

test('Materialfehler fokussiert die betroffene Zuordnung', async () => {
  const assignment = page.getByLabel('Material für Bauteil', { exact: true });
  await assignment.selectOption('');
  await validate();
  await expect(latestError()).toContainText('nicht definiertes Material');
  await expect(latestError()).toContainText('regions.T');
  await page.getByRole('button', { name: /01 Netz/ }).click();
  await latestError().getByRole('button', { name: 'Eingabe anzeigen', exact: true }).click();
  await expect(assignment).toBeFocused();
  await assignment.selectOption('Werkstoff');
});

test('nicht im Formular darstellbare Pfade öffnen den vollständigen Datensatz', async () => {
  await page
    .getByRole('button', { name: 'Vollständigen Model-Datensatz bearbeiten', exact: true })
    .click();
  const input = page.getByLabel('Vollständiger Model-Datensatz', { exact: true });
  await input.fill(JSON.stringify({ ...JSON.parse(await input.inputValue()), zusatz: 1 }));
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await page.getByRole('button', { name: 'Vollständigen Model-Datensatz ausblenden' }).click();
  await validate();
  await expect(latestError()).toContainText('ungültige Angabe');
  await expect(latestError()).toContainText('document');
  await expect(latestError()).toContainText("unknown key 'zusatz'");
  await latestError().getByRole('button', { name: 'Eingabe anzeigen', exact: true }).click();
  await expect(input).toBeFocused();
  expect(errors).toEqual([]);
});
