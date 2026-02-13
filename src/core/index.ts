/**
 * GQP Core Module
 * Zero-dependency graph engine
 */

// Main engine
export { GQP } from "./engine.js";

// Schema management
export { GQPSchema } from "./schema.js";

// Cursor/navigation
export { GQPGraphCursor, CursorManager } from "./cursor.js";

// Query execution
export { QueryExecutor } from "./executor.js";
export type { ExecutorConfig } from "./executor.js";

// Error handling
export {
  GQPError,
  GQPErrorCode,
  createError,
  isGQPError,
  wrapError,
} from "./errors.js";
export type { GQPErrorCodeType } from "./errors.js";

// Input validation
export {
  Validator,
  createValidator,
  safeJsonParse,
  safeJsonStringify,
  DEFAULT_VALIDATION,
  DEFAULT_LIMITS,
} from "./validation.js";
export type { ValidationConfig, LimitsConfig } from "./validation.js";

// Security
export {
  SecurityManager,
  createSecurityManager,
  noopSecurityManager,
} from "./security.js";
export type {
  SecurityConfig,
  SecurityContext,
  NodeAccessRule,
  RLSFunction,
  IntrospectionMode,
} from "./security.js";

// All types
export type {
  // Field types
  FieldType,
  RelationType,
  GQPCapability,
  GQPAction,

  // Directives
  GQPDirective,
  SearchDirective,
  TemporalDirective,
  ResolveDirective,
  CostDirective,

  // Node & Field
  GQPField,
  GQPEdge,
  GQPNode,

  // Cursor & Navigation
  GQPCursor,
  NeighborhoodView,

  // Query & Filters
  QueryFilters,
  QueryOptions,
  QueryResult,

  // Tool Call Interface
  ToolCallParams,
  ExploreResult,
  NavigateResult,
  IntrospectionResult,
  ToolCallResult,

  // Configuration
  GQPConfig,
  SchemaConfig,
  DebugConfig,

  // Adapter & Plugin interfaces
  GQPAdapter,
  GQPPlugin,
  PluginContext,
  GQPEngine,
  GQPSchema as IGQPSchema,
} from "./types.js";
