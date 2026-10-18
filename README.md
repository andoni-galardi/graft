# graft

Apply flexible change files to a project.

`graft` is a small tool for describing file changes in a way that both humans
and AI assistants can write reliably. It is meant as a softer alternative to
`git apply` / `patch`: instead of line numbers and hunks, you describe changes
in terms of text anchors, regular expressions, or full blocks. It is
idempotent, so re-applying the same change file is safe.

Typical use case: you are working with an AI assistant in a chat, and instead
of pasting entire files back and forth, you ask for a `.graft` file that
contains only the changes. You save it in your project, run `graft apply`, and
you are done.

## Why not `git apply`?

`git apply` uses unified diff hunks with exact line numbers and three lines of
context. That works fine for machines that produce diffs from real files, but
AI assistants frequently get line numbers wrong, misindent context, or drop
trailing whitespace, which makes the patch fail to apply.

`graft` removes line numbers from the equation. A change is described by the
text to find and the text to replace it with. If the text is ambiguous, you
narrow it with an anchor or a line range. If the change is already applied,
`graft` skips it instead of failing.

## Install

### CLI

Requires Node.js 20+.

```sh
npm install -g @andoni.galardi/graft
```

For local development:

```sh
npm install
npm run build
node dist/cli/index.js --help
```

### VS Code extension

The repository ships a VS Code extension under `editors/vscode/`. It adds a
side panel with an embedded view of the current `.graft` file and buttons to
validate or apply it.

To build and install it locally:

```sh
cd editors/vscode
npm run package
```

That produces `graft-vscode-<version>.vsix`. Install it with:

- `Ctrl+Shift+P` → **Extensions: Install from VSIX…** → pick the file.

The `.vsix` is self-contained: it bundles the core, so it does not need
Node.js, the CLI, or the source repository on the target machine.

## Quick start

Create a file at `.graft/changes.graft` (the VS Code panel creates it for you
with the command **Graft: New changes file**):

```
[op: mkdir]
path: src/components

[op: write]
path: src/components/Button.tsx
<<<CONTENT
export function Button({ label }: { label: string }) {
  return <button>{label}</button>;
}
CONTENT>>>

[op: insert-after]
path: src/index.ts
anchor: "export * from './app';"
<<<CONTENT
export * from './components/Button';
CONTENT>>>

[op: patch]
path: src/utils.ts
scope-after: 'export function add'
<<<FIND
  return a + b;
FIND>>>
<<<REPLACE
  return a + b; // sum
REPLACE>>>
```

Preview the changes:

```sh
graft apply .graft/changes.graft --dry-run
```

Apply them for real, with a backup of any modified file:

```sh
graft apply .graft/changes.graft --backup
```

## The `.applied` sidecar

After a `.graft` file is applied successfully, `graft` writes a small record
next to it: `.graft/changes.graft.applied`. It contains a SHA-256 of the file
content at the time of applying, the timestamp, and the number of operations.

On the next run, if the file content has not changed and the sidecar is
present, `graft apply` refuses to run and exits with code `3`, telling you
when the file was already applied. That prevents accidental double-applies
from scripts, cron jobs, or a distracted user.

To force re-application:

- Pass `--force`, or
- Delete the `.applied` file.

The sidecar is also written when the operations all end up in `skipped`
(meaning the desired state was already in place), so the state stays coherent
if you apply the same `.graft` from a machine where the sidecar was missing.

`--dry-run` never writes the sidecar and never short-circuits on an existing
one.

## CLI

```
graft apply <file>   Apply operations from a .graft file
graft check <file>   Parse and validate without touching anything
graft <file>         Shorthand for 'graft apply <file>'
graft --help         Show this help
graft --version      Show version
```

Options:

```
--cwd <dir>          Base directory for operations (default: current dir)
--dry-run, -n        Show what would happen, write nothing
--force, -f          Re-apply even if the file is recorded as already applied
--backup, -b         Save originals to .graft/backups/<timestamp>/
--json               Output machine-readable JSON instead of text
--quiet, -q          Suppress per-operation output (only show summary)
```

Exit codes:

```
0  all operations ok, skipped, or would-apply (dry-run)
1  at least one operation failed
2  usage or parse error
3  skipped because the file was already applied (use --force to override)
```

## VS Code extension

Once installed, the extension adds:

- A **Graft** icon in the Activity Bar. Opening it shows the current
  `.graft` file with a toolbar.
- A **Graft changes** section inside the Explorer, with the same content.
  Useful if you prefer not to dedicate a full Activity Bar slot to it.

Both panels show the same file and stay in sync. The content is read-only;
use the **Edit** button to open the file in a full editor tab when you want
to modify it.

Buttons:

- **New** — creates `.graft/changes.graft` if missing, or opens an existing
  one. Prompts for a name.
- **Pick** — QuickPick listing all `*.graft` files in the workspace.
- **Paste** — replaces the current file content with the clipboard. Prompts
  for confirmation if the current content is non-empty and does not look like
  a template (only comments). Set `graft.paste.confirmOnReplace` to `false`
  to skip the confirmation.
- **Edit** — opens the current `.graft` in a normal editor tab.
- **Validate** — parses the file and shows the result (operation count, or
  the exact parse error with line number).
- **Apply** — runs a dry-run, shows a summary ("N would be applied, M would
  be skipped"), and asks for confirmation before applying for real.

The extension writes to the same `.applied` sidecar as the CLI, so a file
applied from VS Code will be recognized as "already applied" by a subsequent
`graft apply` from the terminal, and vice versa.

### Building the extension from source

```sh
cd editors/vscode
npm install
npm run build           # or: npm run watch
```

To try it without installing:

- Open the repository in VS Code.
- Press `F5`. A second VS Code window ("Extension Development Host") opens
  with the extension loaded.
- Open a project folder inside that window (`File → Open Folder…`).
- The Graft panel appears in the Activity Bar and in the Explorer.

## File format

A `.graft` file is a sequence of operations. Blank lines and comments are
ignored outside blocks. Inside a block, everything is literal.

See [`docs/format-v1.md`](docs/format-v1.md) for the full grammar.

### Header

```
[op: mkdir]
```

Lowercase ASCII name, optionally hyphenated. Nothing else on the line.

### Attributes

```
path: src/components
```

`key: value`, one per line. Values may be quoted, but that is only necessary
when the value contains a colon.

### Blocks

```
<<<CONTENT
...content...
CONTENT>>>
```

The opener is `<<<` + an uppercase name. The closer is the name + `>>>`,
alone on its own line. Allowed names: `CONTENT`, `FIND`, `REPLACE`.

## Operations

### mkdir

Creates a directory, recursive. Idempotent.

```
[op: mkdir]
path: src/components
```

### delete

Deletes a file or directory.

```
[op: delete]
path: src/legacy
recursive: true
```

### write

Creates or overwrites a file.

```
[op: write]
path: src/new.ts
<<<CONTENT
export const x = 1;
CONTENT>>>
```

### rename

Renames or moves a file. Fails if the destination exists.

```
[op: rename]
path: src/old-name.ts
to: src/new-name.ts
```

### copy

Copies a file. Idempotent: skips if the destination already has the same
content.

```
[op: copy]
path: src/template.ts
to: src/new-module.ts
```

### append

Appends content to the end of a file. Creates the file if missing.

```
[op: append]
path: src/index.ts
<<<CONTENT
export * from './new-module';
CONTENT>>>
```

### prepend

Prepends content to the start of a file. Creates the file if missing.

```
[op: prepend]
path: src/index.ts
<<<CONTENT
/* Copyright 2026 */
CONTENT>>>
```

### insert-after

Inserts content right after an anchor. The anchor must match exactly once.

By default, if the anchor ends at the end of a line, the content is placed on
the following line, with a newline added if needed. Use `inline: true` to
insert literally at the anchor position without line-snapping.

```
[op: insert-after]
path: src/app.ts
anchor: "import { Component } from './component';"
<<<CONTENT
import { Service } from './service';
CONTENT>>>
```

### insert-before

Same as `insert-after`, before the anchor.

```
[op: insert-before]
path: src/app.ts
anchor: 'export function main()'
<<<CONTENT
// Entry point
CONTENT>>>
```

### patch

The workhorse. Two modes.

**find/replace** (default):

```
[op: patch]
path: src/utils.ts
<<<FIND
  return a + b;
FIND>>>
<<<REPLACE
  return a + b; // sum
REPLACE>>>
```

Attributes:

- `match`: `exact` (default), `normalized` (ignores leading/trailing
  whitespace and collapses internal whitespace per line), or `regex`.
- `word: true`: match must have word boundaries on both sides.
- `scope-after`, `scope-before`: narrow search to a region between text
  anchors.
- `scope-after-line`, `scope-before-line`: same, by line number.
- `first: true` / `all: true`: pick the first match or apply to all. They are
  mutually exclusive.
- If the `FIND` block matches more than once and no scope or `first`/`all` is
  given, the operation fails. This is deliberate: better to fail than to
  change the wrong place.

**lines**: replace a range by line number.

```
[op: patch]
path: src/config.ts
lines: 40..42
<<<CONTENT
const TIMEOUT = 5000;
CONTENT>>>
```

## Using graft with AI assistants

This is the point of the tool. Paste the following into your chat as part of
the system prompt, along with the file or files you want to modify.

```
You are going to produce a .graft file with the changes I ask for.

Rules:
- Output ONLY the .graft file content. No markdown fences, no prose.
- One operation = one "[op: <name>]" header on its own line.
- Attribute lines are "key: value", one per line.
- Blocks open with "<<<NAME" and close with "NAME>>>", alone on the line.
  NAME is one of CONTENT, FIND, REPLACE.
- Inside a block, everything is literal. Do not insert comments.
- Paths use forward slashes, relative to the project root.
- For patches, copy the FIND block character-for-character from the file I
  showed you. Do not retype it from memory.
- If the same text appears more than once, add a scope-after / scope-before
  with a unique anchor, or use first: true / all: true.
- The REPLACE block is the literal replacement text, not a diff.

Operation catalog:
- mkdir: create a directory. attr: path.
- delete: remove a file or directory. attrs: path, recursive (bool).
- write: create or overwrite a file. attr: path. block: CONTENT.
- rename: rename/move. attrs: path, to.
- copy: duplicate a file. attrs: path, to.
- append: add to end of file. attr: path. block: CONTENT.
- prepend: add to start of file. attr: path. block: CONTENT.
- insert-after: insert right after an anchor. attrs: path, anchor, match,
  inline. block: CONTENT.
- insert-before: same, before the anchor.
- patch: modify part of a file. attrs: path, match, word, scope-after,
  scope-before, scope-after-line, scope-before-line, first, all, lines.
  blocks: FIND + REPLACE, or CONTENT (when using lines).

File: src/example.ts
<contents>

Change I want:
<description>

Output the .graft file.
```

Save the result as `.graft/changes.graft`, review it with
`graft apply .graft/changes.graft --dry-run`, then apply it with
`graft apply .graft/changes.graft`. Or use the VS Code extension and press
**Validate** and **Apply**.

## Status

Functional. The core (parser, matcher, engine, CLI) and the VS Code extension
are complete and covered by tests (~137 tests). The sidecar mechanism
prevents accidental double-applies. Published on npm and on the VS Code
Marketplace are planned.

## Development

```sh
npm install
npm test                # run all tests
npm run build           # compile the core and CLI
npm run build:vscode    # compile the VS Code extension
npm run build:all       # both
```

The repository is a small npm workspace:

```
graft/
├── src/                    core + CLI
├── tests/                  tests for the core
├── docs/format-v1.md       format specification
├── examples/               sample .graft files
└── editors/vscode/         VS Code extension
```

The extension consumes the core via `@andoni.galardi/graft`, resolved through
the workspace. At package time, esbuild bundles the core into a single
self-contained `extension.js`, so the resulting `.vsix` does not need the
repository or Node.js on the target machine.

## License

MIT
 