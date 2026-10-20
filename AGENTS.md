# Development Guidelines for Femantis Desktop

These rules apply repository-wide to human and automated contributions. Explicit
task instructions take precedence within the governing instruction hierarchy;
directory-specific instructions refine or override rules in their scope. Project
conventions determine paths, versions, and commands. Conditional sections apply
only when relevant. For Codex instruction discovery, see the
[AGENTS.md documentation](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

## Repository and Project Contracts

- Product: **Femantis Desktop**, currently version `0.2.0`. The public GitHub
  repository is [maschin96/Femantis](https://github.com/maschin96/Femantis),
  renamed from `maschin96/Firmantis` on 2026-10-19. The default branch is
  `main`, and the local remote is `origin`. Preserve these names unless requested.
- This is an Electron application with React, TypeScript, Three.js, and a Python
  adapter, not a standalone Python library. Use `package.json`, `package-lock.json`,
  and `backend/constraints.txt`; do not introduce packaging or tool migrations
  solely to match generic Python defaults below.
- Read `README.md` for setup and current behavior, `Doc/ELECTRON_UI_PLAN.md` for
  design, and `Doc/MODELLING_IMPLEMENTATION.md` for the current modelling scope.
  `Doc/IMPLEMENTATION.md` documents the earlier viewer milestone. Their historical
  statements about having no repository or commit predate GitHub initialization
  on 2026-10-13; they do not describe the current repository state. Historical
  test counts are evidence for those revisions, not proof that current tests pass.
- The numerical dependency is the separate public (MIT) repository
  `maschin96/FEM-Toolbox`, version `1.4.0`, pinned in `scripts/setup_backend.py`
  to commit `baae07f088a87ce6e256af3c5855a3b110d0f17a`. Use its public APIs;
  do not edit cached Toolbox sources or duplicate its solvers/readers in the GUI.
  Dependency updates require explicit compatibility work and updated evidence.

### Architecture and User Experience

- `src/main/`: Electron lifecycle, validated IPC, file operations, project storage,
  and Python-process orchestration. Keep privileged operations here.
- `src/preload/`: the narrow desktop API exposed to the renderer. Preserve context
  isolation and sender validation; do not expose arbitrary filesystem or process access.
- `src/renderer/`: German UI, model forms, and Three.js visualization;
  `src/shared/`: shared types and runtime schemas. Keep UI errors actionable and
  show actual backend phases rather than invented progress percentages.
- `backend/adapter.py` handles mesh/protocol adaptation; `backend/models.py`
  handles the public Toolbox model and result APIs. Preserve stdio protocol output
  and little-endian binary buffers; diagnostics must not corrupt protocol data.
- Preserve original double-precision coordinates and raw field values. Original
  64-bit IDs travel as strings; never cast them to unsafe JavaScript numbers.
  Gmsh internal indices must not be presented as original IDs.
- Solver inputs use SI units; preserve the documented m/mm import conversion and
  units in forms and results. GPU centering and deformation are display operations
  and must not change numerical inputs. Tet10 visualization uses linear
  interpolation on subdivided faces and must remain identified as an approximation.
- Current modelling covers stationary heat, linear elasticity, and electrostatics
  with Toolbox Model schema 1. Do not imply that CAD, coupled/transient solvers,
  or installers are implemented without implementing and verifying them.
- Preserve Desktop schema 2 saving and schema 1 reading. A `.femantis.json` project
  and its `.files` directory form a portable unit. Keep original meshes, immutable
  result bundles, hashes, path/symlink checks, source association, and stale-result
  detection. Unapplied JSON drafts must continue blocking conflicting operations.

### Setup and Project Checks

Use the existing npm scripts from the repository root:

```sh
npm ci
npm run setup:backend
npm run dev
```

Backend setup requires Python 3.11–3.13 and network access; pip downloads the
pinned Toolbox commit anonymously. It creates `.venv`; the constraints
file applies to Python 3.13. `FEMANTIS_PYTHON` can select another prepared runtime.
Use the existing `unittest` backend suite rather than introducing pytest by default.

```sh
npm test
npm run test:backend
npm run typecheck
npm run build
npm run test:desktop
npm run benchmark
git diff --check
```

- TypeScript and integration tests use Vitest; backend tests use `unittest`.
  `npm run test:backend` runs the `.venv` Python through `scripts/venv-python.mjs`
  on every platform; `npm run setup:backend` picks `python3`, or `py -3` on Windows.
- `npm run build` includes type checking. Desktop tests use Playwright with a real
  Electron/WebGL window and the prepared backend; run them for changed user flows,
  rendering, IPC, or persistence. Mock native dialog responses only at the
  infrastructure boundary, preserving real file and solver behavior.
- Run benchmarks when changing topology or binary transfer performance; they
  measure backend work, not interactive FPS. Documentation-only edits require
  content, path, command, and whitespace checks, not the executable test suites.
- Local development evidence covers macOS/Apple Silicon. `.github/workflows/quality.yml`
  also runs on Ubuntu 24.04 and Windows 2025 (#11); report each platform only from an
  observed run. Do not claim installer or bundled-runtime support without new results,
  or CI success or branch protection without checking the current repository.
- Keep TypeScript formatting consistent with `.prettierrc.json` (single quotes,
  trailing commas, 100-column width). Preserve focused diffs in Python as well.
- Track all source, tests, documentation, evidence screenshots, examples, and
  dependency lock/constraints files. Respect `.gitignore`: installed dependencies,
  `.venv`, caches, generated builds, test outputs, and OS metadata stay local unless
  the user explicitly requests otherwise. Never upload authentication tokens.

## Project Context and Starting Work

- Inspect the branch, Git status, and existing changes. Read applicable instructions
  and task-relevant documents: architecture for structural changes, environment
  and test configuration for code changes, release guidance for releases.
- Identify relevant compatibility, paths, tools, and CI requirements. Examples
  below are not assumed to exist.
- Keep changes focused and preserve unrelated work. No unrequested resets,
  history rewrites, or force-pushes.
- Resolve correctness-critical requirements before dependent implementation;
  continue independent work when possible.
- Report limitations honestly. Never invent results, issue numbers, or approvals.

## Issue and Pull Request Workflow

When the project uses GitHub or another issue tracker:

1. Find a suitable open issue before implementation. Reuse it or create one
   without duplicates, following contribution rules.
2. Record problem, outcome, scope, exclusions, acceptance criteria, and test plan.
   Defects also need a minimal reproducer, expected/actual behavior, and environment.
   Use appropriate existing labels and milestones.
3. Split large tasks into independently reviewable changes.
4. Reuse a task branch with matching scope and base; otherwise branch from stable
   `main` or the applicable milestone. Follow project naming, for example
   `codex/123-short-description`; substitute the actual main-branch name as needed.
   Verify the PR base before opening or merging. Do not switch branches or change
   bases in ways that move, lose, or mix existing work without authorization.
5. Inspect the staged diff and commit only intended files. Follow project commit
   conventions; otherwise use `test:`, `feat:`, `fix:`, `refactor:`, `docs:`, or
   `ci:` with applicable issue references.
6. Describe the problem, resulting behavior, verification, and risks in the PR.
   On GitHub, use `Closes #123` for completed issues and `Refs #123` for partial work.
7. Apply the readiness requirements under Definition of Done before integration.
   Seek independent review and disclose missing reviewers. A local commit alone
   does not complete the issue.

Without an available tracker, record the task and acceptance criteria locally and
continue independent work. A local commit request does not authorize push or merge.
Verify issue closure after integration; GitHub closing keywords depend on the
target branch. See
[GitHub's issue and pull request linking rules](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/using-keywords-in-issues-and-pull-requests).

### Optional Milestone Branches and Releases

- Keep `main` stable. Optional milestone branches coordinate related changes:
  `main -> milestone branch -> issue branch -> milestone branch -> main`, with
  the same integration requirements for every pull request.
- Before the release merge, incorporate relevant main-branch changes, resolve
  conflicts, and verify the result. Functionality and documentation must be
  complete; only publication steps may remain.
- Stable-version maintenance may target the main branch directly through an issue
  pull request. Carry relevant fixes into active milestone branches.
- Follow project release guidance and check the resulting main-branch CI before
  tagging or publishing. Close issues with an integration reference; release work
  stays open until publication and artifact checks are complete.

## Test-Driven Development: Red - Green - Refactor

TDD is required for new executable behavior and defect fixes:

1. **Red:** Run a small, deterministic acceptance test before implementation;
   confirm failure reflects missing/incorrect behavior, not a broken environment.
   For defects, first write a reproducing regression test.
2. **Green:** Implement the smallest correct solution; run focused and affected tests.
3. **Refactor:** Improve structure without changing behavior; rerun affected tests.
4. Repeat, then run relevant suites and quality checks before integration readiness.

- Test observable behavior against independent expectations, not implementation
  copies or incidental internals. Cover normal cases, boundaries, invalid inputs,
  and failures with focused fixtures and useful parameterization.
- Isolate unit tests: control randomness and time, avoid real external services,
  use temporary directories, and mock infrastructure boundaries rather than logic.
- Separate tests needing external resources and document their setup. Record
  observed Red/Green results with the verification report. Do not disable tests
  or weaken expectations merely to make CI pass.
- For documentation-only changes, check content, links, and examples without
  artificial failing tests. Before behavior-preserving refactoring, run existing
  tests and address relevant coverage gaps.

For Femantis, use the existing Vitest, unittest, and Playwright suites above.
Use `pytest` by default only for new Python projects unless another choice is justified. Test
the installed package; avoid ad hoc `sys.path` fixes hiding packaging defects. See
[pytest's integration practices](https://docs.pytest.org/en/stable/explanation/goodpractices.html).

## Python Environment, Dependencies, and Packaging

- Respect supported Python versions; new projects should use maintained versions
  compatible with deployment needs. Declare package compatibility in
  `requires-python`, align CI, and keep syntax and APIs within that range.
- Use an isolated environment, normally `.venv`, and the existing dependency
  manager. Document reproducible setup; avoid system-interpreter installations.
- New projects use `pyproject.toml` for metadata, dependencies, and supported tool
  settings; packaged projects declare `[build-system]`. Preserve working legacy
  configuration unless migration is part of the task.
- Separate runtime, optional, and development dependencies. Justify additions by
  need, maintenance, compatibility, and licensing; prefer suitable standard-library solutions.
- Keep the project's lock or constraints files synchronized for reproducible
  application, development, and CI environments. Library metadata should express
  supported ranges rather than copy every exact development-environment version.
- Exclude environments, caches, local configuration, and generated build artifacts
  from version control unless explicitly maintained as project assets.

Metadata and dependency conventions follow the
[Python Packaging User Guide](https://packaging.python.org/en/latest/guides/writing-pyproject-toml/).

## Architecture and Code Style

- Preserve established architecture and layout. Prefer `src/` with external tests
  for new distributable packages; applications and scripts may use simpler layouts.
  Avoid incidental repository restructuring. See
  [PyPA's layout discussion](https://packaging.python.org/en/latest/discussions/src-layout-vs-flat-layout/).
- Keep functions focused, data flow explicit, and modules cohesive. Separate domain
  logic from I/O; avoid mutable globals, circular dependencies, and needless abstraction.
- Follow project formatting and PEP 8. Use descriptive names, explicit imports,
  and comments explaining decisions; avoid wildcard imports and unrelated reformatting. See
  [PEP 8](https://peps.python.org/pep-0008/).
- Avoid mutable defaults; create per-call values inside functions. Use `is None`
  when checking absence, not a general falsy-value check. See
  [Python's default argument guidance](https://docs.python.org/3/tutorial/controlflow.html#default-argument-values).
- Avoid surprising import-time side effects; use explicit startup entry points and
  `if __name__ == "__main__":` where appropriate.
- Optimize correct code only after profiling; verify behavior and measurable gains.

## Types, Public APIs, and Documentation

- Type public functions and meaningful internal interfaces, including return
  values. Use annotation syntax supported by the declared Python versions.
- Use precise types and suitable abstract inputs such as `Sequence` or `Mapping`.
  Use `Any` deliberately; explain narrow type-check suppressions rather than hide
  unexplained errors. See
  [Python typing best practices](https://typing.python.org/en/latest/reference/best_practices.html).
- Validate untrusted inputs at boundaries and enforce domain invariants. Type hints
  do not validate at runtime; do not rely on `assert` for required validation,
  since optimized execution can remove it.
- Document public behavior, assumptions, inputs, outputs, exceptions, and side
  effects using the project's docstring convention. Include shapes, units, or
  precision when relevant; avoid restating obvious code.
- Preserve public API compatibility unless explicitly changing it. Follow project
  deprecation and versioning policies and document breaking changes and migration.
- Keep relevant documentation, examples, and design decisions consistent with
  behavior, including working setup and verification commands.

## Errors, Resources, and Logging

- Raise specific, actionable exceptions; catch only meaningfully handled errors.
  Avoid bare `except` and silent failure; preserve causes with `raise ... from exc`.
- Manage resources with context managers or cleanup. Prefer `pathlib`, portable
  paths, and explicit encodings when required by the format. See
  [Python's exception and cleanup guidance](https://docs.python.org/3/tutorial/errors.html#defining-clean-up-actions).
- Use module loggers (`logging.getLogger(__name__)`); applications configure
  logging, libraries must not configure the root logger. Use `print` for intended
  CLI output; never log credentials or sensitive data. See the
  [Python Logging HOWTO](https://docs.python.org/3/howto/logging.html#configuring-logging-for-a-library).

## Quality Checks

The Femantis commands under Setup and Project Checks take precedence; do not
assume Ruff or mypy is configured here. Defaults for new Python projects are
`pytest`, `ruff`, and `mypy`. Example root-level checks for a configured `src/` project:

```sh
python -m pytest
python -m ruff check .
python -m ruff format --check .
python -m mypy src
git diff --check
```

- Use the prepared environment or documented runner and actual type-check targets.
  Run focused checks during implementation and all applicable required checks on
  the revision intended for integration, including CI and subsystem requirements.
- Where feasible, run relevant baseline checks before behavioral changes.
  Distinguish pre-existing failures from failures introduced by the task using
  observed evidence. If no baseline is available, report uncertain attribution.
  Fix task-caused failures; report unrelated failures without expanding the scope
  automatically. A pre-existing failure does not count as a passed required check.
- Report passed, failed, skipped, and unavailable checks separately, with commands
  and reasons for gaps. Missing tools or configuration do not count as success.
- For packaging/release changes, build distributions, install in a clean environment,
  and check imports or entry points; source-tree tests do not prove installability.

## Numerical and Scientific Verification, When Applicable

- Use analytical solutions, independent references, or domain invariants for
  expected results. Justify floating-point tolerances by scale, units, and
  conditioning; never widen them to conceal defects.
- For algorithm changes, run applicable invariant, conservation, convergence, or
  benchmark tests and verify components before combinations.
- Record reference-data provenance, parameters, and tolerances; justify changed
  reference values. Follow project definitions of verification and validation and
  document changes to mathematical conventions or domain assumptions.

## Continuous Integration and Security

- Check pull requests and main-branch changes on supported Python versions and
  relevant platforms. Automate installation and configured quality checks.
- Separate slow or resource-dependent tests where useful without waiving required
  results. Follow branch protection, review, and release policies; absent branch
  protections do not waive integration requirements.
- When using GitHub Actions, pin external actions to full commit SHAs and maintain
  updates deliberately. Give `GITHUB_TOKEN` minimal permissions by default and
  grant additional permissions only to jobs that need them.
- Never execute untrusted pull request code with secrets or privileged tokens,
  including through an unsafe `pull_request_target` workflow. Do not interpolate
  untrusted inputs directly into shell code. See
  [GitHub Actions security guidance](https://docs.github.com/en/actions/reference/security/secure-use).
- Never commit credentials, private datasets, or local environments. Check dependency
  advisories through project tooling; security reports must not expose credentials.

## Definition of Done

Distinguish implementation progress from verified readiness:

- **Local handoff with verification gaps:** Work may be handed over when required
  checks fail, are blocked, or are unavailable. State what is implemented, which acceptance
  criteria have evidence, what remains unverified, and the blockers. Do not label
  this state fully verified, integration-ready, or release-ready.
- **Done / integration-ready:** Acceptance criteria are demonstrably satisfied;
  relevant tests and all applicable required checks pass on the current revision,
  and review comments are resolved. Pre-existing failures in required checks
  remain blockers. Relevant documentation is current and the final diff contains
  only intended changes, with no secrets or accidental generated files.
- **Release-ready:** Integration requirements and the project's release checks,
  including CI on the resulting main-branch commit and applicable artifact checks,
  are satisfied. Claim publication only after it has actually completed.

Every handoff or completion report states the applicable status, changes,
verification results, gaps and remaining risks, and relevant issue, commit, or
pull request references. Explain inapplicable checks without counting skipped or
unavailable required checks as passes.

The issue workflow, TDD requirement, and default tools are deliberate working
conventions, not universal Python standards. General reference-check date: 2026-10-12. Femantis project context updated on
2026-10-13 from the local source and verified GitHub setup.
