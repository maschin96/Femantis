# Issue #24: Liquid-Glass-Design und überarbeitete Benutzerführung

Bezug: [Issue #24](https://github.com/maschin96/Firmantis/issues/24), Basis `0e7c93b`
(Branch `codex/6-structured-diagnostics`, PR #22), 19.10.2026, macOS/Apple Silicon,
FEM-Toolbox 1.4.0.

## Umsetzung

- `src/renderer/styles.css`: neues Stylesheet mit zentralen Glass-Tokens
  (transluzente Flächen, `backdrop-filter`, Glanzkante, weiche Schatten). Panels
  schweben mit Abstand über einem ruhigen Farbverlauf. Primäraktionen bleiben im
  CI-Grün mit Petroltext. Die WebGL-Zeichenfläche bleibt deckend, damit Glas die
  Feldfarben nicht verfälscht.
- `src/renderer/guidance.ts`: reine Zustandslogik für die Karte „Nächster Schritt“
  (`nextStep`) und für erledigte Schritte der Ablaufleiste (`stepStates`). Ein
  veraltetes Ergebnis gilt nicht als erledigte Berechnung.
- `src/renderer/App.tsx`: Ablaufleiste in der Kopfzeile mit erledigten Schritten,
  Karte „Nächster Schritt“ mit genau einer empfohlenen Aktion und „Modell neu
  erstellen“, gebündelter Bereich „Netz laden“ (Import m/mm, Quader, Beispiele),
  einklappbare Gruppenlisten und eine einklappbare Meldungskonsole mit integrierter
  Statuszeile, die sich bei neuen Fehlern selbst öffnet. Redundante Modellaktionen
  der linken Leiste entfallen; alle Wege bleiben über Ablaufleiste und Karte erreichbar.
- `src/main/index.ts`: auf macOS integrierte Titelleiste (`hiddenInset`); die
  Kopfzeile ist Ziehbereich, Bedienelemente sind davon ausgenommen.

Unverändert: Solver, Backend-Protokoll, Projektformat, Rechenwerte,
Farbskalenberechnung und Viewer-Interpolation.

## Red/Green

| Schritt | Ergebnis |
|---|---|
| `npx vitest run tests/guidance.test.ts` vor Umsetzung | rot: Modul `src/renderer/guidance` fehlt |
| `npx playwright test tests/desktop/guidance.spec.ts` gegen vorherigen Build | rot: 2 von 2 fehlgeschlagen (Karte und Konsolenschalter nicht vorhanden) |
| beide nach Umsetzung | grün: 7 Unit-Tests, 2 Desktoptests |

## Prüfungen auf dem Endstand

| Befehl | Ergebnis |
|---|---|
| `npm test` | 10 Dateien, 68 Tests bestanden |
| `npm run test:backend` | 28 Tests OK |
| `npm run build` (inkl. Typprüfung) | bestanden |
| `npm run test:desktop` | 23 bestanden (21 bestehende, 2 neue) |
| `npx prettier --check src/renderer src/main tests` | bestanden |
| `git diff --check` | bestanden |

Benchmarks entfallen: keine Änderung an Topologie oder Binärübertragung.

## CI-Befund

Der erste CI-Lauf von PR #25 (Run 39289329126) scheiterte nur im Job „Desktop ·
macOS 15“: Der erste Electron-Start wartete 5 s auf das Beispielnetz und sah noch
„—“. Derselbe Fehler trat vorher unabhängig von dieser Änderung auf `main` auf
(Run 39285725120). Ursache ist der kalte Start von Python und Toolbox auf dem
Runner. `tests/desktop/startup.ts` gibt ausschließlich den Startwartezeiten 30 s;
Prüfungen nach Benutzeraktionen behalten den Standard.

## Nachweise

Screenshots aus dem echten Electron/WebGL-Fenster (Seiteninhalt ohne native
Fensterleiste):

- [Start mit Beispielnetz](evidence/liquid-glass-start.png)
- [Dialog „Quader erstellen“](evidence/liquid-glass-dialog.png)
- [Modelleditor](evidence/liquid-glass-model.png)
- [Ergebnis Wärmeleitung](evidence/liquid-glass-result.png)

## Offene Punkte

- Die Lage der macOS-Fensterknöpfe in der Kopfzeile ist in den Screenshots nicht
  sichtbar und wurde nicht automatisiert geprüft.
- Windows und Linux nicht praktisch geprüft; dort bleibt der Standardfensterrahmen.
- Kein Dark Mode.
