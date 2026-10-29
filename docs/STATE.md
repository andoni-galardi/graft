# Graft - Project State & Roadmap

**Current Version**: v0.7.0
**Last Updated**: 2026-10-29

## 1. What is Done (v0.7.0)

- **Core (`src/core/`)**:
  - Implemented Query Operations: `read`, `search`, `list`.
  - Added overlay virtual filesystem to `validate` to allow chained operations (for example: write file then read it, or delete file then list directory).
  - `apply` aborts on the first real failure and marks subsequent operations as skipped.
  - Sidecar `.applied` is not written if the file only contains query operations.
  - Added `output` field to `OperationResult`. Supports `.graft` v1.2 format.

- **VS Code Extension (`editors/vscode/`)**:
  - **Unified Report**: A bottom panel displays the results of all operations, including query outputs and errors.
  - **Copy Features**: Copy button per operation details and a Copy All button for the report.
  - **Toolbar Cleanup**: Removed Edit and Validate from toolbar (moved to the ... menu).
  - **UI Adjustments**: Auto-numbered operations column and optimized column widths for Action and Status.

## 2. Known Issues / Tech Debt

- **Query Status Labels in UI**: Currently, query operations (`read`, `search`, `list`) show as `Applied` in the UI table when validated, because they execute during the `dryRun` to generate the report.
  - *Proposed UX fix*: During `Validate` (`dryRun`), queries should probably show as `Ready`. When actually applied, they should show as `Queried` or similar.
  - *Complication*: Pure-query grafts might not require hitting `Apply` at all, making the state transition unclear. Mixed grafts (queries + modifications) need a consistent visual flow. Discuss before implementing.

## 3. Next Step: v0.8.0 (Conditional Logic)

**Concept**: Allow operations to be evaluated conditionally based on the state of the codebase. This will make `.graft` files smarter and more resilient in large refactorings.

**Proposed Syntax**:

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

## 4. Future Ideas
- **v0.9.0**: Publish to VS Code Marketplace and npm.
