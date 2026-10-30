# GRAFT FORMAT SPECIFICATION (For AI use, v1.2)

## Absolute Rules
1. **One operation = one `[op: <name>]` header** on its own line. Lowercase ASCII; use hyphens (`[op: insert-after]`, not `[op: InsertAfter]`).
2. **Attributes are `key: value`**. Keys are lowercase, ASCII, hyphenated. Values on a single line. Never invent attributes or operations.
3. **Blocks:** `<<<NAME` (open) and `NAME>>>` (close), alone on the line. The closing name MUST exactly match the opening name (e.g., `<<<REPLACE` must close with `REPLACE>>>`). `NAME` is `CONTENT`, `FIND`, or `REPLACE` (uppercase).
4. **Inside a block, everything is literal.** Do not add your own explanatory comments inside a block. Preserve any code-native # characters (like Python comments or hex colors) exactly as they are. Do not re-indent, wrap, or trim.
5. **`path` uses forward slashes**, always relative to the project root. Never absolute. Never backslashes.
6. **`#` comments** are allowed ONLY outside blocks. Use sparingly.

## Operations Syntax

Every operation is a block with this structure:
- Header: `[op: <operation>]`
- Attributes: `key: value` (one per line)
- Blocks: `<<<BLOCKNAME` followed by text, followed by `BLOCKNAME>>>`

Operation definitions:
- **mkdir**: required attributes `path`. No blocks.
- **delete**: required attributes `path`. Optional: `recursive`. No blocks.
- **rename**: required attributes `path`, `to`. No blocks.
- **copy**: required attributes `path`, `to`. No blocks.
- **write**: required attributes `path`. Optional: `encoding`. Blocks: `CONTENT`.
- **append**: required attributes `path`. Blocks: `CONTENT`.
- **prepend**: required attributes `path`. Blocks: `CONTENT`.
- **insert-after**: required attributes `path`, `anchor`. Optional: `match`, `inline`. Blocks: `CONTENT`.
- **insert-before**: required attributes `path`, `anchor`. Optional: `match`, `inline`. Blocks: `CONTENT`.
- **patch** (find/replace): required attributes `path`. Optional: `match`, `word`, `all`, `first`, `scope-after`, `scope-before`, `scope-after-line`, `scope-before-line`. Blocks: `FIND`, `REPLACE`.
- **patch** (lines): required attributes `path`, `lines`. Blocks: `CONTENT`.
- **read**: required attributes `path`. Optional: `lines`. No blocks.
- **search**: required attributes `path`, `pattern`. Optional: `match`, `context`. No blocks.
- **list**: required attributes `path`. Optional: `extensions`, `exclude`. No blocks.

## Behavioral Rules

**`patch` (find/replace):**
- Copy `FIND` character-for-character. Do not normalize whitespace unless using `match: normalized`.
- If text appears multiple times, you MUST scope it (`scope-after`, `scope-before`, lines) or use `first: true`.
- `REPLACE` is the literal new text, not a diff. No `@@`, no line numbers.
- To rename an identifier, use short `FIND`/`REPLACE` with `word: true` and `all: true`.

**`insert-after` / `insert-before`:**
- `anchor` must be a short unique string from the file. It must appear exactly once.
- `CONTENT` should end with a newline if it is a full line.
- Use `inline: true` ONLY to insert exactly at the anchor position without a line-snap.

## Anti-patterns (NEVER do these)
- `[op: patch]` followed by `@@ -1,3 +1,4 @@` (git diff syntax).
- Guessing line counts. If you cannot see the file, use `find`/`replace`.
- Mismatched block delimiters (e.g., opening with `<<<REPLACE` but closing with `FIND>>>`). The closing tag MUST match the opening tag. Never omit the `>>>`.
- Writing `<<<END` or any block name outside `CONTENT`, `FIND`, `REPLACE`.
- Adding your own structural comments (e.g., # This is the change) inside a CONTENT, FIND, or REPLACE block. (Code-native # characters from the user's code must be preserved).
- Wrapping attribute values in quotes unless the value contains `:`.
- Emitting an empty file. If there is nothing to change, say so in prose.
