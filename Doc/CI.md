# GitHub-Prüfungen (Issue #5)

`.github/workflows/quality.yml` startet für Pull Requests und Änderungen an `main`.

| Job | Runner | Inhalt |
|---|---|---|
| Frontend · Node 22 | `ubuntu-24.04` | `npm ci`, `npm run build` einschließlich Typprüfung |
| Backend · Python 3.11/3.12/3.13 | `ubuntu-24.04`, Matrix ohne `fail-fast` | `npm ci`, `npm run setup:backend` (öffentliche Toolbox am festen Commit), unter 3.13 Prüfung der installierten Versionen gegen `backend/constraints.txt`, `npm run test:backend`, `npm test` (Vitest einschließlich echter Python-Läufe) |
| Backend · Python 3.13 · Windows | `windows-2025` | wie oben (#11) |
| Desktop · macOS 15 / Windows 2025 / Ubuntu 24.04 | `macos-15` (arm64), `windows-2025`, `ubuntu-24.04`; Python 3.13 | `npm ci`, Toolbox-Setup, `npm run build`, `npm run test:desktop` mit echtem Electron/WebGL. Unter Linux mit `xvfb-run` (Software-OpenGL) und freigegebenen Benutzer-Namespaces für die Chromium-Sandbox (#11). Bei Fehlern `test-results/` sieben Tage als Artefakt `desktop-test-results-<os>` |

Backend- und Desktopjobs warten auf den Frontend-Job und laufen nur für Branches
dieses Repositorys und für `main`. Bei fremden Fork-PRs läuft nur die
Frontend-Prüfung. Ob Fork-Code auch auf Backend- und macOS-Runnern laufen soll,
ist eine eigene Entscheidung.

## Sicherheit

- Keine Secrets. Toolbox und Repository sind seit dem 19.10.2026 öffentlich; das
  frühere `TOOLBOX_READ_TOKEN` ist entfallen und kann, falls angelegt, gelöscht
  werden.
- `permissions: contents: read` für den `GITHUB_TOKEN`; kein
  `pull_request_target`.
- Externe Actions sind auf vollständige Commit-SHAs fixiert. Am 20.10.2026 per
  `git ls-remote --tags` geprüft: `actions/checkout` und `actions/setup-node`
  v4.4.0, `actions/setup-python` v5.6.0, `actions/upload-artifact` v4.6.2.
  Updates erfolgen bewusst per SHA-Wechsel.
- Desktop-Artefakte sind reine Fehlerdiagnostik ohne Zugangsdaten.

## Constraints

`scripts/setup_backend.py` übergibt `backend/constraints.txt` nur unter Python 3.13.
3.11/3.12 erhalten die Versionsbereiche aus den Toolbox-Metadaten. Weil die
aktuellen Versionen dort zufällig gleich sind, belegt ein grüner Lauf allein nicht,
dass die Constraints wirken. Der 3.13-Job prüft deshalb mit
`node scripts/venv-python.mjs scripts/setup_backend.py --check-constraints` jede gepinnte
Version und scheitert bei einer Abweichung.

## Beobachtete Läufe

| Datum | Lauf | Ergebnis | Ursache |
|---|---|---|---|
| 14.10.2026 | [38524756622](https://github.com/maschin96/Femantis/actions/runs/38524756622), 38524862206, 38525759817 (`main`) | kein Runner gestartet | Billing-/Ausgabenlimitsperre des Kontos |
| 19.10.2026 16:11 | 39283536637 | kein Runner gestartet | dieselbe Sperre |
| 19.10.2026 16:16 | [39284096757](https://github.com/maschin96/Femantis/actions/runs/39284096757) | Backend/Desktop rot | `TOOLBOX_READ_TOKEN` fehlte; behoben durch die öffentliche Toolbox ([PR #23](https://github.com/maschin96/Femantis/pull/23)) |
| 19.10.2026 16:28/16:53 | [39285725120](https://github.com/maschin96/Femantis/actions/runs/39285725120) (`main`), 39289329126 (PR #25) | Desktop rot | 5-s-Wartezeit beim kalten Python-/Toolbox-Start; behoben in `966d172` (#24, `tests/desktop/startup.ts`) |
| seit 19.10.2026 17:00 | u. a. `main` [39294051729](https://github.com/maschin96/Femantis/actions/runs/39294051729), [39371862896](https://github.com/maschin96/Femantis/actions/runs/39371862896), [39371920834](https://github.com/maschin96/Femantis/actions/runs/39371920834); jeweils letzte Läufe der PRs #25–#30 | alle fünf Jobs grün | – |

Lauf 39371920834 (`main` @ `7d1de63`, 20.10.2026):

- Runner: Ubuntu 24.04 (Image 20261018.339.1) bzw. `macos-15-arm64` (20260907.0337.1)
- Python: CPython 3.11.17, 3.12.15, 3.13.16 (Backend), 3.13.15 (Desktop)
- Je Python-Version 28 unittest- und 91 Vitest-Tests (14 Dateien) bestanden; Desktop
  24 Electron-/WebGL-Tests in 1,5 min; Gesamtlaufzeit etwa 2,5 min

## Branch Protection

Eine separate Repository-Einstellung. Am 20.10.2026 meldete die GitHub-API für
`main` „Branch not protected“ (HTTP 404). Erforderliche Checks werden also nicht
erzwungen; ein PR ist erst integrierbar, wenn alle fünf Jobs grün sind. Ob Checks
verpflichtend werden sollen, entscheidet der Repository-Eigentümer.
