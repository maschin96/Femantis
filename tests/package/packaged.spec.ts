/**
 * Smoke test of the distributed macOS app (#10). It mounts the built DMG, copies the app
 * into a temporary "Programme" folder outside the repository and starts it with a fresh
 * HOME and a minimal PATH, i.e. without Node, npm, gh, `.venv` or FEMANTIS_* variables.
 * With FEMANTIS_PACKAGE_SANDBOX=1 a Seatbelt profile additionally denies network access
 * except loopback (Playwright's control channel) and every read of the repository,
 * Homebrew and the python.org framework. Chromium cannot initialize its own sandbox inside
 * Seatbelt, so only this mode starts the app with --no-sandbox; the default run keeps it.
 */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { execFileSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repository = process.cwd();
const dmg =
  process.env.FEMANTIS_PACKAGE_DMG ||
  path.join(
    repository,
    'dist',
    `Femantis-${JSON.parse(readFileSync('package.json', 'utf8')).version}-mac-arm64.dmg`,
  );
const sandboxed = process.env.FEMANTIS_PACKAGE_SANDBOX === '1';

let folder: string;
let installed: string;
let home: string;
let app: ElectronApplication;
let page: Page;
const errors: string[] = [];

async function install(): Promise<string> {
  const mount = path.join(folder, 'volume');
  execFileSync('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, dmg]);
  try {
    const target = path.join(folder, 'Programme', 'Femantis.app');
    execFileSync('ditto', [path.join(mount, 'Femantis.app'), target]);
    return target;
  } finally {
    execFileSync('hdiutil', ['detach', mount, '-quiet']);
  }
}

async function executable(): Promise<string> {
  const binary = path.join(installed, 'Contents/MacOS/Femantis');
  if (!sandboxed) return binary;
  const profile = path.join(folder, 'offline.sb');
  await writeFile(
    profile,
    `(version 1)
(allow default)
(deny network-outbound (remote ip))
(allow network-outbound (remote ip "localhost:*"))
(deny network-outbound (remote unix-socket (path-regex #"^/private/var/run/mDNSResponder")))
(deny file-read* (subpath "${repository}"))
(deny file-read* (subpath "/opt/homebrew"))
(deny file-read* (subpath "/Library/Frameworks/Python.framework"))
`,
  );
  const wrapper = path.join(folder, 'femantis-offline.sh');
  await writeFile(
    wrapper,
    `#!/bin/sh\nexec /usr/bin/sandbox-exec -f "${profile}" "${binary}" --no-sandbox "$@"\n`,
  );
  await chmod(wrapper, 0o755);
  return wrapper;
}

async function showModel(): Promise<void> {
  await page.getByRole('button', { name: /02 Modell/ }).click();
}

test.beforeAll(async () => {
  // realpath: macOS reports /private/var/... for the /var/... temporary folder.
  folder = await realpath(await mkdtemp(path.join(tmpdir(), 'femantis-package-')));
  home = path.join(folder, 'home');
  installed = await install();
  app = await electron.launch({
    executablePath: await executable(),
    // Electron derives userData from the product name, not from HOME; keep the test
    // away from the real ~/Library/Application Support/Femantis.
    args: [`--user-data-dir=${path.join(home, 'Library/Application Support/Femantis')}`],
    cwd: folder,
    env: { HOME: home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TMPDIR: path.join(folder, '') },
  });
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await expect(page.getByTestId('cell-count')).toHaveText('288', { timeout: 60_000 });
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1;
  });
});

test.afterAll(async () => {
  if (app) {
    await page.evaluate(() => window.desktop.setDirty(false)).catch(() => {});
    await app.close();
  }
  if (installed)
    // Running the app must not modify the signed bundle (no bytecode, caches or runs).
    execFileSync('codesign', ['--verify', '--deep', '--strict', installed]);
  await rm(folder, { recursive: true, force: true });
});

test('startet ohne Entwicklercheckout mit gebündelter Python-Runtime und Toolbox', async () => {
  const paths = await app.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    resources: process.resourcesPath,
    userData: app.getPath('userData'),
    python: process.env.FEMANTIS_PYTHON ?? null,
  }));
  expect(paths.packaged).toBe(true);
  expect(paths.python).toBeNull();
  expect(path.relative(installed, paths.resources).startsWith('..')).toBe(false);
  expect(path.relative(repository, paths.resources).startsWith('..')).toBe(true);
  expect(path.relative(home, paths.userData).startsWith('..')).toBe(false);
  const status = await page.evaluate(() => window.desktop.backendStatus());
  expect(status).toMatchObject({ available: true, toolboxVersion: '1.4.0' });
  expect(status.pythonVersion).toMatch(/^3\.13\.16/);
  expect(errors).toEqual([]);
});

for (const [physics, field, label] of [
  ['heat', 'temperature_K', '350 K'],
  ['elasticity', 'displacement_m', 'm'],
  ['electrostatics', 'potential_V', '10 V'],
] as const) {
  test(`öffnet ${physics}.toml aus den App-Ressourcen und berechnet es`, async () => {
    const resources = await app.evaluate(() => process.resourcesPath);
    const filename = path.join(resources, 'examples', `${physics}.toml`);
    await app.evaluate(({ dialog }, filename) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
    }, filename);
    const create = page.getByRole('button', { name: 'Modell erstellen', exact: true });
    if (await create.isVisible()) await create.click();
    else await showModel();
    await page.getByRole('button', { name: 'TOML öffnen', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Physik' })).toHaveValue(physics);
    await page.getByRole('button', { name: 'Berechnen', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Ergebnisfeld' })).toHaveValue(field, {
      timeout: 30_000,
    });
    await expect(page.locator('.result-status')).toContainText('Aktueller Modellstand');
    await expect(page.locator('.colorbar-labels')).toContainText(label);
    await expect(page.locator('.viewport canvas')).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('speichert ein Projekt mit Lauf und öffnet es wieder', async () => {
  const filename = path.join(folder, 'projekte', 'paket.femantis.json');
  await mkdir(path.dirname(filename));
  await app.evaluate(({ dialog }, filename) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename });
  }, filename);
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.locator('.project-title')).toContainText('Gespeichertes Projekt');
  const saved = JSON.parse(await readFile(filename, 'utf8'));
  expect(saved.schemaVersion).toBe(2);
  expect(saved.run.provenanceSha256).toMatch(/^[a-f0-9]{64}$/);
  expect((await stat(path.join(folder, 'projekte', saved.run.path, 'result.json'))).isFile()).toBe(
    true,
  );
  await app.evaluate(({ dialog }, filename) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
  }, filename);
  await page.getByRole('button', { name: 'Projekt öffnen', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Ergebnisfeld' })).toHaveValue('potential_V');
  await expect(page.locator('.result-status')).toContainText('Aktueller Modellstand');
  expect(errors).toEqual([]);
});

test('bricht eine laufende Berechnung ab und beendet den gebündelten Python-Prozess', async () => {
  await page.getByRole('button', { name: /03 Berechnung/ }).click();
  const before = (await page.evaluate(() => window.desktop.listRuns())).runs.length;
  // Click „Berechnung abbrechen“ in the ribbon as soon as it is enabled, i.e. while Python
  // is running; the small example would otherwise finish before a Playwright round trip.
  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      const button = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Berechnung abbrechen"]:not(:disabled)',
      );
      if (button) {
        observer.disconnect();
        button.click();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  });
  await page.getByRole('button', { name: 'Berechnen', exact: true }).click();
  await expect(page.locator('.message.error', { hasText: 'Berechnung abgebrochen.' })).toHaveCount(
    1,
  );
  await expect(page.getByRole('button', { name: 'Berechnen', exact: true })).toBeEnabled();
  expect((await page.evaluate(() => window.desktop.listRuns())).runs.length).toBe(before);
  const python = path.join(installed, 'Contents/Resources/python');
  await expect
    .poll(() => {
      try {
        return execFileSync('pgrep', ['-f', python], { encoding: 'utf8' }).trim();
      } catch {
        return '';
      }
    })
    .toBe('');
  expect(errors).toEqual([]);
});

test('meldet ein ungültiges Netz verständlich und bleibt bedienbar', async () => {
  const filename = path.join(folder, 'kaputt.msh');
  await writeFile(filename, 'kein Gmsh-Netz\n');
  await app.evaluate(({ dialog }, filename) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
  }, filename);
  const before = await page.locator('.message.error').count();
  await page.getByRole('button', { name: 'Netz öffnen', exact: true }).click();
  await expect(page.locator('.message.error')).toHaveCount(before + 1);
  await expect(
    page.locator('.message.error', { hasText: 'Python-Adapter konnte das Netz nicht verarbeiten' }),
  ).toContainText('as gmsh');
  await expect(page.getByTestId('cell-count')).toHaveText('288');
  const userData = await app.evaluate(({ app }) => app.getPath('userData'));
  expect(await readdir(path.join(userData, 'runs'))).toEqual(expect.any(Array));
});
