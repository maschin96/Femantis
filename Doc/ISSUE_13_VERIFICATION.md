# Issue #13: STEP-Import und Volumenmeshing (erster Schnitt)

Bezug: [Issue #13](https://github.com/maschin96/Femantis/issues/13), Branch
`codex/13-step-import-meshing`, Basis `f668e4f` (`main`), 21.10.2026, macOS/Apple Silicon.
Dies ist ein begrenzter erster Umsetzungsschnitt, keine CAD-Produktfreigabe.

## Entscheidungen

| Thema | Entscheidung |
|---|---|
| Format | STEP (`.step`, `.stp`), genau ein Volumenkörper, bis 64 MB. IGES/BREP/STL nicht unterstützt. |
| Kern und Mesher | Gmsh 4.15.2 (Python-Modul `gmsh`, OpenCASCADE) im Python-Adapter, Aktion `meshGeometry` ([backend/geometry.py](../backend/geometry.py)). Ergebnis ist eine gewöhnliche `.msh` (Gmsh 4.1, Tet4) und läuft danach durch den bestehenden Netzimport und `read_gmsh` der Toolbox. |
| Lizenz | Gmsh ist GPL-2.0-or-later und mit Femantis (GPL-3.0-or-later) vereinbar. Gmsh steht **nicht** in `backend/constraints.txt` und nicht im gepackten macOS-Runtime; `setup_backend.py` installiert es nur für die Entwicklung. Die Funktion meldet sich über `capabilities.geometry` und ist ohne Gmsh deaktiviert. Aufnahme in das Paket erfordert einen eigenen Schnitt (Lizenztexte, Größe, Signierung) unter [#10](https://github.com/maschin96/Femantis/issues/10). |
| Einheiten | Gmsh wird mit `Geometry.OCCTargetUnit = "M"` gelesen: die im STEP deklarierte Längeneinheit wird nach Meter umgerechnet, das Netz entsteht in m (Importmaßstab 1). |
| Elementgröße | Größte Kantenlänge in m; Standard Bauteildiagonale / 10. Vorab-Schätzung (`V / (h³/(6√2))`) lehnt Größen mit mehr als dem Fünffachen der Grenze ab, danach hartes Limit von 100.000 Elementen. |
| Flächenidentität | Jede Außenfläche erhält `Flaeche_<Gmsh-Flächennummer>`; die Nummern folgen der Flächenreihenfolge der STEP-Datei. Für den Referenzquader belegt (siehe Tests). Stabilität über Änderungen am CAD-Modell hinweg ist **nicht** belegt: Eine andere STEP-Datei kann die Nummern verändern. |
| Neuvernetzung | Jeder Import erzeugt ein neues Projekt mit neuem Netz; Modell, Bedingungen und Läufe des vorherigen Netzes werden nicht übernommen (wie bei „Quader erstellen“). |
| Fehlerfälle | Kein STEP / kein Volumenkörper / mehrere Körper / ungültige oder zu kleine Größe / zu viele Elemente / leeres Netz: `GeometryError` (Kategorie `input`) mit deutschem Hinweis. |
| Protokoll | Gmsh/OpenCASCADE schreiben auf das C-Level-stdout. `mesh_step` leitet Dateideskriptor 1 während der Arbeit nach stderr um, damit das JSON-Protokoll unverändert bleibt. |

## Nicht im Umfang

Mehrkörper und Baugruppen (gemeinsame Flächen), Flächen/Schalen, Tet10, lokale
Netzverfeinerung, Krümmungsadaption, Speichern der STEP-Quelle im Projekt (das
erzeugte Netz wird wie jedes Originalnetz gespeichert), Bündelung von Gmsh im Paket,
CAD-Bearbeitung.

## Nachweise (21.10.2026, lokal)

- `tests/backend/test_geometry.py` (unabhängig erzeugter STEP-Quader 10 × 20 × 30 mm):
  Koordinaten in m, Volumen 6·10⁻⁶ m³ (relativ 10⁻⁹), sechs Flächengruppen, die jeweils genau
  auf der erwarteten Ebene liegen, Summe der Gruppen = Außendreiecke, Größe steuert die
  Elementzahl, Fehlerfälle, Protokoll-stdout bleibt sauber.
- Analytischer Fall: stationäre Wärmeleitung zwischen `Flaeche_1` (300 K) und `Flaeche_2`
  (350 K) ist linear in x und stimmt knotenweise mit 10⁻⁶ K überein.
- `tests/geometry-import.test.ts`, `tests/desktop/geometry.spec.ts` (echtes Electron/WebGL:
  Import, Gruppen, Berechnung mit Farbskala 300–350 K).
- Lokal: `npm test` (136), `npm run test:backend` (44), `npm run test:desktop` (31) bestanden.
  - CI (PR #44, Lauf 39591420537): alle neun Jobs grün, darunter Backend auf Ubuntu 24.04
  (Python 3.11–3.13) und Windows 2025 sowie Desktop auf macOS, Windows und Ubuntu.
  Unter Ubuntu braucht das Gmsh-Wheel Systembibliotheken (`libglu1-mesa`, X11-Bibliotheken);
  die Workflows installieren sie. Der erste Lauf scheiterte ohne sie in den Linux-Jobs;
  der Paketjob schlug dort in einem Abbruch-Test fehl und war im Wiederholungslauf grün
  (Ursache nicht untersucht, vermutlich Timing).
