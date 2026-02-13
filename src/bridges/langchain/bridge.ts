/**
 * LangChain Bridge for GQP
 * Creates LangChain tools from GQP graph
 */

import type { GQP } from "../../core/engine.js";
import type { ToolCallParams, ToolCallResult } from "../../core/types.js";

/**
 * LangChain tool options
 */
export interface LangChainBridgeOptions {
  /** Custom tool name */
  name?: string;
  /** Custom description */
  description?: string;
  /** Description style */
  descriptionStyle?: "concise" | "verbose";
  /** Max traversal depth */
  maxDepth?: number;
  /** Enable cursor for session continuity */
  enableCursor?: boolean;
}

/**
 * Zod schema for the GQP tool
 * This is created at runtime to avoid requiring zod as a dependency
 */
function createZodSchema(): {
  schema: unknown;
  zodImport: typeof import("zod") | null;
} {
  try {
    // Dynamic require to make zod optional
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const zod = require("zod");
    const z = zod.z || zod;

    const schema = z.object({
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
    });

    return { schema, zodImport: zod };
  } catch {
    return { schema: null, zodImport: null };
  }
}

/**
 * Create a LangChain DynamicStructuredTool from GQP
 *
 * @example
 * ```typescript
 * import { createTool } from '@mzhub/gqp/langchain';
 * import { ChatOpenAI } from 'langchain/chat_models/openai';
 *
 * const tool = createTool(graph);
 *
 * const agent = createToolCallingAgent({
 *   llm: new ChatOpenAI({ modelName: 'gpt-4' }),
 *   tools: [tool]
 * });
 * ```
 */
export async function createTool(
  graph: GQP,
  options: LangChainBridgeOptions = {},
): Promise<unknown> {
  // Dynamic import to make langchain optional
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { DynamicStructuredTool } =
    (await import("@langchain/core/tools")) as any;

  const toolDef = graph.getToolDefinition();
  const { schema } = createZodSchema();

  if (!schema) {
    throw new Error(
      "zod is required for LangChain integration. Install it with: npm install zod",
    );
  }

  const name = options.name || toolDef.name;

  let description = options.description || toolDef.description;
  if (options.descriptionStyle === "concise") {
    description =
      "Navigate and query data using a graph interface. Use explore to discover data, navigate to focus on a node, query to search.";
  }

  return new DynamicStructuredTool({
    name,
    description,
    schema,
    func: async (params: ToolCallParams): Promise<string> => {
      const result = await graph.handleToolCall(params);
      return JSON.stringify(result, null, 2);
    },
  });
}

/**
 * Create multiple LangChain tools (one per action) for simpler agent interactions
 */
export async function createActionTools(
  graph: GQP,
  options: LangChainBridgeOptions = {},
): Promise<unknown[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { DynamicStructuredTool } =
    (await import("@langchain/core/tools")) as any;
  const { zodImport } = createZodSchema();

  if (!zodImport) {
    throw new Error("zod is required for LangChain integration");
  }

  const z = zodImport.z || zodImport;
  const tools: unknown[] = [];

  // Explore tool
  tools.push(
    new DynamicStructuredTool({
      name: options.name ? `${options.name}_explore` : "explore_data",
      description:
        "Discover available data nodes. Call this first to see what data is available.",
      schema: z.object({}),
      func: async (): Promise<string> => {
        const result = await graph.handleToolCall({ action: "explore" });
        return JSON.stringify(result, null, 2);
      },
    }),
  );

  // Navigate tool
  tools.push(
    new DynamicStructuredTool({
      name: options.name ? `${options.name}_navigate` : "navigate_to_node",
      description:
        "Focus on a specific data node to see its fields and relations. Use this after exploring.",
      schema: z.object({
        node: z.string().describe("Name of the node to navigate to"),
      }),
      func: async (params: { node: string }): Promise<string> => {
        const result = await graph.handleToolCall({
          action: "navigate",
          node: params.node,
        });
        return JSON.stringify(result, null, 2);
      },
    }),
  );

  // Query tool
  tools.push(
    new DynamicStructuredTool({
      name: options.name ? `${options.name}_query` : "query_data",
      description:
        "Search and filter data within a node. Use filters to narrow results.",
      schema: z.object({
        node: z.string().describe("Name of the node to query"),
        query: z.string().optional().describe("Semantic search query"),
        filters: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Field filters"),
        limit: z.number().optional().default(10).describe("Max results"),
      }),
      func: async (params: {
        node: string;
        query?: string;
        filters?: Record<string, unknown>;
        limit?: number;
      }): Promise<string> => {
        const result = await graph.handleToolCall({
          action: "query",
          node: params.node,
          query: params.query,
          filters: params.filters,
          options: { limit: params.limit },
        });
        return JSON.stringify(result, null, 2);
      },
    }),
  );

  return tools;
}

/**
 * Create a simple function wrapper for use with LangChain
 * This is useful when you want to handle the tool definition yourself
 */
export function createToolFunction(
  graph: GQP,
): (params: ToolCallParams) => Promise<ToolCallResult> {
  return async (params) => graph.handleToolCall(params);
}

/**
 * Get tool definition in LangChain format
 */
export function getToolDefinition(
  graph: GQP,
  options: LangChainBridgeOptions = {},
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
