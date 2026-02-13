/**
 * GQP Engine
 * The main GQP class - consolidates 50+ tools into ONE dynamic navigable tool
 */

import type {
  GQPConfig,
  GQPAdapter,
  GQPPlugin,
  GQPEngine as IGQPEngine,
  ToolCallResult,
  ExploreResult,
  NavigateResult,
  QueryResult,
  IntrospectionResult,
  QueryFilters,
  QueryOptions,
  GQPSchema as IGQPSchema,
} from "./types.js";
import { GQPSchema } from "./schema.js";
import { GQPGraphCursor, CursorManager } from "./cursor.js";
import { QueryExecutor } from "./executor.js";
import { Validator, DEFAULT_LIMITS } from "./validation.js";
import { SecurityManager } from "./security.js";
import { createError, isGQPError, wrapError } from "./errors.js";

/**
 * GQP - The Universal Agent Data Layer
 *
 * Transforms messy databases and APIs into an intelligent, traversable graph
 * optimized for LLM agents.
 *
 * @example
 * ```typescript
 * import { GQP } from '@mzhub/gqp';
 * import { fromPrisma } from '@mzhub/gqp/prisma';
 *
 * const graph = new GQP({
 *   sources: {
 *     database: fromPrisma(prisma)
 *   }
 * });
 *
 * // Agent calls this ONE tool instead of 50+ separate tools
 * const result = await graph.handleToolCall({
 *   action: 'explore'
 * });
 * ```
 */
export class GQP implements IGQPEngine {
  private schema: GQPSchema;
  private adapters: Map<string, GQPAdapter>;
  private plugins: GQPPlugin[];
  private cursorManager: CursorManager;
  private executor: QueryExecutor;
  private validator: Validator;
  private security: SecurityManager;
  private config: GQPConfig;
  private initialized = false;
  private schemaRefreshTimer?: ReturnType<typeof setInterval>;

  constructor(config: GQPConfig) {
    this.config = config;
    this.schema = new GQPSchema();
    this.adapters = new Map();
    this.plugins = config.plugins || [];

    const limits = { ...DEFAULT_LIMITS, ...config.limits };

    this.validator = new Validator(config.validation, config.limits);
    this.security = new SecurityManager({
      ...config.security,
      hiddenFields:
        config.schema?.hiddenFields || config.security?.hiddenFields,
      hiddenNodes: config.schema?.hiddenNodes || config.security?.hiddenNodes,
    });

    this.cursorManager = new CursorManager(
      this.schema,
      limits.maxCursors,
      limits.cursorTTL,
      limits.maxCursorPathLength,
    );

    this.executor = new QueryExecutor(
      this.schema,
      this.adapters,
      this.plugins,
      {
        defaultLimit: limits.defaultLimit,
        maxLimit: limits.maxLimit,
        timeout: limits.timeout,
        maxIncludeDepth: limits.maxIncludeDepth,
      },
    );

    for (const [name, adapter] of Object.entries(config.sources)) {
      this.adapters.set(name, adapter);
    }
  }

  /**
   * Initialize the engine - introspects all sources and builds schema
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    for (const [_name, adapter] of this.adapters.entries()) {
      const nodes = await adapter.introspect();
      for (const node of nodes) {
        this.schema.addNode(node, true);
      }
    }

    for (const plugin of this.plugins) {
      if (plugin.onInit) {
        await plugin.onInit(this);
      }
    }

    if (
      this.config.schema?.refreshInterval &&
      this.config.schema.refreshInterval > 0
    ) {
      this.schemaRefreshTimer = setInterval(
        () => this.refreshSchema(),
        this.config.schema.refreshInterval,
      );
    }

    this.initialized = true;
  }

  /**
   * Refresh the schema (useful for detecting database changes)
   */
  async refreshSchema(): Promise<void> {
    this.schema.clear();

    for (const [_name, adapter] of this.adapters.entries()) {
      const nodes = await adapter.introspect();
      for (const node of nodes) {
        this.schema.addNode(node, true);
      }
    }
  }

  /**
   * Cleanup and destroy the engine
   */
  async destroy(): Promise<void> {
    if (this.schemaRefreshTimer) {
      clearInterval(this.schemaRefreshTimer);
    }

    for (const plugin of this.plugins) {
      if (plugin.onDestroy) {
        await plugin.onDestroy();
      }
    }

    this.cursorManager.clear();
    this.initialized = false;
  }

  /**
   * Ensure engine is initialized before operations
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  // ============================================================================
  // Primary Tool Interface - THE ONE TOOL
  // ============================================================================

  /**
   * Handle a tool call from an agent
   * This is the SINGLE entry point that replaces 50+ individual tools
   */
  async handleToolCall(params: unknown): Promise<ToolCallResult> {
    try {
      await this.ensureInitialized();

      const validated = this.validator.validateToolCallParams(params);
      const ctx = this.security.isEnabled()
        ? await this.security.getContext()
        : undefined;

      switch (validated.action) {
        case "explore":
          return this.explore();

        case "navigate": {
          const node = validated.node!;
          await this.security.checkNodeAccess(node, "navigate", ctx);
          return this.navigate(node, validated.cursorId);
        }

        case "query": {
          const node = validated.node!;
          await this.security.checkNodeAccess(node, "query", ctx);

          let filters = validated.filters || {};
          filters = await this.security.applyRLS(node, filters, ctx);

          return this.query(
            node,
            validated.query,
            filters,
            validated.options,
            validated.cursorId,
          );
        }

        case "introspect":
          await this.security.checkIntrospectionAccess(ctx);
          return this.introspect();

        default:
          throw createError.invalidAction(
            String((validated as { action: string }).action),
          );
      }
    } catch (error) {
      if (isGQPError(error)) {
        throw error;
      }
      throw wrapError(error);
    }
  }

  // ============================================================================
  // Action Implementations
  // ============================================================================

  /**
   * Explore - discover available data nodes
   * This is the entry point for agents to understand what data is available
   */
  private explore(): ExploreResult {
    let rootNodes = this.schema.getRootNodes();
    const neighborhoodSize = this.config.features?.neighborhoodSize || 5;

    rootNodes = rootNodes.filter(
      (node) => !this.security.isNodeHidden(node.name),
    );

    return {
      availableNodes: rootNodes.slice(0, neighborhoodSize).map((node) => ({
        name: node.name,
        description: node.description,
        operations: this.getNodeOperations(node),
      })),
      message:
        'Start by navigating to one of these nodes using action: "navigate"',
      totalNodes: rootNodes.length,
    };
  }

  /**
   * Navigate - focus on a specific node to see its fields and relations
   */
  private navigate(nodeName: string, cursorId?: string): NavigateResult {
    const schemaNode = this.schema.getNode(nodeName);
    if (!schemaNode) {
      const allNodes = this.schema.getAllNodes().map((n) => n.name);
      const suggestions = this.findSimilar(nodeName, allNodes, 3);
      throw createError.nodeNotFound(nodeName, suggestions);
    }

    const cursor = this.cursorManager.getOrCreate(cursorId);
    const neighborhood = cursor.navigateTo(nodeName);

    if (!neighborhood.currentNode) {
      throw createError.nodeNotFound(nodeName);
    }

    const node = this.security.filterHiddenFields(neighborhood.currentNode);

    return {
      currentNode: node.name,
      fields: node.fields.map((field) => ({
        name: field.name,
        type: field.type,
        description: field.description,
        capabilities: this.getFieldCapabilities(field),
      })),
      relatedNodes: node.edges.map((edge) => ({
        name: edge.to,
        relation: edge.relation,
        description: edge.description,
      })),
      capabilities: node.capabilities,
      path: neighborhood.path,
    };
  }

  /**
   * Query - execute filtered search on a node
   */
  private async query(
    nodeName: string,
    query?: string,
    filters?: QueryFilters,
    options?: QueryOptions,
    cursorId?: string,
  ): Promise<QueryResult> {
    const schemaNode = this.schema.getNode(nodeName);
    if (!schemaNode) {
      const allNodes = this.schema.getAllNodes().map((n) => n.name);
      const suggestions = this.findSimilar(nodeName, allNodes, 3);
      throw createError.nodeNotFound(nodeName, suggestions);
    }

    if (cursorId) {
      const cursor = this.cursorManager.get(cursorId);
      if (cursor && cursor.getCurrentNode() !== nodeName) {
        cursor.navigateTo(nodeName);
      }
    }

    if (query) {
      return this.executor.executeWithSearch(
        nodeName,
        query,
        filters || {},
        options || {},
      );
    }

    return this.executor.execute(nodeName, filters || {}, options || {});
  }

  /**
   * Introspect - get full schema information
   */
  private introspect(): IntrospectionResult {
    let nodes = this.schema.getAllNodes();

    nodes = nodes
      .filter((node) => !this.security.isNodeHidden(node.name))
      .map((node) => this.security.filterHiddenFields(node));

    return {
      nodes,
      capabilities: this.schema.getAllCapabilities(),
      version: "1.0.0",
    };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Find similar strings (for "did you mean" suggestions)
   */
  private findSimilar(
    input: string,
    candidates: string[],
    max: number,
  ): string[] {
    const lower = input.toLowerCase();
    return candidates
      .map((c) => ({ name: c, score: this.similarity(lower, c.toLowerCase()) }))
      .filter((x) => x.score > 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, max)
      .map((x) => x.name);
  }

  /**
   * Simple string similarity (Dice coefficient)
   */
  private similarity(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;

    const bigrams = new Map<string, number>();
    for (let i = 0; i < a.length - 1; i++) {
      const bigram = a.substring(i, i + 2);
      bigrams.set(bigram, (bigrams.get(bigram) || 0) + 1);
    }

    let matches = 0;
    for (let i = 0; i < b.length - 1; i++) {
      const bigram = b.substring(i, i + 2);
      const count = bigrams.get(bigram) || 0;
      if (count > 0) {
        matches++;
        bigrams.set(bigram, count - 1);
      }
    }

    return (2 * matches) / (a.length + b.length - 2);
  }

  /**
   * Get available operations for a node
   */
  private getNodeOperations(node: { capabilities: string[] }): string[] {
    const ops = ["query", "filter", "get_by_id"];

    if (node.capabilities.includes("fuzzy_search")) {
      ops.push("semantic_search");
    }
    if (node.capabilities.includes("temporal_filter")) {
      ops.push("date_filter");
    }

    return ops;
  }

  /**
   * Get capabilities for a field
   */
  private getFieldCapabilities(field: {
    type: string;
    directives: Array<{ name: string }>;
  }): string[] {
    const caps: string[] = [];

    for (const directive of field.directives) {
      if (directive.name === "@search") {
        caps.push("searchable");
      }
      if (directive.name === "@reasoning") {
        caps.push("temporal");
      }
    }

    return caps;
  }

  // ============================================================================
  // Engine Interface Implementation
  // ============================================================================

  getSchema(): IGQPSchema {
    return this.schema;
  }

  getAdapter(name: string): GQPAdapter | undefined {
    return this.adapters.get(name);
  }

  getPlugins(): GQPPlugin[] {
    return this.plugins;
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Create a new cursor
   */
  createCursor(startNode?: string): GQPGraphCursor {
    return this.cursorManager.create(startNode);
  }

  /**
   * Get cursor by ID
   */
  getCursor(id: string): GQPGraphCursor | undefined {
    return this.cursorManager.get(id);
  }

  /**
   * Get validator for external use
   */
  getValidator(): Validator {
    return this.validator;
  }

  /**
   * Get security manager for external use
   */
  getSecurityManager(): SecurityManager {
    return this.security;
  }

  /**
   * Generate tool definition for MCP/OpenAI/LangChain
   * This is the single tool that replaces 50+ tools
   */
  getToolDefinition(): {
    name: string;
    description: string;
    inputSchema: object;
  } {
    const limits = this.validator.getLimits();

    return {
      name: "navigate_data_graph",
      description: `Navigate and query data using a graph interface.

Actions:
- explore: Discover available data nodes
- navigate: Focus on a specific node to see its fields and relations
- query: Search and filter data within a node
- introspect: Get full schema information

Start with 'explore' to see what data is available, then 'navigate' to a node, then 'query' to get data.`,
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["explore", "navigate", "query", "introspect"],
            description: "The action to perform",
          },
          node: {
            type: "string",
            description: "Node name (required for navigate/query)",
          },
          query: {
            type: "string",
            description: "Semantic search query (optional for query)",
          },
          filters: {
            type: "object",
            description: 'Field filters (e.g., { "status": "pending" })',
            additionalProperties: true,
          },
          options: {
            type: "object",
            properties: {
              limit: {
                type: "number",
                description: `Max results (1-${limits.maxLimit})`,
                default: limits.defaultLimit,
                maximum: limits.maxLimit,
              },
              offset: {
                type: "number",
                description: "Skip results",
                default: 0,
                maximum: limits.maxOffset,
              },
              include: {
                type: "array",
                items: { type: "string" },
                description: "Related nodes to include",
              },
            },
          },
          cursorId: {
            type: "string",
            description: "Cursor ID for session continuity",
          },
        },
        required: ["action"],
      },
    };
  }
}
