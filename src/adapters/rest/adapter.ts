/**
 * REST API Adapter for GQP
 * Wraps REST APIs as GQP data sources
 */

import type {
  GQPAdapter,
  GQPNode,
  GQPField,
  GQPEdge,
  GQPCapability,
  FieldType,
  QueryFilters,
  QueryOptions,
} from "../../core/types.js";

/**
 * REST resource configuration
 */
export interface RESTResource {
  /** API endpoint path (e.g., '/users' or '/users/:id') */
  endpoint: string;
  /** Primary key field name */
  idField?: string;
  /** Resource description */
  description?: string;
  /** Schema definition for the resource */
  schema?: Record<string, FieldType | { type: FieldType; nullable?: boolean }>;
  /** Related resources */
  relations?: Record<
    string,
    { resource: string; type: "belongsTo" | "hasOne" | "hasMany" }
  >;
  /** Custom headers for this resource */
  headers?: Record<string, string>;
}

/**
 * REST adapter configuration
 */
export interface RESTAdapterConfig {
  /** Base URL for the API */
  baseURL: string;
  /** Authentication configuration */
  auth?: {
    type: "bearer" | "basic" | "apikey";
    token?: string;
    apiKey?: string;
    apiKeyHeader?: string;
    username?: string;
    password?: string;
  };
  /** Default headers */
  headers?: Record<string, string>;
  /** Resource definitions */
  resources: Record<string, RESTResource>;
  /** Rate limiting */
  rateLimit?: {
    requests: number;
    window: "second" | "minute" | "hour";
  };
  /** Request timeout in ms */
  timeout?: number;
}

/**
 * REST Adapter Implementation
 */
export class RESTAdapter implements GQPAdapter {
  name = "rest";
  private config: RESTAdapterConfig;
  private rateLimitState: Map<string, { count: number; resetTime: number }> =
    new Map();

  constructor(config: RESTAdapterConfig) {
    this.config = config;
  }

  /**
   * Introspect REST API resources and return GQP nodes
   */
  async introspect(): Promise<GQPNode[]> {
    const nodes: GQPNode[] = [];

    for (const [resourceName, resource] of Object.entries(
      this.config.resources,
    )) {
      const node = this.resourceToNode(resourceName, resource);
      nodes.push(node);
    }

    return nodes;
  }

  /**
   * Execute a query against the REST API
   */
  async execute(
    nodeName: string,
    filters: QueryFilters,
    options: QueryOptions,
  ): Promise<unknown[]> {
    const resource = this.config.resources[nodeName];
    if (!resource) {
      throw new Error(`Resource "${nodeName}" not found`);
    }

    // Check rate limit
    await this.checkRateLimit(nodeName);

    // Build URL with query params
    const url = this.buildURL(resource.endpoint, filters, options);

    // Make request
    const response = await this.fetch(url, {
      method: "GET",
      headers: this.buildHeaders(resource.headers),
    });

    if (!response.ok) {
      throw new Error(
        `REST API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as any;

    // Handle different response formats
    if (Array.isArray(data)) {
      return data;
    }
    if (data.data && Array.isArray(data.data)) {
      return data.data;
    }
    if (data.results && Array.isArray(data.results)) {
      return data.results;
    }
    if (data.items && Array.isArray(data.items)) {
      return data.items;
    }

    // Single item response
    return [data];
  }

  /**
   * Get count from REST API (if supported)
   */
  async count(nodeName: string, filters: QueryFilters): Promise<number> {
    // Many REST APIs don't support count, so we estimate
    const results = await this.execute(nodeName, filters, { limit: 1000 });
    return results.length;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Convert REST resource to GQP node
   */
  private resourceToNode(name: string, resource: RESTResource): GQPNode {
    const fields: GQPField[] = [];
    const edges: GQPEdge[] = [];
    const capabilities: GQPCapability[] = [];

    // Build fields from schema
    if (resource.schema) {
      for (const [fieldName, fieldDef] of Object.entries(resource.schema)) {
        const type = typeof fieldDef === "string" ? fieldDef : fieldDef.type;
        const nullable =
          typeof fieldDef === "object" ? (fieldDef.nullable ?? true) : true;

        fields.push({
          name: fieldName,
          type,
          nullable,
          isList: false,
          directives: [],
        });

        // Add capabilities based on type
        if (type === "String") {
          capabilities.push("full_text");
        }
        if (type === "DateTime") {
          capabilities.push("temporal_filter");
        }
      }
    } else {
      // Add common default fields
      fields.push({
        name: resource.idField || "id",
        type: "ID",
        nullable: false,
        isList: false,
        directives: [],
      });
    }

    // Build edges from relations
    if (resource.relations) {
      for (const [relName, rel] of Object.entries(resource.relations)) {
        edges.push({
          name: relName,
          to: rel.resource,
          relation: rel.type,
        });
      }
    }

    return {
      name,
      description: resource.description,
      fields,
      edges,
      capabilities: [...new Set(capabilities)],
      source: this.name,
    };
  }

  /**
   * Build URL with query parameters - with SSRF protection
   */
  private buildURL(
    endpoint: string,
    filters: QueryFilters,
    options: QueryOptions,
  ): string {
    const cleanEndpoint = endpoint.split(/[^a-zA-Z0-9/_-]/)[0] || endpoint;

    let url: URL;
    try {
      url = new URL(cleanEndpoint, this.config.baseURL);
    } catch {
      throw new Error("Invalid URL construction");
    }

    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("Only HTTP/HTTPS protocols are allowed");
    }

    const hostname = url.hostname.toLowerCase();
    if (this.isPrivateHost(hostname)) {
      throw new Error("Requests to private networks are not allowed");
    }

    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null) continue;

      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) continue;

      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        url.searchParams.set(key, String(value));
      }
    }

    if (options.limit) {
      const limit = Math.min(Math.max(1, Number(options.limit) || 10), 100);
      url.searchParams.set("limit", String(limit));
    }
    if (options.offset) {
      const offset = Math.max(0, Number(options.offset) || 0);
      url.searchParams.set("offset", String(offset));
    }

    if (options.orderBy && typeof options.orderBy.field === "string") {
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(options.orderBy.field)) {
        url.searchParams.set("sort", options.orderBy.field);
        url.searchParams.set(
          "order",
          options.orderBy.direction === "desc" ? "desc" : "asc",
        );
      }
    }

    return url.toString();
  }

  /**
   * Check if hostname is a private/internal network
   */
  private isPrivateHost(hostname: string): boolean {
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1"
    ) {
      return true;
    }

    if (hostname.startsWith("10.") || hostname.startsWith("192.168.")) {
      return true;
    }

    const parts = hostname.split(".");
    if (parts[0] === "172") {
      const second = parseInt(parts[1], 10);
      if (second >= 16 && second <= 31) return true;
    }

    if (hostname.endsWith(".local") || hostname.endsWith(".internal")) {
      return true;
    }

    return false;
  }

  /**
   * Build request headers - with injection protection
   */
  private buildHeaders(
    resourceHeaders?: Record<string, string>,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    const safeAdd = (key: string, value: string) => {
      const cleanKey = key.replace(/[\r\n]/g, "");
      const cleanValue = String(value).replace(/[\r\n]/g, "");
      if (/^[a-zA-Z0-9-]+$/.test(cleanKey)) {
        headers[cleanKey] = cleanValue;
      }
    };

    if (this.config.headers) {
      for (const [key, value] of Object.entries(this.config.headers)) {
        safeAdd(key, value);
      }
    }

    if (resourceHeaders) {
      for (const [key, value] of Object.entries(resourceHeaders)) {
        safeAdd(key, value);
      }
    }

    if (this.config.auth) {
      switch (this.config.auth.type) {
        case "bearer":
          if (this.config.auth.token) {
            headers["Authorization"] =
              `Bearer ${this.config.auth.token.replace(/[\r\n]/g, "")}`;
          }
          break;
        case "basic":
          if (this.config.auth.username && this.config.auth.password) {
            const credentials = btoa(
              `${this.config.auth.username}:${this.config.auth.password}`,
            );
            headers["Authorization"] = `Basic ${credentials}`;
          }
          break;
        case "apikey":
          if (this.config.auth.apiKey) {
            const headerName = (
              this.config.auth.apiKeyHeader || "X-API-Key"
            ).replace(/[\r\n]/g, "");
            if (/^[a-zA-Z0-9-]+$/.test(headerName)) {
              headers[headerName] = this.config.auth.apiKey.replace(
                /[\r\n]/g,
                "",
              );
            }
          }
          break;
      }
    }

    return headers;
  }

  /**
   * Make HTTP request with timeout
   */
  private async fetch(url: string, init: RequestInit): Promise<Response> {
    const timeout = this.config.timeout || 30000;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Check and update rate limit
   */
  private async checkRateLimit(resourceName: string): Promise<void> {
    if (!this.config.rateLimit) return;

    const key = resourceName;
    const now = Date.now();
    const state = this.rateLimitState.get(key);

    // Get window in ms
    const windowMs =
      this.config.rateLimit.window === "second"
        ? 1000
        : this.config.rateLimit.window === "minute"
          ? 60000
          : 3600000;

    if (!state || now > state.resetTime) {
      // New window
      this.rateLimitState.set(key, {
        count: 1,
        resetTime: now + windowMs,
      });
      return;
    }

    if (state.count >= this.config.rateLimit.requests) {
      // Rate limited - wait until reset
      const waitTime = state.resetTime - now;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      this.rateLimitState.set(key, {
        count: 1,
        resetTime: Date.now() + windowMs,
      });
      return;
    }

    // Increment count
    state.count++;
  }
}

/**
 * Factory function to create REST adapter
 *
 * @example
 * ```typescript
 * import { GQP } from '@mzhub/gqp';
 * import { fromREST } from '@mzhub/gqp/rest';
 *
 * const graph = new GQP({
 *   sources: {
 *     stripe: fromREST({
 *       baseURL: 'https://api.stripe.com/v1',
 *       auth: { type: 'bearer', token: process.env.STRIPE_KEY },
 *       resources: {
 *         charges: {
 *           endpoint: '/charges',
 *           idField: 'id',
 *           schema: {
 *             id: 'String',
 *             amount: 'Int',
 *             status: 'String'
 *           }
 *         }
 *       }
 *     })
 *   }
 * });
 * ```
 */
export function fromREST(config: RESTAdapterConfig): GQPAdapter {
  return new RESTAdapter(config);
}
