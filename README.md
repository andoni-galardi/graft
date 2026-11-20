# graft

**Soft patching tool: apply flexible, LLM-friendly change files to a project.**

`graft` is a CLI and VS Code extension that allows AI assistants (or humans) to generate reliable modifications for a codebase without relying on line numbers or unified diffs.

Two frontends are provided:

- **CLI** — apply `.graft` files from the terminal.
- **VS Code Extension** — visual editor for `.graft` files with a table view, dry-run validation, and a query report panel.

## The `.graft` Format

A `.graft` file is a sequence of operations. It is idempotent: applying the same file twice does not break anything.

    [op: patch]
    path: src/index.ts
    description: Fix login bug
    <<<FIND
    const total = a + b;
    FIND>>>
    <<<REPLACE
    const total = a + b + c;
    REPLACE>>>

The full specification lives in [docs/format-v1.2.md](docs/format-v1.2.md).

## Installation

- **CLI** — clone the repo, run `npm install` and `npm run build`. The CLI is exposed as `graft` via the `bin` field in `package.json`.
- **VS Code Extension** — download the `.vsix` from GitHub Releases and install it from VS Code (`Extensions → ... → Install from VSIX...`).

## VS Code Extension Features

- **Interactive Table**: See all operations at a glance, with auto-numbering. Colors indicate the action type (configurable in settings). Double-click any row to see full paths, descriptions, or error details.
- **Validation & Dry-Run**: "Validate" checks syntax and simulates the application in memory (including queries) to predict if operations will succeed or fail.
- **Query Operations**: Use `read`, `search`, and `list` to inspect the codebase. Results are displayed in a unified report panel at the bottom, which can be copied with a single click.
- **Apply Clipboard**: A one-click button to paste from your clipboard, validate, and apply.
- **Smart Path Compressing**: Long paths are shortened (e.g., `src/.../file.ts`) to keep the table readable.

## Documentation

- [docs/STATUS.md](docs/STATUS.md) — current state and next step.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — design and decisions.
- [CHANGELOG.md](CHANGELOG.md) — release history.
