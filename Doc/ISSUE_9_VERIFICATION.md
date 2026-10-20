# Issue #9: Quadratisch korrekte Tet10-Felddarstellung

Bezug: [Issue #9](https://github.com/maschin96/Femantis/issues/9), Branch
`codex/9-quadratic-tet10`, Basis `6c60ac3` (`main`), 20.10.2026,
macOS/Apple Silicon, FEM-Toolbox 1.4.0.

## Verfahren

Geradkantige Tet10 haben ebene Triangle6-Außenflächen. Darauf sind die
flächenlokalen Flächenkoordinaten λ affin, und die quadratische Feldinterpolation
ist `f(λ) = Σ N_k(λ) f_k` mit `N_i = λ_i(2λ_i − 1)` an den Ecken und
`N = 4λ_iλ_j` an den Kantenmitten.

- **Backend:** `backend/adapter.py` liefert für Tet10 zusätzlich
  `triangleFaceNodes`: je Anzeigedreieck die sechs Knoten seiner Fläche (Ecken,
  Kanten 01/12/20, Reihenfolge der Toolbox-Topologie). Die Teilung in vier
  Anzeigedreiecke, `triangleOwners`, `triangleFacets`, IDs und Gruppen bleiben
  unverändert. `src/main/backend.ts` verlangt den Puffer bei Tet10, prüft Länge,
  Indizes und dass jedes Anzeigedreieck aus Knoten seiner Fläche besteht, und
  lehnt ihn bei Tet4 ab.
- **Anzeige:** `buildDisplay` gibt für Tet10-Knotenfelder je Vertex λ sowie die
  normierten Werte der drei Ecken und drei Kantenmitten aus. Der Fragmentshader
  wertet die sechs Formfunktionen pro Bildpunkt aus; die Farbe entsteht erst
  danach (wie bisher nach der Interpolation). Weil `Σ N_k = 1`, ist die
  Interpolation der in Double normierten Werte gleich der Normierung der
  interpolierten Rohwerte.

## Verträge

| Fall | Darstellung |
|---|---|
| Tet10, Knotenfeld, Komponente (auch Vektorkomponente) | exakt quadratisch, Beschriftung „Knotenwerte · quadratische Triangle6-Interpolation“ |
| Tet10, Betrag eines Vektorfelds | quadratische Interpolation der nodalen Beträge, nicht der Betrag des interpolierten Vektorfelds; Beschriftung „… (Näherung)“ |
| Inaktive Knoten | Eine Fläche wird nur gezeichnet, wenn alle sechs Knoten aktiv sind. Bisher fiel nur das berührte Teildreieck weg. |
| Zell-/Schwerpunktfelder | unverändert konstant je Zelle, „Elementwerte · ohne Glättung“, kein quadratischer Pfad |
| Verformung (Faktor ≠ 0) | Jede Teilfläche wird in vier Dreiecke geteilt (16 je Triangle6-Fläche). Die Position folgt isoparametrisch `x + Faktor · Σ N_k u_k` an 15 Punkten je Fläche (λ-Raster 1/4), dazwischen eben. Netzlinien laufen durch die exakt verschobenen Kantenmitten. Die Feldfarbe bleibt pro Bildpunkt exakt. |
| Tet4 | unverändert; bitgleich zum vorherigen Aufbau (Paritätsprüfung gegen `966d172` auf `examples/cantilever.msh`) |

Auswahl und Picking ordnen jede Anzeigezeile ihrem Original-Anzeigedreieck zu. Die
Hervorhebung umfasst bei Verfeinerung alle vier Zeilen. Original-IDs und
Eigentümer bleiben unverändert.

## Toleranzen, Auflösung, Leistung

- Unit-Tests: Abweichung höchstens 5e-6 (`toBeCloseTo(…, 5)`). Die Werte gehen
  wie auf der GPU als Float32 ein; deren Rundung von etwa 1e-7 relativ bei
  Werten bis etwa 5 bestimmt die Grenze.
- WebGL: höchstens 3 von 255 Farbstufen, wie bei den bestehenden Pixeltests
  (Pixelmitte, sRGB-Quantisierung). Die Auswertung im Shader erfolgt in Float32;
  sie ist exakt bis auf diese Rundung, nicht symbolisch.
- Auflösung: Feldfarbe pro Bildpunkt; verformte Geometrie an 15 Punkten je
  Fläche. Der Sehnenfehler einer quadratischen Verschiebung ist dadurch ein
  Viertel des Fehlers der bisherigen Teilung an 6 Punkten.
- Kosten bei Tet10-Knotenfeldern: 3×vec3 zusätzliche Attribute je Vertex
  (108 Byte je Anzeigedreieck). Mit Verformung vervierfacht sich die Zahl der
  Anzeigedreiecke. Tet4 ist nicht betroffen; der Backend-Benchmark (Tet4) bleibt
  bei 0,034/0,61 s. Große Tet10-Netze sind nicht vermessen.

## Abnahmekriterien

| Kriterium | Nachweis |
|---|---|
| Lineare und quadratische Referenzfelder gegen unabhängige Formfunktionen | `tests/display.test.ts`: Polynome in (x, z) an drei inneren Punkten je Teilfläche gegen die Triangle6-Formfunktionen des Tests; WebGL-Pixeltest `field-pixels.spec.ts` |
| Originalknotenwerte und Eigentümer-/Flächenzuordnung exakt | Backendtest (Teildreieck ⊂ Fläche, Kantenmitten = Kantenmittelpunkte, Eigentümer/Facetten unverändert), TS-Validierung, Verformungstest (Positionen an Knoten exakt), Tet4-Parität |
| Inaktive Knoten, Vektorkomponenten, Verformung | Verträge oben; Tests für ganze Flächenmaske, Verfeinerung mit exakter quadratischer Verschiebung, Beschriftung für Betrag |
| Zell-/Schwerpunktfelder unterschieden | Test „Zellwerte ohne quadratische Attribute“, Beschriftung |
| Toleranzen, Auflösung, Leistungsgrenzen dokumentiert | dieser Abschnitt |
| Kennzeichnung | Betrag weiter als Näherung beschriftet; AGENTS.md, README und Modellierungsdokument angepasst |

## Verifikation

- Red:
  - Backend: `KeyError: 'triangleFaceNodes'`
  - Anzeige: 6 Tests rot (fehlende quadratische Attribute; Teildreieck trotz
    inaktivem Knoten sichtbar; keine Verfeinerung; fehlende Beschriftung)
  - `backend.test.ts`: Puffer fehlte
  - WebGL-Pixeltest auf `main`: Schwerpunkt um 159 Farbstufen abweichend
    (lineare Teilflächen)
- Green: `npm test` 98, `npm run test:backend` 34, `npm run build`,
  `npm run test:desktop` 26, darunter der neue Pixeltest und
  `tests/desktop/tet10.spec.ts` (Tet10-Beispiel rechnen, Beschriftung
  „quadratisch“). Dazu `npm run benchmark`, `git diff --check` und Prettier.

Gekrümmte Tet10, Volumenschnitte und eine exakte Betragsdarstellung bleiben
außerhalb des Umfangs. Gemessen nur auf macOS/Apple Silicon.

Status: lokal verifiziert, unabhängige Review und PR-CI stehen aus.
