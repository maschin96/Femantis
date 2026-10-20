/**
 * Build the macOS/Apple Silicon app bundle and DMG with a bundled Python runtime (#10).
 *
 * Inputs are pinned: CPython from python-build-standalone (archive SHA-256 below), the
 * FEM-Toolbox commit from scripts/setup_backend.py, Python versions from
 * backend/constraints.txt and the Electron version from package-lock.json. Downloads
 * are cached under .cache/packaging; results go to dist/. Run via `npm run package:mac`
 * after `npm run build`. The bundle is signed ad hoc only; Developer ID signing and
 * notarization are documented as open in Doc/RELEASE.md.
 */
import { packager } from '@electron/packager';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  openSync,
  readSync,
  readlinkSync,
  closeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleDigest, contentDigest, removeEmptyDirectories } from './bundle-digest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

const PBS_RELEASE = '20261003';
const PYTHON_VERSION = '3.13.16';
const RUNTIME = {
  name: `cpython-${PYTHON_VERSION}+${PBS_RELEASE}-aarch64-apple-darwin-install_only_stripped.tar.gz`,
  sha256: '9e01f63bbb08576cd9c8bc2d0564d098cb30c8453a0cd4bcf6aef458f6d2a147',
};
// License texts of the statically linked native libraries (OpenSSL, SQLite, Tcl/Tk, …)
// ship only in the full archive of the same build, from which install_only is derived.
const RUNTIME_LICENSES = {
  name: `cpython-${PYTHON_VERSION}+${PBS_RELEASE}-aarch64-apple-darwin-pgo+lto-full.tar.zst`,
  sha256: 'ca3eb5bf8110eaed1c3e516be4bd4d52bcf636f8e888359353f274288406bae7',
};
const TOOLBOX_VERSION = '1.4.0';
const BUNDLE_ID = 'io.github.maschin96.femantis';

const cache = path.join(root, '.cache/packaging');
const dist = path.join(root, 'dist');
// Build, sign and assemble outside the checkout: synced folders such as an iCloud
// ~/Documents attach Finder/File Provider attributes that invalidate the signature.
const work = mkdtempSync(path.join(tmpdir(), 'femantis-package-'));
const staging = path.join(work, 'staging');

function step(message) {
  console.log(`\n▸ ${message}`);
}
function run(command, args, options = {}) {
  return execFileSync(command, args, { stdio: 'inherit', ...options });
}
function output(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', ...options }).trim();
}
async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** Download a python-build-standalone asset once and verify its pinned SHA-256. */
async function pinnedDownload({ name, sha256: expected }) {
  mkdirSync(cache, { recursive: true });
  const file = path.join(cache, name);
  if (!existsSync(file)) {
    const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_RELEASE}/${encodeURIComponent(name)}`;
    console.log(`Lade ${url}`);
    run('curl', ['-sSfL', '--retry', '3', '-o', `${file}.part`, url]);
    run('mv', [`${file}.part`, file]);
  }
  const actual = await sha256(file);
  if (actual !== expected) {
    rmSync(file);
    throw new Error(`SHA-256 von ${name} weicht ab: ${actual}, erwartet ${expected}.`);
  }
  return file;
}

function toolboxArchive() {
  const setup = readFileSync(path.join(root, 'scripts/setup_backend.py'), 'utf8');
  const commit = /^COMMIT = "([0-9a-f]{40})"$/m.exec(setup)?.[1];
  if (!commit) throw new Error('Toolbox-Commit in scripts/setup_backend.py nicht gefunden.');
  return { commit, url: `https://codeload.github.com/maschin96/FEM-Toolbox/tar.gz/${commit}` };
}

function isMachO(file) {
  const descriptor = openSync(file, 'r');
  try {
    const magic = Buffer.alloc(4);
    if (readSync(descriptor, magic, 0, 4, 0) !== 4) return false;
    return ['cffaedfe', 'cefaedfe', 'cafebabe', 'feedfacf', 'feedface'].includes(
      magic.toString('hex'),
    );
  } finally {
    closeSync(descriptor);
  }
}
function* walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}
function licenseFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((name) => /^(licen[cs]e|copying|notice)/i.test(name));
}

async function stagePython() {
  step(`Python ${PYTHON_VERSION} (python-build-standalone ${PBS_RELEASE}) vorbereiten`);
  const archive = await pinnedDownload(RUNTIME);
  run('tar', ['-xzf', archive, '-C', staging]);
  const home = path.join(staging, 'python');
  const python = path.join(home, 'bin/python3');
  const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME, PIP_NO_INPUT: '1' };
  // -I: ignore PYTHON* variables, user site-packages and the working directory;
  // -B: build steps write no bytecode, compileall below produces it deterministically.
  const py = (args, options = {}) => output(python, ['-I', '-B', ...args], { env, ...options });
  const toolbox = toolboxArchive();
  step(`FEM-Toolbox ${TOOLBOX_VERSION} @ ${toolbox.commit} installieren`);
  const scripts = new Set(readdirSync(path.join(home, 'bin')));
  run(
    python,
    [
      '-I',
      '-B',
      '-m',
      'pip',
      'install',
      '--disable-pip-version-check',
      '--no-warn-script-location',
      '--no-compile',
      '--only-binary',
      ':all:',
      '--no-binary',
      'fem-toolbox',
      '--constraint',
      path.join(root, 'backend/constraints.txt'),
      `fem-toolbox @ ${toolbox.url}`,
    ],
    { env },
  );
  run(python, ['-I', '-B', path.join(root, 'scripts/setup_backend.py'), '--check-constraints'], {
    env,
  });
  const version = py(['-c', 'import fem_toolbox; print(fem_toolbox.__version__)']);
  if (version !== TOOLBOX_VERSION)
    throw new Error(`Gebündelte Toolbox ${version}, erwartet ${TOOLBOX_VERSION}.`);
  // pip is a build tool only; the app never installs packages at runtime.
  py(['-m', 'pip', 'uninstall', '--yes', '--quiet', 'pip']);
  // Console scripts (f2py, meshio, …) carry the staging path in their shebang and are not
  // used by the app; remove them and their RECORD lines so the bundle is deterministic.
  for (const name of readdirSync(path.join(home, 'bin')))
    if (!scripts.has(name)) rmSync(path.join(home, 'bin', name));
  const sitePackages = py(['-c', 'import sysconfig; print(sysconfig.get_paths()["purelib"])']);
  for (const entry of readdirSync(sitePackages).filter((name) => name.endsWith('.dist-info'))) {
    const record = path.join(sitePackages, entry, 'RECORD');
    const lines = readFileSync(record, 'utf8').split('\n');
    const kept = lines.filter((line) => !line.startsWith('../../../bin/'));
    if (kept.length !== lines.length) writeFileSync(record, kept.join('\n'));
  }
  // Hash-validated bytecode stays valid after copying (mtimes change); the app runs with -B
  // and never writes into the bundle. -s strips the random staging path from co_filename;
  // the import system replaces it with the actual source path when loading.
  run(
    python,
    [
      '-I',
      '-m',
      'compileall',
      '-q',
      '-f',
      // Test packages are never imported by the app; their bytecode was the remaining
      // non-deterministic marshal output. Sequential compilation keeps the rest stable.
      '-x',
      '[/\\\\]tests?[/\\\\]',
      '-s',
      home,
      '--invalidation-mode',
      'unchecked-hash',
      path.join(home, 'lib'),
    ],
    { env },
  );
  const packages = JSON.parse(
    py([
      '-c',
      'import json; from importlib import metadata as m; print(json.dumps(sorted([d.metadata["Name"], d.version] for d in m.distributions())))',
    ]),
  );
  return { python, packages, toolbox, sitePackages };
}

function stageBackendAndExamples() {
  step('Adapter und Beispiele übernehmen');
  mkdirSync(path.join(staging, 'backend'));
  for (const name of ['adapter.py', 'models.py'])
    cpSync(path.join(root, 'backend', name), path.join(staging, 'backend', name));
  cpSync(path.join(root, 'examples'), path.join(staging, 'examples'), { recursive: true });
}

/** Collect license texts of everything shipped; fail if a bundled component has none. */
async function stageLicenses(sitePackages, packages, asarModules, bundleParent) {
  step('Lizenzen und Hinweise sammeln');
  const target = path.join(staging, 'licenses');
  const missing = [];
  const rows = [];
  const copy = (from, to) => {
    mkdirSync(path.dirname(to), { recursive: true });
    cpSync(from, to);
  };

  // Femantis itself.
  copy(path.join(root, 'LICENSE'), path.join(target, 'femantis/LICENSE'));
  rows.push(['Femantis Desktop', pkg.version, String(pkg.license), 'femantis/']);

  // Python runtime and its statically linked native libraries.
  const full = await pinnedDownload(RUNTIME_LICENSES);
  const extracted = path.join(work, 'runtime-licenses');
  rmSync(extracted, { recursive: true, force: true });
  mkdirSync(extracted, { recursive: true });
  run('tar', ['-xf', full, '-C', extracted, 'python/licenses', 'python/PYTHON.json']);
  cpSync(path.join(extracted, 'python/licenses'), path.join(target, 'python-runtime'), {
    recursive: true,
  });
  rows.push([
    'CPython (python-build-standalone)',
    `${PYTHON_VERSION} / ${PBS_RELEASE}`,
    'PSF-2.0 und gelinkte Bibliotheken',
    'python-runtime/',
  ]);

  // Python distributions installed into the runtime.
  for (const [name, version] of packages) {
    const info = readdirSync(sitePackages).find(
      (entry) =>
        entry === `${name.toLowerCase().replace(/[-_.]+/g, '_')}-${version}.dist-info` ||
        entry === `${name}-${version}.dist-info`,
    );
    const directory = info && path.join(sitePackages, info);
    const metadata = directory ? readFileSync(path.join(directory, 'METADATA'), 'utf8') : '';
    const license =
      /^License-Expression: (.+)$/m.exec(metadata)?.[1] ??
      /^License: (.+)$/m.exec(metadata)?.[1] ??
      'siehe Lizenztext';
    const files = directory
      ? [...walk(directory)].filter((file) =>
          /^(licen[cs]e|copying|notice|authors)/i.test(path.basename(file)),
        )
      : [];
    if (!files.length) missing.push(`Python: ${name} ${version}`);
    for (const file of files)
      copy(file, path.join(target, 'python', name, path.relative(directory, file)));
    rows.push([name, version, license.slice(0, 80), `python/${name}/`]);
  }

  // Electron and the Node modules inside app.asar. The license texts come from the
  // Electron distribution the packager bundled (written next to the .app), not from
  // node_modules/electron/dist, which Electron only downloads on first start.
  const electronVersion = JSON.parse(
    readFileSync(path.join(root, 'node_modules/electron/package.json'), 'utf8'),
  ).version;
  for (const name of ['LICENSE', 'LICENSES.chromium.html'])
    copy(path.join(bundleParent, name), path.join(target, 'electron', name));
  rows.push(['Electron (inkl. Chromium, Node.js)', electronVersion, 'MIT u. a.', 'electron/']);
  for (const name of asarModules) {
    const directory = path.join(root, 'node_modules', name);
    const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'));
    const files = licenseFiles(directory);
    if (!files.length) missing.push(`npm: ${name} ${manifest.version}`);
    for (const file of files)
      copy(path.join(directory, file), path.join(target, 'npm', name, file));
    rows.push([name, manifest.version, String(manifest.license ?? ''), `npm/${name}/`]);
  }

  // Example data from the Toolbox; the icon is original Femantis artwork.
  copy(
    path.join(root, 'examples/TOOLBOX-LICENSE.txt'),
    path.join(target, 'fem-toolbox-examples/LICENSE.txt'),
  );
  if (missing.length) throw new Error(`Fehlende Lizenztexte:\n${missing.join('\n')}`);

  const table = rows.map((row) => `| ${row.join(' | ')} |`).join('\n');
  writeFileSync(
    path.join(target, 'README.md'),
    `# Femantis Desktop ${pkg.version} – Lizenzen\n\n` +
      'Femantis Desktop ist freie Software unter der GNU General Public License, Version 3\n' +
      'oder (nach Ihrer Wahl) jeder späteren Version (`femantis/LICENSE`). Der Quelltext steht\n' +
      'unter https://github.com/maschin96/Femantis bereit.\n\n' +
      'Dieses Paket enthält die folgenden Komponenten. Die Lizenztexte liegen in den genannten\n' +
      'Unterordnern. `python-runtime/` stammt aus dem vollständigen Archiv desselben\n' +
      'python-build-standalone-Builds und deckt auch dort nicht verwendete Plattformbibliotheken ab.\n' +
      'Das Beispielnetz `examples/tet10-groups.msh` stammt aus der FEM-Toolbox (MIT,\n' +
      '`fem-toolbox-examples/`). Das Anwendungssymbol ist eigene Gestaltung des Projekts.\n\n' +
      '| Komponente | Version | Lizenzangabe | Texte |\n|---|---|---|---|\n' +
      table +
      '\n',
  );
  rmSync(extracted, { recursive: true, force: true });
  return { electronVersion, components: rows.length };
}

/** Every symlink in the bundle must be relative and resolve inside the bundle. */
function assertContainedSymlinks(app) {
  const escaping = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const target = readlinkSync(full);
        const resolved = path.resolve(directory, target);
        if (path.isAbsolute(target) || path.relative(app, resolved).startsWith('..'))
          escaping.push(`${path.relative(app, full)} -> ${target}`);
      } else if (entry.isDirectory()) visit(full);
    }
  };
  visit(app);
  if (escaping.length)
    throw new Error(`Symlinks zeigen aus dem App-Bundle heraus:\n${escaping.join('\n')}`);
}

/** Bundled Mach-O files may only load system libraries or libraries inside the bundle. */
function assertSystemLinkage(app) {
  const foreign = [];
  for (const file of [...walk(path.join(app, 'Contents/Resources'))].filter(isMachO)) {
    // `otool -L` lists a dylib's own install name first; only dependencies matter.
    const own = output('otool', ['-D', file]).split('\n').slice(1);
    const libraries = output('otool', ['-L', file])
      .split('\n')
      .slice(1)
      .map((line) => line.trim().split(' (')[0])
      .filter((library) => !own.includes(library));
    for (const library of libraries)
      if (
        !/^(\/usr\/lib\/|\/System\/Library\/|@rpath\/|@loader_path\/|@executable_path\/)/.test(
          library,
        )
      )
        foreign.push(`${path.relative(app, file)} -> ${library}`);
  }
  if (foreign.length)
    throw new Error(`Bibliotheken außerhalb von System und Bundle:\n${foreign.join('\n')}`);
}

function signAdHoc(app) {
  step('Ad-hoc-Signatur (keine Developer-ID verfügbar)');
  // Extended attributes (e.g. Finder info) are not allowed inside a signed bundle.
  run('xattr', ['-cr', app]);
  // Nested Mach-O files outside the standard bundle locations are sealed as resources by
  // the app signature; sign them individually so each binary carries its own signature.
  const binaries = [...walk(path.join(app, 'Contents/Resources'))].filter(isMachO);
  for (let index = 0; index < binaries.length; index += 200)
    output('codesign', ['--force', '--sign', '-', ...binaries.slice(index, index + 200)], {
      stdio: 'pipe',
    });
  output('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'pipe' });
  run('codesign', ['--verify', '--deep', '--strict', app]);
  return binaries.length;
}

/** The app inside the finished image must carry an intact signature. */
function verifyImage(dmg) {
  const mount = path.join(work, 'mount');
  run('hdiutil', ['attach', '-quiet', '-nobrowse', '-readonly', '-mountpoint', mount, dmg]);
  try {
    run('codesign', ['--verify', '--deep', '--strict', path.join(mount, 'Femantis.app')]);
    assertContainedSymlinks(path.join(mount, 'Femantis.app'));
  } finally {
    run('hdiutil', ['detach', '-quiet', mount]);
  }
}

async function main() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw new Error('Das Paket wird derzeit nur auf macOS/Apple Silicon erzeugt (#10).');
  if (!existsSync(path.join(root, 'out/main/index.js')))
    throw new Error('Kein Produktionsbuild gefunden. Bitte zuerst npm run build ausführen.');
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist);
  mkdirSync(staging);

  const { packages, toolbox, sitePackages } = await stagePython();
  stageBackendAndExamples();

  step('Electron-App paketieren');
  const keep = (relative) =>
    relative === '' ||
    relative === '/package.json' ||
    relative === '/out' ||
    relative.startsWith('/out/') ||
    relative === '/node_modules' ||
    (relative.startsWith('/node_modules/') && !relative.startsWith('/node_modules/.'));
  const asarModules = [];
  const [bundleParent] = await packager({
    dir: root,
    out: path.join(work, 'package'),
    name: 'Femantis',
    executableName: 'Femantis',
    platform: 'darwin',
    arch: 'arm64',
    appBundleId: BUNDLE_ID,
    appCategoryType: 'public.app-category.productivity',
    appCopyright: 'Femantis Desktop · GPL-3.0-or-later',
    icon: path.join(root, 'build/icon.icns'),
    asar: true,
    prune: true,
    overwrite: true,
    darwinDarkModeSupport: true,
    ignore: (file) => !keep(file.startsWith(root) ? file.slice(root.length) : file),
    // Licenses follow the pruned app.asar content and are copied after packaging.
    afterPrune: [
      async ({ buildPath }) => {
        const modules = path.join(buildPath, 'node_modules');
        // Pruned dev dependencies leave empty (scope) folders, depending on the npm version;
        // app.asar would record them and differ between machines.
        if (existsSync(modules)) removeEmptyDirectories(modules);
        for (const entry of existsSync(modules) ? readdirSync(modules) : [])
          if (entry.startsWith('@'))
            for (const scoped of readdirSync(path.join(modules, entry)))
              asarModules.push(`${entry}/${scoped}`);
          else if (!entry.startsWith('.')) asarModules.push(entry);
        asarModules.sort();
      },
    ],
  });
  const app = path.join(bundleParent, 'Femantis.app');
  const resources = path.join(app, 'Contents/Resources');
  const licenses = await stageLicenses(sitePackages, packages, asarModules, bundleParent);
  // ditto keeps the runtime's relative symlinks; packager's extraResource rewrites them
  // to absolute paths into the staging folder, which break on every other machine.
  for (const name of ['python', 'backend', 'examples', 'licenses'])
    run('ditto', [path.join(staging, name), path.join(resources, name)]);
  assertContainedSymlinks(app);
  assertSystemLinkage(app);

  const signed = signAdHoc(app);
  const bundle = await bundleDigest(app);
  const content = await contentDigest(app);

  step('DMG erstellen');
  const name = `Femantis-${pkg.version}-mac-arm64`;
  const volume = path.join(work, 'dmg');
  mkdirSync(volume);
  run('ditto', [app, path.join(volume, 'Femantis.app')]);
  cpSync(path.join(staging, 'licenses'), path.join(volume, 'Lizenzen'), { recursive: true });
  symlinkSync('/Applications', path.join(volume, 'Programme'));
  const dmg = path.join(dist, `${name}.dmg`);
  run('hdiutil', [
    'create',
    '-quiet',
    '-volname',
    `Femantis ${pkg.version}`,
    '-srcfolder',
    volume,
    '-format',
    'UDZO',
    '-ov',
    dmg,
  ]);
  rmSync(volume, { recursive: true, force: true });
  verifyImage(dmg);

  const commit = output('git', ['rev-parse', 'HEAD'], { cwd: root });
  const dirty = output('git', ['status', '--porcelain'], { cwd: root }) !== '';
  const info = {
    product: 'Femantis Desktop',
    version: pkg.version,
    platform: 'darwin-arm64',
    commit,
    workingTreeClean: !dirty,
    builtAt: new Date().toISOString(),
    electron: licenses.electronVersion,
    python: { version: PYTHON_VERSION, release: PBS_RELEASE, archive: RUNTIME },
    toolbox: { version: TOOLBOX_VERSION, commit: toolbox.commit },
    pythonPackages: Object.fromEntries(packages),
    nodeModules: asarModules,
    signing: 'ad-hoc',
    signedMachO: signed,
    bundleDigest: bundle.digest,
    contentDigest: content.digest,
    artifact: { file: path.basename(dmg), bytes: statSync(dmg).size, sha256: await sha256(dmg) },
  };
  writeFileSync(path.join(dist, `${name}.build.json`), JSON.stringify(info, null, 2) + '\n');
  writeFileSync(path.join(dist, `${name}.bundle-manifest.txt`), bundle.manifest);
  writeFileSync(path.join(dist, `${name}.content-manifest.txt`), content.manifest);
  writeFileSync(path.join(dist, 'SHA256SUMS'), `${info.artifact.sha256}  ${info.artifact.file}\n`);
  if (dirty)
    console.warn(
      '\nWarnung: Arbeitsverzeichnis nicht sauber; dieses Paket ist kein Releasekandidat.',
    );
  console.log(`\nFertig: ${path.relative(root, dmg)} (${info.artifact.sha256})`);
}

main()
  .catch((error) => {
    console.error(
      `\nPaketierung fehlgeschlagen: ${error instanceof Error ? error.message : error}`,
    );
    process.exitCode = 1;
  })
  .finally(() => {
    if (process.env.FEMANTIS_PACKAGE_KEEP === '1') console.log(`Arbeitsordner behalten: ${work}`);
    else rmSync(work, { recursive: true, force: true });
  });
