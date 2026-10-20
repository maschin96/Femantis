# Issue #6: Strukturierte Toolbox-Diagnosen bis zum Editorfeld

Bezug: [Issue #6](https://github.com/maschin96/Femantis/issues/6), Basis `1fe9936`,
19.10.2026, macOS/Apple Silicon, FEM-Toolbox 1.4.0.

## Diagnosevertrag (Version 1)

`backend/adapter.py` ergänzt jede Fehlerantwort additiv um `error.diagnostic`
(`diagnostic_version: 1`). Das stdio-Protokoll bleibt Version 1; `category`,
`message` und `field` bleiben unverändert erhalten. Felder: `category`, `kind`,
`code` (Toolbox-Ausnahmeklasse), `path` (Toolbox-Datenpfad), `related` (weitere
Pfade), `reason`, `detail` (Rohmeldung) und `cell_id`. `reason` und `detail` sind
auf 500 Zeichen begrenzt, weil Referenzfehler alle betroffenen Knoten aufzählen.

| Kategorie | Quelle |
|---|---|
| `material` | `ModelSchemaError` unter `materials.*`/`regions.*`; bei `MaterialAssignmentError` als Ursache mit `kind` (z. B. `unknown_material`, `missing`), betroffenen Regionspfaden und der laut Toolbox externen Volumenzell-ID als String |
| `reference` | `kind: unknown_set` (unbekannte Flächengruppe) oder `missing_anchor` (Pfad `boundary.T/u/phi`, `ThermalNullspaceError`, `ElectricGaugeError`) |
| `boundary_conflict` | widersprüchliche Dirichlet-Werte; `related` nennt den kollidierenden Eintrag |
| `file` | `OSError`, TOML-Syntax, `MeshIOError`, nicht unterstütztes Netzformat, Pfad `file` |
| `schema`, `mesh`, `input`, `internal` | übrige Modell-, Netz-, Eingabe- und unerwartete Fehler |

Konflikte und unbekannte Flächengruppen sind in Toolbox 1.4.0 nur am Wortlaut von
`reason` erkennbar. `tests/backend/test_diagnostics.py` erzeugt alle Fälle mit
echten Toolbox-Fehlern, sodass eine geänderte Toolbox-Formulierung dort auffällt.
Interne Knotenindizes aus Toolbox-Meldungen bleiben nur im Rohtext und werden nicht
als Original-IDs ausgegeben.

## Übertragung und Darstellung

Main wirft `DiagnosticError` (`src/shared/diagnostics.ts`). Weil Electron bei
abgelehnten IPC-Aufrufen nur den Meldungstext überträgt, steht die Diagnose
markiert als JSON im Text und wird im Renderer erneut per Zod validiert. Fehlt sie
oder ist sie ungültig, entsteht ein lesbarer Fallback (`process`, bei Abbruch
`cancelled`) mit unverändertem Meldungstext.

Die Meldungsliste zeigt deutschen Titel und Korrekturhinweis, Datenpfad, bezogene
Pfade und die eingeklappte Toolbox-Meldung. „Eingabe anzeigen“ wechselt zum
Modellschritt und fokussiert das genaueste Formularelement, dessen
`data-model-path` ein Vorfahr des Toolbox-Pfads ist. Gibt es keines (z. B.
`document`), öffnet sich der vollständige Datensatz.
[Geprüfte Ansicht](evidence/diagnostic-navigation.png).

## Verifikation

- Baseline vor Änderungen: `npm test` 54, `npm run test:backend` 17 Tests,
  Typprüfung bestanden.
- Red: `tests/backend/test_diagnostics.py` scheiterte am fehlenden `diagnostic`,
  `tests/diagnostics.test.ts` am fehlenden Modul, `tests/desktop/diagnostics.spec.ts`
  an der rohen Diagnose im Meldungstext (die Struktur kam bereits über IPC an).
- Green: `npm run test:backend` 28 Tests; `npm test` 61 Tests (einer davon mit
  echtem Python-Prozess); `npm run build`; `npm run test:desktop` 21
  Electron-/WebGL-Tests, darunter Fokus auf den Randbedingungsbereich, die
  kollidierende Bedingung, die Materialzuordnung aus einem anderen Schritt und
  der Datensatz-Fallback.
- `git diff --check` und `npx prettier --check src tests` bestanden; Screenshot
  visuell geprüft.

Keine Topologie- oder Binärtransferänderung; Benchmarks sind nicht einschlägig.
Windows/Linux wurden nicht geprüft. GitHub Actions starten wegen der in
[CI.md](CI.md) dokumentierten Billing-Sperre weiterhin keine Runner; es gibt
keinen CI-Nachweis.

Status: lokal verifiziert, unabhängige Review steht aus.
