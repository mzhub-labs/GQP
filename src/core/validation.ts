/**
 * GQP Input Validation
 * Configurable validation with secure defaults
 */

import { createError } from "./errors.js";
import type { ToolCallParams, QueryFilters, QueryOptions } from "./types.js";

/**
 * Validation configuration
 */
export interface ValidationConfig {
  /** Enforce strict node name format (default: true) */
  strictNodeNames?: boolean;
  /** Custom node name pattern (default: /^[a-zA-Z_][a-zA-Z0-9_]*$/) */
  nodeNamePattern?: RegExp;
  /** Allowed filter operators */
  allowedFilterOperators?: string[];
  /** Max array size in filters */
  maxArrayInFilter?: number;
  /** Max filter depth */
  maxFilterDepth?: number;
  /** Max query string length */
  maxQueryLength?: number;
}

/**
 * Limits configuration
 */
export interface LimitsConfig {
  /** Maximum limit for query results (default: 100) */
  maxLimit?: number;
  /** Default limit for query results (default: 10) */
  defaultLimit?: number;
  /** Maximum offset for pagination (default: 10000) */
  maxOffset?: number;
  /** Maximum include depth for relationships (default: 3) */
  maxIncludeDepth?: number;
  /** Maximum cursors to maintain (default: 100) */
  maxCursors?: number;
  /** Cursor TTL in milliseconds (default: 30 minutes) */
  cursorTTL?: number;
  /** Maximum cursor path length (default: 100) */
  maxCursorPathLength?: number;
  /** Query timeout in milliseconds (default: 30000) */
  timeout?: number;
}

/**
 * Default validation config
 */
export const DEFAULT_VALIDATION: Required<ValidationConfig> = {
  strictNodeNames: true,
  nodeNamePattern: /^[a-zA-Z_][a-zA-Z0-9_]*$/,
  allowedFilterOperators: [
    "equals",
    "not",
    "in",
    "notIn",
    "lt",
    "lte",
    "gt",
    "gte",
    "contains",
    "startsWith",
    "endsWith",
    "mode",
    "search",
  ],
  maxArrayInFilter: 100,
  maxFilterDepth: 5,
  maxQueryLength: 1000,
};

/**
 * Default limits config
 */
export const DEFAULT_LIMITS: Required<LimitsConfig> = {
  maxLimit: 100,
  defaultLimit: 10,
  maxOffset: 10000,
  maxIncludeDepth: 3,
  maxCursors: 100,
  cursorTTL: 30 * 60 * 1000,
  maxCursorPathLength: 100,
  timeout: 30000,
};

/**
 * Validation utilities
 */
export class Validator {
  private config: Required<ValidationConfig>;
  private limits: Required<LimitsConfig>;

  constructor(
    validationConfig?: ValidationConfig,
    limitsConfig?: LimitsConfig,
  ) {
    this.config = { ...DEFAULT_VALIDATION, ...validationConfig };
    this.limits = { ...DEFAULT_LIMITS, ...limitsConfig };
  }

  /**
   * Validate a node name
   */
  validateNodeName(node: unknown): string {
    if (node === undefined || node === null) {
      throw createError.nodeRequired("navigate/query");
    }

    if (typeof node !== "string") {
      throw createError.validation("node", "must be a string", node);
    }

    const trimmed = node.trim();
    if (trimmed === "") {
      throw createError.nodeRequired("navigate/query");
    }

    if (
      this.config.strictNodeNames &&
      !this.config.nodeNamePattern.test(trimmed)
    ) {
      throw createError.invalidNode(
        trimmed,
        this.config.nodeNamePattern.source,
      );
    }

    return trimmed;
  }

  /**
   * Validate action parameter
   */
  validateAction(
    action: unknown,
  ): "explore" | "navigate" | "query" | "introspect" {
    const validActions = ["explore", "navigate", "query", "introspect"];

    if (!action || typeof action !== "string") {
      throw createError.validation(
        "action",
        "is required and must be a string",
        action,
      );
    }

    if (!validActions.includes(action)) {
      throw createError.invalidAction(action);
    }

    return action as "explore" | "navigate" | "query" | "introspect";
  }

  /**
   * Validate and normalize query options
   */
  validateOptions(options: QueryOptions = {}): QueryOptions {
    const normalized: QueryOptions = {};

    // Validate limit
    if (options.limit !== undefined) {
      const limit = Number(options.limit);
      if (!Number.isFinite(limit) || limit < 1) {
        normalized.limit = this.limits.defaultLimit;
      } else {
        normalized.limit = Math.min(limit, this.limits.maxLimit);
      }
    } else {
      normalized.limit = this.limits.defaultLimit;
    }

    // Validate offset
    if (options.offset !== undefined) {
      const offset = Number(options.offset);
      if (!Number.isFinite(offset) || offset < 0) {
        normalized.offset = 0;
      } else {
        normalized.offset = Math.min(offset, this.limits.maxOffset);
      }
    } else {
      normalized.offset = 0;
    }

    // Validate include depth
    if (options.include && Array.isArray(options.include)) {
      normalized.include = options.include
        .filter((inc): inc is string => typeof inc === "string")
        .map((inc) => {
          const parts = inc.split(".");
          if (parts.length > this.limits.maxIncludeDepth) {
            return parts.slice(0, this.limits.maxIncludeDepth).join(".");
          }
          return inc;
        });
    }

    // Copy orderBy if valid
    if (options.orderBy && typeof options.orderBy === "object") {
      const { field, direction } = options.orderBy as {
        field?: string;
        direction?: string;
      };
      if (
        typeof field === "string" &&
        ["asc", "desc"].includes(direction || "")
      ) {
        normalized.orderBy = { field, direction: direction as "asc" | "desc" };
      }
    }

    return normalized;
  }

  /**
   * Validate query string
   */
  validateQuery(query: unknown): string | undefined {
    if (query === undefined || query === null) {
      return undefined;
    }

    if (typeof query !== "string") {
      throw createError.validation("query", "must be a string", query);
    }

    if (query.length > this.config.maxQueryLength) {
      throw createError.validation(
        "query",
        `exceeds maximum length of ${this.config.maxQueryLength}`,
        { length: query.length },
      );
    }

    return query;
  }

  /**
   * Validate filters object
   */
  validateFilters(filters: unknown, depth = 0): QueryFilters {
    if (filters === undefined || filters === null) {
      return {};
    }

    if (typeof filters !== "object" || Array.isArray(filters)) {
      throw createError.validation("filters", "must be an object", filters);
    }

    if (depth > this.config.maxFilterDepth) {
      throw createError.validation(
        "filters",
        `exceeds maximum depth of ${this.config.maxFilterDepth}`,
        { depth },
      );
    }

    const validated: QueryFilters = {};
    const filterObj = filters as Record<string, unknown>;

    for (const [key, value] of Object.entries(filterObj)) {
      // Validate key format
      if (
        this.config.strictNodeNames &&
        !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)
      ) {
        if (!["AND", "OR", "NOT"].includes(key)) {
          continue;
        }
      }

      // Handle arrays (e.g., { in: [...] })
      if (Array.isArray(value)) {
        if (value.length > this.config.maxArrayInFilter) {
          throw createError.validation(
            `filters.${key}`,
            `array exceeds maximum length of ${this.config.maxArrayInFilter}`,
            { length: value.length },
          );
        }
        validated[key] = value;
      }
      // Handle nested objects (operators or nested filters)
      else if (value !== null && typeof value === "object") {
        validated[key] = this.validateNestedFilter(
          key,
          value as Record<string, unknown>,
          depth,
        );
      }
      // Handle primitive values
      else {
        validated[key] = value;
      }
    }

    return validated;
  }

  /**
   * Validate nested filter (operator object)
   */
  private validateNestedFilter(
    parentKey: string,
    filter: Record<string, unknown>,
    depth: number,
  ): Record<string, unknown> {
    const validated: Record<string, unknown> = {};

    for (const [op, value] of Object.entries(filter)) {
      // Check if it's an operator
      if (this.config.allowedFilterOperators.includes(op)) {
        // Validate array values
        if (
          Array.isArray(value) &&
          value.length > this.config.maxArrayInFilter
        ) {
          throw createError.validation(
            `filters.${parentKey}.${op}`,
            `array exceeds maximum length of ${this.config.maxArrayInFilter}`,
            { length: value.length },
          );
        }
        validated[op] = value;
      }
      // Allow nested logical operators (AND, OR, NOT)
      else if (["AND", "OR", "NOT"].includes(op)) {
        if (Array.isArray(value)) {
          validated[op] = value.map((v) => this.validateFilters(v, depth + 1));
        } else {
          validated[op] = this.validateFilters(value, depth + 1);
        }
      }
      // Allow nested field access (for relations)
      else if (typeof value === "object" && value !== null) {
        validated[op] = this.validateNestedFilter(
          `${parentKey}.${op}`,
          value as Record<string, unknown>,
          depth + 1,
        );
      }
      // Primitive values (equals shorthand)
      else {
        validated[op] = value;
      }
    }

    return validated;
  }

  /**
   * Validate cursor ID format
   */
  validateCursorId(cursorId: unknown): string | undefined {
    if (cursorId === undefined || cursorId === null) {
      return undefined;
    }

    if (typeof cursorId !== "string") {
      throw createError.validation("cursorId", "must be a string", cursorId);
    }

    return cursorId;
  }

  /**
   * Validate complete tool call params
   */
  validateToolCallParams(params: unknown): ToolCallParams {
    if (!params || typeof params !== "object") {
      throw createError.validation("params", "must be an object", params);
    }

    const p = params as Record<string, unknown>;

    const action = this.validateAction(p.action);
    const result: ToolCallParams = { action };

    // Validate node for actions that require it
    if (action === "navigate" || action === "query") {
      result.node = this.validateNodeName(p.node);
    } else if (p.node !== undefined) {
      result.node = this.validateNodeName(p.node);
    }

    // Validate optional fields
    if (p.query !== undefined) {
      result.query = this.validateQuery(p.query);
    }

    if (p.filters !== undefined) {
      result.filters = this.validateFilters(p.filters);
    }

    if (p.options !== undefined) {
      result.options = this.validateOptions(p.options as QueryOptions);
    }

    if (p.cursorId !== undefined) {
      result.cursorId = this.validateCursorId(p.cursorId);
    }

    return result;
  }

  /**
   * Get current limits
   */
  getLimits(): Required<LimitsConfig> {
    return { ...this.limits };
  }

  /**
   * Get current validation config
   */
  getConfig(): Required<ValidationConfig> {
    return { ...this.config };
  }
}

/**
 * Create a validator instance
 */
export function createValidator(
  validationConfig?: ValidationConfig,
  limitsConfig?: LimitsConfig,
): Validator {
  return new Validator(validationConfig, limitsConfig);
}

/**
 * Safe JSON parse with error handling
 */
export function safeJsonParse<T>(json: string, fallback?: T): T {
  try {
    return JSON.parse(json) as T;
  } catch (e) {
    if (fallback !== undefined) {
      return fallback;
    }
    throw createError.parseError(
      json,
      e instanceof Error ? e.message : "Invalid JSON",
    );
  }
}

/**
 * Circular-safe JSON stringify
 */
export function safeJsonStringify(obj: unknown, maxDepth = 10): string {
  const seen = new WeakSet();
  let depth = 0;

  return JSON.stringify(obj, (_, value) => {
    if (depth > maxDepth) {
      return "[max depth exceeded]";
    }

    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return "[circular reference]";
      }
      seen.add(value);
      depth++;
    }

    return value;
  });
}
