# `.graft` file format — v1

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

## Errors

The parser stops at the first error and reports `file:line: reason`.

Possible errors: malformed header, unknown operation, unknown attribute,
unexpected block, unterminated block, duplicate attribute, missing `path`
or other required attribute, invalid `lines` format, invalid `match` value,
`first`/`all` together, non-boolean for `first`/`all`/`word`/`inline`/
`recursive`.

---

## For AI assistants

Copy this section verbatim into your system prompt if you want the model to
produce `.graft` files reliably.

**Task**: When asked to produce a `.graft` file, output ONLY the file content.
No markdown fences, no commentary, no leading/trailing prose.

**Absolute rules**:

1. One operation = one `[op: <name>]` header on its own line. Nothing else
   on that line. The name is lowercase ASCII; use hyphen if needed
   (`[op: insert-after]`, not `[op: InsertAfter]`).
2. Attribute lines are `key: value`. Keys are lowercase, ASCII, hyphenated.
   Values on a single line. Only use attributes this document defines.
3. Blocks open with `<<<NAME` and close with `NAME>>>`, alone on the line.
   `NAME` must be one of: `CONTENT`, `FIND`, `REPLACE`. Uppercase.
4. Inside a block, everything is literal. Do not insert comments. Do not
   interpret `#` as a comment. Do not re-indent. Do not wrap or trim.
5. `path` uses forward slashes, always relative to the project root.
   Never absolute paths. Never backslashes.
6. `#` starts a comment ONLY outside blocks. Use it sparingly.
7. Never invent attributes. Never invent operations.

**Choosing the operation**:

- Create a new file → `[op: write]`.
- Modify part of an existing file → `[op: patch]` (preferred for
  replacements).
- Rename an identifier everywhere in a file → `[op: patch]` with
  `word: true` and `all: true`.
- Add content to the top of an existing file (imports, license header) →
  `[op: prepend]`.
- Add content to the end of an existing file (exports, list entries) →
  `[op: append]`.
- Add one line right after a specific existing line (e.g. one import after
  another) → `[op: insert-after]`.
- Add content right before a specific line (e.g. a comment before a
  function) → `[op: insert-before]`.
- Rename or move a file → `[op: rename]`.
- Duplicate a file → `[op: copy]`.

**How to write a `patch` operation**:

- Copy the `FIND` block character-for-character from the source file the user
  provided. Do not retype it from memory, do not "fix" indentation, do not
  normalize whitespace. If unsure, use `match: normalized`.
- If the same text appears more than once in the file, you MUST either:
  - add a `scope-after` / `scope-before` (with an anchor that appears once), or
  - add `scope-after-line` / `scope-before-line` (if the user gave line numbers), or
  - add `first: true` (only if the user explicitly wants just the first one).
- To rename an identifier everywhere in a file, use `word: true` and
  `all: true` with a short `FIND` (just the identifier, no newlines) and
  a short `REPLACE`.
- The `REPLACE` block contains the full new version of the matched region.
  It is not a diff. It is the literal replacement text.
- Do not add line numbers. Do not add `@@`. Do not output git patch syntax.

**How to write `insert-after` / `insert-before`**:

- The `anchor` must be a short unique string from the file. Prefer a full
  line without its trailing newline (e.g. `import { X } from 'y';`). The
  operation will place the content on its own line automatically.
- Use an `anchor` that appears exactly once. If not, the operation fails.
- `CONTENT` should end with a newline (it is usually a full line).
- If you want several lines, put them all in the `CONTENT` block.
- Use `inline: true` only if you want to insert literally at the exact
  position (for example, to insert inside a line, or to splice text without
  adding a newline).

**Anti-patterns (never do these)**:

- `[op: patch]` followed by `@@ -1,3 +1,4 @@` (that is git diff syntax).
- Guessing line counts. If you cannot see the file, use `find`/`replace`.
- Omitting `>>>` on the closing block line.
- Writing `<<<END` or any other block name outside `CONTENT`, `FIND`, `REPLACE`.
- Putting `#` comments inside a block.
- Wrapping attribute values in quotes unless the value itself contains `:`.
- Emitting an empty file. If there is nothing to change, say so in prose
  instead of producing an empty `.graft`.

**Minimal valid file**:

    [op: mkdir]
    path: src

**Common correct shape for editing a function**:

    [op: patch]
    path: src/math.ts
    scope-after: 'export function add'
    <<<FIND
    export function add(a: number, b: number) {
      return a + b;
    }
    FIND>>>
    <<<REPLACE
    export function add(a: number, b: number): number {
      return a + b;
    }
    REPLACE>>>

**Common correct shape for renaming an identifier in a file**:

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

**Common correct shape for adding an import**:

    [op: insert-after]
    path: src/app.ts
    anchor: "import { Component } from './component';"
    <<<CONTENT
    import { Service } from './service';
    CONTENT>>>
    