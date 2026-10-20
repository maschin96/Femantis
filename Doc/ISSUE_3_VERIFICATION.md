# Issue #3: Präzision der Felddarstellung

14.10.2026, Basis `6a74f1d`, macOS/Apple Silicon.
[Issue #3](https://github.com/maschin96/Femantis/issues/3).

## Anzeigevertrag

Die CPU berechnet `(value - low) / (high - low)` in Double-Präzision vor der
Float32-Übertragung. Bei überlaufender Double-Differenz wird die äquivalente
Halbierung von Zähler und Nenner verwendet. Der Shader interpoliert diese affinen
Anzeigewerte und begrenzt erst danach auf die Farbskala. Eine Begrenzung pro Knoten
würde bei benutzerdefinierten Grenzen die Interpolation verfälschen.

Die Rohfelder, Auswahlwerte, Solverwerte, Masken und Verformungsdaten bleiben
unverändert. Konstante Felder verwenden weiterhin die Mitte der erweiterten
automatischen Skala. Zellwerte werden unverändert pro Eigentümerelement angezeigt.
Eine nicht endliche/aufsteigende oder in Float32 nicht darstellbare Skala meldet
eine korrigierbare Diagnose, statt einen ungültigen Shaderwert zu veröffentlichen.
Die Feldansicht kann nach Änderung der Grenzen wieder aktualisiert werden.

## Verifikation

- Baseline `npm test`: 32 Tests bestanden.
- Red: 13 fokussierte Tests scheiterten am fehlenden Normalisierungsvertrag.
  Mit echtem Viewport/Shader scheiterten drei von vier WebGL-Pixeltests an falschen
  Farben, während konstante Felder bestanden. Ein anfänglicher Fehler bei Auswahl
  und Schließen des zusätzlichen Testfensters wurde durch einen eigenen minimalen
  Electron-Teststart beseitigt; der reproduzierte Red-Lauf dauerte danach 4,1 s.
- Green: Normalisierung reproduziert Endpunkte 0/1 für Temperatur-, Verschiebungs-
  und Spannungsskalen, erhält NaN-Masken und extrapolierte Werte und behandelt
  konstante positive/negative/Nullfelder sowie überlaufende Double-Differenzen.
- `npm test`: 46 Tests bestanden.
- `npm run build`: Typprüfung und Produktionsbuild bestanden.
- `npm run test:desktop`: 16 Tests bestanden, darunter vier echte WebGL-Pixeltests
  sowie alle bestehenden Solver-, Persistenz-, Modell- und Viewerabläufe.
- `git diff --check`: bestanden.

Die Pixelreferenz besteht aus zwei Dreiecken in der X/Z-Ebene mit analytisch
festgelegter Kameraprojektion. Erwartete sRGB-Farben sind die festen Viridis-
Anker `#440154`, `#3b528b`, `#21918c`, `#5ec962`, `#fde725` sowie der Hintergrund
`#f4f7f8`; sie werden nicht mit der Implementierung berechnet. Toleranz: drei
8-Bit-Stufen je RGB-Kanal wegen Pixelmitteninterpolation und sRGB-Quantisierung;
Alpha muss exakt 255 sein. `readPixels` misst den echten Framebuffer direkt nach
dem Rendern. Rohwerte müssen exakt erhalten bleiben, GL- und Shaderfehler fehlen.

Backendtests und Benchmarks sind ohne Solver-/Topologie-/Transferänderung nicht
einschlägig. Bekannte Zod-Annotationshinweise bleiben unverändert. Electron lief
mit Ausführungsfreigabe außerhalb der Sandbox. Windows/Linux, Installer und CI
wurden nicht geprüft. Status: lokal verifiziert, unabhängige Review ausstehend.
