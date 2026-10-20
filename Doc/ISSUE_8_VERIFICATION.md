# Issue #8: Viewerleistung für 100.000 Tet4-Zellen

Bezug: [Issue #8](https://github.com/maschin96/Femantis/issues/8), Branch
`codex/8-viewer-performance`, Basis `966d172` (`codex/24-liquid-glass-ui`, siehe
[PR #26](https://github.com/maschin96/Femantis/pull/26)), 19.10.2026.

## Referenzgerät und Messablauf

MacBook Pro `Mac16,1`, Apple M4 (10 Kerne), 32 GB, ProMotion-Display (120 Hz),
macOS (Darwin 27.0.0, arm64), Electron 44.7.0 / Chrome 152, WebGL über ANGLE Metal,
Fenster 1480×940 bei Pixelverhältnis 2, Python 3.13.7, FEM-Toolbox 1.4.0.

- Netze: `npm run benchmark:meshes` erzeugt deterministische strukturierte
  Tet4-Quader (`scripts/generate_viewer_meshes.py`, gleiche Zerlegung wie
  **Quader erstellen**, ohne dessen 30.000-Zellen-Grenze) nach
  `.cache/viewer-benchmark`. Sie haben sechs Flächengruppen und zusätzlich die
  überlappende Volumengruppe `Vorderhaelfte`. *Block* (0,4×0,2×0,2 m) hat wenig
  Oberfläche, *Platte* (0,5×0,5×0,005 m, eine Lage) viel.
- Messung: `npm run benchmark:viewer` (`tests/benchmark/viewer.bench.ts`, eigene
  Playwright-Konfiguration). Gemessen werden ein echtes Electron-/WebGL-Fenster,
  ein echter Import über **Netz öffnen** (nur der Dateidialog ist automatisiert)
  und ein echter Solverlauf. Keine Screenshots als FPS-Ersatz.
  - **Laden:** Klick bis zur angezeigten Zellzahl.
  - **Viewer-Zeiten:** User-Timing-Einträge `femantis:*` des Viewers
    (`createViewport`, `setView`, `setField`, `setSelected`, `pick`).
  - **FPS:** Abstände von `requestAnimationFrame` beim Ziehen, je Bild eine
    Mausbewegung.
  - **Speicher:** JS-Heap nach `gc()` mit `--enable-precise-memory-info`,
    Working Sets aus `app.getAppMetrics()` und die Bytes der hochgeladenen
    Vertexattribute.
- Grenzen der Messung: Die FPS sind durch 120 Hz gedeckelt und enthalten den
  Playwright-Eingaberundlauf; sie sind eine konservative Untergrenze, keine
  GPU-Zeit. GPU-Speicher ist als Attributbytes plus GPU-Prozess-Working-Set
  erfasst, nicht als Treiberwert. In der ersten Baseline-Datei war der JS-Heap
  noch quantisiert (13,6 MB) und ist dort nicht aussagekräftig.

## Ergebnisse

| Netz | Zellen | Außendreiecke | Laden | Viewer-Aufbau | Rotation (Median/p95) | Picking (Ende-zu-Ende/Raycast) |
|---|---|---|---|---|---|---|
| block-100k | 100.800 | 8.240 | 12,4 s | 36 ms | 120 FPS (8,3/8,7 ms) | 17/2,3 ms |
| plate-100k | 101.400 | 68.640 | 13,9 s | 74 ms | 120 FPS (8,3/8,9 ms) | 16/3,6 ms |
| block-1m | 998.976 | 38.192 | 122 s | 119 ms | 120 FPS (8,3/8,4 ms) | 18/2,6 ms |
| plate-1m | 1.008.600 | 675.680 | 185 s | 489 ms | 120 FPS (8,3/8,9 ms) | 38/26 ms |

Optimierter Stand, alle vier Netze in einer Sitzung
([viewer-benchmark-optimized.json](evidence/viewer-benchmark-optimized.json)).
Rotation im Netz- und Bauteilmodus sowie mit Temperaturfeld ist gleich.

Bedienbarkeit (100k): Während des Solverlaufs (23–24 s) dreht die Ansicht mit
120 FPS (p95 ≤ 8,7 ms). Main- und Renderer-Prozess bleiben frei, der Solver ist ein
eigener Python-Prozess. Speicher nach dem Laden:

| Netz | JS-Heap | Renderer | GPU-Prozess | Main | Vertexattribute |
|---|---|---|---|---|---|
| block-100k | 21 MB | 209 MB | 116 MB | 206 MB | 1,3 MB |
| plate-100k | 76 MB | 309 MB | 158 MB | 216 MB | 11 MB |
| block-1m | 114 MB | 430 MB | 196 MB | 370 MB | 6,2 MB |
| plate-1m | 602 MB | 643 MB | 327 MB | 760 MB | 109 MB |

### Belegte Engpässe und Änderungen

1. **Import (Toolbox).** Etwa 99 % der Ladezeit entfallen auf
   `fem_toolbox.mesh.inspect_boundary_topology`. Sie baut je Zelle ein
   Python-`Tet4Geometry`-Objekt, was cProfile bei block-100k mit 22 von 22 s
   ausweist. `npm run benchmark` ergibt konsistent etwa 0,1 ms je Zelle (6.000
   Zellen: 0,57 s). Mit dem festen 120-s-Limit scheiterten **beide 1M-Netze**
   ([baseline-1m](evidence/viewer-benchmark-baseline-1m.json)). Auf Entscheidung
   des Nutzers bleibt die Toolbox-Topologie maßgeblich; Desktop dupliziert sie
   nicht. Geändert ist nur das Importlimit: `importTimeout` = 120 s + 30 s/MiB,
   höchstens 60 min, also mindestens doppelte Reserve zur gemessenen Rate. Die
   Beschleunigung ist Folgearbeit in der FEM-Toolbox
   ([maschin96/FEM-Toolbox#287](https://github.com/maschin96/FEM-Toolbox/issues/287)).
2. **Ansichtsaufbau (Renderer).** `setView` baute alle Puffer mit Arrays je Knoten,
   String-Kantenschlüsseln, `Set`-Gruppen und `push(...)` neu auf, `setSelected`
   suchte linear. `src/renderer/viewer/display.ts` erzeugt dieselben Puffer jetzt
   aus typisierten Arrays mit numerischen Kantenschlüsseln, Gruppenmasken, einer
   Zellfarbtabelle je Netz und einer Zuordnung von Anzeige- zu Originaldreieck.

| Ansichtsänderung (vorher → nachher) | plate-100k | block-1m | plate-1m |
|---|---|---|---|
| Viewer-Aufbau | 285 → 74 ms | 137 → 119 ms | 877 → 489 ms |
| Bauteil/Netz umschalten | 58 → 39 ms | 85 → 29 ms | 794 → 469 ms |
| Volumengruppe wählen | 69 → 29 ms | 97 → 26 ms | 778 → 390 ms |
| Flächengruppe ausblenden | 43 → 16 ms | 115 → 19 ms | 465 → 197 ms |
| Feld anzeigen / wechseln / Skala | 69 / 55 / 54 → 30 / 34 / 30 ms | – | – |

Quellen: [baseline](evidence/viewer-benchmark-baseline.json) (100k),
[baseline-block-1m](evidence/viewer-benchmark-baseline-block-1m.json) (Lauf mit
neuem Limit; der anschließende plate-1m-Fall brach dort ab, die Seite wurde
geschlossen), [baseline-plate-1m](evidence/viewer-benchmark-baseline-plate-1m.json)
(Einzellauf). Der Abbruch trat im optimierten Lauf mit allen vier Netzen nicht
wieder auf, seine Ursache ist aber nicht geklärt. Unter `block-100k` lagen die
Wechsel schon vorher unter 16 ms.

### Ziel 100k/30 FPS

Erfüllt auf dem Referenzgerät: Beide 100k-Netze drehen mit 120 FPS (Displaygrenze),
p95 ≤ 8,9 ms, auch während des Solverlaufs. Ansichts- und Feldwechsel bleiben unter
40 ms. Nicht erfüllt ist eine kurze Ladezeit: 12–14 s für 100k, 2–3 min für 1M,
beides durch die Toolbox-Topologie bestimmt.

Grenzen bei 1M (Grenzermittlung, kein Produktversprechen): Laden 2–3 min mit
Busy-Anzeige und ohne Abbruchmöglichkeit. Bei 675k Außendreiecken dauert jede
Ansichtsänderung noch 0,2–0,5 s, und der Main-Prozess braucht 760 MB.
Folgearbeit: vektorisierte Randtopologie in der Toolbox (FEM-Toolbox#287); im Viewer inkrementelle
Farb-/Feldaktualisierung statt Neuaufbau, wenn größere Oberflächen nötig werden.

## Korrektheit

- `tests/display.test.ts`, mit unabhängigen Erwartungen an einem Würfel mit Offset
  1e6:
  - geschlossene Haut mit E = 3F/2
  - Zentrierung in Double
  - Ausblenden von Volumen- und Flächengruppen mit Abbildung Anzeige → Original
  - Auswahlfarbe und Vorrang der ersten Volumengruppe
  - Knoten-/Zellwerte mit NaN-Masken
  - Verformung nur in der Anzeige
- Einmalige Paritätsprüfung (nicht im Repo, da sie das 100k-Netz aus `.cache`
  braucht): Der alte `setView`-Algorithmus aus `966d172` und `buildDisplay`
  liefern auf plate-100k bitgleiche Positions-, Farb-, Kanten-, Knoten- und
  Feldpuffer sowie dieselbe Dreiecksliste. Geprüft für 2 Ansichten × 3 Feldarten
  (ohne Feld, Knoten mit Maske, Zellen mit Maske).
- Originalkoordinaten, IDs, Gruppen und Netzpuffer bleiben unverändert. Geändert
  ist nur der Aufbau der Anzeigepuffer. Bestehende Desktoptests für Original-IDs,
  Gruppen, Pixel-Farbskalen und Masken bestehen.

## Verifikation

- Baseline vor Änderungen: `npm test` 68, `npm run test:backend` 28, Typprüfung.
- Red: `tests/backend.test.ts` scheiterte an fehlendem `importTimeout` (3 Tests).
  `tests/display.test.ts` scheiterte an fehlendem Modul
  `src/renderer/viewer/display`, beobachtet in `tsc`.
- Green: `npm test` 77, `npm run test:backend` 28, `npm run build`,
  `npm run test:desktop` 23, `npm run benchmark` (Vergleich, Werte siehe oben),
  `git diff --check`, Prettier.
- `backend/models.py`: `create_box` prüft unverändert und ruft das neue
  `structured_box` auf, das auch der Netzgenerator nutzt. Der Backend-Quadertest
  besteht.

Nur macOS/Apple Silicon mit 120-Hz-Display; Windows/Linux, schwächere GPUs und
60-Hz-Displays sind nicht gemessen. Kein CI-Nachweis (Billing-Sperre, [CI.md](CI.md)).

Nachtrag vom 20.10.2026: Diese Aussage war beim Schreiben bereits überholt. Die
PR-Läufe 39302869360 (`f7ae66d`) und 39371606829 (`a7efa39`) sowie der `main`-Lauf
39371862896 waren mit allen fünf Jobs grün. Der Viewer-Benchmark läuft bewusst
nicht in der CI. Siehe [CI.md](CI.md).

Status: lokal verifiziert, unabhängige Review steht aus.
