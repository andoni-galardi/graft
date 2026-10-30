# Graft — Status

**Current Version**: v0.7.0
**Next Milestone**: v0.8.0 (Conditional Logic)

## Recent

- Query operations implemented: `read`, `search`, `list`.
- Overlay virtual filesystem added to `validate` to allow chained operations.
- `apply` aborts on the first real failure; subsequent operations are marked as skipped.
- Sidecar `.applied` is not written for pure-query grafts.
- `output` field added to `OperationResult` (`.graft` v1.2).
- VS Code: unified report panel, Copy per-op / Copy All, auto-numbered operations column, toolbar cleanup (Edit/Validate moved to the `...` menu).

## Known Issues

- **Query Status Labels in UI**: query operations show as `Applied` after `Validate`. See [docs/ARCHITECTURE.md](ARCHITECTURE.md#open-design-questions) for the open design question.

## Next

**v0.8.0 — Conditional Logic.** Allow operations to run conditionally based on codebase state (proposed `[op: when]` syntax). Design details in [docs/ARCHITECTURE.md](ARCHITECTURE.md#v080-design--conditional-logic).

## After

**v0.9.0** — Publish to VS Code Marketplace and npm.
