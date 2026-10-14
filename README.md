# Femantis Desktop

Electron-Desktopoberfläche für die Python-FEM-Toolbox. Version 0.2 bietet Modellerstellung, Bearbeitung, stationäre Berechnung und interaktive 3D-Ergebnisse.

## Starten

Voraussetzungen: Node.js mit npm, Python 3.11–3.13 und eine mit `gh auth login` angemeldete GitHub-Sitzung mit Zugriff auf `maschin96/FEM-Toolbox`. Die Toolbox bleibt eine separate Abhängigkeit; der geprüfte Commit ist festgelegt.

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

1. Ein Netz öffnen oder links **Quader erstellen** wählen. Abmessungen werden in mm eingegeben; die Berechnung verwendet m. Der Quader erhält ein Tet4-Netz, eine Volumengruppe und sechs Flächengruppen (`x_min` bis `z_max`).
2. **Modell erstellen** wählen. Für einen neuen Quader wird der Editor automatisch geöffnet. Bei vorhandenem Modell heißt die Aktion **Modell neu erstellen** und verlangt eine Bestätigung zum Zurücksetzen von Materialien, Zuordnungen, Randbedingungen und Lasten. **Abbrechen** oder Escape erhält den Entwurf; zum Bearbeiten die Physikaktion in der Seitenleiste oder **Modell** wählen. Ein bestätigter Neustart behält Netz und Physik; bisherige Ergebnisse bleiben als **Vorheriger Modellstand** verfügbar.
3. Physik wählen: **stationäre Wärmeleitung**, **lineare Elastizität** oder **Elektrostatik**. Ein Physikwechsel setzt Materialien und Randbedingungen für einen neuen Entwurf zurück.
4. Materialwerte und Regionszuordnungen bearbeiten. Bei überlappenden Volumengruppen müssen die Zuordnungen übereinstimmen. Neue Materialien erst zuordnen; unbenutzte Materialien oder Lücken meldet die Toolbox.
5. Randbedingungen hinzufügen: Temperatur/Potential/Verschiebung, Wärmestrom, Konvektion, Flächenlast oder Flächenladung. Mechanische Komponenten lassen sich einzeln festlegen. Volumenquellen/-kräfte/-ladungen sind zusätzlich möglich.
6. **Modell prüfen**, danach **Berechnen**. Die Toolbox prüft Materialwerte, Einheiten, Referenzen, Lagerungen und kollidierende Randbedingungen. Der Python-Prozess kann über **Berechnung abbrechen** beendet werden.
7. Unter **Ergebnisse** Feld und Komponente wählen. Knotenwerte werden auf Darstellungsdreiecken linear interpoliert, Zellwerte bleiben ohne Glättung. Farbskalen haben Einheiten; eigene Grenzen werden gekennzeichnet. Für Verschiebungen ist ein expliziter Verformungsfaktor verfügbar. Rohwerte der angeklickten Fläche erscheinen als Auswahlwerte, Bilanzen und Eingabehash unter den Kennwerten.
8. **Speichern** erhält Netz, Modellentwurf, Ansicht und den ausgewählten Berechnungslauf. Änderungen am Modell markieren vorhandene Ergebnisse als **Vorheriger Modellstand**. Auch ein solcher Lauf kann gemeinsam mit dem neueren Entwurf gespeichert werden; die Kennzeichnung bleibt nach Wiederöffnung erhalten.

Der vollständige Datensatz der vorhandenen Toolbox-Model-API kann zusätzlich als JSON bearbeitet werden. So bleiben Tensoren und explizite Knotenlisten erhalten. Textänderungen zuerst **Übernehmen** oder **Textentwurf verwerfen**; Speichern, Berechnung und Navigation sind bis dahin gesperrt.

JSON-Übernahme, TOML-Import und Projektöffnung prüfen die für den Editor erforderlichen Tabellen und Zahlen-/Vektorstrukturen. Bei Ablehnung nennt die Meldung den betroffenen Datenpfad (z. B. `boundary.traction[0].value`); der bisherige Arbeitsstand bleibt erhalten. Fehlerhafte vorhandene Entwürfe lassen sich im vollständigen Datensatz korrigieren. Physikalische Gültigkeit, Einheiten, Referenzen und netzabhängige Dirichlet-Vektorlängen prüft weiterhin **Modell prüfen** über die Toolbox.

**TOML öffnen/exportieren** verwendet das bestehende Model-Schema 1. Beim Export wird eine zugehörige Netzdatei daneben abgelegt. Gmsh-Fälle lassen sich auch mit `Model.from_file` direkt in der Toolbox öffnen. Für VTU-Fälle verwendet Desktop den öffentlichen Weg `read_vtu` → `Model(mesh=..., document=...)`; die Toolbox-`from_file`-Methode erwartet Gmsh.

Drei fertige Beispiele: [Wärmeleitung](examples/heat.toml), [Elastizität](examples/elasticity.toml), [Elektrostatik](examples/electrostatics.toml). Nach **Modell erstellen → TOML öffnen** kann eines gewählt und direkt berechnet werden. Beim Start wird weiterhin das reine Kragträgernetz geladen.

Projektdateien mit Modellen/Ergebnissen verwenden Desktop-Schema 2; reine Viewer-Projekte mit Schema 1 bleiben lesbar. Bei Weitergabe Projektdatei und gesamten `.files`-Ordner zusammen kopieren. Laufordner enthalten Eingabesnapshot, Netz sowie das unveränderte VTU/JSON-Ergebnisbündel der Toolbox.

Der erste Rechenumfang ist linear und stationär. Tet10-Rechnungen sind über die vorhandenen Toolbox-Operatoren möglich; die nodale Viewer-Darstellung auf Triangle6-Teilflächen bleibt eine ausdrücklich lineare Darstellungsapproximation, keine exakte quadratische Feldinterpolation. Schwerpunktfelder sind gekennzeichnet. CAD-Bearbeitung, gekoppelte Physiken, Zeit-/Frequenzserien und Installationspakete folgen separat.

## Prüfungen

```sh
npm test
npm run test:backend
npm run build
npm run test:desktop
npm run benchmark
```

`test:backend` verwendet die lokale macOS/Linux-Python-Umgebung; auf Windows entsprechend `.venv\Scripts\python.exe -m unittest discover -s tests/backend -v` ausführen. Desktoptests starten ein echtes Electron-Fenster und automatisieren native Dateidialogantworten. `benchmark` misst ausschließlich Python-Topologie und Binärpuffer, keine interaktiven FPS.

Die GitHub-Prüfjobs und das für die private Toolbox nötige Lesesecret sind unter [CI](Doc/CI.md) beschrieben.

## Dokumentation

- [UI-, Architektur- und Umsetzungsplan](Doc/ELECTRON_UI_PLAN.md)
- [Umsetzungsumfang und Abnahme](Doc/IMPLEMENTATION.md)
- [Modellerstellung und Berechnungsnachweise](Doc/MODELLING_IMPLEMENTATION.md)
- [Beispielnetze und Herkunft](examples/README.md)

Basis: [maschin96/FEM-Toolbox](https://github.com/maschin96/FEM-Toolbox), Version 1.4.0, Commit `baae07f088a87ce6e256af3c5855a3b110d0f17a`. Produktname: Femantis; Python-Import: `fem_toolbox`. Erstentwicklung auf macOS/Apple Silicon. Windows/Linux und eine mitgelieferte Python-Runtime sind noch keine geprüften Auslieferungsziele.
