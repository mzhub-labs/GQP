export interface WrappedTool {
  /** The actual tool instance (DynamicStructuredTool or similar) */
  tool: unknown;
  /** Tool name */
  name: string;
  /** Tool description */
  description: string;
  /** Tool schema/parameters (zod schema) */
  schema?: unknown;
}

/**
 * A node in the tool graph
 */
export interface ToolGraphNode {
  /** Human-readable description of this node */
  description?: string;
  /** Map of operation names to tools */
  tools: Record<string, WrappedTool | unknown>;
  /** Relations to other nodes */
  relations?: Record<string, string>;
}

/**
 * Full tool graph configuration
 */
export interface ToolGraph {
  [nodeName: string]: ToolGraphNode;
}

/**
 * Configuration for wrapTools
 */
export interface WrapToolsConfig {
  /** The tool graph structure */
  graph: ToolGraph;
  /** Custom tool name (default: navigate_tools) */
  toolName?: string;
  /** Custom tool description */
  toolDescription?: string;
}

/**
 * Result from tool wrapper operations
 */
export interface WrapperResult {
  [key: string]: unknown;
}

/**
 * Tool Graph Wrapper - the core engine for tool consolidation
 */
export class ToolGraphWrapper {
  private graph: ToolGraph;
  private toolIndex: Map<
    string,
    { node: string; operation: string; tool: unknown }
  > = new Map();

  constructor(graph: ToolGraph) {
    this.graph = graph;
    this.buildIndex();
  }

  /**
   * Build an index of all tools for fast lookup
   */
  private buildIndex(): void {
    for (const [nodeName, node] of Object.entries(this.graph)) {
      for (const [opName, tool] of Object.entries(node.tools)) {
        const key = `${nodeName}.${opName}`;
        this.toolIndex.set(key, { node: nodeName, operation: opName, tool });
      }
    }
  }

  /**
   * Explore: Show available nodes
   */
  explore(): WrapperResult {
    const nodes = Object.entries(this.graph).map(([name, node]) => ({
      name,
      description: node.description,
      operations: Object.keys(node.tools),
      relations: node.relations ? Object.keys(node.relations) : [],
    }));

    return {
      availableNodes: nodes,
      message:
        "Use navigate to see operations for a specific node, or execute to run a tool directly.",
      totalNodes: nodes.length,
    };
  }

  /**
   * Navigate: Show operations for a specific node
   */
  navigate(nodeName: string): WrapperResult {
    const node = this.graph[nodeName];
    if (!node) {
      throw new Error(
        `Unknown node: "${nodeName}". Use explore to see available nodes.`,
      );
    }

    const operations = Object.entries(node.tools).map(([opName, tool]) => {
      const wrappedTool = this.extractToolInfo(tool);
      return {
        name: opName,
        description: wrappedTool.description,
        parameters: this.schemaToParams(wrappedTool.schema),
      };
    });

    const relations = node.relations
      ? Object.entries(node.relations).map(([name, target]) => ({
          name,
          target,
        }))
      : [];

    return {
      currentNode: nodeName,
      description: node.description,
      operations,
      relations,
      message: `Use execute with node="${nodeName}" and operation="<op>" to run a tool.`,
    };
  }

  /**
   * Execute: Run the actual tool
   */
  async execute(
    nodeName: string,
    operation: string,
    params: Record<string, unknown> = {},
  ): Promise<WrapperResult> {
    const key = `${nodeName}.${operation}`;
    const entry = this.toolIndex.get(key);

    if (!entry) {
      const node = this.graph[nodeName];
      if (!node) {
        throw new Error(`Unknown node: "${nodeName}"`);
      }
      const available = Object.keys(node.tools).join(", ");
      throw new Error(
        `Unknown operation: "${operation}". Available: ${available}`,
      );
    }

    const tool = entry.tool as {
      invoke?: (params: unknown) => Promise<unknown>;
      func?: (params: unknown) => Promise<unknown>;
    };

    // Call the actual tool
    let result: unknown;
    if (typeof tool.invoke === "function") {
      result = await tool.invoke(params);
    } else if (typeof tool.func === "function") {
      result = await tool.func(params);
    } else if (typeof tool === "function") {
      result = await (tool as (params: unknown) => Promise<unknown>)(params);
    } else {
      throw new Error(`Tool "${key}" is not callable`);
    }

    // Parse result if it's a JSON string
    if (typeof result === "string") {
      try {
        result = JSON.parse(result);
      } catch {
        // Keep as string if not valid JSON
      }
    }

    return {
      node: nodeName,
      operation,
      data: result,
      suggestions: this.getSuggestions(nodeName),
    };
  }

  /**
   * Get suggestions for next actions based on current node
   */
  private getSuggestions(nodeName: string): string[] {
    const node = this.graph[nodeName];
    if (!node) return [];

    const suggestions: string[] = [];

    // Suggest related nodes
    if (node.relations) {
      for (const [relName, target] of Object.entries(node.relations)) {
        suggestions.push(`Navigate to ${target} (${relName})`);
      }
    }

    return suggestions.slice(0, 3);
  }

  /**
   * Extract tool info from various tool formats
   */
  private extractToolInfo(tool: unknown): WrappedTool {
    const t = tool as Record<string, unknown>;

    return {
      tool,
      name: (t.name as string) || "unknown",
      description: (t.description as string) || "",
      schema: t.schema,
    };
  }

  /**
   * Convert zod schema to simple parameter description
   */
  private schemaToParams(schema: unknown): Record<string, string> | undefined {
    if (!schema) return undefined;

    const s = schema as {
      shape?: Record<
        string,
        { description?: string; _def?: { typeName?: string } }
      >;
    };
    if (!s.shape) return undefined;

    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(s.shape)) {
      const type = value._def?.typeName?.replace("Zod", "") || "unknown";
      const desc = value.description || "";
      params[key] = desc ? `${type} - ${desc}` : type;
    }

    return params;
  }

  /**
   * Get tool definition for the wrapper
   */
  getToolDefinition(
    name: string,
    description: string,
  ): { name: string; description: string; inputSchema: object } {
    return {
      name,
      description,
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["explore", "navigate", "execute"],
            description:
              "Action to perform: explore (list nodes), navigate (see node details), execute (run a tool)",
          },
          node: {
            type: "string",
            description: "Node name (required for navigate/execute)",
          },
          operation: {
            type: "string",
            description: "Operation name (required for execute)",
          },
          params: {
            type: "object",
            description: "Parameters to pass to the tool (for execute)",
            additionalProperties: true,
          },
        },
        required: ["action"],
      },
    };
  }

  /**
   * Handle a tool call
   */
  async handleToolCall(params: {
    action: "explore" | "navigate" | "execute";
    node?: string;
    operation?: string;
    params?: Record<string, unknown>;
  }): Promise<WrapperResult> {
    switch (params.action) {
      case "explore":
        return this.explore();

      case "navigate":
        if (!params.node) {
          throw new Error("node is required for navigate action");
        }
        return this.navigate(params.node);

      case "execute":
        if (!params.node || !params.operation) {
          throw new Error("node and operation are required for execute action");
        }
        return this.execute(params.node, params.operation, params.params || {});

      default:
        throw new Error(
          `Unknown action: ${(params as { action: string }).action}`,
        );
    }
  }
}

/**
 * Input parameters for wrapper tool
 */
interface WrapToolParams {
  action: "explore" | "navigate" | "execute";
  node?: string;
  operation?: string;
  params?: Record<string, unknown>;
}

/**
 * Wrap existing LangChain tools into ONE navigable interface
 *
 * @example
 * ```typescript
 * import { wrapTools } from '@mzhub/gqp/langchain';
 * import {
 *   searchProductsTool,
 *   getProductDetailsTool,
 *   searchVendorsTool,
 *   listOrdersTool
 * } from './tools';
 *
 * const gqpTool = await wrapTools({
 *   graph: {
 *     Product: {
 *       description: 'Product catalog',
 *       tools: {
 *         search: searchProductsTool,
 *         getDetails: getProductDetailsTool
 *       },
 *       relations: {
 *         vendor: 'Vendor'
 *       }
 *     },
 *     Vendor: {
 *       description: 'Vendor search',
 *       tools: {
 *         search: searchVendorsTool
 *       }
 *     },
 *     Order: {
 *       description: 'Order history',
 *       tools: {
 *         list: listOrdersTool
 *       }
 *     }
 *   }
 * });
 *
 * // Now use ONE tool instead of many
 * const agent = createReactAgent({
 *   llm,
 *   tools: [
 *     gqpTool,           // Wraps all read tools
 *     createOrderTool,   // Keep action tools separate
 *   ]
 * });
 * ```
 */
export async function wrapTools(config: WrapToolsConfig): Promise<unknown> {
  // Dynamic import to make langchain optional
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { DynamicStructuredTool } =
    (await import("@langchain/core/tools")) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { z } = (await import("zod")) as any;

  const wrapper = new ToolGraphWrapper(config.graph);

  const toolName = config.toolName || "navigate_tools";
  const toolDescription =
    config.toolDescription ||
    "Navigate and execute available tools using a graph interface. " +
      "Use explore to see available nodes, navigate to see operations for a node, " +
      "and execute to run a specific tool.";

  return new DynamicStructuredTool({
    name: toolName,
    description: toolDescription,
    schema: z.object({
      action: z
        .enum(["explore", "navigate", "execute"])
        .describe(
          "Action: explore (list nodes), navigate (see node details), execute (run tool)",
        ),
      node: z.string().optional().describe("Node name (for navigate/execute)"),
      operation: z.string().optional().describe("Operation name (for execute)"),
      params: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Tool parameters (for execute)"),
    }),
    func: async (params: WrapToolParams): Promise<string> => {
      const result = await wrapper.handleToolCall(params);
      return JSON.stringify(result, null, 2);
    },
  });
}

/**
 * Create wrapper without LangChain dependency (for other frameworks)
 */
export function createToolWrapper(config: WrapToolsConfig): ToolGraphWrapper {
  return new ToolGraphWrapper(config.graph);
}
