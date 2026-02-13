/**
 * MCP Bridge for GQP
 * Generates MCP server with single tool from GQP graph
 */

import type { GQP } from "../../core/engine.js";
import type { ToolCallParams } from "../../core/types.js";

/**
 * MCP Tool Definition
 */
export interface MCPTool {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[];
    };
}

/**
 * MCP Server Options
 */
export interface MCPServerOptions {
    /** Server name */
    name?: string;
    /** Server version */
    version?: string;
    /** Tool customization */
    tool?: {
        /** Custom tool name */
        name?: string;
        /** Custom description */
        description?: string;
    };
    /** Lifecycle hooks */
    hooks?: {
        beforeQuery?: (params: ToolCallParams) => Promise<ToolCallParams>;
        afterQuery?: (result: unknown) => Promise<unknown>;
        onError?: (error: Error) => Promise<void>;
    };
}

/**
 * Create MCP tool definition from GQP
 */
export function createMCPTool(graph: GQP, options: MCPServerOptions = {}): MCPTool {
    const toolDef = graph.getToolDefinition();

    return {
        name: options.tool?.name || toolDef.name,
        description: options.tool?.description || toolDef.description,
        inputSchema: toolDef.inputSchema as MCPTool["inputSchema"],
    };
}

/**
 * Create MCP tool handler
 */
export function createMCPHandler(
    graph: GQP,
    options: MCPServerOptions = {}
): (params: unknown) => Promise<{ type: "text"; text: string }[]> {
    return async (params) => {
        try {
            let toolParams = params as ToolCallParams;

            // Run beforeQuery hook
            if (options.hooks?.beforeQuery) {
                toolParams = await options.hooks.beforeQuery(toolParams);
            }

            // Execute
            let result = await graph.handleToolCall(toolParams);

            // Run afterQuery hook
            if (options.hooks?.afterQuery) {
                result = (await options.hooks.afterQuery(result)) as any;
            }

            return [
                {
                    type: "text" as const,
                    text: JSON.stringify(result, null, 2),
                },
            ];
        } catch (error) {
            // Run onError hook
            if (options.hooks?.onError) {
                await options.hooks.onError(error as Error);
            }

            return [
                {
                    type: "text" as const,
                    text: JSON.stringify({
                        error: true,
                        message: (error as Error).message,
                    }),
                },
            ];
        }
    };
}

/**
 * Serve GQP as MCP server
 *
 * This creates a complete MCP server with a single tool that consolidates
 * all data access into one navigable interface.
 *
 * @example
 * ```typescript
 * import { GQP } from '@mzhub/gqp';
 * import { serveMCP } from '@mzhub/gqp/mcp';
 * import { fromPrisma } from '@mzhub/gqp/prisma';
 *
 * const graph = new GQP({
 *   sources: { db: fromPrisma(prisma) }
 * });
 *
 * serveMCP(graph, {
 *   name: 'my-data-server',
 *   hooks: {
 *     beforeQuery: async (params) => {
 *       console.log('Query:', params);
 *       return params;
 *     }
 *   }
 * });
 * ```
 */
export async function serveMCP(
    graph: GQP,
    options: MCPServerOptions = {}
): Promise<void> {
    // Dynamic import to make @modelcontextprotocol/sdk optional
    const { Server } = (await import("@modelcontextprotocol/sdk/server/index.js" as any)) as any;
    const { StdioServerTransport } = (await import(
        "@modelcontextprotocol/sdk/server/stdio.js" as any
    )) as any;

    const serverName = options.name || "gqp-data-server";
    const serverVersion = options.version || "1.0.0";

    const server = new Server(
        {
            name: serverName,
            version: serverVersion,
        },
        {
            capabilities: {
                tools: {},
            },
        }
    );

    const tool = createMCPTool(graph, options);
    const handler = createMCPHandler(graph, options);

    // Handle tool listing
    server.setRequestHandler(
        { method: "tools/list" } as { method: string },
        async () => ({
            tools: [tool],
        })
    );

    // Handle tool calls
    server.setRequestHandler(
        { method: "tools/call" } as any,
        async (request: any) => {
            if (request.params.name !== tool.name) {
                throw new Error(`Unknown tool: ${request.params.name}`);
            }

            const content = await handler(request.params.arguments || {});
            return { content };
        }
    );

    // Connect to stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);

    // Log startup
    console.error(`[GQP] MCP server "${serverName}" started`);
}

/**
 * Create MCP server configuration for external use
 * Returns the configuration without starting the server
 */
export function getMCPConfig(graph: GQP, options: MCPServerOptions = {}): {
    tool: MCPTool;
    handler: (params: Record<string, unknown>) => Promise<{ type: "text"; text: string }[]>;
    serverInfo: { name: string; version: string };
} {
    return {
        tool: createMCPTool(graph, options),
        handler: createMCPHandler(graph, options),
        serverInfo: {
            name: options.name || "gqp-data-server",
            version: options.version || "1.0.0",
        },
    };
}
