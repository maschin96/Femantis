#!/bin/sh
# Regenerate build/icon.icns from build/icon.svg (macOS: Electron, sips, iconutil).
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
"$root/node_modules/.bin/electron" "$root/scripts/render_icon.cjs" "$work/icon-1024.png"
mkdir "$work/icon.iconset"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$work/icon-1024.png" --out "$work/icon.iconset/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$work/icon-1024.png" --out "$work/icon.iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns -o "$root/build/icon.icns" "$work/icon.iconset"
echo "build/icon.icns erzeugt."
