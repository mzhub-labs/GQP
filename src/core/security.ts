/**
 * GQP Security Layer
 * Optional authorization and row-level security
 */

import { createError, GQPError } from "./errors.js";
import type { QueryFilters, GQPNode } from "./types.js";

/**
 * Security context provided by the application
 */
export interface SecurityContext {
  /** User identifier */
  userId?: string;
  /** Organization/tenant identifier */
  orgId?: string;
  /** User roles */
  roles?: string[];
  /** Custom claims/attributes */
  claims?: Record<string, unknown>;
}

/**
 * Access rule for a node
 */
export interface NodeAccessRule {
  /** Roles that can access this node (empty = all roles) */
  roles?: string[];
  /** Specific actions allowed (empty = all actions) */
  actions?: ("explore" | "navigate" | "query")[];
  /** Custom access check function */
  check?: (ctx: SecurityContext) => boolean | Promise<boolean>;
}

/**
 * Row-level security function
 * Returns filters to apply to queries on this node
 */
export type RLSFunction = (
  ctx: SecurityContext,
) => QueryFilters | Promise<QueryFilters>;

/**
 * Introspection access mode
 */
export type IntrospectionMode =
  | "public"
  | "authenticated"
  | "disabled"
  | ((ctx: SecurityContext) => boolean);

/**
 * Security configuration
 */
export interface SecurityConfig {
  /**
   * Context provider function
   * Called before each operation to get current security context
   */
  context?: () => SecurityContext | Promise<SecurityContext>;

  /**
   * Node-level access rules
   * Key is node name or '*' for default
   */
  nodeAccess?: Record<string, NodeAccessRule>;

  /**
   * Row-level security rules
   * Key is node name or '*' for default
   * Returns additional filters to apply to all queries
   */
  rowLevelSecurity?: Record<string, RLSFunction>;

  /**
   * Schema introspection access
   * - 'public': anyone can introspect
   * - 'authenticated': requires context.userId
   * - 'disabled': introspection throws error
   * - function: custom check
   */
  introspection?: IntrospectionMode;

  /**
   * Fields to hide from schema introspection
   * Supports wildcards: ['password', '*Token', 'secret*']
   */
  hiddenFields?: string[];

  /**
   * Nodes to hide from exploration
   * Still accessible if you know the name (use nodeAccess to fully block)
   */
  hiddenNodes?: string[];
}

/**
 * Security manager
 */
export class SecurityManager {
  private config: SecurityConfig;
  private defaultContext: SecurityContext = {};

  constructor(config?: SecurityConfig) {
    this.config = config || {};
  }

  /**
   * Check if security is enabled
   */
  isEnabled(): boolean {
    return !!(
      this.config.context ||
      this.config.nodeAccess ||
      this.config.rowLevelSecurity ||
      this.config.introspection
    );
  }

  /**
   * Get current security context
   */
  async getContext(): Promise<SecurityContext> {
    if (!this.config.context) {
      return this.defaultContext;
    }

    try {
      return await this.config.context();
    } catch (error) {
      throw new GQPError(
        "AUTHORIZATION_ERROR",
        "Failed to resolve security context",
        { error: error instanceof Error ? error.message : error },
      );
    }
  }

  /**
   * Check if current context can access a node
   */
  async checkNodeAccess(
    node: string,
    action: "explore" | "navigate" | "query",
    ctx?: SecurityContext,
  ): Promise<void> {
    const context = ctx || (await this.getContext());

    // Check specific node rule first, then default rule
    const rule =
      this.config.nodeAccess?.[node] || this.config.nodeAccess?.["*"];

    if (!rule) {
      return;
    }

    // Check roles
    if (rule.roles && rule.roles.length > 0) {
      const userRoles = context.roles || [];
      const hasRole = rule.roles.some((role) => userRoles.includes(role));
      if (!hasRole) {
        throw createError.accessDenied(node, action);
      }
    }

    // Check allowed actions
    if (rule.actions && rule.actions.length > 0) {
      if (!rule.actions.includes(action)) {
        throw createError.accessDenied(node, action);
      }
    }

    // Custom check
    if (rule.check) {
      const allowed = await rule.check(context);
      if (!allowed) {
        throw createError.accessDenied(node, action);
      }
    }
  }

  /**
   * Get row-level security filters for a node
   */
  async getRLSFilters(
    node: string,
    ctx?: SecurityContext,
  ): Promise<QueryFilters> {
    const context = ctx || (await this.getContext());

    // Get specific node RLS or default
    const rlsFn =
      this.config.rowLevelSecurity?.[node] ||
      this.config.rowLevelSecurity?.["*"];

    if (!rlsFn) {
      return {};
    }

    try {
      return await rlsFn(context);
    } catch (error) {
      throw new GQPError(
        "AUTHORIZATION_ERROR",
        `Failed to compute row-level security for ${node}`,
        { error: error instanceof Error ? error.message : error },
      );
    }
  }

  /**
   * Apply RLS filters to existing filters
   */
  async applyRLS(
    node: string,
    filters: QueryFilters,
    ctx?: SecurityContext,
  ): Promise<QueryFilters> {
    const rlsFilters = await this.getRLSFilters(node, ctx);

    if (Object.keys(rlsFilters).length === 0) {
      return filters;
    }

    if (Object.keys(filters).length === 0) {
      return rlsFilters;
    }

    return {
      AND: [filters, rlsFilters],
    };
  }

  /**
   * Check introspection access
   */
  async checkIntrospectionAccess(ctx?: SecurityContext): Promise<void> {
    const mode = this.config.introspection || "public";

    if (mode === "public") {
      return;
    }

    const context = ctx || (await this.getContext());

    if (mode === "disabled") {
      throw createError.introspectionDisabled();
    }

    if (mode === "authenticated") {
      if (!context.userId) {
        throw new GQPError(
          "AUTHORIZATION_ERROR",
          "Authentication required for schema introspection",
          undefined,
          401,
        );
      }
      return;
    }

    if (typeof mode === "function") {
      const allowed = mode(context);
      if (!allowed) {
        throw createError.introspectionDisabled();
      }
    }
  }

  /**
   * Check if a field should be hidden from introspection
   */
  isFieldHidden(fieldName: string): boolean {
    const patterns = this.config.hiddenFields || [];

    for (const pattern of patterns) {
      if (this.matchPattern(fieldName, pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a node should be hidden from exploration
   */
  isNodeHidden(nodeName: string): boolean {
    const hiddenNodes = this.config.hiddenNodes || [];
    return hiddenNodes.includes(nodeName);
  }

  /**
   * Filter hidden fields from a node
   */
  filterHiddenFields(node: GQPNode): GQPNode {
    if (!this.config.hiddenFields?.length) {
      return node;
    }

    return {
      ...node,
      fields: node.fields.filter((field) => !this.isFieldHidden(field.name)),
    };
  }

  /**
   * Match a field name against a pattern (supports * wildcard)
   */
  private matchPattern(name: string, pattern: string): boolean {
    if (pattern === name) {
      return true;
    }

    if (!pattern.includes("*")) {
      return false;
    }

    const regex = new RegExp(
      "^" +
        pattern
          .split("*")
          .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join(".*") +
        "$",
      "i",
    );
    return regex.test(name);
  }

  /**
   * Get security config
   */
  getConfig(): SecurityConfig {
    return { ...this.config };
  }
}

/**
 * Create a security manager instance
 */
export function createSecurityManager(
  config?: SecurityConfig,
): SecurityManager {
  return new SecurityManager(config);
}

/**
 * No-op security manager (for when security is disabled)
 */
export const noopSecurityManager = new SecurityManager();
