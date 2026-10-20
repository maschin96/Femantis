# Femantis Desktop

Electron-Desktopoberfläche für die Python-FEM-Toolbox. Version 0.2 bietet Modellerstellung, Bearbeitung, stationäre Berechnung und interaktive 3D-Ergebnisse.

## Starten

Voraussetzungen: Node.js mit npm, Python 3.11–3.13 und Internetzugang. `npm run setup:backend` lädt den festgelegten Commit der öffentlichen [FEM-Toolbox](https://github.com/maschin96/FEM-Toolbox) (MIT) ohne GitHub-Anmeldung über pip. Die Toolbox bleibt eine separate Abhängigkeit.

```sh
npm ci
npm run setup:backend
npm run dev
```

Die lokale Umgebung dieses Projekts ist bereits eingerichtet. Hier genügt `npm run dev`. Electron lädt seine plattformspezifische Laufzeit beim ersten Start. Bei langsamen offiziellen Downloads kann für diesen Download `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` gesetzt werden; Electron prüft die Datei gegen die mitgelieferten offiziellen SHA-256-Werte.

Produktionsbuild ohne Entwicklungsserver:

```sh
npm run build
npm start
```

Eine andere eingerichtete Python-Umgebung lässt sich mit `FEMANTIS_PYTHON=/absoluter/pfad/python` verwenden. Dieser Desktopstand erwartet FEM-Toolbox 1.4.0. Auf Windows liegt die automatisch eingerichtete Runtime unter `.venv/Scripts/python.exe`.

## macOS-Paket (Apple Silicon)

```sh
npm run package:mac
npm run test:package
```

`package:mac` erzeugt `dist/Femantis-<version>-mac-arm64.dmg` mit gebündeltem CPython 3.13.16 und FEM-Toolbox 1.4.0 sowie Build-Manifest und `SHA256SUMS`. Die App benötigt auf dem Zielrechner weder Node.js noch Python oder Internetzugang. Developer-ID-Signierung und Notarisierung sind bewusst zurückgestellt: Die App ist nur ad hoc signiert, und Gatekeeper verlangt beim ersten Start eine Freigabe unter **Systemeinstellungen → Datenschutz & Sicherheit**. Paketierungsentscheidung, Smoke-Tests und Releasecheckliste: [Auslieferung](Doc/RELEASE.md).

## Verfügbare Bedienung

- Bauteilaußenhaut, Tet4-/geradkantige Tet10-Netze, Netzkanten und Oberflächenknoten.
- Drehen, zoomen, verschieben, Standardansichten und „Alles einpassen“.
- Kleines Koordinatensystem unten links: X rot, Y grün, Z blau. Pfeile zeigen die positiven globalen Achsenrichtungen und folgen der Kameradrehung; Größe und Position bleiben beim Zoomen und Verschieben konstant.
- Volumen-/Flächengruppen auswählen, hervorheben und ausblenden; überlappende Gruppen bleiben erhalten. Ausgeblendete Gruppen schließen ihre Flächen aus, auch wenn diese zugleich zu einer sichtbaren Gruppe gehören.
- Eine Außenfläche anklicken: Original-Element-ID, Flächen-ID falls vorhanden, Gruppen und Koordinaten der dargestellten Flächenknoten erscheinen rechts. Bei Tet10 sind dies die drei Knoten der angeklickten Teilfläche.
- Gmsh (`.msh`) und Toolbox-kompatible VTU-Netze (`.vtu`) öffnen. Gmsh-Einheit m/mm vor dem Import wählen; VTU verlangt m. Oberflächennetze ohne Tetraeder sind noch nicht unterstützt.
- Projekte als `.femantis.json` speichern und öffnen; `⌘S`/`Ctrl+S` speichert, Escape hebt die Auswahl auf. Neben der Projektdatei entsteht ein `.files`-Ordner mit der unveränderten Netzdatei. Für Weitergabe beide zusammen kopieren.
- Originaldaten in Double-Präzision; 64-Bit-IDs als Strings; zentrierte GPU-Anzeigedaten. Tet10-Flächen werden zur Ansicht unterteilt; die FEM-Topologie bleibt unverändert.

Der Gmsh-Reader der Toolbox 1.4.0 liefert keine Original-Gmsh-IDs. Der Inspector benennt diese Zuordnung deshalb als interne Indizes. Vorhandene Original-IDs aus Toolbox-VTU-Metadaten bleiben erhalten, einschließlich großer 64-Bit-Werte.

## Modelle erstellen, bearbeiten und berechnen

1. Links unter **Netz laden** ein Netz öffnen, **Quader erstellen** oder ein Beispiel wählen. Abmessungen werden in mm eingegeben; die Berechnung verwendet m. Der Quader erhält ein Tet4-Netz, eine Volumengruppe und sechs Flächengruppen (`x_min` bis `z_max`).
2. In der Karte **Nächster Schritt** rechts **Modell erstellen** wählen. Die Karte bietet je Zustand genau eine passende Aktion (Modell erstellen, **Zur Berechnung**, **Ergebnisse ansehen**); erledigte Schritte sind in der Ablaufleiste oben grün markiert. Für einen neuen Quader wird der Editor automatisch geöffnet. Bei vorhandenem Modell bietet die Karte zusätzlich **Modell neu erstellen**; diese Aktion verlangt eine Bestätigung zum Zurücksetzen von Materialien, Zuordnungen, Randbedingungen und Lasten. **Abbrechen** oder Escape erhält den Entwurf; zum Bearbeiten in der Ablaufleiste **Modell** wählen. Ein bestätigter Neustart behält Netz und Physik; bisherige Ergebnisse bleiben als **Vorheriger Modellstand** verfügbar.
3. Physik wählen: **stationäre Wärmeleitung**, **lineare Elastizität** oder **Elektrostatik**. Ein Physikwechsel setzt Materialien und Randbedingungen für einen neuen Entwurf zurück.
4. Materialwerte und Regionszuordnungen bearbeiten. Bei überlappenden Volumengruppen müssen die Zuordnungen übereinstimmen. Neue Materialien erst zuordnen; unbenutzte Materialien oder Lücken meldet die Toolbox.
5. Randbedingungen hinzufügen: Temperatur/Potential/Verschiebung, Wärmestrom, Konvektion, Flächenlast oder Flächenladung. Mechanische Komponenten lassen sich einzeln festlegen. Volumenquellen/-kräfte/-ladungen sind zusätzlich möglich.
6. **Modell prüfen**, danach **Berechnen**. Die Toolbox prüft Materialwerte, Einheiten, Referenzen, Lagerungen und kollidierende Randbedingungen. Der Python-Prozess kann über **Berechnung abbrechen** beendet werden.
7. Unter **Ergebnisse** Feld und Komponente wählen. Knotenwerte werden auf Darstellungsdreiecken linear interpoliert, Zellwerte bleiben ohne Glättung. Farbskalen haben Einheiten; eigene Grenzen werden gekennzeichnet. Anzeigewerte werden vor der GPU-Übertragung in Double-Präzision auf die gewählte Skala normiert, damit kleine Unterschiede auf großem Grundwert sichtbar bleiben. Die Farbbegrenzung erfolgt erst nach der Interpolation; Rohwerte bleiben unverändert. Für Verschiebungen ist ein expliziter Verformungsfaktor verfügbar. Rohwerte der angeklickten Fläche erscheinen als Auswahlwerte, Bilanzen und Eingabehash unter den Kennwerten.
8. Unter **Berechnungsläufe** stehen alle Läufe des Arbeitsstands mit Kennung (`Lauf <UUID-Präfix>`), Zeitpunkt, Physik, Eingabehash, Modellstand und Speicherort (**Nur lokal**/**Im Projekt**). Ein Klick zeigt einen älteren Lauf an; der angezeigte Lauf lässt sich nicht entfernen. **Speichern** erhält Netz, Modellentwurf, Ansicht, alle aufgeführten Läufe und die Auswahl. Änderungen am Modell markieren vorhandene Ergebnisse als **Vorheriger Modellstand**. Auch ein solcher Lauf kann gemeinsam mit dem neueren Entwurf gespeichert werden; die Kennzeichnung bleibt nach Wiederöffnung erhalten.

Der vollständige Datensatz der vorhandenen Toolbox-Model-API kann zusätzlich als JSON bearbeitet werden. So bleiben Tensoren und explizite Knotenlisten erhalten. Textänderungen zuerst **Übernehmen** oder **Textentwurf verwerfen**; Speichern, Berechnung und Navigation sind bis dahin gesperrt.

JSON-Übernahme, TOML-Import und Projektöffnung prüfen die für den Editor erforderlichen Tabellen und Zahlen-/Vektorstrukturen. Bei Ablehnung nennt die Meldung den betroffenen Datenpfad (z. B. `boundary.traction[0].value`); der bisherige Arbeitsstand bleibt erhalten. Fehlerhafte vorhandene Entwürfe lassen sich im vollständigen Datensatz korrigieren. Physikalische Gültigkeit, Einheiten, Referenzen und netzabhängige Dirichlet-Vektorlängen prüft weiterhin **Modell prüfen** über die Toolbox.

**TOML öffnen/exportieren** verwendet das bestehende Model-Schema 1. Beim Export wird eine zugehörige Netzdatei daneben abgelegt. Gmsh-Fälle lassen sich auch mit `Model.from_file` direkt in der Toolbox öffnen. Für VTU-Fälle verwendet Desktop den öffentlichen Weg `read_vtu` → `Model(mesh=..., document=...)`; die Toolbox-`from_file`-Methode erwartet Gmsh.

Drei fertige Beispiele: [Wärmeleitung](examples/heat.toml), [Elastizität](examples/elasticity.toml), [Elektrostatik](examples/electrostatics.toml). Nach **Modell erstellen → TOML öffnen** kann eines gewählt und direkt berechnet werden. Beim Start wird weiterhin das reine Kragträgernetz geladen.

Ungespeicherte Läufe liegen im lokalen Laufcache `.cache/runs/session-<uuid>/`, in der paketierten App unter `~/Library/Application Support/Femantis/runs/` (abweichend jeweils über einen absoluten Pfad in `FEMANTIS_RUN_CACHE`). Er ist nicht portabel: Beim Beenden, beim Wechsel des Arbeitsstands und nach dem Speichern werden die Cachekopien gelöscht; nach dem Speichern verweist die Historie auf die Projektkopien. Sitzungen abgestürzter Instanzen entfernt der nächste Start. **Cache bereinigen** löscht zusätzlich Laufordner älterer Versionen (`.cache/runs/<uuid>`); Läufe der Historie und anderer laufender Instanzen bleiben erhalten. Projektordner werden nie bereinigt; ein aus der Historie entfernter gespeicherter Lauf bleibt unter `.files/runs` liegen. Details: [Issue-#7-Nachweis](Doc/ISSUE_7_VERIFICATION.md).

Projektdateien mit Modellen/Ergebnissen verwenden Desktop-Schema 2; reine Viewer-Projekte mit Schema 1 bleiben lesbar. Bei Weitergabe Projektdatei und gesamten `.files`-Ordner zusammen kopieren. Laufordner enthalten Eingabesnapshot, Netz sowie das unveränderte VTU/JSON-Ergebnisbündel der Toolbox. Neue Läufe speichern außerdem `model.json` und `run.json`: Der SHA-256-Wert des Laufnachweises steht im Projekt und bindet Originalnetz samt Maßstab, gerechnete Modellrevision, Eingabesnapshot und Ergebnisdateien. Beim Öffnen werden auch Netzgeometrie, Topologie, Feldgrößen und Physik gegen den Lauf geprüft. Veränderte oder fehlende Laufdateien erfordern eine Neuberechnung. Ältere Schema-2-Läufe ohne Laufnachweis bleiben lesbar, werden aber sichtbar als **Zuordnung nicht verifiziert** gekennzeichnet; Speichern stuft sie nicht nachträglich hoch. Der Nachweis schützt die Zuordnung innerhalb eines unveränderten Projekts; er ist keine Signatur gegen eine gemeinsame bewusste Neuschreibung von Projektdatei und allen Laufdateien.

Der erste Rechenumfang ist linear und stationär. Tet10-Rechnungen sind über die vorhandenen Toolbox-Operatoren möglich; die nodale Viewer-Darstellung auf Triangle6-Teilflächen bleibt eine ausdrücklich lineare Darstellungsapproximation, keine exakte quadratische Feldinterpolation. Schwerpunktfelder sind gekennzeichnet. CAD-Bearbeitung, gekoppelte Physiken, Zeit-/Frequenzserien sowie signierte und notarisierte Installationspakete folgen separat.

## Prüfungen

```sh
npm test
npm run test:backend
npm run build
npm run test:desktop
npm run benchmark
npm run benchmark:meshes
npm run benchmark:viewer
```

`test:backend` verwendet die lokale macOS/Linux-Python-Umgebung; auf Windows entsprechend `.venv\Scripts\python.exe -m unittest discover -s tests/backend -v` ausführen. Desktoptests starten ein echtes Electron-Fenster und automatisieren native Dateidialogantworten. `benchmark` misst ausschließlich Python-Topologie und Binärpuffer, keine interaktiven FPS. `benchmark:meshes` erzeugt 100k-/1M-Tet4-Messnetze unter `.cache/viewer-benchmark`; `benchmark:viewer` misst damit in einem echten Electron-/WebGL-Fenster Ladezeit, FPS, Picking, Speicher und Ansichtswechsel (`FEMANTIS_BENCH_CASES`, `FEMANTIS_BENCH_LABEL`). Ergebnisse und Grenzen: [Issue-#8-Nachweis](Doc/ISSUE_8_VERIFICATION.md).

Die GitHub-Prüfjobs sind unter [CI](Doc/CI.md) beschrieben.

## Dokumentation

- [Aktueller Projektstand und offene Abnahmegates](Doc/PROJECT_STATUS.md)
- [UI-, Architektur- und Umsetzungsplan](Doc/ELECTRON_UI_PLAN.md)
- [Umsetzungsumfang und Abnahme](Doc/IMPLEMENTATION.md)
- [Modellerstellung und Berechnungsnachweise](Doc/MODELLING_IMPLEMENTATION.md)
- [Auslieferung und Releasecheckliste](Doc/RELEASE.md)
- [Beispielnetze und Herkunft](examples/README.md)

Basis: [maschin96/FEM-Toolbox](https://github.com/maschin96/FEM-Toolbox), Version 1.4.0, Commit `baae07f088a87ce6e256af3c5855a3b110d0f17a`. Produktname: Femantis; Python-Import: `fem_toolbox`. Erstentwicklung auf macOS/Apple Silicon. Ein ad-hoc-signiertes macOS/Apple-Silicon-Paket mit gebündelter Python-Runtime ist lokal und offline geprüft ([#10](https://github.com/maschin96/Femantis/issues/10)); Developer-ID-Signierung und Notarisierung sind zurückgestellt. Windows/Linux sind noch keine geprüften Auslieferungsziele.

## Lizenz

Femantis Desktop ist freie Software unter der [GNU General Public License, Version 3 oder später](LICENSE) (`GPL-3.0-or-later`). Die FEM-Toolbox und die übrigen Abhängigkeiten behalten ihre eigenen, GPL-kompatiblen Lizenzen; das macOS-Paket bündelt alle Lizenztexte.
