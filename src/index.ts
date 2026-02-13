/**
 * GQP - The Universal Agent Data Layer
 * "Prisma for AI Agents"
 *
 * Transforms messy databases and APIs into an intelligent, traversable graph
 * optimized for LLM agents. Consolidates 50+ tools into 1 dynamic navigable tool.
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
 *
 * @packageDocumentation
 */

// Re-export everything from core
export * from "./core/index.js";

// Convenience re-exports
export { GQP } from "./core/engine.js";
export { GQPSchema } from "./core/schema.js";
export { GQPGraphCursor } from "./core/cursor.js";
