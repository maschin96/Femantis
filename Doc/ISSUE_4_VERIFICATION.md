# Issue #4: Bewusster Modellneustart

Bezug: [Issue #4](https://github.com/maschin96/Firmantis/issues/4), Basis `44360d2`,
14.10.2026, macOS/Apple Silicon. Eigenständiger Schnitt ohne Abhängigkeit von Issue #2.

## Verhalten

Beim vorhandenen Modell wird „Modell erstellen“ zu „Modell neu erstellen“.
Ein modaler Dialog benennt den Verlust von Materialien, Regionszuordnungen,
Randbedingungen und Lasten. Abbrechen sowie Escape ändern weder Entwurf noch
Ergebnisstatus. Bestätigung erstellt einen Standardentwurf zur bisherigen Physik
auf demselben Netz. Die bisherigen Ergebnisse bleiben erhalten und werden als
früherer Modellstand gekennzeichnet. Unapplizierte JSON-Texte blockieren den Neustart.

Der native HTML-Dialog sperrt den Hintergrund, setzt den Anfangsfokus auf
Abbrechen und begrenzt Tab/Shift+Tab auf seine Aktionen. Beim Schließen kehrt der
Fokus zum Auslöser zurück. Der Dialog wird vor dem Entfernen aus dem DOM geschlossen,
damit diese Rückgabe erhalten bleibt. [Geprüfte Ansicht](evidence/model-restart.png).

## Verifikation

- Red: Produktionsbuild und `npx playwright test tests/desktop/modelling.spec.ts`;
  die fünf vorhandenen Modellabläufe bestanden, die neue Regression scheiterte
  am fehlenden Bestätigungsdialog. Das bisherige Modell wurde unmittelbar ersetzt.
- Green/Refactor: Abbruch, Escape, bestätigter Neustart, Material-/Lastenerhalt,
  bisherige Physik, Stale-Ergebnis und JSON-Sperre bestehen im echten Desktop.
  Eine anfänglich falsche Testannahme über einen nach Navigation offenen
  JSON-Editor wurde korrigiert; der Editor wird explizit geöffnet. Der zusätzlich
  reproduzierte Fokusfehler wurde behoben, ohne die Erwartung abzuschwächen.
- `npm test`: 16 Tests bestanden.
- `npm run build`: Typprüfung und Produktionsbuild bestanden.
- `npm run test:desktop`: alle 9 Electron-/WebGL-Tests bestanden, einschließlich
  drei echter Solver und Persistenz-/TOML-Roundtrips.
- `git diff --check`: bestanden; Dialog-Screenshot visuell geprüft.

Keine Backend-, Topologie- oder Transferänderung; Backendtests und Benchmarks sind
für diesen Schnitt nicht einschlägig. Die bestehenden Zod-Annotationshinweise im
Build sind unverändert. Electron lief mit Ausführungsfreigabe außerhalb der Sandbox.
Windows/Linux, Installer und CI wurden nicht verifiziert; CI ist nicht eingerichtet.

Status: lokal verifiziert und zur unabhängigen Review vorbereitet. Eine unabhängige
Review steht noch aus; im Repository ist nur der Autor als Collaborator verfügbar.
Integration und Issue-Schließung bleiben bis zur Review offen.
