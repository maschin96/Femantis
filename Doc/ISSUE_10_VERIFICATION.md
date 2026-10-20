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
| Reproduzierbares Paket mit festgelegter Toolbox und Python ohne Entwicklercheckout erzeugbar | erfüllt (lokal) | `npm run package:mac`: CPython 3.13.16 (python-build-standalone `20261003`, SHA-256 gegen Release-Digest und `SHA256SUMS` geprüft), Toolbox 1.4.0 vom gepinnten Commit, Pakete nach `backend/constraints.txt` (`--check-constraints` im Build). Zwei aufeinanderfolgende Builds: identischer `bundleDigest` `23a12a7f6a53bcb7ff20b0b4986de5f6c723dbcac9f22e249338133e0517a6a8` über 6661 Pfade. Das DMG ist wegen Zeitstempeln nicht bitgleich. Die App braucht weder Checkout noch `.venv`. |
| Backend/Beispiele aus Ressourcenpfaden; Cache/Benutzerdaten außerhalb schreibgeschützter Ressourcen | erfüllt | `src/main/runtime.ts` mit 6 Vitest-Fällen; Paket: `Contents/Resources/{python,backend,examples}`, Laufcache `~/Library/Application Support/Femantis/runs`. Python startet mit `-E -s -B`; ein Test belegt, dass der echte Adapter so rechnet, ohne Bytecode neben den Adapter zu schreiben. Nach jedem Paket-Smoke-Test besteht `codesign --verify --deep --strict` am benutzten Bundle (keine Schreibzugriffe ins Bundle). |
| Sauberes Zielsystem ohne Node, gh und Entwicklungs-.venv: offline importieren, rechnen, speichern, wieder öffnen | teilweise | Lokal simuliert, kein zweiter Mac: DMG eingehängt, App außerhalb des Repos kopiert, frisches `HOME`, eigener Benutzerdatenordner, `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, keine `FEMANTIS_*`. Mit `FEMANTIS_PACKAGE_SANDBOX=1` zusätzlich Seatbelt: Netz nur Loopback, kein Lesezugriff auf Repository, Homebrew und python.org-Framework (Negativkontrollen: `curl` per Name und IP scheitert, `cat` im Repo und Start des python.org-Pythons verweigert). Gebündelte Mach-O-Dateien linken nur `/usr/lib`, `/System` und das Bundle (Build-Guard). Ein echter Zweitrechner und der neue CI-Job stehen aus. |
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
- `productName` ist jetzt `Femantis`; Electron legt Benutzerdaten damit unter
  `Application Support/Femantis` statt `femantis-desktop` ab (auch im Entwicklungsmodus).
- Eine kaputte Netzdatei meldet die App mit „Python-Adapter konnte das Netz nicht
  verarbeiten: … as gmsh“ – unverändertes Verhalten, im Paket wie im Checkout.

## Verifikation

- Red: `tests/runtime.test.ts` scheiterte am fehlenden Modul `src/main/runtime`;
  die neuen Fälle in `tests/backend.test.ts` scheiterten, weil das Backend nur einen
  Repository-Pfad annahm (4 rot).
- Green/aktueller Stand: `npm run typecheck` grün; `npm test` 99 Tests (15 Dateien);
  `npm run test:backend` 32 Tests; `npm run test:desktop` 24 Tests; `npm run
  test:package` 7 Tests, mit `FEMANTIS_PACKAGE_SANDBOX=1` ebenfalls 7 Tests
  (DMG SHA-256 `4f273c1e…f75b`, 280 MB, Bundle 619 MB). Prettier, YAML-Parse des
  Workflows und `git diff --check` sauber.
- Benchmark nicht ausgeführt: keine Änderung an Topologie oder Binärtransfer.
- Neuer CI-Job „Package · macOS 15“ (ohne `setup-python`): Ergebnis steht bis zum
  ersten beobachteten PR-Lauf aus.

## Nicht abgedeckt

Developer-ID-Signierung und Notarisierung (zurückgestellt), Gatekeeper-Prüfung eines heruntergeladenen
Artefakts, ein zweiter sauberer Mac, Electron-Fuses, Intel/Universal,
Windows/Linux ([#11](https://github.com/maschin96/Femantis/issues/11)) und
automatische Updates.

Status: lokale Übergabe mit Verifikationslücken. Bau, Pfade, Offline-Betrieb,
Lizenzen einschließlich GPL-3.0-or-later und Checkliste sind lokal belegt.
Zweitrechner und CI-Lauf sind offen; Developer-ID/Notarisierung bewusst zurückgestellt.
Kein Release veröffentlicht.
