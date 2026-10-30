# Graft — Architecture

## Overview

Graft is a soft-patching tool. `.graft` files describe operations (patches, writes, inserts, deletes) that are applied without relying on line numbers or unified diffs. Written in TypeScript. Distributed as an npm package (`@andoni.galardi/graft`) and a VS Code extension (`graft-vscode`).

## Repository layout

- `src/core/` — parser, validator, apply engine.
- `src/cli/` — CLI entry point (exposed as `graft` via `package.json#bin`).
- `editors/vscode/` — VS Code extension (own `package.json`, npm workspace).
- `docs/` — project documentation.
- `tests/` — vitest test suite.
- `examples/` — sample `.graft` files.

## Key design decisions

### Soft patching vs unified diffs
`.graft` files describe operations keyed on content, not line numbers. The format is idempotent (re-applying the same file is safe) and versioned (current: v1.2; spec in `docs/format-v1.2.md`).

### Overlay virtual filesystem in `validate`
`validate` runs operations against an in-memory overlay so chained operations can be simulated safely (e.g., write-then-read, delete-then-list). The real filesystem is untouched during validation.

### Abort on first real failure
`apply` stops at the first operation that fails against the real filesystem; subsequent operations are marked `skipped`.

### Sidecar `.applied`
A `.applied` sidecar is written on successful `apply`, except when the file contains only query operations.

### Query Operations
`read`, `search`, and `list` were added in v0.7.0. Their results populate `OperationResult.output`, which the extension renders in a unified report panel.

## v0.8.0 design — Conditional Logic

Idea: allow operations to be evaluated conditionally based on the state of the codebase, so `.graft` files become more resilient in large refactorings.

Proposed syntax:

    [op: when]
    path: src/index.ts
    find: "legacy"
    <<<THEN
    [op: patch]
    path: src/index.ts
    <<<FIND
    const x = legacy();
    FIND>>>
    <<<REPLACE
    const x = modern();
    REPLACE>>>
    THEN>>>

Open questions:

- Should `when` conditions evaluate against the real filesystem or the overlay?
- On failed condition: silent skip, or logged?
- Nested `when` blocks: allowed or forbidden?

## Open design questions

### Query Status Labels in UI

- **Current**: query operations show as `Applied` in the UI table after `Validate`, because they execute during `dryRun` to produce the report.
- **Proposed fix**: during `dryRun`, queries should show as `Ready`; when actually applied, as `Queried` or similar.
- **Complication**: pure-query grafts may not require hitting `Apply` at all, making the transition unclear; mixed grafts (queries + modifications) need a consistent visual flow. Discuss before implementing.

## Roadmap

- **v0.8.0** — Conditional Logic (`[op: when]`).
- **v0.9.0** — Publish to VS Code Marketplace and npm.
