# Issue #11: Windows- und Linux-Kompatibilität

Bezug: [Issue #11](https://github.com/maschin96/Femantis/issues/11), Branch
`codex/11-windows-linux`, Basis `6c60ac3` (`main`), 20.10.2026.

## Ziele und Priorität

| Priorität | Ziel | Prüfumgebung |
|---|---|---|
| 1 | macOS 15, Apple Silicon (arm64) | lokale Entwicklung und `macos-15`-Runner |
| 2 | Windows (x64) | GitHub-Runner `windows-2025`, Python 3.13 |
| 3 | Linux, Ubuntu 24.04 (x64) | GitHub-Runner `ubuntu-24.04`, Python 3.11–3.13; Desktop mit Xvfb und Mesa-Software-OpenGL |

Nicht im Umfang: Windows/Linux auf arm64, andere Distributionen, signierte
Installer, Hardware-GPU-Treiber unter Linux. Unter Linux ist WebGL in der CI eine
echte Implementierung, aber in Software gerendert. Dass es mit Hardware-GPU
funktioniert, ist damit nicht belegt.

## Gefundene Lücken und Änderungen

| Lücke | Wirkung | Änderung |
|---|---|---|
| Adapter las stdin mit der Locale-Kodierung | Unter Windows (cp1252) wurden Umlaute in Material-, Gruppen- und Regionsnamen verfälscht (`Stähl` → `StÃ¤hl`). | `backend/adapter.py` liest stdin und schreibt stderr als UTF-8; Main startet Python mit `PYTHONUTF8=1`. |
| `case.json`/`case.toml`/`result.json` ohne `encoding` | `case.toml` wäre unter Windows nicht UTF-8 und damit kein gültiges TOML. | `backend/models.py` und die Benchmark-Skripte mit `encoding="utf-8"`. |
| npm-Skripte riefen `.venv/bin/python` auf | `test:backend`, `benchmark`, `benchmark:meshes` und der Constraint-Schritt der CI liefen unter Windows nicht. | `scripts/venv-python.mjs` wählt den Interpreter plattformgerecht (respektiert `FEMANTIS_PYTHON`). |
| `setup:backend` rief `python3` auf | Unter Windows fehlt `python3` oder startet den Store-Stub. | `scripts/setup-backend.mjs`: `py -3`/`python` unter Windows, sonst `python3`/`python`; `FEMANTIS_SETUP_PYTHON` überschreibt. |
| Tests legten Verzeichnis-Symlinks an | Ohne Administratorrechte unter Windows nicht erlaubt. | Junctions unter Windows. Die Schutzlogik behandelt sie wie Symlinks. |
| Zeilenenden | `core.autocrlf=true` auf Windows-Runnern hätte Beispielnetze und Fixtures verändert (Hashes, Laufnachweise). | `.gitattributes` `* text=auto eol=lf`. Im Repository waren alle Textdateien schon LF; es ändern sich keine Bytes. |
| Keine Windows-/Linux-Läufe | Plattformen waren unbelegt. | CI: Backend auf `windows-2025`, Desktop zusätzlich auf `windows-2025` und `ubuntu-24.04`. |

Im ersten PR-Lauf (39380595984) zusätzlich gefunden:

| Lücke | Wirkung | Änderung |
|---|---|---|
| Interne Containment-Prüfungen übergaben `path.relative(...)` an `resolveMeshPath`, das Backslashes ablehnt | Unter Windows ließen sich Projekte weder speichern noch öffnen (18 Vitest-Tests rot, Desktop-Speicherabläufe rot). | `assertInside` prüft aufgelöste native Pfade mit den Trennzeichen der Plattform; `resolveMeshPath` bleibt für die portablen `/`-Pfade der Projektdatei zuständig. Test mit `path.win32`-Semantik. |
| WebGL unter Xvfb | Chromium setzt Software-OpenGL (Mesa llvmpipe) für WebGL auf die Blockliste; jeder Viewer-Start scheiterte. | Nur die Desktoptests des Linux-Jobs starten Electron mit `--ignore-gpu-blocklist` (`FEMANTIS_TEST_CHROMIUM_ARGS`). Die App selbst ist unverändert: Ohne GPU-Treiber meldet sie unter Linux weiterhin, dass die 3D-Ansicht nicht starten konnte. |

Im zweiten PR-Lauf (39381586323, `67ce986`) waren Backend und Desktop unter
Windows 2025 grün, Ubuntu 24.04 mit 25 von 26 Desktoptests. Rot war nur der mit #9
nach `main` gekommene `tests/desktop/tet10.spec.ts`, der die Linux-Schalter noch
nicht verwendete. Er ist nach dem Merge von `main` angepasst.

Plattformneutral waren bereits: der Interpreterpfad der App (`Scripts/python.exe`),
die Projektpfade mit `/` samt Ablehnung von Backslashes und absoluten
Windows-Pfaden, `realpath`-/Symlinkprüfungen, atomares Speichern per `rename`,
`windowsHide` beim Solverstart und der Abbruch über `child.kill()`.

## Portable Projektweitergabe

`tests/fixtures/portable-project` wurde am 20.10.2026 auf macOS mit einem echten
Wärmelauf gespeichert (Material „Wärmeleiter-Ü“, Laufnachweis, Netz).
`tests/portable-project.test.ts` öffnet es und prüft Laufnachweis und
analytisches Feld `T = 300 + 50·x/0,12` (Toleranz 1e-8 K). Aussagekräftig ist der
Test auf Windows und Linux, wo das Projekt von einer anderen Plattform stammt.
Die Fixture steht in `.prettierignore`. Eine Umformatierung ihrer JSON-Dateien
wurde lokal sofort vom Laufnachweis abgewiesen, wie vorgesehen.

## Abnahmekriterien

| Kriterium | Stand |
|---|---|
| Ziele und Priorität dokumentiert | erledigt (oben) |
| Frisches npm-/Python-/Toolbox-Setup je Ziel; portable Test-/Benchmarkaufrufe | Skripte portabel; lokal (macOS) geprüft. Windows/Linux: **ausstehend bis zum PR-Lauf** |
| Pfade, native Dialoge, relative Projekte, Symlinkschutz, atomares Speichern | über Store-, Provenienz-, Laufhistorien- und Desktoptests auf jeder CI-Plattform. Native Dialoge sind in Tests automatisiert; der echte Systemdialog ist nicht geprüft. **Ausstehend bis zum PR-Lauf** |
| Solverstart/-abbruch, UTF-8, echtes WebGL | Abbruchtest, `tests/backend/test_encoding.py`, Pixel- und Desktoptests je Plattform; **ausstehend bis zum PR-Lauf** |
| Ergebnisse je Plattform getrennt; fehlende Runner/GPU zählen nicht | Jeder Plattformjob ist ein eigener Check; Software-WebGL unter Linux ist als solches benannt. |

## Verifikation (lokal, macOS/Apple Silicon)

- Red:
  - `tests/backend/test_encoding.py` mit erzwungener Fremdkodierung:
    `StÃ¤hl` statt `Stähl` aus stdin; `case.toml` mit Latin-1-Byte `0xe4`.
  - `tests/venv.test.ts` und `tests/setup-launcher.test.ts`: Module fehlten.
- Green: `npm test` 97, `npm run test:backend` 34, `npm run build`,
  `npm run test:desktop` 24, `npm run setup:backend` über den neuen Launcher,
  YAML geparst, `git diff --check` und Prettier.
- Windows und Linux sind lokal nicht verfügbar. Diese Ergebnisse liefert erst der
  PR-Lauf; bis dahin gilt keine der beiden Plattformen als geprüft.

Status: lokale Übergabe mit Lücke. Die Plattformnachweise für Windows und Linux
stehen aus; die Commit-Referenz lautet deshalb `Refs #11`.
