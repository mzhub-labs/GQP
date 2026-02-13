/**
 * Vercel AI SDK Bridge for GQP
 * Creates Vercel AI SDK tools from GQP graph
 */

import type { GQP } from "../../core/engine.js";
import type { ToolCallParams } from "../../core/types.js";

/**
 * Vercel AI tool options
 */
export interface VercelAIBridgeOptions {
    /** Custom tool name */
    name?: string;
    /** Custom description */
    description?: string;
}

/**
 * Create Vercel AI SDK tool from GQP
 *
 * @example
 * ```typescript
 * import { createTools } from '@mzhub/gqp/vercel-ai';
 * import { streamText } from 'ai';
 * import { openai } from '@ai-sdk/openai';
 *
 * const tools = createTools(graph);
 *
 * const result = await streamText({
 *   model: openai('gpt-4-turbo'),
 *   prompt: 'Find customers with high-value orders',
 *   tools,
 * });
 * ```
 */
export async function createTools(
    graph: GQP,
    options: VercelAIBridgeOptions = {}
): Promise<Record<string, unknown>> {
    // Dynamic import to make ai package optional
    const { tool } = (await import("ai" as any)) as any;
    const { z } = await import("zod");

    const toolDef = graph.getToolDefinition();
    const name = options.name || toolDef.name;

    return {
        [name]: tool({
            description: options.description || toolDef.description,
            parameters: z.object({
                action: z.enum(["explore", "navigate", "query", "introspect"]),
                node: z.string().optional(),
                query: z.string().optional(),
                filters: z.record(z.string(), z.unknown()).optional(),
                options: z
                    .object({
                        limit: z.number().optional().default(10),
                        offset: z.number().optional().default(0),
                        include: z.array(z.string()).optional(),
                    })
                    .optional(),
                cursorId: z.string().optional(),
            }),
            execute: async (params: ToolCallParams) => {
                return graph.handleToolCall(params);
            },
        }),
    };
}

/**
 * Create separate tools for each action
 */
export async function createActionTools(
    graph: GQP,
    options: VercelAIBridgeOptions = {}
): Promise<Record<string, unknown>> {
    const { tool } = (await import("ai" as any)) as any;
    const { z } = await import("zod");

    const prefix = options.name || "data";

    return {
        [`${prefix}_explore`]: tool({
            description: "Discover available data nodes",
            parameters: z.object({}),
            execute: async () => graph.handleToolCall({ action: "explore" }),
        }),

        [`${prefix}_navigate`]: tool({
            description: "Focus on a specific data node to see its fields and relations",
            parameters: z.object({
                node: z.string().describe("Name of the node to navigate to"),
            }),
            execute: async (params: { node: string }) =>
                graph.handleToolCall({ action: "navigate", node: params.node }),
        }),

        [`${prefix}_query`]: tool({
            description: "Search and filter data within a node",
            parameters: z.object({
                node: z.string().describe("Name of the node to query"),
                query: z.string().optional().describe("Semantic search query"),
                filters: z.record(z.string(), z.unknown()).optional().describe("Field filters"),
                limit: z.number().optional().default(10).describe("Max results"),
            }),
            execute: async (params: {
                node: string;
                query?: string;
                filters?: Record<string, unknown>;
                limit?: number;
            }) =>
                graph.handleToolCall({
                    action: "query",
                    node: params.node,
                    query: params.query,
                    filters: params.filters,
                    options: { limit: params.limit },
                }),
        }),
    };
}

/**
 * Get tool schema for manual use
 */
export function getToolSchema(
    graph: GQP,
    options: VercelAIBridgeOptions = {}
): {
    name: string;
    description: string;
    parameters: object;
} {
    const toolDef = graph.getToolDefinition();

    return {
        name: options.name || toolDef.name,
        description: options.description || toolDef.description,
        parameters: toolDef.inputSchema,
    };
}
