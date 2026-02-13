/**
 * GQP Query Executor
 * Orchestrates query execution across adapters and plugins
 */

import type {
  GQPAdapter,
  GQPPlugin,
  GQPNode,
  QueryFilters,
  QueryOptions,
  QueryResult,
  PluginContext,
} from "./types.js";
import type { GQPSchema } from "./schema.js";
import { createError } from "./errors.js";

export interface ExecutorConfig {
  defaultLimit: number;
  maxLimit: number;
  timeout: number;
  maxIncludeDepth?: number;
}

const DEFAULT_CONFIG: ExecutorConfig = {
  defaultLimit: 10,
  maxLimit: 100,
  timeout: 30000,
  maxIncludeDepth: 3,
};

export class QueryExecutor {
  private adapters: Map<string, GQPAdapter>;
  private plugins: GQPPlugin[];
  private schema: GQPSchema;
  private config: ExecutorConfig;

  constructor(
    schema: GQPSchema,
    adapters: Map<string, GQPAdapter>,
    plugins: GQPPlugin[],
    config: Partial<ExecutorConfig> = {},
  ) {
    this.schema = schema;
    this.adapters = adapters;
    this.plugins = plugins;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute a query against a node
   */
  async execute(
    nodeName: string,
    filters: QueryFilters = {},
    options: QueryOptions = {},
  ): Promise<QueryResult> {
    const startTime = Date.now();

    const node = this.schema.getNode(nodeName);
    if (!node) {
      throw createError.nodeNotFound(nodeName);
    }

    const adapter = this.adapters.get(node.source);
    if (!adapter) {
      throw createError.adapterNotFound(nodeName);
    }

    const normalizedOptions = this.normalizeOptions(options);

    const context: PluginContext = {
      query: undefined,
      filters,
      options: normalizedOptions,
    };

    let processedFilters = { ...filters };
    for (const plugin of this.plugins) {
      if (plugin.onPreQuery) {
        processedFilters = await plugin.onPreQuery(
          node,
          processedFilters,
          context,
        );
      }

      if (plugin.translateFilter) {
        processedFilters = await this.translateFilters(
          node,
          processedFilters,
          plugin,
          context,
        );
      }
    }

    let results = await this.executeWithTimeout(
      adapter.execute(nodeName, processedFilters, normalizedOptions),
      this.config.timeout,
    );

    for (const plugin of this.plugins) {
      if (plugin.onPostQuery) {
        results = await plugin.onPostQuery(node, results, context);
      }
    }

    let total: number | undefined;
    if (adapter.count) {
      try {
        total = await adapter.count(nodeName, processedFilters);
      } catch {}
    }

    const executionTimeMs = Date.now() - startTime;

    return {
      data: results,
      meta: {
        total,
        hasMore: results.length === normalizedOptions.limit,
        executionTimeMs,
      },
      nextActions: this.suggestNextActions(node, results),
    };
  }

  /**
   * Normalize and validate query options
   */
  private normalizeOptions(options: QueryOptions): QueryOptions {
    let limit = this.config.defaultLimit;
    if (options.limit !== undefined) {
      const parsedLimit = Number(options.limit);
      if (Number.isFinite(parsedLimit) && parsedLimit > 0) {
        limit = Math.min(parsedLimit, this.config.maxLimit);
      }
    }

    let offset = 0;
    if (options.offset !== undefined) {
      const parsedOffset = Number(options.offset);
      if (Number.isFinite(parsedOffset) && parsedOffset >= 0) {
        offset = parsedOffset;
      }
    }

    let include = options.include;
    if (include && Array.isArray(include) && this.config.maxIncludeDepth) {
      include = include.map((inc) => {
        const parts = inc.split(".");
        if (parts.length > this.config.maxIncludeDepth!) {
          return parts.slice(0, this.config.maxIncludeDepth).join(".");
        }
        return inc;
      });
    }

    return {
      limit,
      offset,
      orderBy: options.orderBy,
      include: include || [],
    };
  }

  /**
   * Execute query with semantic search
   */
  async executeWithSearch(
    nodeName: string,
    query: string,
    filters: QueryFilters = {},
    options: QueryOptions = {},
  ): Promise<QueryResult> {
    const node = this.schema.getNode(nodeName);
    if (!node) {
      throw createError.nodeNotFound(nodeName);
    }

    const context: PluginContext = {
      query,
      filters,
      options,
    };

    let enhancedFilters = { ...filters };
    for (const plugin of this.plugins) {
      if (plugin.onPreQuery) {
        enhancedFilters = await plugin.onPreQuery(
          node,
          enhancedFilters,
          context,
        );
      }
    }

    return this.execute(nodeName, enhancedFilters, options);
  }

  /**
   * Translate filter values using plugins
   */
  private async translateFilters(
    node: GQPNode,
    filters: QueryFilters,
    plugin: GQPPlugin,
    context: PluginContext,
  ): Promise<QueryFilters> {
    const translated: QueryFilters = {};

    for (const [fieldName, value] of Object.entries(filters)) {
      const field = node.fields.find((f) => f.name === fieldName);

      if (field && plugin.translateFilter) {
        const translatedValue = plugin.translateFilter(field, value, context);
        if (translatedValue !== null) {
          translated[fieldName] = translatedValue;
          continue;
        }
      }

      translated[fieldName] = value;
    }

    return translated;
  }

  /**
   * Execute with timeout
   */
  private async executeWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(createError.timeout("query", timeoutMs));
      }, timeoutMs);

      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * Suggest next actions based on results
   */
  private suggestNextActions(node: GQPNode, results: unknown[]): string[] {
    const actions: string[] = [];

    if (results.length === 0) {
      actions.push("Try a different query or filter");
      actions.push("Navigate to a related node");
    } else {
      for (const edge of node.edges.slice(0, 2)) {
        actions.push(`Navigate to ${edge.to} to see related data`);
      }

      if (results.length >= this.config.defaultLimit) {
        actions.push("Add filters to narrow down results");
      }
    }

    return actions;
  }
}
