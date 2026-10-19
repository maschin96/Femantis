# Issue #7: Berechnungsläufe dauerhaft verwalten und lokalen Laufcache begrenzen

Bezug: [Issue #7](https://github.com/maschin96/Firmantis/issues/7), Branch
`codex/7-run-history-cache`, Basis `966d172` (`codex/24-liquid-glass-ui`; der Branch
berührt UI-Code aus #24), 19.10.2026, macOS/Apple Silicon, FEM-Toolbox 1.4.0.

Hinweis zur Basis: PR #25 (#24) wurde in `codex/6-structured-diagnostics` gemergt
(`33a02ea`), nachdem PR #22 bereits in `main` lag. `main` (`7af184a`) enthält #24
deshalb noch nicht. Der Baum von `33a02ea` ist identisch mit `966d172`.

## Lebenszyklus eines Laufs

| Zustand | Ort | Ende |
|---|---|---|
| Ungespeichert | `.cache/runs/session-<uuid>/<lauf-uuid>/` (oder `FEMANTIS_RUN_CACHE`) | Entfernen aus der Historie, Wechsel des Arbeitsstands, Speichern (Kopie im Projekt), Beenden der App |
| Gespeichert | `<projekt>.files/runs/<lauf-uuid>/` | wird von der App nie gelöscht |

- Jede Instanz veröffentlicht ihren Sitzungsordner atomar (`session.json` mit PID,
  Umbenennung aus `.session-<uuid>.tmp`). Ein Laufordner wird ohne `recursive`
  angelegt; existiert er bereits, bricht der Lauf ab, statt etwas zu überschreiben.
- Der Start entfernt Sitzungen, deren Prozess nicht mehr existiert. **Cache
  bereinigen** entfernt außerdem flache Laufordner älterer Versionen
  (`.cache/runs/<uuid>`, hier lokal 100 Ordner/12 MB) und nicht referenzierte
  Läufe der eigenen Sitzung. Läufe der Historie und Sitzungen laufender Instanzen
  bleiben. Symbolische Links werden gelöscht, nie verfolgt. Nicht verwaltete
  Einträge bleiben unberührt.
- Bereinigung und Berechnung sind exklusive Main-Vorgänge und laufen nie
  gleichzeitig. Der Ordner eines laufenden Jobs kann daher nicht entfernt werden.
- Die Oberfläche zeigt Größe und Anzahl aller verwalteten Cacheläufe.

## Projektformat (Desktop-Schema 2, additiv)

`runs` listet alle aufbewahrten Läufe (höchstens 100) mit `id`, `path`, `modelKey`,
`sourceKey`, `provenanceSha256` und optional `createdAt` (ISO-Zeit, nur
informativ und nicht Teil des Laufnachweises). `run` bleibt der ausgewählte
Eintrag und ist identisch zu seinem Eintrag in `runs`. Ältere Leser öffnen so
weiterhin den ausgewählten Lauf. IDs und Pfade müssen eindeutig sein; eine nicht
leere Historie braucht eine enthaltene Auswahl. Projekte nur mit `run`
(Schema 2 vor #7) werden als einelementige Historie gelesen, Schema 1 als leere.
Beim Öffnen wird jeder Lauf per Pfad-/Symlinkprüfung und Laufnachweis (#1)
verifiziert. Ein beschädigter Lauf verhindert das Öffnen des Projekts, wie
bisher beim Einzellauf.

Die Historie zeigt je Lauf UUID-Präfix, Zeitpunkt, Physik, Toolbox-Eingabehash,
Modellstand (aktuell/vorherig/nicht verifiziert) und Speicherort. Entfernen ist
für den angezeigten Lauf gesperrt. Bei gespeicherten Läufen wird nur der
Historieneintrag entfernt; die Dateien bleiben im Projektordner.
[Geprüfte Ansicht](evidence/run-history.png).

## Abnahmekriterien und Nachweise

| Kriterium | Nachweis |
|---|---|
| Mehrere Läufe unterscheidbar und auswählbar, mit Eingaberevision und Stale-Status | `tests/run-history.test.ts` (zwei echte Läufe, unterschiedliche Eingabehashes, getrennt geladene Felder 350/400 K), `tests/runs.test.ts`, `tests/desktop/runs.spec.ts` |
| Persistenz/Portabilität mehrerer Läufe dokumentiert und getestet | dieses Dokument, README; Speichern/Wiederöffnen mit Auswahl, Migration von Einzellauf und Schema 1 (Vitest und Desktop) |
| Cachegröße/Aufbewahrung nachvollziehbar, sichere Bereinigung | `tests/run-cache.test.ts` (Größe, tote/lebende Sitzungen, Altläufe, Symlink nach außen, fremde Dateien), Desktop: Altlauf bereinigt, Anzeige 2 → 0 Läufe nach Speichern |
| Keine Entfernung aktiver Läufe oder Projektdateien | `discard` lehnt Projektordner ab; Projekt bleibt nach Cachebereinigung lesbar; entfernter Lauf bleibt unter `.files/runs` (Vitest und Desktop) |
| Keine Kollisionen/Überschreibungen | erneutes Anlegen derselben Lauf-ID scheitert; abweichendes vorhandenes Ergebnisbündel wird beim Speichern nicht überschrieben |
| Beschädigte/fremde Pfade | `../fremd`, absoluter Pfad, doppelte ID, fehlende oder nicht enthaltene Auswahl, gefälschter `run.json` eines nicht ausgewählten Laufs |

## Verifikation

- Baseline auf `966d172`: `npm test` 68, `npm run test:backend` 28 Tests,
  Typprüfung bestanden.
- Red: `tests/run-cache.test.ts`, `tests/run-history.test.ts` und
  `tests/runs.test.ts` scheiterten an fehlenden Modulen. Nach Umsetzung von
  `RunCache` scheiterten 7 Historientests gezielt an fehlendem `runs`/`describeRun`.
  `tests/desktop/runs.spec.ts` scheiterte auf einem Build von `966d172` (temporärer
  Worktree) nach erfolgreicher Berechnung an der fehlenden Laufhistorie
  (0 statt 1 Eintrag).
- Zwei bestehende Tests in `tests/provenance.test.ts` änderten nur `document.run`.
  Das ist jetzt bereits ein ungültiges Projekt. Sie ändern nun konsistent auch den
  Eintrag in `runs` (Umetikettierung muss weiterhin am Laufnachweis scheitern)
  bzw. entfernen `runs` wie ein Projekt vor #7. Die Erwartungen sind unverändert.
- Green auf dem Commit-Stand: `npm test` 82 Tests (13 Dateien, mit echten
  Python-Läufen), `npm run test:backend` 28 Tests, `npm run build` (inkl.
  Typprüfung), `npm run test:desktop` 24 Electron-/WebGL-Tests, `git diff --check`
  und `npx prettier --check src tests` bestanden. Screenshot visuell geprüft.

Keine Änderung an Python-Adapter, Topologie oder Binärtransfer; Benchmarks sind
nicht einschlägig. Windows/Linux wurden nicht geprüft. Die PID-Prüfung anderer
Sitzungen kann bei wiederverwendeter PID eine verwaiste Sitzung zu lange
behalten, aber nie eine aktive löschen. Gleichzeitig laufende Instanzen einer
Version vor #7 nutzen den flachen Altordner; dessen Bereinigung erfolgt deshalb
nur auf ausdrücklichen Klick. GitHub Actions starten wegen der in [CI.md](CI.md)
dokumentierten Billing-Sperre weiterhin keine Runner; es gibt keinen CI-Nachweis.

Status: lokal verifiziert, unabhängige Review steht aus; nicht gepusht.
