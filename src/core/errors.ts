/**
 * GQP Error Classes
 * Environment-aware error handling with safe production messages
 */

/**
 * Error codes for GQP errors
 */
export const GQPErrorCode = {
  INVALID_ACTION: "INVALID_ACTION",
  INVALID_NODE: "INVALID_NODE",
  NODE_NOT_FOUND: "NODE_NOT_FOUND",
  NODE_REQUIRED: "NODE_REQUIRED",
  ADAPTER_NOT_FOUND: "ADAPTER_NOT_FOUND",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  AUTHORIZATION_ERROR: "AUTHORIZATION_ERROR",
  ACCESS_DENIED: "ACCESS_DENIED",
  INTROSPECTION_DISABLED: "INTROSPECTION_DISABLED",
  QUERY_ERROR: "QUERY_ERROR",
  TIMEOUT_ERROR: "TIMEOUT_ERROR",
  CONFIGURATION_ERROR: "CONFIGURATION_ERROR",
  CURSOR_NOT_FOUND: "CURSOR_NOT_FOUND",
  CURSOR_EXPIRED: "CURSOR_EXPIRED",
  RATE_LIMIT_ERROR: "RATE_LIMIT_ERROR",
  PARSE_ERROR: "PARSE_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type GQPErrorCodeType = (typeof GQPErrorCode)[keyof typeof GQPErrorCode];

/**
 * Safe production messages that don't leak internal details
 */
const SAFE_MESSAGES: Record<GQPErrorCodeType, string> = {
  [GQPErrorCode.INVALID_ACTION]: "Invalid action specified",
  [GQPErrorCode.INVALID_NODE]: "Invalid node name format",
  [GQPErrorCode.NODE_NOT_FOUND]: "Resource not found",
  [GQPErrorCode.NODE_REQUIRED]: "Node name is required for this action",
  [GQPErrorCode.ADAPTER_NOT_FOUND]: "Data source not available",
  [GQPErrorCode.VALIDATION_ERROR]: "Invalid input provided",
  [GQPErrorCode.AUTHORIZATION_ERROR]: "Authentication required",
  [GQPErrorCode.ACCESS_DENIED]: "Access denied",
  [GQPErrorCode.INTROSPECTION_DISABLED]: "Schema introspection is disabled",
  [GQPErrorCode.QUERY_ERROR]: "Query failed",
  [GQPErrorCode.TIMEOUT_ERROR]: "Request timed out",
  [GQPErrorCode.CONFIGURATION_ERROR]: "Configuration error",
  [GQPErrorCode.CURSOR_NOT_FOUND]: "Session not found",
  [GQPErrorCode.CURSOR_EXPIRED]: "Session expired",
  [GQPErrorCode.RATE_LIMIT_ERROR]: "Rate limit exceeded",
  [GQPErrorCode.PARSE_ERROR]: "Failed to parse input",
  [GQPErrorCode.INTERNAL_ERROR]: "An internal error occurred",
};

/**
 * GQP Error class with environment-aware message exposure
 */
export class GQPError extends Error {
  public readonly code: GQPErrorCodeType;
  public readonly details?: unknown;
  public readonly statusCode: number;

  constructor(
    code: GQPErrorCodeType,
    devMessage: string,
    details?: unknown,
    statusCode = 400,
  ) {
    const isProduction =
      typeof process !== "undefined" && process.env?.NODE_ENV === "production";
    const message = isProduction ? SAFE_MESSAGES[code] : devMessage;

    super(message);
    this.name = "GQPError";
    this.code = code;
    this.statusCode = statusCode;

    if (!isProduction) {
      this.details = details;
    }

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, GQPError);
    }
  }

  toJSON(): { code: GQPErrorCodeType; message: string; details?: unknown } {
    return {
      code: this.code,
      message: this.message,
      ...(this.details !== undefined && { details: this.details }),
    };
  }
}

/**
 * Create a GQP error with common patterns
 */
export const createError = {
  invalidAction: (action: string) =>
    new GQPError(
      GQPErrorCode.INVALID_ACTION,
      `Invalid action: "${action}". Valid actions are: explore, navigate, query, introspect`,
      { action, validActions: ["explore", "navigate", "query", "introspect"] },
    ),

  invalidNode: (node: string, pattern?: string) =>
    new GQPError(
      GQPErrorCode.INVALID_NODE,
      `Invalid node name: "${node}". ${pattern ? `Must match pattern: ${pattern}` : "Must be alphanumeric with underscores"}`,
      { node, pattern },
    ),

  nodeNotFound: (node: string, suggestions?: string[]) =>
    new GQPError(
      GQPErrorCode.NODE_NOT_FOUND,
      suggestions?.length
        ? `Node "${node}" not found. Did you mean: ${suggestions.join(", ")}?`
        : `Node "${node}" not found in schema`,
      { node, suggestions },
      404,
    ),

  nodeRequired: (action: string) =>
    new GQPError(
      GQPErrorCode.NODE_REQUIRED,
      `Node name is required for action "${action}"`,
      { action },
    ),

  adapterNotFound: (node: string) =>
    new GQPError(
      GQPErrorCode.ADAPTER_NOT_FOUND,
      `No adapter found for node "${node}"`,
      { node },
    ),

  validation: (field: string, message: string, value?: unknown) =>
    new GQPError(
      GQPErrorCode.VALIDATION_ERROR,
      `Validation error for "${field}": ${message}`,
      { field, message, value },
    ),

  accessDenied: (node: string, action?: string) =>
    new GQPError(
      GQPErrorCode.ACCESS_DENIED,
      `Access denied to node "${node}"${action ? ` for action "${action}"` : ""}`,
      { node, action },
      403,
    ),

  introspectionDisabled: () =>
    new GQPError(
      GQPErrorCode.INTROSPECTION_DISABLED,
      "Schema introspection is disabled in production",
      undefined,
      403,
    ),

  timeout: (operation: string, timeoutMs: number) =>
    new GQPError(
      GQPErrorCode.TIMEOUT_ERROR,
      `Operation "${operation}" timed out after ${timeoutMs}ms`,
      { operation, timeoutMs },
      504,
    ),

  cursorNotFound: (cursorId: string) =>
    new GQPError(
      GQPErrorCode.CURSOR_NOT_FOUND,
      `Cursor "${cursorId}" not found. It may have been evicted or never existed.`,
      { cursorId },
      404,
    ),

  cursorExpired: (cursorId: string) =>
    new GQPError(
      GQPErrorCode.CURSOR_EXPIRED,
      `Cursor "${cursorId}" has expired. Please create a new cursor.`,
      { cursorId },
      410,
    ),

  parseError: (input: string, error?: string) =>
    new GQPError(
      GQPErrorCode.PARSE_ERROR,
      `Failed to parse input: ${error || "malformed data"}`,
      { input: input.substring(0, 100), error },
    ),

  rateLimit: (limit: number, windowMs: number) =>
    new GQPError(
      GQPErrorCode.RATE_LIMIT_ERROR,
      `Rate limit exceeded: ${limit} requests per ${windowMs}ms`,
      { limit, windowMs },
      429,
    ),

  internal: (cause?: unknown) =>
    new GQPError(
      GQPErrorCode.INTERNAL_ERROR,
      cause instanceof Error ? cause.message : "An internal error occurred",
      { cause: cause instanceof Error ? cause.message : cause },
      500,
    ),
};

/**
 * Check if an error is a GQP error
 */
export function isGQPError(error: unknown): error is GQPError {
  return error instanceof GQPError;
}

/**
 * Wrap any error as a GQP error
 */
export function wrapError(error: unknown): GQPError {
  if (isGQPError(error)) {
    return error;
  }
  if (error instanceof Error) {
    return new GQPError(
      GQPErrorCode.INTERNAL_ERROR,
      error.message,
      { stack: error.stack },
      500,
    );
  }
  return createError.internal(error);
}
