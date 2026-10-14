# Issue #1: Zuordnung gespeicherter Ergebnisse

Stand: 14.10.2026, macOS/Apple Silicon. Zwei echte Wärmeläufe auf demselben Netz mit 300→350 K und 300→400 K dienten als reproduzierbarer Fremdbündel-Fall.

## Vertrag

Neue Desktop-Schema-2-Läufe enthalten `model.json` (der gerechnete Entwurf) und `run.json` (Laufnachweis Version 1). Der Nachweis enthält die Lauf-ID, den kanonischen Modellschlüssel, die Originalnetzkennung samt Maßstab, den Toolbox-Eingabehash sowie SHA-256-Werte von `model.json`, `case.json`, `case.toml`, dem Eingabenetz, `result.json` und `result.vtu`. Das Projekt verankert den SHA-256-Wert von `run.json` als optionales `run.provenanceSha256`.

Beim Öffnen und Speichern werden die verankerten Dateien, Originalnetzbytes und Maßstab, der gerechnete Eingabesnapshot sowie Physik und Toolbox-Eingabehash verglichen. Vor Weitergabe an den Renderer prüft der Python-Adapter das Ergebnis-VTU mit der öffentlichen Toolbox-Lesefunktion gegen Geometrie, Topologie, Gruppen und Original-IDs des Eingabenetzes; Feldzeilen, Komponenten und aktive Knoten werden ebenfalls geprüft. Abweichungen brechen das Öffnen mit einer Diagnose ab.

Ältere Schema-2-Projekte ohne `provenanceSha256` und die bisherigen Schema-1-Viewerprojekte bleiben lesbar. Ein alter Lauf ohne Nachweis erhält `provenanceVerified: false` und wird in der Oberfläche als „Zuordnung nicht verifiziert“ bezeichnet. Beim Speichern wird kein nachträglicher Nachweis aus alten Dateien konstruiert. Ein neuer Lauf kann eine verifizierte Zuordnung herstellen. Das Hashschema schützt vor unbeabsichtigtem Austausch oder Veränderung innerhalb eines Projekts; es ist keine kryptografische Signatur gegen die gemeinsame Neuschreibung der Projektdatei und aller Laufartefakte.

## Red/Green und Prüfung

- **Red:** Sieben neue Vitest-Fälle scheiterten vor der Implementierung an der fehlenden Laufbindung. Zwei neue Backendtests scheiterten an fehlenden Parametern für Eingabenetz und Physik. Der reproduzierte Austausch zweier für sich gültiger Ergebnisdateien war der Ausgangsfehler.
- **Green:** Der Fremdbündel-Austausch, Änderungen an Eingabe-/Ergebnismanifest, Laufnachweis und Modellschlüssel, ein fehlender Nachweis, ein legitimer älterer Lauf neben einem neuen Entwurf sowie ein echtes altes Schema-2-Bündel ohne Nachweis sind abgedeckt. Die Backendtests prüfen zusätzlich Netzgeometrie und ungültige Feld-/Knotendaten. Der Desktoptest prüft, dass ein beschädigter Lauf vor der Anzeige abgewiesen wird.
- `npm test`: 40/40 bestanden.
- `npm run test:backend`: 17/17 bestanden.
- `npm run build` einschließlich Typprüfung: bestanden; zwei Hinweise aus dem unveränderten Zod-Paket.
- `npm run test:desktop`: 13/13 bestanden mit realem Electron/WebGL-Fenster. In der Sandbox konnte Electron kein Fenster öffnen; außerhalb der Sandbox lief die Suite vollständig.
- `npx prettier --check` für geänderte TypeScript-Dateien und `git diff --check`: bestanden.

Kein Benchmark: Die Änderung betrifft Laufzuordnung und Ergebnisprüfung, nicht Topologieerzeugung oder Binärtransferleistung. Kein neuer Solver, keine Änderung der Toolbox-Abhängigkeit. Unabhängiges Review und GitHub-Integration stehen noch aus.
