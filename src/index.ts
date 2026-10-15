export * from './core/types.js';
export { parseGraftFile, GraftParseError } from './core/parser.js';
export { applyOperations } from './core/engine.js';
export { applyGraftFile } from './core/apply.js';
export {
  computeHash,
  sidecarPathFor,
  readAppliedRecord,
  writeAppliedRecord,
  deleteAppliedRecord,
} from './core/state.js';
export {
  findAllMatches,
  findMatches,
  type Match,
  type MatchError,
  type MatchErrorKind,
  type FindAllOptions,
  type FindAllResult,
} from './core/matcher.js';
