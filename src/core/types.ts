export type MatchMode = 'exact' | 'normalized' | 'regex';

export interface Scope {
  afterText?: string;
  beforeText?: string;
  afterLine?: number;
  beforeLine?: number;
}

export interface OperationBase {
  description?: string;
}

export interface PatchFindOperation extends OperationBase {
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

export interface PatchLinesOperation extends OperationBase {
  op: 'patch';
  path: string;
  mode: 'lines';
  from: number;
  to: number;
  content: string;
}

export interface RenameOperation extends OperationBase {
  op: 'rename';
  path: string;
  to: string;
}

export interface CopyOperation extends OperationBase {
  op: 'copy';
  path: string;
  to: string;
}

export interface AppendOperation extends OperationBase {
  op: 'append';
  path: string;
  content: string;
}

export interface PrependOperation extends OperationBase {
  op: 'prepend';
  path: string;
  content: string;
}

export interface InsertAfterOperation extends OperationBase {
  op: 'insert-after';
  path: string;
  anchor: string;
  content: string;
  match: MatchMode;
  inline?: boolean;
}

export interface InsertBeforeOperation extends OperationBase {
  op: 'insert-before';
  path: string;
  anchor: string;
  content: string;
  match: MatchMode;
  inline?: boolean;
}

export interface ReadOperation extends OperationBase {
  op: 'read';
  path: string;
  from?: number;
  to?: number;
}

export interface SearchOperation extends OperationBase {
  op: 'search';
  path: string;
  pattern: string;
  match: MatchMode;
  context?: number;
}

export interface ListOperation extends OperationBase {
  op: 'list';
  path: string;
  extensions?: string[];
  exclude?: string[];
}

export type Operation =
  | ({ op: 'mkdir'; path: string } & OperationBase)

  | ({ op: 'delete'; path: string; recursive: boolean } & OperationBase)
  | ({ op: 'write'; path: string; content: string; encoding?: string } & OperationBase)
  | RenameOperation
  | CopyOperation
  | AppendOperation
  | PrependOperation
  | InsertAfterOperation
  | InsertBeforeOperation
  | PatchFindOperation
  | PatchLinesOperation
  | ReadOperation
  | SearchOperation
  | ListOperation;



export type OperationStatus = 'ok' | 'skipped' | 'failed' | 'would-apply';

export interface OperationResult {
  op: Operation;
  status: OperationStatus;
  reason?: string;
  error?: string;
  diff?: { before: string; after: string };
  matchCount?: number;
  output?: string;
}


export interface ApplyOptions {
  cwd: string;
  dryRun?: boolean;
  force?: boolean;
  backup?: boolean;
}

export interface AppliedRecord {
  appliedAt: string;
  hash: string;
  operations: number;
}

export interface ApplyFileResult {
  alreadyApplied: boolean;
  appliedRecord?: AppliedRecord;
  readError?: string;
  parseError?: { message: string; line: number };
  results?: OperationResult[];
  counts?: Record<OperationStatus, number>;
  recorded?: boolean;
}
