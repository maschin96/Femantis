# Auslieferung und Releasevertrag (macOS/Apple Silicon)

Stand: 20.10.2026, eingeführt mit [#10](https://github.com/maschin96/Femantis/issues/10).
Gilt für Femantis Desktop ab `0.2.0`. Ziel ist ausschließlich macOS auf Apple
Silicon (arm64). Windows/Linux ([#11](https://github.com/maschin96/Femantis/issues/11)),
Intel-/Universal-Builds und automatische Updates sind nicht Teil dieses Vertrags.

## Paketierungsentscheidung

| Baustein | Entscheidung | Begründung |
|---|---|---|
| App-Bundle | [`@electron/packager`](https://github.com/electron/packager) 20.3.0 (exakt gepinnt), `asar`, Produktions-`node_modules` | Offizielles Electron-Werkzeug, keine Installer-/Update-Infrastruktur nötig |
| Abbild | `hdiutil` (UDZO-DMG) mit App, Lizenzordner und Verknüpfung „Programme“ | Bordmittel von macOS, kein weiteres npm-Paket |
| Python | CPython 3.13.16 aus [python-build-standalone](https://github.com/astral-sh/python-build-standalone) Release `20261003`, Variante `aarch64-apple-darwin-install_only_stripped`, SHA-256 `9e01f63b…a147` | Relokierbar, ohne Systempython; Prüfsumme gegen Release-Digest und `SHA256SUMS` des Releases verglichen |
| Toolbox und Python-Pakete | FEM-Toolbox 1.4.0 vom Commit in `scripts/setup_backend.py`, alle anderen Pakete als Binärwheels exakt nach `backend/constraints.txt`; danach `--check-constraints` und Versionsprüfung `1.4.0` | Gleiche Pins wie Entwicklung und CI |
| Laufzeitpfade | `src/main/runtime.ts`: Paket liest Python, Adapter und Beispiele aus `Contents/Resources`, Laufcache unter `~/Library/Application Support/Femantis/runs` | Signiertes Bundle bleibt schreibgeschützt |
| Python-Isolation | Gebündeltes Python startet mit `-E -s -B`; Bytecode wird beim Paketieren hashbasiert (`unchecked-hash`) vorkompiliert | Keine `PYTHON*`-Variablen, keine Benutzer-Site-Packages, keine Schreibzugriffe ins Bundle |
| Symbol | `build/icon.svg` → `build/icon.icns` (`npm run icon`) | Eigene Gestaltung |
| Lizenzen | Femantis selbst: GPL-3.0-or-later. Drittlizenzen werden beim Paketieren gesammelt (CPython und gelinkte Bibliotheken, jede Python-Distribution, Electron/Chromium, jedes Modul in `app.asar`, Toolbox-Beispielnetz); fehlende Texte brechen den Build ab | `Contents/Resources/licenses/README.md` und Ordner `Lizenzen` im DMG |

Das Paketierungsskript bricht außerdem ab, wenn ein Symlink aus dem Bundle zeigt,
eine gebündelte Mach-O-Datei Bibliotheken außerhalb von `/usr/lib`, `/System` oder
dem Bundle lädt, die Signatur nicht verifiziert oder die App im fertigen DMG keine
gültige Signatur trägt.

## Build

Voraussetzungen: macOS auf Apple Silicon, Node.js ≥ 22.12 mit npm, Xcode-
Befehlszeilenwerkzeuge (`codesign`, `otool`, `hdiutil`, `iconutil`), `curl`, `tar`
mit zstd-Unterstützung (macOS-`tar`) und Internetzugang. Ein Systempython oder
`.venv` ist nicht nötig.

```sh
npm ci
npm run package:mac
npm run test:package
FEMANTIS_PACKAGE_SANDBOX=1 npm run test:package
```

`package:mac` führt `npm run build` aus und erzeugt in `dist/`:

- `Femantis-<version>-mac-arm64.dmg`
- `Femantis-<version>-mac-arm64.build.json`: Commit, sauberer Arbeitsbaum ja/nein,
  Electron-, Python- und Paketversionen, Signaturart, Zahl der signierten Mach-O-Dateien,
  `bundleDigest` (SHA-256 über alle Pfade, Dateiinhalte und Symlinkziele des
  signierten Bundles) sowie Größe und SHA-256 des DMG
- `SHA256SUMS`

Downloads liegen in `.cache/packaging/`. Bau, Signatur und DMG-Inhalt entstehen in
einem temporären Ordner außerhalb des Checkouts: Synchronisierte Ordner wie ein
iCloud-„Dokumente“-Ordner setzen Finder-/File-Provider-Attribute auf das Bundle und
machen die Signatur ungültig.

`test:package` hängt das DMG ein, kopiert die App in einen temporären Ordner außerhalb
des Repositorys und startet sie mit frischem `HOME`, eigenem Benutzerdatenordner,
`PATH=/usr/bin:/bin:/usr/sbin:/sbin` und ohne `FEMANTIS_*`. Geprüft werden Start mit
gebündelter Runtime, die drei TOML-Beispiele aus den App-Ressourcen, Speichern und
Wiederöffnen, Abbruch einschließlich beendetem Python-Prozess, ein ungültiges Netz
und abschließend die unveränderte Signatur des benutzten Bundles. Mit
`FEMANTIS_PACKAGE_SANDBOX=1` läuft die App zusätzlich in einem Seatbelt-Profil ohne
Netzwerk (außer Loopback für Playwright) und ohne Lesezugriff auf Repository,
Homebrew und das python.org-Framework. Chromium kann seine eigene Sandbox darin nicht
initialisieren; nur dieser Modus startet deshalb mit `--no-sandbox`.

Reproduzierbarkeit bedeutet hier: gleiche gepinnte Eingaben ergeben ein Bundle mit
gleichem `bundleDigest`. Das DMG selbst enthält Zeitstempel und ist nicht bitgleich.

## Lizenz

Femantis Desktop steht seit dem 20.10.2026 unter der **GNU General Public License,
Version 3 oder (nach Wahl) jeder späteren Version** (SPDX `GPL-3.0-or-later`,
[LICENSE](../LICENSE), Entscheidung des Repository-Eigentümers). Alle gebündelten
Drittkomponenten stehen unter GPL-3.0-kompatiblen Lizenzen (MIT, BSD, ISC, PSF,
Zlib u. a.; Einzelheiten im Lizenzordner des Pakets). Das Paket enthält den
Lizenztext unter `licenses/femantis/LICENSE`. Weil das DMG nur Objektcode enthält,
verweist jede Veröffentlichung auf den Quelltext des zugehörigen Tags (GPL-3.0 § 6).

## Signierung, Notarisierung und Gatekeeper

Entscheidung vom 20.10.2026: **Developer-ID-Signierung und Notarisierung sind
zurückgestellt.** Releases werden bis auf Weiteres nur ad hoc signiert
(`codesign --sign -`). Diese Signatur bleibt erforderlich, weil macOS auf Apple
Silicon unsignierte ausführbare Dateien nicht startet. Jede gebündelte Mach-O-Datei
wird einzeln, das Bundle anschließend vollständig signiert und mit
`codesign --verify --deep --strict` geprüft. Eine Ad-hoc-Signatur belegt Integrität
gegenüber nachträglicher Veränderung, aber keine Herkunft; die Herkunft belegen
`SHA256SUMS` und `build.json` am GitHub-Release.

Folge für Nutzer: Ein aus dem Internet geladenes, nicht notarisiertes DMG blockiert
Gatekeeper beim ersten Start. App in „Programme“ kopieren, öffnen, Meldung schließen,
dann unter **Systemeinstellungen → Datenschutz & Sicherheit** „Dennoch öffnen“ wählen.
Die Releasenotizen müssen diesen Schritt und die Prüfsumme nennen.

Für eine spätere Developer-ID-Freigabe fehlen weiterhin: ein „Developer ID
Application“-Zertifikat (`security find-identity -v -p codesigning` meldete am
20.10.2026 „0 valid identities found“), Notarisierungszugangsdaten für
`xcrun notarytool` sowie ein implementierter und geprüfter Signaturweg mit Hardened
Runtime, sicheren Zeitstempeln und Entitlements für Electron und das gebündelte Python.

Offene Härtung: Electron-Fuses (u. a. `RunAsNode`, `EnableNodeCliInspectArguments`
aus, ASAR-Integrität an) sind nicht gesetzt. Sie würden die Playwright-Steuerung des
Paket-Smoke-Tests abschalten und brauchen einen eigenen Prüfweg.

## Releasecheckliste

Jeder Abschnitt ist ein eigenes Gate. Ein späteres Gate gilt erst, wenn alle früheren
mit Nachweis erledigt sind.

### 1. Build (Releasekandidat)

- [ ] Version in `package.json`/`package-lock.json` gesetzt; Arbeitsbaum sauber.
- [ ] `npm ci`, `npm run package:mac` auf macOS/Apple Silicon; `build.json` meldet
      `"workingTreeClean": true` und den erwarteten Commit.
- [ ] `npm run test:package` und `FEMANTIS_PACKAGE_SANDBOX=1 npm run test:package` grün.
- [ ] Zweiter Build aus demselben Commit auf derselben Maschine liefert denselben
      `bundleDigest` (maschinenübergreifend bisher nicht gleich, siehe Nachweis #10).
- [ ] Lizenzordner im DMG gesichtet; neue Abhängigkeiten haben Lizenztexte.

### 2. Integration

- [ ] Änderungen über PR nach `main`; alle CI-Jobs einschließlich „Package · macOS 15“
      auf dem PR und danach auf dem `main`-Commit grün.
- [ ] Nachweisdokument mit Befehlen, Umgebung und Ergebnissen aktualisiert.

### 3. Tag

- [ ] Annotierter Tag `v<version>` auf genau dem geprüften `main`-Commit.
- [ ] Paket aus dem Tag neu gebaut; `bundleDigest` stimmt mit Gate 1 überein.

### 4. Veröffentlichung

- [ ] Artefakt auf einem zweiten, sauberen Mac aus dem Download heraus geöffnet
      (einschließlich Gatekeeper-Freigabe); Rechnen, Speichern und Wiederöffnen
      manuell bestätigt.
- [ ] GitHub-Release zum Tag mit DMG, `SHA256SUMS` und `build.json`; Releasenotizen
      nennen GPL-3.0-or-later, den Quelltext des Tags, die fehlende Notarisierung mit
      Gatekeeper-Anleitung und die Prüfsumme.
- [ ] Prüfsumme nach dem Hochladen erneut gegen den Download verglichen.
- [ ] Erst danach wird die Veröffentlichung als erfolgt gemeldet.
