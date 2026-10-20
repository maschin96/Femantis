# Issue #5: GitHub Actions für Qualitäts- und Integrationsprüfungen

Bezug: [Issue #5](https://github.com/maschin96/Femantis/issues/5), Branch
`codex/5-ci-evidence`, Basis `7d1de63` (`main`), 20.10.2026.

Der Workflow selbst kam über [PR #20](https://github.com/maschin96/Femantis/pull/20)
und [PR #23](https://github.com/maschin96/Femantis/pull/23) nach `main`. Offen
waren bis jetzt nur beobachtete Erfolge und ein Nachweis, dass die
3.13-Constraints wirken. Aufbau, Sicherheit und Laufhistorie stehen in
[CI.md](CI.md).

## Abnahmekriterien

| Kriterium | Nachweis |
|---|---|
| PR- und `main`-Jobs mit `npm ci`, Vitest, Typecheck/Build, unittest | Frontend: `npm ci` + `npm run build` (inkl. `tsc`). Backend: `npm run test:backend` + `npm test`. Grün u. a. PR #27 (39293171476), PR #28 (39371606829), PR #30 (39371624669) und `main` 39294051729, 39371862896, 39371920834. |
| Python 3.11–3.13 als Matrix; Constraints für 3.13 wirksam | Matrix 3.11.17/3.12.15/3.13.16 mit je 28 unittest- und 91 Vitest-Tests grün (39371920834). Neu: Schritt „Verify Python 3.13 constraints“ vergleicht jede Version aus `backend/constraints.txt` mit der installierten und scheitert bei Abweichung. |
| Echter Electron/WebGL-Job auf dokumentiertem Runner | „Desktop · macOS 15“ auf `macos-15-arm64` (Image 20260907.0337.1): 24 Playwright-Tests mit echtem Fenster, echter WebGL-Pixelprüfung und echten Solverläufen. |
| Keine privilegierten Zugangsdaten für fremde PRs; kein `pull_request_target` | Workflow ohne Secrets; Backend/Desktop nur für Branches dieses Repositorys und `main`; Trigger `pull_request`/`push`. |
| Actions auf vollständige SHAs, minimale Tokenrechte | Vier Actions per SHA fixiert, am 20.10.2026 gegen die Tags v4.4.0/v4.4.0/v5.6.0/v4.6.2 geprüft; `permissions: contents: read`. |
| Artefakte/Logs dokumentiert; Branch Protection gesondert geprüft | `desktop-test-results` bei Fehlern, 7 Tage. Branch Protection: HTTP 404 „Branch not protected“ am 20.10.2026, also nicht erzwungen (Entscheidung des Eigentümers). |

## Verifikation

- Red: `tests/backend/test_setup.py` scheiterte am fehlenden
  `constraint_mismatches` (ImportError).
- Green: 4 neue Tests (passend, abweichend/fehlend, PEP-503-Namen, nicht
  gepinnte Zeile). `npm run test:backend` 32 Tests, `npm test` 91 Tests.
  `.venv/bin/python scripts/setup_backend.py --check-constraints` meldet lokal
  (Python 3.13.7) alle Versionen passend.
- YAML per Ruby-Parser geladen; `git diff --check` sauber.
- Nicht lokal ausführbar: der neue CI-Schritt selbst. Er gilt laut Testplan erst
  nach einem beobachteten grünen Lauf am PR und danach auf `main` als belegt.
- Keine Änderung an Anwendungscode oder Benutzerabläufen; Build und Desktoptests
  laufen in der CI des PRs.

Nicht abgedeckt: Windows/Linux-Desktop ([#11](https://github.com/maschin96/Femantis/issues/11)),
Fork-PRs auf Backend-/macOS-Runnern (bewusst ausgeschlossen) und erzwungene Checks.

Status: lokal verifiziert; der PR-Lauf mit dem neuen Constraint-Schritt steht aus.
