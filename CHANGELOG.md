# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versions v0.1.0–v0.4.x existed before the first git tag (v0.5.0); they are not individually recorded here.

## [0.7.0]

### Added

- Query operations: `read`, `search`, `list`.
- Overlay virtual filesystem in `validate` (chained operations).
- Unified report panel in VS Code extension (query outputs and errors).
- Copy per-operation and Copy All in the report.
- `output` field on `OperationResult` (`.graft` v1.2).

### Changed

- `apply` aborts on the first real failure; subsequent operations marked as skipped.
- Sidecar `.applied` not written for pure-query grafts.
- VS Code toolbar cleanup: Edit and Validate moved to the `...` menu.
- VS Code UI: auto-numbered operations column, optimized Action/Status column widths.

## [0.6.0]

### Added

- Interactive operations table (auto-numbering, configurable colors per action type).
- Dry-run validation.
- Apply Clipboard workflow.
- Timeline-style header.
- Single toolbar with an expanded (`...`) menu.

## [0.5.0]

### Added

- VS Code extension.
- `.applied` sidecar.
- esbuild bundling for the extension.
