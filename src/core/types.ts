/**
 * GQP Core Types
 * Zero-dependency type definitions for the graph engine
 */

// ============================================================================
// Field Types
// ============================================================================

export type FieldType =
  | "String"
  | "Int"
  | "Float"
  | "Boolean"
  | "DateTime"
  | "Json"
  | "Enum"
  | "ID";

export type RelationType = "belongsTo" | "hasOne" | "hasMany";

export type GQPCapability =
  | "fuzzy_search"
  | "full_text"
  | "temporal_filter"
  | "enum_filter"
  | "json_query";

export type GQPAction = "explore" | "navigate" | "query" | "introspect";

// ============================================================================
// Directive System
// ============================================================================

export interface GQPDirective {
  name: string;
  args: Record<string, unknown>;
}

export interface SearchDirective extends GQPDirective {
  name: "@search";
  args: {
    type: "fuzzy" | "exact";
    threshold?: number;
  };
}

export interface TemporalDirective extends GQPDirective {
  name: "@reasoning";
  args: {
    type: "temporal";
    format?: string;
  };
}

export interface ResolveDirective extends GQPDirective {
  name: "@resolve";
  args: {
    source: string;
    endpoint: string;
    cache?: { ttl: number };
  };
}

export interface CostDirective extends GQPDirective {
  name: "@cost";
  args: {
    credits: number;
    rateLimit?: string;
  };
}

// ============================================================================
// Node & Field Definitions
// ============================================================================

export interface GQPField {
  name: string;
  type: FieldType;
  nullable: boolean;
  isList: boolean;
  description?: string;
  directives: GQPDirective[];
  enumValues?: string[];
}

export interface GQPEdge {
  name: string;
  to: string;
  relation: RelationType;
  foreignKey?: string;
  description?: string;
}

export interface GQPNode {
  name: string;
  description?: string;
  fields: GQPField[];
  edges: GQPEdge[];
  capabilities: GQPCapability[];
  source: string;
}

// ============================================================================
// Cursor & Navigation
// ============================================================================

export interface GQPCursor {
  id: string;
  currentNode: string | null;
  neighbors: string[];
  path: string[];
  depth: number;
  createdAt: number;
  metadata: {
    totalNodes: number;
    exploredNodes: number;
  };
}

export interface NeighborhoodView {
  currentNode: GQPNode | null;
  neighbors: Array<{
    name: string;
    description?: string;
    relation: RelationType;
    distance: number;
  }>;
  path: string[];
  depth: number;
  availableActions: GQPAction[];
}

// ============================================================================
// Query & Filters
// ============================================================================

export interface QueryFilters {
  [field: string]: unknown;
}

export interface QueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: { field: string; direction: "asc" | "desc" };
  include?: string[];
  cursor?: string;
}

export interface QueryResult<T = unknown> {
  data: T[];
  meta: {
    total?: number;
    hasMore: boolean;
    executionTimeMs: number;
  };
  cursor?: GQPCursor;
  nextActions?: string[];
}

// ============================================================================
// Tool Call Interface (The ONE tool)
// ============================================================================

export interface ToolCallParams {
  action: GQPAction;
  node?: string;
  query?: string;
  filters?: QueryFilters;
  options?: QueryOptions;
  cursorId?: string;
}

export interface ExploreResult {
  availableNodes: Array<{
    name: string;
    description?: string;
    operations: string[];
  }>;
  message: string;
  totalNodes: number;
}

export interface NavigateResult {
  currentNode: string;
  fields: Array<{
    name: string;
    type: FieldType;
    description?: string;
    capabilities: string[];
  }>;
  relatedNodes: Array<{
    name: string;
    relation: RelationType;
    description?: string;
  }>;
  capabilities: GQPCapability[];
  path: string[];
}

export interface IntrospectionResult {
  nodes: GQPNode[];
  capabilities: GQPCapability[];
  version: string;
}

export type ToolCallResult =
  | ExploreResult
  | NavigateResult
  | QueryResult
  | IntrospectionResult;

// ============================================================================
// Configuration
// ============================================================================

import type { ValidationConfig, LimitsConfig } from "./validation.js";
import type { SecurityConfig } from "./security.js";

/**
 * Schema configuration for introspection and visibility
 */
export interface SchemaConfig {
  /** Fields to hide from schema introspection (supports wildcards) */
  hiddenFields?: string[];
  /** Nodes to hide from exploration */
  hiddenNodes?: string[];
  /** Refresh schema periodically (ms). 0 = never refresh */
  refreshInterval?: number;
}

/**
 * Debug configuration
 */
export interface DebugConfig {
  /** Enable debug mode */
  enabled?: boolean;
  /** Log level */
  logLevel?: "silent" | "error" | "warn" | "info" | "verbose";
  /** Expose detailed error messages (overrides NODE_ENV detection) */
  exposeErrors?: boolean;
}

export interface GQPConfig {
  /** Data source adapters */
  sources: Record<string, GQPAdapter>;

  /** Feature flags */
  features?: {
    fuzzySearch?: boolean;
    temporalReasoning?: boolean;
    neighborhoodSize?: number;
    maxDepth?: number;
  };

  /** Plugins */
  plugins?: GQPPlugin[];

  /** Directive overrides */
  directives?: {
    overrides?: Record<string, Partial<GQPField>>;
    defaults?: Record<string, unknown>;
  };

  /** Security configuration (optional - disable for internal tools/prototypes) */
  security?: SecurityConfig;

  /** Input validation configuration */
  validation?: ValidationConfig;

  /** Query and resource limits */
  limits?: LimitsConfig;

  /** Schema visibility configuration */
  schema?: SchemaConfig;

  /** Debug configuration */
  debug?: DebugConfig;
}

// ============================================================================
// Adapter Interface
// ============================================================================

export interface GQPAdapter {
  name: string;

  /**
   * Introspect data source and return schema nodes
   */
  introspect(): Promise<GQPNode[]>;

  /**
   * Execute a query against the data source
   */
  execute(
    nodeName: string,
    filters: QueryFilters,
    options: QueryOptions,
  ): Promise<unknown[]>;

  /**
   * Get count for pagination
   */
  count?(nodeName: string, filters: QueryFilters): Promise<number>;
}

// ============================================================================
// Plugin Interface
// ============================================================================

export interface GQPPlugin {
  name: string;

  /**
   * Called during initialization
   */
  onInit?(engine: GQPEngine): Promise<void>;

  /**
   * Called during cleanup/shutdown
   */
  onDestroy?(): Promise<void>;

  /**
   * Transform filters before query execution
   */
  onPreQuery?(
    node: GQPNode,
    filters: QueryFilters,
    context: PluginContext,
  ): Promise<QueryFilters>;

  /**
   * Post-process query results
   */
  onPostQuery?(
    node: GQPNode,
    results: unknown[],
    context: PluginContext,
  ): Promise<unknown[]>;

  /**
   * Translate a filter value (e.g., "last week" -> date range)
   */
  translateFilter?(
    field: GQPField,
    value: unknown,
    context: PluginContext,
  ): unknown | null;
}

export interface PluginContext {
  query?: string;
  filters: QueryFilters;
  options: QueryOptions;
}

// ============================================================================
// Engine Interface (for plugin access)
// ============================================================================

export interface GQPEngine {
  getSchema(): GQPSchema;
  getAdapter(name: string): GQPAdapter | undefined;
  getPlugins(): GQPPlugin[];
}

export interface GQPSchema {
  getNode(name: string): GQPNode | undefined;
  getRootNodes(): GQPNode[];
  getNeighbors(nodeName: string, limit?: number): GQPNode[];
  getAllNodes(): GQPNode[];
}
