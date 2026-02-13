/**
 * LangChain Bridge for GQP
 *
 * Two modes of operation:
 *
 * 1. Database Adapter Mode - Generate tools from data sources:
 * @example
 * ```typescript
 * import { createTool } from '@mzhub/gqp/langchain';
 *
 * const tool = await createTool(graph);
 * ```
 *
 * 2. Tool Wrapper Mode - Consolidate existing tools:
 * @example
 * ```typescript
 * import { wrapTools } from '@mzhub/gqp/langchain';
 *
 * const gqpTool = await wrapTools({
 *   graph: {
 *     Product: { tools: { search: searchProductsTool } }
 *   }
 * });
 * ```
 */

// Database adapter mode (GQP engine)
export {
    createTool,
    createActionTools,
    createToolFunction,
    getToolDefinition,
} from "./bridge.js";

export type { LangChainBridgeOptions } from "./bridge.js";

// Tool wrapper mode (consolidate existing tools)
export {
    wrapTools,
    createToolWrapper,
    ToolGraphWrapper,
} from "./wrapper.js";

export type {
    WrappedTool,
    ToolGraphNode,
    ToolGraph,
    WrapToolsConfig,
} from "./wrapper.js";
