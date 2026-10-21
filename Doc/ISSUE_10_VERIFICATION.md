# Issue #10: macOS-Auslieferung mit gebündelter Python-Runtime

Bezug: [Issue #10](https://github.com/maschin96/Femantis/issues/10), Branch
`codex/10-macos-packaging`, Basis `6c60ac3` (`main`), 20.10.2026. Paketierung,
Lizenz, Signaturentscheidung und Releasecheckliste: [RELEASE.md](RELEASE.md).

Umgebung: MacBook Pro, Apple Silicon (arm64), macOS 27.0.1, Xcode 26.5, Node.js
25.8.2, npm 11.11.1, Playwright 1.64.0, Electron 44.7.0. Das Repository liegt in einem
per iCloud synchronisierten Ordner „Dokumente“; das deckte den unten beschriebenen
Signaturfehler auf.

## Abnahmekriterien

| Kriterium | Stand | Nachweis |
|---|---|---|
| Reproduzierbares Paket mit festgelegter Toolbox und Python ohne Entwicklercheckout erzeugbar | erfüllt (Inhalt maschinenübergreifend, Signatur je Maschine) | `npm run package:mac`: CPython 3.13.16 (python-build-standalone `20261003`, SHA-256 gegen Release-Digest und `SHA256SUMS` geprüft), Toolbox 1.4.0 vom gepinnten Commit, Pakete nach `backend/constraints.txt` (`--check-constraints` im Build). Der signaturunabhängige `contentDigest` ist zwischen Maschinen gleich: lokal (macOS 27.0.1, zwei Builds) und in der CI (macOS 15, Lauf [39462473949](https://github.com/maschin96/Femantis/actions/runs/39462473949)) jeweils `b8a8bc80fa37c6847c5a711d5cabb2465e123af8a13d491ba9496e333510bcce`, Inhaltsmanifeste bytegleich. Der `bundleDigest` über die signierten Bytes ist auf derselben Maschine gleich (lokal zweimal `6eb88103…585e`; die ausgelagerte Funktion ergibt am alten lokalen Bundle unverändert `c6335973…1350`), zwischen macOS-Versionen nicht (CI `5c808cf1…4a5a`), weil `codesign` versionsabhängig signiert; siehe Befunde. Das DMG ist wegen Zeitstempeln nicht bitgleich. Die App braucht weder Checkout noch `.venv`. |
| Backend/Beispiele aus Ressourcenpfaden; Cache/Benutzerdaten außerhalb schreibgeschützter Ressourcen | erfüllt | `src/main/runtime.ts` mit 6 Vitest-Fällen; Paket: `Contents/Resources/{python,backend,examples}`, Laufcache `~/Library/Application Support/Femantis/runs`. Python startet mit `-E -s -B`; ein Test belegt, dass der echte Adapter so rechnet, ohne Bytecode neben den Adapter zu schreiben. Nach jedem Paket-Smoke-Test besteht `codesign --verify --deep --strict` am benutzten Bundle (keine Schreibzugriffe ins Bundle). |
| Sauberes Zielsystem ohne Node, gh und Entwicklungs-.venv: offline importieren, rechnen, speichern, wieder öffnen | teilweise | Lokal simuliert, kein zweiter Mac: DMG eingehängt, App außerhalb des Repos kopiert, frisches `HOME`, eigener Benutzerdatenordner, `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, keine `FEMANTIS_*`. Mit `FEMANTIS_PACKAGE_SANDBOX=1` zusätzlich Seatbelt: Netz nur Loopback, kein Lesezugriff auf Repository, Homebrew und python.org-Framework (Negativkontrollen: `curl` per Name und IP scheitert, `cat` im Repo und Start des python.org-Pythons verweigert). Gebündelte Mach-O-Dateien linken nur `/usr/lib`, `/System` und das Bundle (Build-Guard). Zusätzlich beobachtet auf einem frischen GitHub-Runner `macos-15-arm64` (Image 20260907.0337.1) ohne `setup-python` und `.venv`: Lauf [39415699111](https://github.com/maschin96/Femantis/actions/runs/39415699111), Build aus sauberem Arbeitsbaum (`workingTreeClean: true`), `test:package` 7/7 und offline 7/7. Ein manuell bedienter Zweitrechner steht aus. |
| Lizenzen/Notices gebündelt; Anwendungssymbol | erfüllt | Femantis selbst: GPL-3.0-or-later (`LICENSE`, unveränderter GPLv3-Text von gnu.org, SHA-256 `3972dc97…6986`; Entscheidung des Eigentümers vom 20.10.2026), im Paket unter `licenses/femantis/`. `Contents/Resources/licenses/` und `Lizenzen/` im DMG: CPython plus gelinkte Bibliotheken (aus dem vollständigen Archiv desselben Builds, SHA-256 gepinnt), alle 8 Python-Distributionen, Electron/Chromium, alle 6 Module in `app.asar`, Toolbox-Beispielnetz. Ein fehlender Text bricht den Build ab. Symbol: `build/icon.svg` → `build/icon.icns`. Alle Drittlizenzen sind GPL-3.0-kompatibel. |
| Signierung/Notarisierung und Artefaktintegrität: geprüfter Weg oder benannte Blocker | erfüllt (Developer ID zurückgestellt) | Entscheidung des Eigentümers vom 20.10.2026: Developer-ID-Signierung und Notarisierung zurückgestellt; Gatekeeper-Freigabe ist in README und RELEASE.md beschrieben. Ad-hoc-Signatur aller 138 gebündelten Mach-O-Dateien und des Bundles, im Build und im eingehängten DMG verifiziert; `SHA256SUMS` und `build.json`. Für später fehlen Developer-ID (`security find-identity` → 0 Identitäten), Notarisierungszugangsdaten und ein geprüfter Developer-ID-Signaturweg. |
| Releasecheckliste trennt Build, Integration, Tag, Veröffentlichung | erfüllt | [RELEASE.md](RELEASE.md), Gates 1–4. |

## Befunde während der Umsetzung

- `extraResource` von `@electron/packager` schrieb die relativen Symlinks der Python-
  Runtime (`bin/python3 → python3.13`) in absolute Pfade auf den Build-Ordner um. Das
  Paket wäre auf jedem anderen Rechner defekt gewesen. Ressourcen werden jetzt per
  `ditto` kopiert; ein Guard verbietet Symlinks, die aus dem Bundle zeigen.
- Im iCloud-synchronisierten Checkout setzte der File Provider `com.apple.FinderInfo`
  auf das `.app`; die Signatur war danach auch im DMG ungültig. Bau und Signatur laufen
  jetzt in einem temporären Ordner, die Signatur wird im eingehängten DMG geprüft.
- Nicht deterministisch waren zunächst pip-Konsolenskripte (Build-Pfad im Shebang),
  Bytecode mit Build-Pfad in `co_filename` und eine einzelne `.pyc` eines SciPy-
  Testmoduls. Behoben durch Entfernen der unbenutzten Skripte samt `RECORD`-Zeilen,
  `compileall -f -s` (sequenziell, `unchecked-hash`) und Ausschluss von Testordnern.
- Der erste CI-Lauf des Paketjobs (39397467382) scheiterte: `node_modules/electron/dist`
  existiert nach `npm ci` nicht, weil Electron 44 die Laufzeit erst beim ersten Start lädt.
  Die Electron-Lizenztexte kommen jetzt aus der vom Packager gebündelten Distribution
  (`cbc6673`); lokal in einem frischen Klon ohne `electron/dist` nachgestellt (7/7, offline 7/7).
- Ein lokaler Build im iCloud-Checkout blieb beim Lesen einer von iCloud ausgelagerten
  Datei in `node_modules` hängen. Für lokale Paketbuilds den Checkout außerhalb von
  iCloud ablegen oder dauerhaft lokal halten.
- Maschinenübergreifend abweichender `bundleDigest` (lokal macOS 27.0.1, Xcode 26.5,
  `codesign-135.0.6`: `c6335973…1350`; CI `macos-15-arm64`, Image 20260907.0337.1:
  `caa911b7…39e8`). Der Paketjob lädt die Einzelmanifeste jetzt als Artefakt
  `bundle-manifest` hoch; für die Untersuchung wurde vorübergehend auch das DMG gesichert
  (Lauf [39453112998](https://github.com/maschin96/Femantis/actions/runs/39453112998)).
  Von 6662 Einträgen wichen 152 ab, aus zwei Ursachen:
  1. **`app.asar`:** Das CI-Archiv enthielt zusätzlich den leeren Ordner
     `node_modules/@napi-rs` (Lockfile-Eintrag nur für `@napi-rs/lzma-linux-x64-gnu`;
     `npm ci` auf dem Runner mit Node 22.23.2 legt den Scope-Ordner an, lokal mit
     npm 11.11.1 nicht). Sonst waren Header und Dateien gleich. Packager schreibt den
     Integritätshash des Archivs in `Info.plist` (`ElectronAsarIntegrity`) und als
     32 Byte in das Electron-Framework-Binary; damit änderten sich auch diese und die
     Hauptprogrammsignatur. Behoben: leere Ordner unter `node_modules` werden nach dem
     Prune entfernt (`removeEmptyDirectories`).
  2. **`codesign`:** 148 der 151 Mach-O-Dateien unterschieden sich nur in der
     Signatur; die 3 übrigen (`libffmpeg.dylib`, `libvk_swiftshader.dylib`, `ShipIt`)
     werden nicht neu signiert und tragen weiter die Linker-Signatur. Am Beispiel
     `numpy/random/_pcg64…so` (aus dem Wheel `numpy-2.5.4-…-macosx_14_0_arm64`
     nachgestellt): Code-Seiten bytegleich, lokal 10 Hashes über 16-KiB-Seiten, in der
     CI 37 Hashes über 4-KiB-Seiten; lokales `codesign --pagesize 4096` ergibt denselben
     Superblob (1418 Byte, gleich bis auf den Hash der ersten Seite, die die von der
     Signaturgröße abhängigen Header-Felder enthält), die CI-Datei reserviert dahinter aber 18006 Nullbytes
     (`datasize` 19424). Ein lokales `--pagesize 16384` reproduziert die lokale Datei
     bytegleich. Da sich der reservierte Platz nicht steuern lässt, ist die signierte
     Ausgabe zwischen macOS-Versionen nicht angleichbar. Dokumentiert in
     [RELEASE.md](RELEASE.md); der neue `contentDigest` vergleicht stattdessen den
     Inhalt ohne Signaturen.
  Nach der Korrektur weichen zwischen lokal und CI nur noch die 148 neu signierten
  Mach-O-Dateien und die 2 `CodeResources`-Siegel ab; `Info.plist` und `app.asar` sind
  gleich.
- `productName` ist jetzt `Femantis`; Electron legt Benutzerdaten damit unter
  `Application Support/Femantis` statt `femantis-desktop` ab (auch im Entwicklungsmodus).
- Eine kaputte Netzdatei meldet die App mit „Python-Adapter konnte das Netz nicht
  verarbeiten: … as gmsh“ – unverändertes Verhalten, im Paket wie im Checkout.

## Verifikation

- Red: `tests/runtime.test.ts` scheiterte am fehlenden Modul `src/main/runtime`;
  die neuen Fälle in `tests/backend.test.ts` scheiterten, weil das Backend nur einen
  Repository-Pfad annahm (4 rot).
- Green nach Merge von `main` (#9, #11): `npm run typecheck` grün; `npm test` 113 Tests;
  `npm run test:backend` grün; `npm run test:desktop` 26 Tests (zweimal; ein früherer
  Durchlauf hatte einen einmaligen Fehlschlag im neuen Tet10-Test aus #9, einzeln und
  danach grün); `npm run test:package` 7 Tests, mit `FEMANTIS_PACKAGE_SANDBOX=1`
  ebenfalls 7. Das gebündelte Python erhält `-X utf8`, weil `-E` das von #11 gesetzte
  `PYTHONUTF8` ignoriert. Prettier, YAML-Parse des Workflows und `git diff --check` sauber.
- `contentDigest`/asar (#10, Nachtrag): Red – `tests/bundle-digest.test.ts` scheiterte am
  fehlenden Modul `scripts/bundle-digest.mjs`; die Windows-CI (Lauf 39462473949)
  zeigte danach Rückwärtsschrägstriche in Manifestpfaden (2 rot), Manifestpfade nutzen
  jetzt auf jeder Plattform `/`. Green: 8 Fälle (synthetische Mach-O mit abweichender
  Signatur und Reserve, Universal-Datei, echtes `/usr/bin/true` mit `--pagesize` 4096
  und 16384, leere Scope-Ordner). In einem frischen Klon unter `/tmp`: `npm test`
  121 Tests (ein erster Lauf direkt nach `setup:backend` hatte zwei 5-s-Zeitüberschreitungen
  beim kalten Python-Start, die Wiederholung war grün), `npm run test:backend` 36 Tests,
  `npm run test:package` 7 Tests, `npm run typecheck`, Prettier und `git diff --check` sauber.
- Benchmark nicht ausgeführt: keine Änderung an Topologie oder Binärtransfer.
- CI auf PR #34, Lauf [39415699111](https://github.com/maschin96/Femantis/actions/runs/39415699111):
  alle 9 Jobs grün (Frontend, Backend 3.11/3.12/3.13 und Windows, Desktop macOS/Windows/
  Ubuntu, Package macOS 15). Nach dem Merge auf `main` (`6b86f98`) Lauf
  [39453629804](https://github.com/maschin96/Femantis/actions/runs/39453629804) grün, ebenso
  `main` @ `d35c00c` (Lauf [39479661162](https://github.com/maschin96/Femantis/actions/runs/39479661162), Paket 7/7, offline 7/7).

## Nicht abgedeckt

Developer-ID-Signierung und Notarisierung (zurückgestellt), Gatekeeper-Prüfung eines heruntergeladenen
Artefakts, ein zweiter sauberer Mac, Electron-Fuses, Intel/Universal,
Windows/Linux ([#11](https://github.com/maschin96/Femantis/issues/11)) und
automatische Updates.

Status: lokale Übergabe mit Verifikationslücken. Bau, Pfade, Offline-Betrieb,
Lizenzen einschließlich GPL-3.0-or-later und Checkliste sind lokal belegt.
PR-CI ist grün. Maschinenübergreifend reproduzierbar ist der Bundle-Inhalt
(`contentDigest`), nicht die signierten Bytes (`codesign` je macOS-Version). `main`-CI ist nach dem Merge grün. Offen
ist ein manuell bedienter Zweitrechner; Developer-ID/Notarisierung
bewusst zurückgestellt.
Kein Release veröffentlicht.
