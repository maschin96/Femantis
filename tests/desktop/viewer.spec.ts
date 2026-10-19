import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { backendStartup } from './startup';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

let application: ElectronApplication;
let page: Page;
let directory: string;
const errors: string[] = [];

test.beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'femantis-desktop-test-'));
  const script = `
import sys, numpy as np
from fem_toolbox.io import read_gmsh, write_vtu
from fem_toolbox.mesh import Mesh
source = read_gmsh('examples/cantilever.msh')
mesh = Mesh(points=source.points, tetra4=source.tetra4, triangle3=source.triangle3,
  point_ids=np.arange(source.n_points, dtype=np.int64) + 2**55,
  tetra4_ids=np.arange(source.n_cells, dtype=np.int64) + 2**60,
  triangle3_ids=np.arange(source.n_facets, dtype=np.int64) + 2**54,
  volume_sets=source.volume_sets, facet_sets=source.facet_sets)
write_vtu(sys.argv[1], mesh)
`;
  execFileSync(
    path.join(
      process.cwd(),
      '.venv',
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
    ),
    ['-c', script, path.join(directory, 'ids.vtu')],
    { cwd: process.cwd() },
  );
  application = await electron.launch({ args: ['.'], cwd: process.cwd() });
  page = await application.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.getByTestId('cell-count')).toHaveText('288', backendStartup);
});
test.afterAll(async () => {
  if (application) {
    await page.evaluate(() => window.desktop.setDirty(false));
    await application.close();
  }
  await rm(directory, { recursive: true, force: true });
});

test('echtes WebGL, Ansichten und Gruppe', async () => {
  await expect(page.locator('.viewport canvas')).toBeVisible();
  expect(
    await page
      .locator('.viewport canvas')
      .evaluate((canvas: HTMLCanvasElement) => !!canvas.getContext('webgl2')),
  ).toBe(true);
  const orientation = page.getByRole('img', {
    name: 'Koordinatensystem: positive X-, Y- und Z-Richtung',
  });
  await expect(orientation).toBeVisible();
  expect(await orientation.locator('text').allTextContents()).toEqual(
    expect.arrayContaining(['X', 'Y', 'Z']),
  );
  const axis = (name: string) => orientation.locator(`line[data-axis="${name}"]`);
  await page.getByRole('button', { name: 'Vorn', exact: true }).click();
  expect(Number(await axis('x').getAttribute('x2'))).toBeCloseTo(114, 1);
  expect(Number(await axis('z').getAttribute('y2'))).toBeCloseTo(30, 1);
  await page.getByRole('button', { name: 'Oben', exact: true }).click();
  expect(Number(await axis('x').getAttribute('x2'))).toBeCloseTo(114, 1);
  expect(Number(await axis('y').getAttribute('y2'))).toBeCloseTo(30, 1);
  await page.getByRole('button', { name: 'Seite', exact: true }).click();
  expect(Number(await axis('y').getAttribute('x2'))).toBeCloseTo(114, 1);
  expect(Number(await axis('z').getAttribute('y2'))).toBeCloseTo(30, 1);
  const previous = await orientation.innerHTML();
  const fixedSize = await orientation.boundingBox();
  const canvasBounds = (await page.locator('.viewport canvas').boundingBox())!;
  await page.mouse.move(
    canvasBounds.x + canvasBounds.width * 0.6,
    canvasBounds.y + canvasBounds.height * 0.4,
  );
  await page.mouse.down();
  await page.mouse.move(
    canvasBounds.x + canvasBounds.width * 0.6 + 60,
    canvasBounds.y + canvasBounds.height * 0.4 + 35,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect.poll(() => orientation.innerHTML()).not.toBe(previous);
  await page.mouse.wheel(0, -200);
  expect(await orientation.boundingBox()).toEqual(fixedSize);
  await page.getByRole('button', { name: 'Gruppe Einspannung auswählen', exact: true }).click();
  await expect(page.locator('.selection-name')).toHaveText('Einspannung');
  await expect(page.locator('.selection-name + .badge')).toHaveText('Flächengruppe');
  await page.getByRole('button', { name: 'Bauteil', exact: true }).click();
  await page.getByRole('button', { name: 'Netz', exact: true }).click();
  await page.getByRole('button', { name: 'Knoten', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Knoten', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Alles einpassen', exact: true }).click();
  await page.screenshot({ path: 'test-results/femantis-tet4.png' });
  expect(errors).toEqual([]);
});

test('Projekt inklusive Netz und Ansicht speichern und wieder öffnen', async () => {
  const filename = path.join(directory, 'probe.femantis.json');
  await application.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    dialog.showMessageBoxSync = () => 1;
  }, filename);
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.locator('.project-title')).toContainText('Gespeichertes Projekt');
  const document = JSON.parse(await readFile(filename, 'utf8'));
  expect(document.mesh.path).toMatch(/^probe\.femantis\.files\/mesh-/);
  expect(document.view.showNodes).toBe(true);
  expect(document.view.selectedGroup).toBe('facet:Einspannung');
  expect(document.view.camera).not.toBeNull();
  await page.getByRole('button', { name: /Tetraeder · Tet10/ }).click();
  await expect(page.getByTestId('cell-count')).toHaveText('1');
  await expect(page.getByTestId('point-count')).toHaveText('10');
  await expect(page.getByTestId('face-count')).toHaveText('4');
  await page.getByRole('button', { name: 'Gruppe electrode auswählen', exact: true }).click();
  await expect(page.locator('.selection-name')).toHaveText('electrode');
  await page.screenshot({ path: 'test-results/femantis-tet10.png' });
  await application.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, filename);
  await page.getByRole('button', { name: 'Projekt öffnen', exact: true }).click();
  await expect(page.getByTestId('cell-count')).toHaveText('288');
  await expect(page.locator('.selection-name')).toHaveText('Einspannung');
  await expect(page.getByRole('button', { name: 'Knoten', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(errors).toEqual([]);
});

test('Import, Sichtbarkeit und Flächenauswahl mit Original-ID', async () => {
  await application.evaluate(
    ({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    },
    path.join(process.cwd(), 'examples/cantilever.msh'),
  );
  await page.getByRole('button', { name: 'Netz öffnen', exact: true }).click();
  await expect(page.getByTestId('cell-count')).toHaveText('288');
  await page.getByRole('button', { name: 'Basis ausblenden', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Basis einblenden', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Basis einblenden', exact: true }).click();
  await page.getByRole('button', { name: 'Vorn', exact: true }).click();
  await page.locator('.viewport canvas').click();
  await expect(page.locator('.selection-name')).toHaveText(/^Elementindex \d+$/);
  await application.evaluate(
    ({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    },
    path.join(directory, 'ids.vtu'),
  );
  await page.getByRole('button', { name: 'Netz öffnen', exact: true }).click();
  await page.getByRole('button', { name: 'Vorn', exact: true }).click();
  await page.locator('.viewport canvas').click();
  await expect(page.locator('.selection-name')).toHaveText(/^Element \d+$/);
  const externalId = BigInt((await page.locator('.selection-name').textContent())!.split(' ')[1]);
  const internalIndex = Number(
    await page.locator('.inspector-section').first().locator('dd').first().textContent(),
  );
  expect(externalId).toBe(2n ** 60n + BigInt(internalIndex));
  await expect(page.locator('.message.error')).toHaveCount(0);
  expect(errors).toEqual([]);
});
