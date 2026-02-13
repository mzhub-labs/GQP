/**
 * OpenAI Bridge for GQP
 *
 * @example
 * ```typescript
 * import { toOpenAIFunctions, createExecutor } from '@mzhub/gqp/openai';
 *
 * const functions = toOpenAIFunctions(graph);
 * const executor = createExecutor(graph);
 * ```
 */

export {
    toOpenAIFunctions,
    toOpenAITools,
    createExecutor,
    createToolExecutor,
    formatToolResult,
} from "./bridge.js";

export type {
    OpenAIFunction,
    OpenAIFunctionCall,
    OpenAITool,
    OpenAIBridgeOptions,
} from "./bridge.js";
