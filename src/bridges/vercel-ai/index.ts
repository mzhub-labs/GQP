/**
 * Vercel AI SDK Bridge for GQP
 *
 * @example
 * ```typescript
 * import { createTools } from '@mzhub/gqp/vercel-ai';
 * import { streamText } from 'ai';
 *
 * const tools = await createTools(graph);
 *
 * const result = await streamText({
 *   model: openai('gpt-4-turbo'),
 *   tools,
 * });
 * ```
 */

export { createTools, createActionTools, getToolSchema } from "./bridge.js";

export type { VercelAIBridgeOptions } from "./bridge.js";
