# Modellerstellung, Bearbeitung und Berechnung

Lokale Arbeitspakete D3/D4, aufbauend auf dem Netzviewer. Die Toolbox bleibt unverändert. Ziel: stationäre Wärme, Elastizität und Elektrostatik mit dem bestehenden Model-Schema 1; Formulare für isotrope Materialien, Regionen, Randbedingungen und Lasten, zusätzlich erhaltende Bearbeitung der vollständigen Model-Daten. Quadererzeugung dient als einfacher Einstieg, kein CAD-Kern.

Abnahme: analytische lineare Wärme-/Potentialfelder und axialer Zugfall; Preflight-Fehler; portable Speicherung von Entwurf und Ergebnissen; Originalwerte und Einheiten in der Ergebnisdarstellung; Modellrevision und veraltete Ergebnisse; abbrechbarer Python-Solverprozess; echte Desktopabläufe von der Erstellung bis zum wieder geöffneten Ergebnis. Änderungen sind derzeit lokal; vor GitHub-Integration sind Repository und Issues zuzuordnen.

## Implementierter Stand 0.2.0

- Quader mit frei gewählten positiven Abmessungen und Teilungen, bis 30.000 Tet4-Zellen. Volumengruppe und sechs Außenflächengruppen entstehen aus der Toolbox-Topologie; kein allgemeiner CAD-Kern.
- Drei stationäre Physiken über `fem_toolbox.model.Model`, isotrope Materialformulare, Materialkatalog/-regionen, Dirichlet-Komponenten, Flächenlasten/-ladungen, Fluss/Konvektion und Volumenlasten. Die bestehenden Operatoren und Konventionen bleiben unverändert.
- Zusätzlicher erhaltender Editor für den vollständigen JSON-sicheren Model-Datensatz; keine zweite physikalische Modellspezifikation. Unapplizierte Texteingaben blockieren Speichern/Berechnen/Navigation bis Übernehmen oder Verwerfen.
- TOML-Import und -Export mit Netzdatei. Gmsh-Verträge werden direkt erfüllt; bei VTU nutzt Desktop den öffentlichen Mesh-Konstruktor, da `Model.from_file` Gmsh erwartet.
- Echte Modellprüfung, asynchroner eigener Python-Prozess, tatsächliche Phasenereignisse statt erfundener Prozentangaben, Abbruchsignal und Veröffentlichung nur vollständiger Ergebnisbündel.
- Rohfelder direkt aus `export_result_bundle`: Einheiten, aktive Knotenmasken, Komponentenreihenfolge, Zellbezug und Schwerpunktkennzeichnung bleiben erhalten. RGB-Farben werden erst nach skalarer Interpolation im Fragmentshader bestimmt; Zellwerte sind ohne Material-/Zellglättung. Lineare Darstellungsinterpolation auf Teilflächen ist bei Tet10 eine Approximation und wird als solche dokumentiert.
- Farbskala, Vektorbetrag, Komponenten, Auswahlwerte, Bilanzen und explizite Verformungsanzeige `x + Faktor · u`. Die veränderte Anzeigegeometrie beeinflusst den Solver nicht.
- Desktop-Schema 2 speichert Entwurf, Originalnetz und immutable Laufdateien. Schema 1 bleibt lesbar. Modellvergleich ist unabhängig von Tabellenreihenfolge und Betriebssystem-Locale; Änderungen kennzeichnen ältere Läufe auch nach Wiederöffnung. Eine Quellnetzkennung verhindert die Zuordnung eines Ergebnisses zu einem anderen Netz. Der ursprüngliche Anzeigename des Netzes bleibt erhalten.

## Nachweise

Zunächst scheiterten sechs neue Python-Akzeptanztests gezielt an den noch nicht implementierten Modellfunktionen. Nach Umsetzung bestanden sie; Quader-/Topologieprüfung wurde ergänzt.

- **16 TypeScript-/Integrationstests bestanden:** bestehender Netz-/Projektvertrag, Model-Daten einschließlich Tensoren, deterministischer Modellvergleich, Komponenten/Beträge/Padding, echter Python-Lauf mit Phasen, analytisches Wärmefeld, portables Schema-2-Ergebnis und tatsächlicher Prozessabbruch.
- **15 Python-Tests bestanden:** bisherige Netzprüfungen plus drei analytische Solverfälle, Randbedingungs-/Referenzfehler, TOML-Roundtrip, Hashprüfung beschädigter Ergebnisse sowie Quadergruppen und korrektes Gesamtvolumen.
- **8 Electron-/WebGL-Desktoptests bestanden:** bestehende Viewer-Abläufe plus Quader/Editor, drei Physiken mit echten Solvern, Bearbeitung/Stale-Kennzeichnung, Speichern/Wiederöffnung, TOML-Roundtrip und Schutz unapplizierter Texteingaben. Native Dateidialogantworten wurden automatisiert; Solver, Dateien und WebGL liefen echt. Keine JavaScript- oder Shaderfehler beobachtet.
- **Typprüfung und Produktionsbuild bestanden.** Es wurden keine neuen Laufzeitabhängigkeiten benötigt. Zwei nichtblockierende Rollup-Hinweise betreffen Annotationen im unveränderten Zod-Paket.

Gesamt: **39 bestandene Tests**. [Editor](evidence/model-editor.png), [Wärmeergebnis](evidence/heat-result.png) und [Elastizität](evidence/elasticity-result.png) wurden visuell geprüft.

Die Referenzen sind unabhängige Kontinuumslösungen für den rechteckigen Kragträger: `T=300+50·x/0.12` K, `φ=10·x/0.12` V und bei ν=0 `u_x=(1 MPa/100 GPa)·x`. Absolute Vergleichstoleranzen betragen 1e-9 K, 1e-10 V und 1e-14 m; die Wärmebilanz wird mit 1e-9 W geprüft. Die Größenordnungen und einfachen linearen Referenzfelder begründen diese Adaptertoleranzen; es wurden keine bestehenden Solver-Grenzen aufgeweicht.

## Grenzen und nächste Erweiterungen

Dieser Schnitt bietet keine gekoppelten Piezo-/Thermomodelle, transiente/harmonische Analyse, allgemeine CAD-Modellierung, quadratisch exakte Tet10-Viewerinterpolation oder Zielplattform-Installer. Numerische Kernverifikation und experimentelle Validierung werden durch die GUI nicht erweitert. Die hier ausgeführten Prüfungen liefen auf macOS/Apple Silicon. Commit, PR und GitHub-Issues sind weiterhin nicht angelegt, da dieses lokale Desktopprojekt noch kein eigenes GitHub-Ziel besitzt.
