/**
 * Render build/icon.svg to a transparent 1024 px PNG with Electron's Chromium.
 * Usage: npx electron scripts/render_icon.cjs <output.png>
 * scripts/package_macos.mjs turns the PNG into build/icon.icns with sips/iconutil.
 */
const { app, BrowserWindow } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const output = process.argv[process.argv.length - 1];
if (!output.endsWith('.png')) {
  console.error('Aufruf: npx electron scripts/render_icon.cjs <ausgabe.png>');
  process.exit(2);
}
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const svg = readFileSync(path.join(__dirname, '..', 'build', 'icon.svg'), 'utf8');
  const window = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    transparent: true,
    frame: false,
    useContentSize: true,
    webPreferences: { offscreen: true, zoomFactor: 1 },
  });
  const html =
    '<!doctype html><html><body style="margin:0;background:transparent">' +
    svg.replace('<svg ', '<svg style="display:block" ') +
    '</body></html>';
  await window.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
  const image = await window.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  const size = image.getSize();
  if (size.width !== 1024 || size.height !== 1024) {
    console.error(`Unerwartete Bildgröße ${size.width}×${size.height}.`);
    app.exit(1);
    return;
  }
  writeFileSync(output, image.toPNG());
  app.exit(0);
});
