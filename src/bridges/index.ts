/**
 * GQP Bridges
 * Framework integrations
 */

// MCP
export { serveMCP, createMCPTool, createMCPHandler, getMCPConfig } from "./mcp/index.js";
export type { MCPTool, MCPServerOptions } from "./mcp/index.js";

// OpenAI
export {
    toOpenAIFunctions,
    toOpenAITools,
    createExecutor as createOpenAIExecutor,
    createToolExecutor as createOpenAIToolExecutor,
    formatToolResult,
} from "./openai/index.js";
export type {
    OpenAIFunction,
    OpenAIFunctionCall,
    OpenAITool,
    OpenAIBridgeOptions,
} from "./openai/index.js";

// LangChain
export {
    createTool as createLangChainTool,
    createActionTools as createLangChainActionTools,
    createToolFunction as createLangChainToolFunction,
    getToolDefinition as getLangChainToolDefinition,
    wrapTools,
    createToolWrapper,
    ToolGraphWrapper,
} from "./langchain/index.js";
export type {
    LangChainBridgeOptions,
    WrappedTool,
    ToolGraphNode,
    ToolGraph,
    WrapToolsConfig,
} from "./langchain/index.js";

// Vercel AI
export {
    createTools as createVercelAITools,
    createActionTools as createVercelAIActionTools,
    getToolSchema as getVercelAIToolSchema,
} from "./vercel-ai/index.js";
export type { VercelAIBridgeOptions } from "./vercel-ai/index.js";
