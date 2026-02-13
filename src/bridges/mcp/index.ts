/**
 * MCP Bridge for GQP
 *
 * @example
 * ```typescript
 * import { GQP } from '@mzhub/gqp';
 * import { serveMCP } from '@mzhub/gqp/mcp';
 *
 * const graph = new GQP({
 *   sources: { db: fromPrisma(prisma) }
 * });
 *
 * // Start MCP server
 * serveMCP(graph);
 * ```
 */

export {
    serveMCP,
    createMCPTool,
    createMCPHandler,
    getMCPConfig,
} from "./server.js";

export type { MCPTool, MCPServerOptions } from "./server.js";
