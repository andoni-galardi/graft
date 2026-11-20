# `.graft` file format — v1.2

## Overview

A `.graft` file contains a sequence of operations. Each operation consists of:

- A header line: `[op: <name>]` (nothing else on the line).
- Zero or more attributes: `key: value` (one per line).
- Zero or more delimited blocks.

Blank lines and comments (`#` as the first non-whitespace character) are
ignored **outside** blocks. Inside a block, `#` and `[op: ...]` are literal
text, not syntax.

## Block delimiters

    <<<NAME
    ...content...
    NAME>>>

- The opening line is `<<<NAME`, where `NAME` is one of `CONTENT`, `FIND`,
  `REPLACE`.
- The closing line is `NAME>>>`, alone on the line.
- Line endings inside a block are preserved.
- An empty block is valid.
- There is no escape mechanism. If your content contains a line that is
  exactly `NAME>>>`, use a different strategy (split into two operations).

## Operations
All operations accept an optional `description` attribute (free-form text,
ignored by the engine). It is intended as a human-readable label shown in
tooling (e.g., the VS Code extension).

### mkdir
Creates a directory (recursive).
- `path` (required)

### delete
Deletes a file or directory.
- `path` (required)
- `recursive` (optional, `true`/`false`, default `false`)

### write
Creates or overwrites a file.
- `path` (required)
- `encoding` (optional, default `utf-8`)
- Block: `CONTENT` (required)

### rename
Renames or moves a file. Fails if the destination already exists.
- `path` (required)
- `to` (required)

### copy
Copies a file. Overwrites if destination exists with different content.
- `path` (required)
- `to` (required)

### append
Appends content to the end of a file. Creates the file if it doesn't exist.
Idempotent: skips if the content is already at the end.
- `path` (required)
- Block: `CONTENT` (required)

### prepend
Prepends content to the start of a file. Creates the file if it doesn't exist.
Idempotent: skips if the content is already at the start.
- `path` (required)
- Block: `CONTENT` (required)

### insert-after

Inserts content immediately **after** the anchor. The anchor must match
exactly one location; otherwise the operation fails.

Semantics:

- By default, if the anchor ends at the end of a line (the next character is
  `\n`, or the anchor is at the end of the file), the content is placed on
  the following line, with a newline added if needed.
- If `inline: true`, no line-snap happens: the content is inserted literally
  right after the anchor, wherever it is.

Idempotent: skips if the same content is already right where it would be
inserted.

- `path` (required)
- `anchor` (required)
- `match`: `exact` | `normalized` | `regex` (default `exact`)
- `inline`: `true` | `false` (default `false`)
- Block: `CONTENT` (required)

### insert-before

Same as `insert-after` but inserts **before** the anchor.

- By default, if the anchor starts at the start of a line (the preceding
  character is `\n`, or the anchor is at the start of the file), the content
  is placed on its own line before the anchor's line, with a trailing newline
  added if needed.
- If `inline: true`, no line-snap happens: literal insertion before the anchor.

- `path` (required)
- `anchor` (required)
- `match`: `exact` | `normalized` | `regex` (default `exact`)
- `inline`: `true` | `false` (default `false`)
- Block: `CONTENT` (required)

### patch

Modifies an existing file. Two modes.

**find/replace mode** (default):
- `path` (required)
- `match`: `exact` | `normalized` | `regex` (default `exact`)
- `word`: `true` | `false` (default `false`). When true, matches must have
  word boundaries on both sides (non-word chars: anything outside
  `[A-Za-z0-9_]`). Useful for renaming identifiers without touching longer
  names that contain the same substring.
- Scope attributes (all optional, combinable):
  - `scope-after: <text>` — search only after the first occurrence of `<text>`.
  - `scope-before: <text>` — search only before the first occurrence of `<text>`.
  - `scope-after-line: N` — search only on lines strictly after line N.
  - `scope-before-line: M` — search only on lines strictly before line M.
- Multiplicity:
  - Default: fails if more than one match within the scope.
  - `first: true` — apply to the first match only.
  - `all: true` — apply to every match.
  - `first` and `all` are mutually exclusive.
- Blocks: `FIND` (required), `REPLACE` (required, may be empty).

**lines mode**:
- `path` (required)
- `lines`: `N..M` (required, 1-based, inclusive on both ends)
- Block: `CONTENT` (required)

### read
Reads a file and outputs its content, optionally restricted to a line range.
- `path` (required)
- `lines` (optional, `N..M`, 1-based inclusive)

### search
Searches for a pattern in files. The path may contain globs.
- `path` (required)
- `pattern` (required)
- `match`: `exact` | `normalized` | `regex` (default `exact`)
- `context` (optional, number of surrounding lines to show)

### list
Lists the contents of a directory.
- `path` (required)
- `extensions` (optional, comma-separated list, e.g. `.ts, .js`)
- `exclude` (optional, comma-separated list of directory or file names)

## Examples


    [op: mkdir]
    path: src/components

    [op: write]
    path: src/new.ts
    <<<CONTENT
    export const x = 1;
    CONTENT>>>

    [op: rename]
    path: src/old.ts
    to: src/new-name.ts

    [op: append]
    path: src/index.ts
    <<<CONTENT
    export * from './new';
    CONTENT>>>

    [op: insert-after]
    path: src/app.ts
    anchor: "import { Component } from './component';"
    <<<CONTENT
    import { Service } from './service';
    CONTENT>>>

    # Renombrar un identificador en todo el archivo
    [op: patch]
    path: src/app.ts
    word: true
    all: true
    <<<FIND
    total
    FIND>>>
    <<<REPLACE
    grandTotal
    REPLACE>>>

    [op: patch]
    path: src/utils.ts
    scope-after: 'export function add'
    <<<FIND
      return a + b;
    FIND>>>
    <<<REPLACE
      return a + b; // sum
    REPLACE>>>

    [op: patch]
    path: src/config.ts
    lines: 40..42
    <<<CONTENT
    const TIMEOUT = 5000;
    CONTENT>>>

    [op: read]
    path: src/index.ts
    lines: 10..20

    [op: search]
    path: src/**/*.ts
    pattern: TODO

    [op: list]
    path: src/
    extensions: .ts, .js


## Errors

The parser stops at the first error and reports `file:line: reason`.

Possible errors: malformed header, unknown operation, unknown attribute,
unexpected block, unterminated block, duplicate attribute, missing `path`
or other required attribute, invalid `lines` format, invalid `match` value,
`first`/`all` together, non-boolean for `first`/`all`/`word`/`inline`/
`recursive`.
