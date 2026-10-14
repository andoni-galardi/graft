export type MatchMode = 'exact' | 'normalized' | 'regex';

export interface Scope {
  afterText?: string;
  beforeText?: string;
  afterLine?: number;
  beforeLine?: number;
}

export interface PatchFindOperation {
  op: 'patch';
  path: string;
  mode: 'find';
  match: MatchMode;
  find: string;
  replace: string;
  scope?: Scope;
  first?: boolean;
  all?: boolean;
  word?: boolean;
}

export interface PatchLinesOperation {
  op: 'patch';
  path: string;
  mode: 'lines';
  from: number;
  to: number;
  content: string;
}

export interface RenameOperation {
  op: 'rename';
  path: string;
  to: string;
}

export interface CopyOperation {
  op: 'copy';
  path: string;
  to: string;
}

export interface AppendOperation {
  op: 'append';
  path: string;
  content: string;
}

export interface PrependOperation {
  op: 'prepend';
  path: string;
  content: string;
}

export interface InsertAfterOperation {
  op: 'insert-after';
  path: string;
  anchor: string;
  content: string;
  match: MatchMode;
  inline?: boolean;
}

export interface InsertBeforeOperation {
  op: 'insert-before';
  path: string;
  anchor: string;
  content: string;
  match: MatchMode;
  inline?: boolean;
}

export type Operation =
  | { op: 'mkdir'; path: string }
  | { op: 'delete'; path: string; recursive: boolean }
  | { op: 'write'; path: string; content: string; encoding?: string }
  | RenameOperation
  | CopyOperation
  | AppendOperation
  | PrependOperation
  | InsertAfterOperation
  | InsertBeforeOperation
  | PatchFindOperation
  | PatchLinesOperation;

export type OperationStatus = 'ok' | 'skipped' | 'failed' | 'would-apply';

export interface OperationResult {
  op: Operation;
  status: OperationStatus;
  reason?: string;
  error?: string;
  diff?: { before: string; after: string };
  matchCount?: number;
}

export interface ApplyOptions {
  cwd: string;
  dryRun?: boolean;
  force?: boolean;
  backup?: boolean;
}
