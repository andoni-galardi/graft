# graft

**Soft patching tool: apply flexible, LLM-friendly change files to a project.**

`graft` is a CLI and VS Code extension that allows AI assistants (or humans) to generate reliable modifications for a codebase without relying on line numbers or unified diffs.

## Status: v0.7.0

- **Core Engine**: Supports the `.graft` v1 format, including the new Query Operations (`read`, `search`, `list`) with a virtual overlay filesystem for safe chained validations.
- **VS Code Extension**: Interactive data table with auto-numbered operations, query report panel, and one-click copy. Features a Timeline-style header, "Apply Clipboard" workflow, dry-run validation, and customizable operation colors.

## The `.graft` Format

A `.graft` file consists of a sequence of operations. It is idempotent, meaning you can apply the same file twice without breaking anything.

    [op: patch]
    path: src/index.ts
    description: Fix login bug
    <<<FIND
    const total = a + b;
    FIND>>>
    <<<REPLACE
    const total = a + b + c;
    REPLACE>>>

    [op: read]
    path: src/index.ts
    lines: 10..15

    [op: search]
    path: src/**/*.ts
    pattern: TODO

See [docs/format-v1.md](docs/format-v1.md) for the full specification.

## VS Code Extension Features

- **Interactive Table**: See all operations at a glance, with auto-numbering. Colors indicate the action type (configurable in settings). Double-click any row to see full paths, descriptions, or error details.
- **Validation & Dry-Run**: "Validate" checks syntax and simulates the application in memory (including queries) to predict if operations will succeed or fail.
- **Query Operations**: Use `read`, `search`, and `list` to inspect the codebase. Results are displayed in a unified report panel at the bottom, which can be copied with a single click.
- **Apply Clipboard**: A one-click button to paste from your clipboard, validate, and apply.
- **Smart Path Compressing**: Long paths are shortened (e.g., `src/.../file.ts`) to keep the table readable.

## Development & Roadmap

See [docs/STATE.md](docs/STATE.md) for current development status and the roadmap for v0.8.0 (Conditional Logic).
