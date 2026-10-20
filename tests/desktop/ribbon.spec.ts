import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { backendStartup, chromiumArgs } from './startup';

let app: ElectronApplication;
let page: Page;
const errors: string[] = [];
test.beforeAll(async () => {
  app = await electron.launch({ args: ['.', ...chromiumArgs], cwd: process.cwd() });
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await expect(page.getByTestId('cell-count')).toHaveText('288', backendStartup);
});
test.afterAll(async () => {
  if (app) {
    await page.evaluate(() => window.desktop.setDirty(false));
    await app.close();
  }
});

const commands = () => page.getByRole('toolbar', { name: 'Befehle' });

test('Registerkarten zeigen die Befehle ihres Arbeitsschritts', async () => {
  await expect(commands().getByRole('button', { name: 'Netz öffnen', exact: true })).toBeVisible();
  await expect(commands().getByRole('button', { name: 'Berechnen', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /02 Modell/ })).toBeDisabled();
  await page
    .getByRole('region', { name: 'Nächster Schritt' })
    .getByRole('button', { name: 'Modell erstellen', exact: true })
    .click();
  await expect(page.getByRole('button', { name: /02 Modell/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(commands().getByRole('button', { name: 'Berechnen', exact: true })).toBeEnabled();
  await expect(commands().getByRole('button', { name: 'Netz öffnen', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /03 Berechnung/ }).click();
  await expect(
    commands().getByRole('button', { name: 'Berechnung abbrechen', exact: true }),
  ).toBeDisabled();
  await expect(
    commands().getByRole('button', { name: 'Anbindung prüfen', exact: true }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
});

test('„Ansicht“ wechselt nur die Befehle, nicht den Arbeitsschritt', async () => {
  await page.getByRole('button', { name: /02 Modell/ }).click();
  await page.getByRole('button', { name: 'Ansicht', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Modelleditor' })).toBeVisible();
  const nodes = commands().getByRole('button', { name: 'Knoten', exact: true });
  await expect(nodes).toHaveAttribute('aria-pressed', 'false');
  await nodes.click();
  await expect(nodes).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: 'Modelleditor' })).toBeVisible();
  await page.getByRole('button', { name: /02 Modell/ }).click();
  await expect(commands().getByRole('button', { name: 'Berechnen', exact: true })).toBeVisible();
});

test('das Menüband lässt sich einklappen und wieder ausklappen', async () => {
  await page.getByRole('button', { name: 'Menüband einklappen', exact: true }).click();
  await expect(commands()).toHaveCount(0);
  await page.getByRole('button', { name: 'Menüband ausklappen', exact: true }).click();
  await expect(commands()).toBeVisible();
});

test('die 3D-Ansicht füllt das Fenster; Panels schweben darüber', async () => {
  await page.getByRole('button', { name: /01 Netz/ }).click();
  const canvas = (await page.locator('.viewport canvas').boundingBox())!;
  const window =
    page.viewportSize() ??
    (await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
    })));
  expect(canvas.x).toBe(0);
  expect(canvas.y).toBe(0);
  expect(canvas.width).toBeCloseTo(window.width, 0);
  expect(canvas.height).toBeCloseTo(window.height, 0);
  const sidebar = (await page.getByRole('complementary', { name: 'Projekt' }).boundingBox())!;
  const inspector = (await page
    .getByRole('complementary', { name: 'Eigenschaften' })
    .boundingBox())!;
  const caption = (await page.locator('.viewport-caption').boundingBox())!;
  // Overlays of the view start in the free area, clear of the floating panels.
  expect(caption.x).toBeGreaterThanOrEqual(sidebar.x + sidebar.width);
  expect(caption.x + caption.width).toBeLessThanOrEqual(inspector.x);
  expect(errors).toEqual([]);
});
