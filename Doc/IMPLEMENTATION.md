# Erster Umsetzungsschnitt: Desktop und Netzviewer

Fortsetzung mit Version 0.2: [Modellerstellung, Bearbeitung und Berechnung](MODELLING_IMPLEMENTATION.md). Die folgenden Angaben dokumentieren den ersten Viewer-Schnitt vom 13.10.2026; der [aktuelle Projektstand](PROJECT_STATUS.md) trennt spätere GitHub-Integration und offene Abnahmegates davon.

Arbeitsbeginn: 13.10.2026. Lokale Arbeitspakete D0–D2 gemäß `ELECTRON_UI_PLAN.md`. Zum Zeitpunkt dieses ersten Viewer-Schnitts besaß das Desktopprojekt noch kein eigenes GitHub-Repository; seit dem 13.10.2026 liegt es unter [maschin96/Femantis](https://github.com/maschin96/Femantis). Die FEM-Toolbox wird als eingefrorene Abhängigkeit verwendet und nicht geändert. Die damalige offene Zuordnung zu Issues und Integrationsbranch ist eine historische Aussage, kein heutiger Status.

## Ziel und Akzeptanz

- Electron-Fenster mit deutscher Oberfläche und Femantis-Farben.
- Separater Python-Adapter mit Versionserkennung und binären Netzpuffern.
- Gmsh-/VTU-Netze mit Tet4 oder geradkantigen Tet10 importieren.
- Bauteilaußenhaut, Netzkanten und Knoten darstellen; innere gemeinsame Flächen ausblenden.
- Gruppen auswählen, hervorheben und ausblenden; Oberflächenauswahl auf Original-IDs zurückführen.
- Projekt samt importierter Netzdatei und Ansicht speichern und erneut öffnen.
- Verständliche Fehler bei fehlender Runtime, ungültigem Netz oder Projektformat.

## Verifikation

Vor Implementierung Tests für Außenflächen zweier benachbarter Tetraeder, Tet10-Unterteilung, überlappende Gruppen, große externe IDs, Binärdaten, Projektpfade und Darstellungsfilter ausführen. Danach Python-/TypeScript-Tests, Typprüfung, Produktionsbuild und echte Electron-Abläufe einschließlich WebGL, Import, Auswahl, Speicherung und Wiederöffnung prüfen. Ein gemessener Adapterbaseline wird getrennt vom interaktiven FPS-Ziel dokumentiert.

Modelleditor, Berechnung, Ergebnisfelder, CAD-Import, Installationspakete und gebündelte Python-Runtime folgen in weiteren Arbeitspaketen. Keine aktiven Schaltflächen für noch nicht implementierte Funktionen.

## Implementierter Stand

Desktopgerüst mit React/TypeScript und Three.js, isolierter Preload-Schnittstelle und Python-Importprozess. Das Backend benutzt die vorhandene Toolbox-Topologie, erzeugt Little-Endian-Binärpuffer und liefert vorhandene Original-ID-/Gruppenzuordnungen. Fehlende Original-IDs werden im Inspector als interne Indizes bezeichnet. Konkret liefert der bestehende Gmsh-Reader keine Original-IDs; Toolbox-VTU-Metadaten können sie bereitstellen. Diese Reader-Grenze wird nicht durch einen zweiten Gmsh-Parser verdeckt.

Das Beispiel Tet4 umfasst 108 Knoten, 288 Zellen und 184 Außenflächen; das Tet10-Fixture umfasst 10 Knoten, eine Zelle und 4 Außenflächen mit 16 Darstellungsdreiecken. Gruppen können hervorgehoben und ausgeblendet werden. Knotenanzeige zeigt die aktuell sichtbaren Oberflächenknoten. Außenflächenauswahl, Kamera, Bauteil-/Netzansicht und portable Projektspeicherung sind implementiert.

Projektdatei: `.femantis.json` mit Desktop-Schema 1, Maßstab, Kamera und Gruppensichtbarkeit. Zugehöriger `.files`-Ordner enthält eine unveränderte, SHA-256-identifizierte Netzdatei. Beschädigte Dateien und Pfade außerhalb des Projektverzeichnisses werden abgelehnt. Backend-Anfragen werden über einen eigenen stdio-Prozess abgewickelt; große Koordinaten-/Indexarrays werden binär übertragen.

### Prüfergebnisse des ersten Viewer-Schnitts (13.10.2026)

- Python: 8 Tests bestanden. Zuerst schlugen 5 Akzeptanzfälle wegen der noch fehlenden Netz-/Binärimplementierung fehl; anschließend bestanden diese und die ergänzten Fehler-/Protokollprüfungen.
- TypeScript/Integration: 11 Tests bestanden, einschließlich echter Python-Aufrufe, überlappender Tet10-Gruppen und Projektspeicherung mit Hash-/Symlinkprüfung.
- TypeScript-Typprüfung und Produktionsbuild bestanden; Frontenddateien einheitlich formatiert.
- npm-Abhängigkeitsprüfung ohne gemeldete Sicherheitsbefunde am 13.10.2026.
- [Adapterbaseline](evidence/backend-baseline.json): 6.000 Tet4-Zellen, 1.386 Punkte, 1.400 Außenflächen; Topologie rund 0,65 s, Binärschreiben rund 0,0007 s auf macOS/arm64 mit Python 3.13.7. Das ist kein FPS-Nachweis.

Echte Desktop-/WebGL-Prüfung: **3 Tests bestanden** unter Electron 44.7.0. Geprüft wurden WebGL2, Tet4/Tet10, Ansichtswechsel, Gruppen-/Sichtbarkeitssteuerung, Gmsh-/VTU-Import, Flächenauswahl, Original-IDs oberhalb der sicheren JavaScript-Zahlengrenze sowie Speichern/Wiederöffnen einschließlich Kamera, Maßstab und Auswahl. Native Dateidialogantworten wurden an der Infrastrukturgrenze automatisiert; Datenverarbeitung und Electron-Fenster liefen echt. Keine JavaScript-Laufzeitfehler beobachtet.

Die [Tet4-Aufnahme](evidence/desktop-tet4.png) und [Tet10-Aufnahme](evidence/desktop-tet10.png) wurden visuell geprüft. Die automatische Kameraeinpassung wurde nach einer zunächst zu knappen Tet10-Ansicht auf eine umschließende Kugel umgestellt; die Desktoptests bestanden danach erneut. Das aktuelle Signet ist eine geometrische Zwischenlösung, kein freigegebener Produktions-Logo-Master.

Der erste Desktoptest machte eine falsche Erwartung an Gmsh-Original-IDs sichtbar. Der korrigierte Test unterscheidet den tatsächlichen Gmsh-Indexvertrag von Original-IDs eines über die öffentliche Toolbox-API geschriebenen VTU-Netzes. Es wurden keine Readerdaten umgedeutet oder ursprüngliche IDs erfunden.

Die langsame Electron-Installation wurde abgeschlossen und die Laufzeit gegen die offizielle SHA-256-Prüfsumme verifiziert. Der frühere abgebrochene Downloadstart gilt nicht als Desktopprüfung; maßgeblich sind die anschließenden erfolgreichen Tests. Insgesamt bestanden **22 Prüfungen** (11 TypeScript-/Integrations-, 8 Python- und 3 Desktoptests).

### Grenzen dieses Schnitts

Dieser Schnitt enthielt noch keine Solver-/Ergebnisoberfläche und keinen CAD-Kern. Keine Prüfung des 100.000-Zellen-/30-FPS-Ziels oder von Installationspaketen. Python-/Frontend-Abhängigkeiten waren für den damaligen lokalen Stand fixiert; numerische Kernverifikation und experimentelle Validierung wurden durch den Viewer nicht erweitert. Entwicklung und Adapterprüfungen liefen auf macOS/Apple Silicon; Windows/Linux waren nicht praktisch geprüft. Die damalige Aussage „kein Commit, PR oder GitHub-Issue“ galt nur vor der Repository-Einrichtung. Spätere Modellfunktionen und Integration sind im [Projektstand](PROJECT_STATUS.md) verzeichnet.
