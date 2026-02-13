

import type { GQP } from "../../core/engine.js";
import type { ToolCallParams, ToolCallResult } from "../../core/types.js";

/**
 * OpenAI Function Definition
 */
export interface OpenAIFunction {
    name: string;
    description: string;
    parameters: {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[];
    };
}

/**
 * OpenAI Function Call (from API response)
 */
export interface OpenAIFunctionCall {
    name: string;
    arguments: string;
}

/**
 * OpenAI Tool Definition (newer format)
 */
export interface OpenAITool {
    type: "function";
    function: OpenAIFunction;
}

/**
 * Bridge options
 */
export interface OpenAIBridgeOptions {
    /** Naming convention for function name */
    naming?: "camelCase" | "snake_case";
    /** Include example queries in description */
    includeExamples?: boolean;
    /** Custom function name */
    functionName?: string;
    /** Custom description */
    description?: string;
}

/**
 * Convert GQP to OpenAI function definitions
 *
 * @example
 * ```typescript
 * import { toOpenAIFunctions } from '@mzhub/gqp/openai';
 *
 * const functions = toOpenAIFunctions(graph);
 *
 * const response = await openai.chat.completions.create({
 *   model: 'gpt-4-turbo',
 *   messages: [...],
 *   functions,
 *   function_call: 'auto'
 * });
 * ```
 */
export function toOpenAIFunctions(
    graph: GQP,
    options: OpenAIBridgeOptions = {}
): OpenAIFunction[] {
    const toolDef = graph.getToolDefinition();

    let name = options.functionName || toolDef.name;
    if (options.naming === "snake_case") {
        name = name.replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_/, "");
    }

    let description = options.description || toolDef.description;
    if (options.includeExamples) {
        description += `

Example calls:
- Explore available data: {"action": "explore"}
- Navigate to Orders: {"action": "navigate", "node": "Order"}
- Query orders: {"action": "query", "node": "Order", "filters": {"status": "pending"}}`;
    }

    return [
        {
            name,
            description,
            parameters: toolDef.inputSchema as OpenAIFunction["parameters"],
        },
    ];
}

/**
 * Convert GQP to OpenAI tools format (newer API)
 */
export function toOpenAITools(
    graph: GQP,
    options: OpenAIBridgeOptions = {}
): OpenAITool[] {
    const functions = toOpenAIFunctions(graph, options);

    return functions.map((fn) => ({
        type: "function" as const,
        function: fn,
    }));
}

/**
 * Create an executor for OpenAI function calls
 *
 * @example
 * ```typescript
 * import { toOpenAIFunctions, createExecutor } from '@mzhub/gqp/openai';
 *
 * const executor = createExecutor(graph);
 *
 * if (response.choices[0].message.function_call) {
 *   const result = await executor(response.choices[0].message.function_call);
 * }
 * ```
 */
export function createExecutor(
    graph: GQP
): (functionCall: OpenAIFunctionCall) => Promise<ToolCallResult> {
    return async (functionCall) => {
        const params = JSON.parse(functionCall.arguments) as ToolCallParams;
        return graph.handleToolCall(params);
    };
}

/**
 * Create a tool executor for OpenAI tool calls (newer API)
 */
export function createToolExecutor(
    graph: GQP
): (toolCall: { function: OpenAIFunctionCall }) => Promise<ToolCallResult> {
    const executor = createExecutor(graph);
    return async (toolCall) => executor(toolCall.function);
}

/**
 * Helper to format result for OpenAI tool response
 */
export function formatToolResult(result: ToolCallResult): string {
    return JSON.stringify(result, null, 2);
}
