# Issue #2: Modelldaten an Editorgrenzen absichern

Bezug: [Issue #2](https://github.com/maschin96/Firmantis/issues/2), Basis `44360d2`,
14.10.2026, macOS/Apple Silicon. Toolbox 1.4.0 bleibt unverändert am gepinnten Commit.

## Verhalten und Umfang

Die gemeinsame Strukturprüfung gilt für JSON-Übernahme, TOML-Import, Projektöffnung
und modellbezogene IPC-Aufrufe. Sie fordert aktive Material-/Regionstabellen,
numerische skalare Lasten, drei Komponenten für Flächen-/Volumenkräfte und sichere
Dirichlet-/Komponentenlisten. Fehler nennen den Datenpfad und eine Korrekturhilfe.
Importe werden vor Veröffentlichung des neuen Arbeitsstands abgelehnt.

Der Editor zeigt bei einem fehlerhaften vorhandenen Datensatz automatisch den
vollständigen JSON-Editor mit Diagnose; die unsicheren Formulare sowie Prüfen/Rechnen
bleiben bis zur Korrektur gesperrt. Leere aktive Tabellen bleiben bearbeitbar.
Tensoren, explizite Knotenlisten, komponentenweise und knotenweise Dirichlet-Werte
und weitere JSON-Tabellen werden erhalten. Physik, Einheiten, Referenzen,
Materialtensoren und netzabhängige Vektorlängen prüft weiterhin die Toolbox.

## Beobachtete Verifikation

- Baseline: `npm test`, 16 Tests bestanden.
- Red: `npx vitest run tests/model.test.ts`, 15 neue Prüfungen scheiterten;
  der echte React-Editor reproduzierte den Nullzugriff bei `traction.value = null`.
- Green: derselbe fokussierte Lauf, 19 Tests bestanden. Die Arrayfälle wurden
  als benannte Fälle präzisiert, damit Vitest die Arrays nicht als Argumentlisten
  auffächert; danach sind kurze und lange Vektoren eigenständige Fälle.
- Final: `npm test`, 32 Tests bestanden; `npm run test:backend`, 15 Tests bestanden;
  `npm run build` einschließlich Typprüfung bestanden;
  `npm run test:desktop`, 11 echte Electron-/WebGL-Tests bestanden.
- Desktopregressionen prüfen JSON-Ablehnung/Korrektur, Erhalt des Entwurfs,
  Projektablehnung samt unverändertem Speicherziel und TOML-Ablehnung. Die
  bestehenden drei echten Solverfälle und portablen Roundtrips bestehen ebenfalls.
- `git diff --check` bestanden.

Electron konnte in der Sandbox nicht starten (`SIGABRT`/`EPERM`); die Desktopabnahme
lief mit Ausführungsfreigabe außerhalb der Sandbox. Buildmeldungen betreffen zwei
bereits bekannte Zod-Kommentarannotation-Hinweise. Keine Solver-/Topologieänderung;
Benchmarks sind für diese Änderung nicht erforderlich. Windows/Linux und Installer
wurden nicht geprüft. CI ist weiterhin nicht eingerichtet.

Status: lokal verifiziert und zur unabhängigen Review vorbereitet. Im Repository
ist nur der Autor als Collaborator verfügbar; eine unabhängige Review liegt noch
nicht vor. Integration und Issue-Schließung bleiben bis zur Review offen.

Nachtrag vom 14.10.2026: [PR #16](https://github.com/maschin96/Firmantis/pull/16)
wurde als Commit `cc6cb25` in `main` integriert; Issue #2 ist geschlossen.
Die Prüfziffern und der Status oben beschreiben den Stand vor dieser Integration.
