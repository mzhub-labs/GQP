/**
 * Vector Search Plugin for GQP
 *
 * @example
 * ```typescript
 * import { VectorPlugin } from '@mzhub/gqp/vector';
 *
 * const graph = new GQP({
 *   plugins: [
 *     new VectorPlugin({
 *       provider: 'pinecone',
 *       config: { ... }
 *     })
 *   ]
 * });
 * ```
 */

export { VectorPlugin, createVectorPlugin } from "./plugin.js";
export type {
    VectorPluginConfig,
    VectorProviderConfig,
    AutoIndexConfig,
} from "./plugin.js";
