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

## Quick start

Create a file called `changes.graft` with something like:

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
graft apply changes.graft --dry-run
```

Apply them for real, with a backup of any modified file:

```sh
graft apply changes.graft --backup
```

Re-apply the same file later and `graft` will skip everything that is already
in place.

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
--force, -f          Reserved for future use (currently no-op)
--backup, -b         Save originals to .graft/backups/<timestamp>/
--json               Output machine-readable JSON instead of text
--quiet, -q          Suppress per-operation output (only show summary)
```

Exit codes:

```
0  all operations ok, skipped, or would-apply (dry-run)
1  at least one operation failed
2  usage or parse error
```

## File format

A `.graft` file is a sequence of operations. Blank lines and comments are
ignored outside blocks. Inside a block, everything is literal.

### Header

Each operation starts with a header line:

```
[op: mkdir]
```

The name is lowercase ASCII (may contain hyphens). Nothing else may appear on
the line.

### Attributes

After the header, each line is an attribute:

```
path: src/components
```

The format is `key: value`. Keys are lowercase, hyphenated. Values occupy a
single line. Quotes around values are optional, and only necessary if the
value contains a colon.

### Blocks

Some operations take blocks of text, delimited by marker lines:

```
<<<CONTENT
...content...
CONTENT>>>
```

Rules:

- The opener is `<<<` followed by an uppercase block name.
- The closer is the block name followed by `>>>`, alone on the line.
- Allowed names: `CONTENT`, `FIND`, `REPLACE`.
- Everything between the markers is literal. Comments, `#`, `[op: ...]`, and
  `<<<...` have no special meaning inside a block.
- An empty block is valid.
- There is no escape mechanism. If your content contains a line that is
  exactly the closing marker, split the content into two operations.

### Comments

Lines whose first non-whitespace character is `#` are comments, but only
outside blocks. Inside a block, `#` is literal.

## Operations

### mkdir

Creates a directory. Recursive, like `mkdir -p`. Idempotent: skips if the
directory already exists.

```
[op: mkdir]
path: src/components
```

### delete

Deletes a file or directory. `recursive: true` is required to delete a
non-empty directory.

```
[op: delete]
path: src/legacy
recursive: true
```

### write

Creates or overwrites a file. Idempotent: skips if the file already has that
content.

```
[op: write]
path: src/new.ts
<<<CONTENT
export const x = 1;
CONTENT>>>
```

### rename

Renames or moves a file. Fails if the destination already exists, so you
cannot accidentally overwrite something.

```
[op: rename]
path: src/old-name.ts
to: src/new-name.ts
```

### copy

Copies a file. Overwrites if the destination exists with different content.
Idempotent: skips if the destination already has the same content.

```
[op: copy]
path: src/template.ts
to: src/new-module.ts
```

### append

Appends content to the end of a file. Creates the file if it does not exist.
Idempotent: skips if the content is already at the end.

```
[op: append]
path: src/index.ts
<<<CONTENT
export * from './new-module';
CONTENT>>>
```

### prepend

Prepends content to the start of a file. Creates the file if it does not
exist. Idempotent: skips if the content is already at the start.

```
[op: prepend]
path: src/index.ts
<<<CONTENT
/* Copyright 2026 */
CONTENT>>>
```

### insert-after

Inserts content right after an anchor. The anchor must match exactly one
location in the file; otherwise the operation fails.

By default, if the anchor ends at the end of a line, the content is placed on
the following line, with a newline added if needed. This is what you want for
"add one import after this other import" and similar.

Use `inline: true` to skip the line-snapping and insert the content literally
right after the anchor, even mid-line.

```
[op: insert-after]
path: src/app.ts
anchor: "import { Component } from './component';"
<<<CONTENT
import { Service } from './service';
CONTENT>>>
```

### insert-before

Same as `insert-after` but inserts before the anchor.

```
[op: insert-before]
path: src/app.ts
anchor: 'export function main()'
<<<CONTENT
// Entry point
CONTENT>>>
```

### patch

The workhorse. Modifies an existing file. Two modes.

**find/replace mode** (default). Replaces a block of text:

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
- `word: true`: the match must have word boundaries on both sides. Useful for
  renaming identifiers without touching longer names that contain the same
  substring (for example `total` vs `subtotal`).
- `scope-after: <text>`: only search after the first occurrence of `<text>`.
- `scope-before: <text>`: only search before the first occurrence of `<text>`.
- `scope-after-line: N`: only search on lines strictly after line N.
- `scope-before-line: M`: only search on lines strictly before line M.
- `first: true`: apply to the first match only.
- `all: true`: apply to every match.
- `first` and `all` are mutually exclusive.

By default, if the `FIND` block matches more than one location and no scope or
`first`/`all` is given, the operation fails. This is deliberate: better to
fail than to change the wrong place.

**lines mode.** Replaces a range of lines by number. Only use this when you
know the exact line numbers; otherwise prefer find/replace.

```
[op: patch]
path: src/config.ts
lines: 40..42
<<<CONTENT
const TIMEOUT = 5000;
CONTENT>>>
```

## Using graft with AI assistants

This is the point of the tool. The trick is to give the model a good prompt
with a precise, narrow format, and enough context to write the `FIND` blocks
correctly.

Paste the following into your chat as part of the system prompt, along with
the file or files you want to modify. Then ask for the changes as a `.graft`
file.

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

Save the result as `changes.graft`, review it with
`graft apply changes.graft --dry-run`, then apply it with
`graft apply changes.graft`.

## Status

Early but functional. The core (parser, matcher, engine, CLI) is complete and
covered by tests. A VS Code extension is planned; the CLI already supports
`--json` so the extension can consume structured results directly.

## License

MIT
